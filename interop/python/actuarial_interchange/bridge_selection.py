"""SelectionDoc <-> chainladder estimators, per the spec 3.2 equivalence table.

Replay policy (injection honesty rules, spec 3.2):

- COMPUTABLE intents with an exact chainladder replay (volume-weighted,
  simple, regression) become a native ``Development(average=...,
  n_periods=...)`` — sigmas stay available downstream, so Mack works.
- Value-only intents (judgmental/external) become
  ``DevelopmentConstant(patterns={ageMonths: factor}, style="ldf")`` —
  exact and always feasible, but it carries no sigma_/std_err_.
- ``geometric`` is DEMOTED to value-only on this engine: chainladder
  0.9.2's ``Development(average="geometric")`` raises ``KeyError``
  (verified against the installed wheel; the spec's verify-before-freeze
  flag on that cell was warranted).
- ``medial`` replays approximately via drop_high/drop_low when every
  column shares one trim configuration; otherwise value-only.
- The Mack-SE-less rule: a Mack request atop a value-only replay is
  answered SE-less (plain ``Chainladder``) with an explicit
  ``InterchangeWarning``, or refused under ``fit_mack``'s own
  ``strict=True`` — never silently approximated. ``fit_mack`` enforces it.

What ``strict=True`` on ``selection_doc_to_estimators`` DOES cover — every
replay compromise raises instead of warning:

- an unknown fitted-tail family (no native replay exists);
- the approximate medial replay via drop_high/drop_low;
- the geometric demotion to value-only;
- any COMPUTABLE intent demoted to value-only because it appears in a
  mixed selection that must flatten to ``DevelopmentConstant``;
- an incoherent selection, when the referenced triangle is supplied
  (``IncoherentSelectionError``).

What it does NOT cover:

- pure judgmental/external selections replaying via
  ``DevelopmentConstant`` — that IS the exact spec replay for value-only
  intents, not a compromise (the sigma-availability warning still fires);
- the Mack-SE-less rule, which is ``fit_mack``'s own ``strict`` flag;
- coherence when NO triangle is supplied — an ``InterchangeWarning``
  states that coherence was not verified, strict or not.

The coherence rule (spec 3.2): for exact-computable intents the stored
``value`` must equal its recomputation on the referenced triangle within
1e-9 relative. ``verify_coherence`` recomputes and, per the strictness
flag, warns or raises ``IncoherentSelectionError``.
``selection_doc_to_estimators`` runs it on import whenever the referenced
triangle is supplied, and warns that it could not when it is not.

Requires the ``[chainladder]`` extra.
"""

from __future__ import annotations

import warnings as _warnings
from typing import Optional, Union

try:
    import chainladder as cl
    import numpy as np
except ImportError as exc:  # pragma: no cover - exercised only without the extra
    raise ImportError(
        "the chainladder bridges require the [chainladder] extra: "
        "pip install actuarial-interchange[chainladder]"
    ) from exc

from .bridge_triangle import triangle_doc_to_cl
from .documents import (
    VALUE_ONLY_INTENT_KINDS,
    Document,
    DevelopmentIntent,
    DevelopmentSelection,
    Exclusion,
    SelectionAppliesTo,
    SelectionPayload,
    TailIntent,
    TailSelection,
    TrianglePayload,
)
from .errors import (
    BadInterchangeError,
    IncoherentSelectionError,
    InterchangeError,
    InterchangeWarning,
)

__all__ = [
    "selection_doc_to_estimators",
    "fit_mack",
    "verify_coherence",
    "extract_selections",
    "COHERENCE_TOLERANCE",
]

#: Spec 3.2 coherence tolerance (relative).
COHERENCE_TOLERANCE = 1e-9

#: Intent kind -> Development(average=...) where the replay is EXACT.
_NATIVE_AVERAGE = {
    "volume-weighted": "volume",
    "simple": "simple",
    "regression": "regression",
}
_AVERAGE_TO_INTENT = {v: k for k, v in _NATIVE_AVERAGE.items()}

_TAIL_FAMILY_TO_CURVE = {
    "exponential-decay": "exponential",
    "inverse-power": "inverse_power",
}
_CURVE_TO_TAIL_FAMILY = {v: k for k, v in _TAIL_FAMILY_TO_CURVE.items()}


def _selection_payload(source: Union[Document, SelectionPayload]) -> SelectionPayload:
    if isinstance(source, Document):
        if not isinstance(source.payload, SelectionPayload):
            raise BadInterchangeError(
                f"expected a selection document, got kind '{source.kind}'"
            )
        return source.payload
    return source


def _warn(message: str) -> None:
    _warnings.warn(message, InterchangeWarning, stacklevel=3)


def _is_native_exact(intent: DevelopmentIntent) -> bool:
    return intent.kind in _NATIVE_AVERAGE


def _drop_list(selections: list[DevelopmentSelection]) -> Optional[list[tuple[str, int]]]:
    """Intent exclusions -> chainladder ``drop`` tuples (origin label,
    from-age in months)."""
    drops = [
        (exclusion.origin, selection.from_age_months)
        for selection in selections
        for exclusion in (selection.intent.exclusions or [])
    ]
    return drops or None


def _collapse(items: list) -> object:
    """A per-column list collapses to a scalar when uniform (readability of
    the resulting estimator's params; chainladder accepts both)."""
    return items[0] if len(set(map(str, items))) == 1 else items


def _development_estimator(
    selections: list[DevelopmentSelection], strict: bool
) -> object:
    ordered = sorted(selections, key=lambda s: s.from_age_months)
    kinds = {s.intent.kind for s in ordered}

    if all(_is_native_exact(s.intent) for s in ordered):
        averages = [_NATIVE_AVERAGE[s.intent.kind] for s in ordered]
        windows = [
            -1 if s.intent.window_origin_periods is None else s.intent.window_origin_periods
            for s in ordered
        ]
        return cl.Development(
            average=_collapse(averages),
            n_periods=_collapse(windows),
            drop=_drop_list(ordered),
        )

    if kinds == {"medial"}:
        trims = {
            (s.intent.exclude_high or 0, s.intent.exclude_low or 0, s.intent.window_origin_periods)
            for s in ordered
        }
        if len(trims) == 1:
            high, low, window = next(iter(trims))
            message = (
                "medial intent replays APPROXIMATELY on chainladder via "
                "drop_high/drop_low (rank-based, with preserve relaxation) — "
                "spec 3.2 marks this cell approx, not exact"
            )
            if strict:
                raise InterchangeError(
                    message + " (strict mode refuses approximate replays; rerun "
                    "without strict to accept the approximation)"
                )
            _warn(message)
            return cl.Development(
                average="simple",
                n_periods=-1 if window is None else window,
                drop_high=high or None,
                drop_low=low or None,
                drop=_drop_list(ordered),
            )

    non_native = kinds - set(_NATIVE_AVERAGE)
    if non_native - {"judgmental", "external", "geometric", "medial"}:
        raise BadInterchangeError(
            f"unknown development intent kind(s): {sorted(non_native)}"
        )
    # Kinds about to be flattened to DevelopmentConstant that are NOT
    # value-only by nature: geometric (engine demotion), medial with
    # non-uniform trims, and computable natives caught in a mixed
    # selection. Under strict, a demotion is a refusal, not a warning.
    demoted = sorted(kinds - VALUE_ONLY_INTENT_KINDS)
    if demoted:
        if strict:
            raise InterchangeError(
                f"selection intents {demoted} have no exact replay on this engine "
                "and would be DEMOTED to a value-only DevelopmentConstant; strict "
                "mode refuses demoted/approximate replays (rerun without strict "
                "to accept the demotion)"
            )
        if "geometric" in kinds:
            _warn(
                "geometric intent is DEMOTED to value-only on chainladder 0.9.2: "
                "Development(average='geometric') raises KeyError on this engine"
            )
    _warn(
        "selection replays value-only via DevelopmentConstant "
        f"(intent kinds: {sorted(kinds)}); sigma_/std_err_ are unavailable, "
        "so Mack standard errors cannot be produced on top of it"
    )
    patterns = {s.from_age_months: float(s.value) for s in ordered}
    return cl.DevelopmentConstant(patterns=patterns, style="ldf")


def _tail_estimator(tail: Optional[TailSelection], strict: bool) -> Optional[object]:
    if tail is None:
        return None
    intent = tail.intent
    if intent.kind == "fitted":
        curve = _TAIL_FAMILY_TO_CURVE.get(intent.family or "")
        if curve is None:
            message = (
                f"unknown fitted-tail family '{intent.family}'; "
                "cannot replay natively"
            )
            if strict:
                raise BadInterchangeError(message)
            _warn(message + " — applying the stored value via TailConstant")
            return cl.TailConstant(tail=float(tail.value))
        fit_period = (intent.fit_from_age_months, None)
        return cl.TailCurve(curve=curve, fit_period=fit_period)
    if intent.kind in ("judgmental", "external"):
        return cl.TailConstant(tail=float(tail.value))
    raise BadInterchangeError(f"unknown tail intent kind '{intent.kind}'")


def selection_doc_to_estimators(
    source: Union[Document, SelectionPayload],
    *,
    triangle: Union[Document, TrianglePayload, "cl.Triangle", None] = None,
    strict: bool = False,
) -> tuple[object, Optional[object]]:
    """SelectionDoc -> ``(development_estimator, tail_estimator_or_None)``.

    Computable intents with exact replays become native ``Development``
    estimators (per the spec 3.2 equivalence table); everything else
    becomes ``DevelopmentConstant``/``TailConstant`` with an explicit
    ``InterchangeWarning``. Under ``strict=True``, every replay compromise
    that would otherwise warn — unknown tail family, approximate medial,
    geometric demotion, computable intents flattened in a mixed
    selection — raises instead (see the module docstring for the full
    strict policy).

    The coherence rule (spec 3.2) is enforced ON IMPORT when ``triangle``
    (the referenced triangle document, payload, or an already-bridged
    ``cl.Triangle``) is supplied: ``verify_coherence`` runs with the same
    strictness (warn, or ``IncoherentSelectionError`` under strict). When
    no triangle is supplied, an ``InterchangeWarning`` states that
    coherence was NOT verified — never silently skipped.
    """
    payload = _selection_payload(source)
    if not payload.development:
        raise BadInterchangeError("selection has no development factors")
    if triangle is not None:
        verify_coherence(payload, triangle, strict=strict)
    else:
        _warn(
            "coherence NOT verified: no triangle was supplied to "
            "selection_doc_to_estimators, so the spec 3.2 coherence rule was "
            "not checked against the referenced triangle (pass triangle= to "
            "enforce it)"
        )
    development = _development_estimator(payload.development, strict)
    tail = _tail_estimator(payload.tail, strict)
    return development, tail


def fit_mack(
    triangle: "cl.Triangle", development_estimator: object, *, strict: bool = False
) -> object:
    """Fit Mack — or its honest SE-less fallback — atop a replayed selection.

    The Mack-SE-less rule (spec 3.2): ``DevelopmentConstant`` carries no
    sigma_/std_err_, so ``MackChainladder`` cannot produce standard errors
    on top of it. A Mack request on a value-only selection is therefore
    answered with a plain ``Chainladder`` fit (point estimates, no SEs)
    under an explicit ``InterchangeWarning`` — or refused with
    ``InterchangeError`` when ``strict=True``. Never silent.
    """
    if isinstance(development_estimator, cl.DevelopmentConstant):
        message = (
            "Mack requested atop a value-only selection (DevelopmentConstant): "
            "no sigma_/std_err_ exist, so standard errors cannot be computed"
        )
        if strict:
            raise InterchangeError(message + " (strict mode refuses; rerun with "
                                   "a computable intent or accept an SE-less answer)")
        _warn(message + " — answering SE-less via plain Chainladder")
        return cl.Chainladder().fit(development_estimator.fit_transform(triangle))
    return cl.MackChainladder().fit(development_estimator.fit_transform(triangle))


def _ldf_by_age(fitted_development: object) -> dict[int, float]:
    """Fitted ldf_ -> {from-age-months: factor} for a single-slice fit."""
    ldf = fitted_development.ldf_
    if ldf.shape[0] != 1 or ldf.shape[1] != 1:
        raise BadInterchangeError(
            f"fitted ldf_ has shape {ldf.shape}; one SelectionDoc carries one "
            "(index-slice, measure) pair — fit on a single slice"
        )
    frame = ldf.to_frame(keepdims=True, origin_as_datetime=True)
    value_column = [c for c in frame.columns if c not in ("origin", "development")][0]
    return {
        int(age): float(value)
        for age, value in zip(frame["development"], frame[value_column])
    }


def verify_coherence(
    selection: Union[Document, SelectionPayload],
    triangle: Union[Document, TrianglePayload, "cl.Triangle"],
    *,
    strict: bool = False,
    tolerance: float = COHERENCE_TOLERANCE,
) -> list[str]:
    """Enforce the spec 3.2 coherence rule on exact-computable intents.

    Recomputes each volume-weighted/simple/regression factor natively on
    the triangle and compares to the stored value at ``tolerance``
    (relative), using the cross-shore relative-deviation definition shared
    with the TS referee and the conformance runners:
    ``|a - b| / max(|a|, |b|)``, defined as 0 when both are 0.
    Divergences raise ``IncoherentSelectionError`` under
    ``strict=True``, otherwise warn (``InterchangeWarning``) and are
    returned as messages. Intents whose chainladder replay is not exact
    (medial, geometric) and value-only intents (judgmental/external —
    where the value IS the judgment) are skipped: this engine cannot
    referee them, and pretending otherwise would overstate the check.
    """
    payload = _selection_payload(selection)
    if isinstance(triangle, (Document, TrianglePayload)):
        triangle = triangle_doc_to_cl(triangle)

    divergences: list[str] = []
    fitted_cache: dict[tuple, dict[int, float]] = {}
    for selection_item in payload.development:
        intent = selection_item.intent
        if not _is_native_exact(intent):
            continue
        drops = tuple(
            (exclusion.origin, selection_item.from_age_months)
            for exclusion in (intent.exclusions or [])
        )
        window = -1 if intent.window_origin_periods is None else intent.window_origin_periods
        cache_key = (intent.kind, window, drops)
        if cache_key not in fitted_cache:
            estimator = cl.Development(
                average=_NATIVE_AVERAGE[intent.kind],
                n_periods=window,
                drop=list(drops) or None,
            ).fit(triangle)
            fitted_cache[cache_key] = _ldf_by_age(estimator)
        recomputed = fitted_cache[cache_key].get(selection_item.from_age_months)
        if recomputed is None:
            divergences.append(
                f"no factor at age {selection_item.from_age_months} on the "
                "referenced triangle"
            )
            continue
        scale = max(abs(selection_item.value), abs(recomputed))
        relative = 0.0 if scale == 0 else abs(selection_item.value - recomputed) / scale
        if relative > tolerance:
            divergences.append(
                f"{selection_item.from_age_months}-{selection_item.to_age_months} "
                f"({intent.kind}): stored {selection_item.value!r} vs recomputed "
                f"{recomputed!r} (relative {relative:.3e} > {tolerance:.0e})"
            )

    if divergences:
        summary = "; ".join(divergences)
        if strict:
            raise IncoherentSelectionError(f"incoherent selection: {summary}")
        _warn(f"incoherent selection (spec 3.2): {summary}")
    return divergences


def _age_pairs(fitted_development: object) -> list[tuple[int, int]]:
    """Fitted ldf_ development labels ('12-24', ...) -> [(from, to), ...]."""
    pairs = []
    for label in fitted_development.ldf_.development:
        from_text, _, to_text = str(label).partition("-")
        pairs.append((int(from_text), int(to_text)))
    return pairs


def _tail_value(fitted_tail: object) -> float:
    return float(np.asarray(fitted_tail.tail_).ravel()[0])


def _extract_tail(fitted_tail: Optional[object], rationale: Optional[str]) -> Optional[TailSelection]:
    if fitted_tail is None:
        return None
    if isinstance(fitted_tail, cl.TailCurve):
        params = fitted_tail.get_params()
        fit_from = params.get("fit_period", (None, None))[0]
        family = _CURVE_TO_TAIL_FAMILY.get(params.get("curve"))
        if family is None:
            raise BadInterchangeError(
                f"cannot express TailCurve(curve={params.get('curve')!r}) as an "
                "interchange tail intent"
            )
        return TailSelection(
            value=_tail_value(fitted_tail),
            intent=TailIntent(
                kind="fitted",
                family=family,
                fit_from_age_months=None if fit_from is None else int(fit_from),
                params={
                    "intercept": float(np.asarray(fitted_tail.intercept_).ravel()[0]),
                    "slope": float(np.asarray(fitted_tail.slope_).ravel()[0]),
                },
            ),
        )
    if isinstance(fitted_tail, cl.TailConstant):
        if not rationale:
            raise InterchangeError(
                "extracting a TailConstant requires a rationale: constant tails "
                "are value-only (external) selections and spec 3.2 makes the "
                "rationale mandatory"
            )
        return TailSelection(
            value=_tail_value(fitted_tail),
            intent=TailIntent(kind="external", rationale=rationale),
        )
    raise BadInterchangeError(
        f"unsupported tail estimator {type(fitted_tail).__name__}"
    )


def extract_selections(
    fitted_development: object,
    fitted_tail: Optional[object] = None,
    *,
    measure: str,
    triangle_integrity: str,
    created_at: str,
    rationale: Optional[str] = None,
) -> Document:
    """Fitted estimators -> a SelectionDoc carrying intent + values.

    Reads ``ldf_`` and ``get_params()`` only (sigma vectors never travel in
    SelectionDocs — each engine recomputes sigma per its convention
    profile). ``Development`` fits yield computable intents; a
    ``DevelopmentConstant`` yields value-only external intents and REQUIRES
    ``rationale`` (spec 3.2). ``created_at`` is caller-supplied.
    """
    ldf_by_age = _ldf_by_age(fitted_development)
    age_pairs = _age_pairs(fitted_development)

    if isinstance(fitted_development, cl.DevelopmentConstant):
        if not rationale:
            raise InterchangeError(
                "extracting a DevelopmentConstant requires a rationale: injected "
                "patterns are value-only (external) selections and spec 3.2 "
                "makes the rationale mandatory"
            )
        development = [
            DevelopmentSelection(
                from_age_months=from_age,
                to_age_months=to_age,
                value=ldf_by_age[from_age],
                intent=DevelopmentIntent(kind="external", rationale=rationale),
            )
            for from_age, to_age in age_pairs
        ]
    elif isinstance(fitted_development, cl.Development):
        params = fitted_development.get_params()
        averages = params["average"]
        windows = params["n_periods"]
        if not isinstance(averages, list):
            averages = [averages] * len(age_pairs)
        if not isinstance(windows, list):
            windows = [windows] * len(age_pairs)
        if len(averages) != len(age_pairs) or len(windows) != len(age_pairs):
            raise BadInterchangeError(
                "per-column average/n_periods lists do not match the fitted "
                "development columns"
            )
        drops = params.get("drop") or []
        development = []
        for (from_age, to_age), average, window in zip(age_pairs, averages, windows):
            kind = _AVERAGE_TO_INTENT.get(average)
            if kind is None:
                raise BadInterchangeError(
                    f"cannot express Development(average={average!r}) as an "
                    "interchange intent"
                )
            exclusions = [
                Exclusion(origin=str(origin))
                for origin, dropped_age in drops
                if int(dropped_age) == from_age
            ]
            development.append(
                DevelopmentSelection(
                    from_age_months=from_age,
                    to_age_months=to_age,
                    value=ldf_by_age[from_age],
                    intent=DevelopmentIntent(
                        kind=kind,
                        window_origin_periods=None if window == -1 else int(window),
                        exclusions=exclusions or None,
                    ),
                )
            )
    else:
        raise BadInterchangeError(
            f"unsupported development estimator {type(fitted_development).__name__}"
        )

    payload = SelectionPayload(
        applies_to=SelectionAppliesTo(measure=measure, triangle_integrity=triangle_integrity),
        development=development,
        tail=_extract_tail(fitted_tail, rationale),
    )
    return Document(kind="selection", payload=payload, created_at=created_at)
