"""The method registry: one entry per spec-7 method.

Each entry is request-shape validation + a chainladder invocation + result
authoring through the actuarial-interchange package (``extract_result``
for MethodResultDocs; ``StochasticResultPayload`` for the bootstrap).
Honesty rules carried through:

- Selections replay via ``selection_doc_to_estimators`` — computable
  intents natively, value-only intents via ``DevelopmentConstant`` — and
  every replay warning the bridge raises lands in the result document's
  ``warnings`` array. Under ``parameters.strictness = "strict"`` a replay
  compromise (or an incoherent selection) is refused with 422.
- The Mack-SE-less rule (spec 3.2): Mack atop a value-only selection is
  answered SE-less via a plain ``Chainladder`` fit with an explicit
  warning (the document's method says ``clpy:Chainladder`` because that is
  what actually ran), or refused with 422 under strict.
- Convention profiles are DERIVED from what the run actually did, never
  taken from the caller: ``deterministic-cl`` for Chainladder point
  estimates, ``mack1993-vw`` only when the factors are volume-weighted
  all-period with ``sigma_interpolation="mack"`` and no exclusions,
  ``odp-bootstrap-distribution`` for the bootstrap. Everything else is
  stamped profile-less.
- ``engagementRef`` passes through OPAQUELY into the result document's
  ``extensions`` — the only correlation the wire permits (spec 7/12).
"""

from __future__ import annotations

import warnings as _warnings
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Callable, Optional

import chainladder as cl
import numpy as np

from actuarial_interchange import (
    Document,
    EngineStamp,
    ResultAppliesTo,
    StochasticResultPayload,
)
from actuarial_interchange.bridge_result import ENGINE_NAME, extract_result
from actuarial_interchange.bridge_selection import fit_mack, selection_doc_to_estimators
from actuarial_interchange.bridge_triangle import triangle_doc_to_cl
from actuarial_interchange.errors import InterchangeError, InterchangeWarning

from .wire import RunRequest, SidecarError

__all__ = ["METHODS", "MethodEntry", "run_method"]

_ALLOWED_AVERAGES = ("volume", "simple", "regression")
_ALLOWED_SIGMA_INTERPOLATIONS = ("log-linear", "mack")
_ALLOWED_STRICTNESS = ("warn", "strict")
_ALLOWED_GROWTH = ("loglogistic", "weibull")
_PERCENTILE_LABELS = (5, 25, 50, 75, 90, 95, 99)
_DEFAULT_N_SIMS = 1000
#: Operational ceiling: the bootstrap is O(n_sims); an unbounded count is a
#: denial-of-service knob, not a modeling knob.
_MAX_N_SIMS = 100_000


# ---------------------------------------------------------------------------
# Parameter validation helpers
# ---------------------------------------------------------------------------


def _check_parameter_keys(request: RunRequest, allowed: frozenset) -> None:
    unknown = set(request.parameters) - set(allowed)
    if unknown:
        raise SidecarError(
            422,
            "UNKNOWN_PARAMETER",
            f"unknown parameter(s) {sorted(unknown)}; this method accepts {sorted(allowed)}",
        )


def _choice(request: RunRequest, key: str, allowed: tuple, default: str) -> str:
    value = request.parameters.get(key, default)
    if value not in allowed:
        raise SidecarError(
            422,
            "INVALID_PARAMETER",
            f"'parameters.{key}' must be one of {list(allowed)}, got {value!r}",
        )
    return value


def _number(request: RunRequest, key: str, default: float) -> float:
    value = request.parameters.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SidecarError(
            422, "INVALID_PARAMETER", f"'parameters.{key}' must be a number, got {value!r}"
        )
    return float(value)


def _positive_int(request: RunRequest, key: str, default: int, maximum: Optional[int] = None) -> int:
    value = request.parameters.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise SidecarError(
            422, "INVALID_PARAMETER", f"'parameters.{key}' must be a positive integer, got {value!r}"
        )
    if maximum is not None and value > maximum:
        raise SidecarError(
            422, "INVALID_PARAMETER", f"'parameters.{key}' must be <= {maximum}, got {value}"
        )
    return value


def _n_periods(request: RunRequest) -> int:
    value = request.parameters.get("n_periods", -1)
    if isinstance(value, bool) or not isinstance(value, int) or (value != -1 and value < 1):
        raise SidecarError(
            422,
            "INVALID_PARAMETER",
            f"'parameters.n_periods' must be -1 (all periods) or a positive integer, got {value!r}",
        )
    return value


# ---------------------------------------------------------------------------
# Development replay (shared by every selection-consuming method)
# ---------------------------------------------------------------------------


@dataclass
class ReplayedDevelopment:
    """The development (and optional tail) estimator a run will use, plus
    the honest parameter echo and the replay warnings it produced."""

    estimator: object
    tail: Optional[object]
    parameters: dict
    selection_integrity: Optional[str]
    warnings: list
    value_only: bool


@contextmanager
def _capturing_interchange_warnings(sink: list):
    """Collect InterchangeWarning messages into ``sink`` (they belong in the
    result document, not on stderr); silence chainladder's unrelated
    numpy-usage warnings so the capture window stays clean."""
    with _warnings.catch_warnings(record=True) as caught:
        _warnings.simplefilter("always")
        yield
    for warning in caught:
        if issubclass(warning.category, InterchangeWarning):
            sink.append(str(warning.message))


def _native_development_echo(estimator: "cl.Development") -> dict:
    params = estimator.get_params(deep=False)
    echo: dict = {"average": params["average"], "n_periods": params["n_periods"]}
    if params.get("drop"):
        echo["drop"] = [[str(origin), int(age)] for origin, age in params["drop"]]
    return echo


def _value_only_echo(estimator: "cl.DevelopmentConstant") -> dict:
    params = estimator.get_params(deep=False)
    return {
        "patterns": {str(age): float(value) for age, value in params["patterns"].items()},
        "style": params["style"],
    }


def _replay_development(
    request: RunRequest, triangle: "cl.Triangle", strictness: str
) -> ReplayedDevelopment:
    """Selection supplied -> bridge replay (warnings captured, strictness
    honored); no selection -> Development built from parameters."""
    if request.selection is None:
        average = _choice(request, "average", _ALLOWED_AVERAGES, "volume")
        n_periods = _n_periods(request)
        estimator = cl.Development(average=average, n_periods=n_periods)
        return ReplayedDevelopment(
            estimator=estimator,
            tail=None,
            parameters={"average": average, "n_periods": n_periods},
            selection_integrity=None,
            warnings=[],
            value_only=False,
        )

    for key in ("average", "n_periods"):
        if key in request.parameters:
            raise SidecarError(
                422,
                "INVALID_PARAMETER",
                f"'parameters.{key}' conflicts with 'selection': the selection "
                "document is the development intent; drop one of the two",
            )

    captured: list = []
    try:
        with _capturing_interchange_warnings(captured):
            estimator, tail = selection_doc_to_estimators(
                request.selection, triangle=triangle, strict=(strictness == "strict")
            )
    except InterchangeError as exc:
        raise SidecarError(422, "REPLAY_REFUSED", str(exc)) from exc

    value_only = isinstance(estimator, cl.DevelopmentConstant)
    parameters = _value_only_echo(estimator) if value_only else _native_development_echo(estimator)
    if tail is not None:
        parameters["tail"] = {
            str(key): value
            for key, value in tail.get_params(deep=False).items()
            if value is not None
        }
    return ReplayedDevelopment(
        estimator=estimator,
        tail=tail,
        parameters=parameters,
        selection_integrity=request.selection.integrity(),
        warnings=captured,
        value_only=value_only,
    )


def _transformed(triangle: "cl.Triangle", replay: ReplayedDevelopment) -> "cl.Triangle":
    transformed = replay.estimator.fit_transform(triangle)
    if replay.tail is not None:
        transformed = replay.tail.fit_transform(transformed)
    return transformed


# ---------------------------------------------------------------------------
# Shared request-shape guards
# ---------------------------------------------------------------------------


def _refuse_secondary(request: RunRequest, method: str) -> None:
    if request.secondary is not None:
        raise SidecarError(
            422,
            "INVALID_REQUEST",
            f"'triangles.secondary' is not consumed by {method}; only "
            "MunichAdjustment takes a secondary (incurred) triangle",
        )


def _refuse_exposure(request: RunRequest, method: str) -> None:
    if request.exposure is not None:
        raise SidecarError(
            422,
            "INVALID_REQUEST",
            f"'exposure' is not consumed by {method}; only BornhuetterFerguson, "
            "Benktander, and CapeCod take an exposure base",
        )


def _refuse_seed(request: RunRequest, method: str) -> None:
    if request.seed is not None:
        raise SidecarError(
            422,
            "INVALID_REQUEST",
            f"'seed' is not consumed by {method}; only BootstrapODPSample is "
            "seeded — a seed on a deterministic method would be a misleading no-op",
        )


def _refuse_selection(request: RunRequest, method: str, reason: str) -> None:
    if request.selection is not None:
        raise SidecarError(
            422,
            "INVALID_REQUEST",
            f"'selection' is not consumed by {method}: {reason}",
        )


# ---------------------------------------------------------------------------
# Result authoring
# ---------------------------------------------------------------------------


def _attach_engagement_ref(document: Document, request: RunRequest) -> Document:
    if request.engagement_ref is not None:
        # Authoring default extensions is {}; the opaque ref is the ONLY
        # correlation identifier the wire permits.
        extensions = dict(document.extensions or {})
        extensions["engagementRef"] = request.engagement_ref
        document.extensions = extensions
    return document


def _author_method_result(
    fitted: object,
    request: RunRequest,
    created_at: str,
    *,
    parameters: dict,
    convention_profile: Optional[str],
    selection_integrity: Optional[str],
    warnings: list,
    method_override: Optional[str] = None,
) -> Document:
    document = extract_result(
        fitted,
        created_at=created_at,
        triangle_integrity=request.primary.integrity(),
        selection_integrity=selection_integrity,
        parameters=parameters,
        convention_profile=convention_profile,
        warnings=warnings or None,
    )
    if method_override is not None:
        # extract_result names the method after the fitted estimator type;
        # for composite pipelines (Clark growth-curve development + CL
        # projection; Munich-adjusted CL projection) the requested method IS
        # the pipeline, so the label is corrected here. The integrity tag is
        # always computed from the current body, so this is safe.
        document.payload.method = method_override
    return _attach_engagement_ref(document, request)


# ---------------------------------------------------------------------------
# Exposure -> sample_weight bridge (BF / Benktander / CapeCod)
# ---------------------------------------------------------------------------


def _exposure_sample_weight(request: RunRequest, triangle: "cl.Triangle") -> "cl.Triangle":
    """The typed exposure vector -> the latest-diagonal Triangle chainladder
    expects as ``sample_weight``. Origins must cover the primary triangle's
    origins exactly — a partial vector would silently NaN origins."""
    exposure = request.exposure
    assert exposure is not None  # guarded by the runner
    payload = request.primary.payload
    labels = [origin.label for origin in payload.origins]
    if sorted(exposure.origins) != sorted(labels):
        raise SidecarError(
            422,
            "INVALID_EXPOSURE",
            f"'exposure.origins' must match the primary triangle's origins "
            f"exactly; triangle has {labels}, exposure has {exposure.origins}",
        )
    import pandas as pd  # deferred: pandas is heavy and already a dependency

    value_by_label = dict(zip(exposure.origins, exposure.values))
    frame = pd.DataFrame(
        [
            (pd.Timestamp(origin.start), triangle.valuation_date, value_by_label[origin.label])
            for origin in payload.origins
        ],
        columns=["origin", "development", exposure.kind],
    )
    exposure_triangle = cl.Triangle(
        frame,
        origin="origin",
        development="development",
        columns=exposure.kind,
        cumulative=True,
    )
    return exposure_triangle.latest_diagonal


def _require_exposure(request: RunRequest, method: str) -> None:
    if request.exposure is None:
        raise SidecarError(
            422,
            "MISSING_EXPOSURE",
            f"{method} requires 'exposure' ({{ origins, values, kind }}): the "
            "apriori ultimate is exposure-based and cannot be inferred from the "
            "triangle",
        )


# ---------------------------------------------------------------------------
# Method runners
# ---------------------------------------------------------------------------


def _run_chainladder(request: RunRequest, created_at: str) -> Document:
    _refuse_secondary(request, "Chainladder")
    _refuse_exposure(request, "Chainladder")
    _refuse_seed(request, "Chainladder")
    strictness = _choice(request, "strictness", _ALLOWED_STRICTNESS, "warn")
    triangle = triangle_doc_to_cl(request.primary)
    replay = _replay_development(request, triangle, strictness)
    fitted = cl.Chainladder().fit(_transformed(triangle, replay))
    return _author_method_result(
        fitted,
        request,
        created_at,
        parameters=replay.parameters,
        convention_profile="deterministic-cl",
        selection_integrity=replay.selection_integrity,
        warnings=replay.warnings,
    )


def _mack_profile(replay: ReplayedDevelopment, sigma_interpolation: str) -> Optional[str]:
    """mack1993-vw requires volume-weighted all-period factors with Mack's
    sigma extrapolation and no exclusions (spec 5); anything else runs
    profile-less rather than overclaiming."""
    if replay.value_only or replay.tail is not None:
        return None
    if (
        replay.parameters.get("average") == "volume"
        and replay.parameters.get("n_periods") == -1
        and "drop" not in replay.parameters
        and sigma_interpolation == "mack"
    ):
        return "mack1993-vw"
    return None


def _run_mack(request: RunRequest, created_at: str) -> Document:
    _refuse_secondary(request, "MackChainladder")
    _refuse_exposure(request, "MackChainladder")
    _refuse_seed(request, "MackChainladder")
    strictness = _choice(request, "strictness", _ALLOWED_STRICTNESS, "warn")
    sigma_interpolation = _choice(
        request, "sigma_interpolation", _ALLOWED_SIGMA_INTERPOLATIONS, "log-linear"
    )
    triangle = triangle_doc_to_cl(request.primary)
    replay = _replay_development(request, triangle, strictness)

    if replay.value_only:
        # The SE-less rule (spec 3.2): never silently approximated. fit_mack
        # answers with a plain Chainladder (warning captured into the doc) or
        # refuses under strict; the document's method names what actually ran.
        warnings = list(replay.warnings)
        try:
            with _capturing_interchange_warnings(warnings):
                fitted = fit_mack(triangle, replay.estimator, strict=(strictness == "strict"))
        except InterchangeError as exc:
            raise SidecarError(422, "SE_LESS_REFUSED", str(exc)) from exc
        return _author_method_result(
            fitted,
            request,
            created_at,
            parameters=replay.parameters,
            convention_profile=None,
            selection_integrity=replay.selection_integrity,
            warnings=warnings,
        )

    development = replay.estimator.set_params(sigma_interpolation=sigma_interpolation)
    transformed = development.fit_transform(triangle)
    if replay.tail is not None:
        transformed = replay.tail.fit_transform(transformed)
    fitted = cl.MackChainladder().fit(transformed)
    parameters = dict(replay.parameters)
    parameters["sigma_interpolation"] = sigma_interpolation
    return _author_method_result(
        fitted,
        request,
        created_at,
        parameters=parameters,
        convention_profile=_mack_profile(replay, sigma_interpolation),
        selection_integrity=replay.selection_integrity,
        warnings=replay.warnings,
    )


def _run_exposure_method(
    request: RunRequest,
    created_at: str,
    *,
    method: str,
    estimator_factory: Callable[[RunRequest], object],
    knob_echo: Callable[[RunRequest], dict],
) -> Document:
    _refuse_secondary(request, method)
    _refuse_seed(request, method)
    _require_exposure(request, method)
    strictness = _choice(request, "strictness", _ALLOWED_STRICTNESS, "warn")
    triangle = triangle_doc_to_cl(request.primary)
    replay = _replay_development(request, triangle, strictness)
    sample_weight = _exposure_sample_weight(request, triangle)
    fitted = estimator_factory(request).fit(
        _transformed(triangle, replay), sample_weight=sample_weight
    )
    parameters = dict(replay.parameters)
    parameters.update(knob_echo(request))
    parameters["exposure_kind"] = request.exposure.kind
    return _author_method_result(
        fitted,
        request,
        created_at,
        parameters=parameters,
        convention_profile=None,
        selection_integrity=replay.selection_integrity,
        warnings=replay.warnings,
    )


def _run_bornhuetter_ferguson(request: RunRequest, created_at: str) -> Document:
    return _run_exposure_method(
        request,
        created_at,
        method="BornhuetterFerguson",
        estimator_factory=lambda r: cl.BornhuetterFerguson(apriori=_number(r, "apriori", 1.0)),
        knob_echo=lambda r: {"apriori": _number(r, "apriori", 1.0)},
    )


def _run_benktander(request: RunRequest, created_at: str) -> Document:
    return _run_exposure_method(
        request,
        created_at,
        method="Benktander",
        estimator_factory=lambda r: cl.Benktander(
            apriori=_number(r, "apriori", 1.0), n_iters=_positive_int(r, "n_iters", 1)
        ),
        knob_echo=lambda r: {
            "apriori": _number(r, "apriori", 1.0),
            "n_iters": _positive_int(r, "n_iters", 1),
        },
    )


def _run_cape_cod(request: RunRequest, created_at: str) -> Document:
    return _run_exposure_method(
        request,
        created_at,
        method="CapeCod",
        estimator_factory=lambda r: cl.CapeCod(
            trend=_number(r, "trend", 0.0), decay=_number(r, "decay", 1.0)
        ),
        knob_echo=lambda r: {
            "trend": _number(r, "trend", 0.0),
            "decay": _number(r, "decay", 1.0),
        },
    )


def _run_clark_ldf(request: RunRequest, created_at: str) -> Document:
    _refuse_secondary(request, "ClarkLDF")
    _refuse_exposure(request, "ClarkLDF")
    _refuse_seed(request, "ClarkLDF")
    _refuse_selection(
        request, "ClarkLDF", "Clark's method fits its own growth-curve development "
        "pattern; a selection would be silently ignored"
    )
    growth = _choice(request, "growth", _ALLOWED_GROWTH, "loglogistic")
    triangle = triangle_doc_to_cl(request.primary)
    with _warnings.catch_warnings():
        # Clark's MLE fit can emit scipy optimization warnings; they are not
        # interchange semantics and do not belong in the result document.
        _warnings.simplefilter("ignore")
        transformed = cl.ClarkLDF(growth=growth).fit_transform(triangle)
        fitted = cl.Chainladder().fit(transformed)
    return _author_method_result(
        fitted,
        request,
        created_at,
        parameters={"growth": growth},
        convention_profile=None,
        selection_integrity=None,
        warnings=[],
        method_override="clpy:ClarkLDF",
    )


def _run_munich_adjustment(request: RunRequest, created_at: str) -> Document:
    _refuse_exposure(request, "MunichAdjustment")
    _refuse_seed(request, "MunichAdjustment")
    _refuse_selection(
        request, "MunichAdjustment", "the Munich adjustment derives its own "
        "bivariate paid/incurred patterns"
    )
    if request.secondary is None:
        raise SidecarError(
            422,
            "MISSING_SECONDARY_TRIANGLE",
            "MunichAdjustment requires 'triangles.secondary' (the incurred "
            "triangle; 'triangles.primary' is paid) — refused without both slots",
        )
    primary_payload = request.primary.payload
    secondary_payload = request.secondary.payload
    if primary_payload.measure == secondary_payload.measure:
        raise SidecarError(
            422,
            "INVALID_REQUEST",
            "MunichAdjustment needs two distinct measures; both triangles carry "
            f"'{primary_payload.measure}'",
        )
    if (
        [(o.label, o.start) for o in primary_payload.origins]
        != [(o.label, o.start) for o in secondary_payload.origins]
        or primary_payload.ages_months != secondary_payload.ages_months
        or primary_payload.valuation_date != secondary_payload.valuation_date
        or primary_payload.cumulative != secondary_payload.cumulative
    ):
        raise SidecarError(
            422,
            "INVALID_REQUEST",
            "MunichAdjustment needs paired triangles: origins, agesMonths, "
            "valuationDate, and cumulative must match across primary and secondary",
        )
    average = _choice(request, "average", _ALLOWED_AVERAGES, "volume")
    n_periods = _n_periods(request)
    primary_measure = primary_payload.measure
    secondary_measure = secondary_payload.measure

    combined = cl.concat(
        [triangle_doc_to_cl(request.primary), triangle_doc_to_cl(request.secondary)], axis=1
    )
    with _warnings.catch_warnings():
        # chainladder's Munich internals emit numpy divide warnings on the
        # residual regression; engine noise, not interchange semantics.
        _warnings.simplefilter("ignore")
        developed = cl.Development(average=average, n_periods=n_periods).fit_transform(combined)
        adjusted = cl.MunichAdjustment(
            paid_to_incurred=[(primary_measure, secondary_measure)]
        ).fit_transform(developed)
        fitted = cl.Chainladder().fit(adjusted)

    # One MethodResultDoc carries one (index-slice, measure) pair: report the
    # PRIMARY (paid) projection. The single-column view is a real Chainladder
    # estimator carrying the engine's own fitted outputs for that slice.
    primary_view = cl.Chainladder()
    primary_view.ultimate_ = fitted.ultimate_[primary_measure]
    primary_view.X_ = fitted.X_[primary_measure]
    return _author_method_result(
        primary_view,
        request,
        created_at,
        parameters={
            "average": average,
            "n_periods": n_periods,
            "paid_to_incurred": [primary_measure, secondary_measure],
            # The result appliesTo names the primary triangle; the secondary
            # input is disclosed here so the run stays reproducible.
            "secondary_triangle_integrity": request.secondary.integrity(),
        },
        convention_profile=None,
        selection_integrity=None,
        warnings=[],
        method_override="clpy:MunichAdjustment",
    )


def _distribution_summary(samples: "np.ndarray") -> dict:
    mean = float(np.mean(samples))
    sd = float(np.std(samples, ddof=1)) if samples.size > 1 else 0.0
    return {
        "mean": mean,
        "sd": sd,
        "cv": (sd / mean) if mean != 0.0 else None,
        "percentiles": {
            str(label): float(np.percentile(samples, label)) for label in _PERCENTILE_LABELS
        },
    }


def _run_bootstrap_odp(request: RunRequest, created_at: str) -> Document:
    _refuse_secondary(request, "BootstrapODPSample")
    _refuse_exposure(request, "BootstrapODPSample")
    if request.seed is None:
        raise SidecarError(
            422,
            "MISSING_SEED",
            "BootstrapODPSample requires 'seed': unseeded simulation is not "
            "reproducible and the sidecar refuses to pretend otherwise",
        )
    strictness = _choice(request, "strictness", _ALLOWED_STRICTNESS, "warn")
    n_sims = _positive_int(request, "n_sims", _DEFAULT_N_SIMS, maximum=_MAX_N_SIMS)
    triangle = triangle_doc_to_cl(request.primary)
    replay = _replay_development(request, triangle, strictness)

    with _warnings.catch_warnings():
        # chainladder 0.9.2's hat-matrix code trips a numpy usage warning;
        # engine noise, not interchange semantics.
        _warnings.simplefilter("ignore")
        sims = cl.BootstrapODPSample(n_sims=n_sims, random_state=request.seed).fit_transform(
            triangle
        )
        fitted = cl.Chainladder().fit(_transformed(sims, replay))

    origins = [str(label) for label in fitted.ultimate_.origin.astype(str)]
    ultimates = np.asarray(fitted.ultimate_.values)[:, 0, :, 0]  # (n_sims, n_origins)
    latests = np.asarray(fitted.X_.latest_diagonal.values)[:, 0, :, 0]
    unpaid = ultimates - latests  # the engine's own ibnr_ definition, per sim
    totals = unpaid.sum(axis=1)

    by_origin = [
        {"origin": origin, **_distribution_summary(unpaid[:, index])}
        for index, origin in enumerate(origins)
    ]
    parameters = dict(replay.parameters)
    parameters["n_sims"] = n_sims

    payload = StochasticResultPayload(
        applies_to=ResultAppliesTo(
            triangle_integrity=request.primary.integrity(),
            selection_integrity=replay.selection_integrity,
        ),
        engine=EngineStamp(
            name=ENGINE_NAME,
            version=cl.__version__,
            convention_profile="odp-bootstrap-distribution",
        ),
        method="clpy:BootstrapODPSample",
        parameters=parameters,
        n_sims=n_sims,
        summary=_distribution_summary(totals),
        by_origin=by_origin,
        seed=request.seed,
        warnings=list(replay.warnings) or None,
    )
    document = Document(kind="stochastic-result", payload=payload, created_at=created_at)
    return _attach_engagement_ref(document, request)


# ---------------------------------------------------------------------------
# The registry
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MethodEntry:
    """One runnable method: its result kind, its parameter vocabulary
    (unknown keys are refused), and its runner."""

    name: str
    result_kind: str
    allowed_parameters: frozenset
    runner: Callable[[RunRequest, str], Document]


def _entry(name: str, result_kind: str, parameters: tuple, runner) -> MethodEntry:
    return MethodEntry(
        name=name,
        result_kind=result_kind,
        allowed_parameters=frozenset(parameters),
        runner=runner,
    )


METHODS: dict = {
    entry.name: entry
    for entry in (
        _entry(
            "Chainladder",
            "method-result",
            ("average", "n_periods", "strictness"),
            _run_chainladder,
        ),
        _entry(
            "MackChainladder",
            "method-result",
            ("average", "n_periods", "sigma_interpolation", "strictness"),
            _run_mack,
        ),
        _entry(
            "BornhuetterFerguson",
            "method-result",
            ("average", "n_periods", "strictness", "apriori"),
            _run_bornhuetter_ferguson,
        ),
        _entry(
            "Benktander",
            "method-result",
            ("average", "n_periods", "strictness", "apriori", "n_iters"),
            _run_benktander,
        ),
        _entry(
            "CapeCod",
            "method-result",
            ("average", "n_periods", "strictness", "trend", "decay"),
            _run_cape_cod,
        ),
        _entry("ClarkLDF", "method-result", ("growth",), _run_clark_ldf),
        _entry(
            "BootstrapODPSample",
            "stochastic-result",
            ("average", "n_periods", "strictness", "n_sims"),
            _run_bootstrap_odp,
        ),
        _entry(
            "MunichAdjustment",
            "method-result",
            ("average", "n_periods"),
            _run_munich_adjustment,
        ),
    )
}


def run_method(method: str, request: RunRequest, created_at: str) -> Document:
    """Look up and execute one method; unknown names are a 404 with the
    supported list, so a typo never reads as an engine failure."""
    entry = METHODS.get(method)
    if entry is None:
        raise SidecarError(
            404,
            "UNKNOWN_METHOD",
            f"unknown method '{method}'; supported: {sorted(METHODS)}",
        )
    _check_parameter_keys(request, entry.allowed_parameters)
    try:
        return entry.runner(request, created_at)
    except InterchangeError as exc:
        # Bridge-level refusals that were not mapped earlier (e.g. a triangle
        # chainladder cannot represent) are still schema'd 422s, not 500s.
        raise SidecarError(422, "INVALID_DOCUMENT", str(exc)) from exc
