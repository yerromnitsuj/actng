"""Fitted chainladder IBNR estimators -> MethodResultDoc.

One function: ``extract_result``. It stamps the engine
(``chainladder-python`` at the installed version), namespaces the method
with the spec-reserved ``clpy:`` prefix, links the result to its inputs by
integrity tag, and echoes the estimator's parameters.

Honesty rules carried through from the spec:

- ``unpaid`` is ``ultimate - latest`` from the engine's OWN fitted
  triangles (chainladder's ``ibnr_`` definition), so fully-developed
  origins — which chainladder omits from ``ibnr_`` — appear with unpaid 0
  rather than being dropped or NaN-filled.
- ``standardError`` appears only where the engine produced one (Mack); a
  fully-developed origin's NaN SE is omitted, never zeroed.

Requires the ``[chainladder]`` extra.
"""

from __future__ import annotations

import math
from typing import Optional

try:
    import chainladder as cl
    import numpy as np
except ImportError as exc:  # pragma: no cover - exercised only without the extra
    raise ImportError(
        "the chainladder bridges require the [chainladder] extra: "
        "pip install actuarial-interchange[chainladder]"
    ) from exc

from .documents import (
    Document,
    EngineStamp,
    MethodResultPayload,
    ResultAppliesTo,
    ResultRow,
    ResultTotals,
)
from .errors import BadInterchangeError

__all__ = ["extract_result", "SUPPORTED_ESTIMATORS"]

ENGINE_NAME = "chainladder-python"
METHOD_PREFIX = "clpy:"

SUPPORTED_ESTIMATORS = (
    cl.MackChainladder,
    cl.Chainladder,
    cl.BornhuetterFerguson,
    cl.Benktander,
    cl.CapeCod,
)


def _single_slice_values(triangle: "cl.Triangle", name: str) -> "np.ndarray":
    if triangle.shape[0] != 1 or triangle.shape[1] != 1:
        raise BadInterchangeError(
            f"{name} has shape {triangle.shape}; one MethodResultDoc carries "
            "one (index-slice, measure) pair — fit on a single slice"
        )
    return triangle.values[0, 0, :, 0]


def _json_clean(value: object) -> object:
    """One parameter value, made JSON-representable for the echo. Finite
    numbers pass through; non-finite sentinels (e.g. drop_above=inf) and
    non-JSON objects become their repr string — echoed, not falsified."""
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, (int, float)):
        number = float(value)
        return value if math.isfinite(number) else repr(value)
    if isinstance(value, (list, tuple)):
        return [_json_clean(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _json_clean(item) for key, item in value.items()}
    return repr(value)


def _mack_standard_errors(fitted: "cl.MackChainladder") -> tuple[list[Optional[float]], float]:
    """Per-origin Mack SEs (None where the engine reports NaN) and the
    total Mack SE."""
    summary = fitted.summary_.to_frame(origin_as_datetime=False)
    per_origin = [
        None if math.isnan(float(value)) else float(value)
        for value in summary["Mack Std Err"]
    ]
    total = float(np.asarray(fitted.total_mack_std_err_).ravel()[0])
    return per_origin, total


def extract_result(
    fitted: object,
    *,
    created_at: str,
    triangle_integrity: str,
    selection_integrity: Optional[str] = None,
    parameters: Optional[dict] = None,
    convention_profile: Optional[str] = None,
    warnings: Optional[list[str]] = None,
) -> Document:
    """Fitted estimator -> MethodResultDoc.

    ``triangle_integrity`` is REQUIRED: a result that does not say which
    triangle it applies to is not comparable to anything (the TS schema
    makes the tag non-nullable, and ``ResultAppliesTo`` never emits a null
    triangleIntegrity). ``parameters`` overrides the echo when the caller
    knows the true requested configuration (e.g. the upstream
    Development's average and n_periods, which the IBNR estimator itself
    does not carry); the default echo is the estimator's own
    ``get_params()``. ``created_at`` is caller-supplied (purity rule).
    """
    if not isinstance(fitted, SUPPORTED_ESTIMATORS):
        raise BadInterchangeError(
            f"unsupported estimator {type(fitted).__name__}; supported: "
            f"{', '.join(t.__name__ for t in SUPPORTED_ESTIMATORS)}"
        )

    ultimates = _single_slice_values(fitted.ultimate_, "ultimate_")
    latests = _single_slice_values(fitted.X_.latest_diagonal, "latest_diagonal")
    origins = [str(label) for label in fitted.ultimate_.origin.astype(str)]

    if isinstance(fitted, cl.MackChainladder):
        standard_errors, total_standard_error = _mack_standard_errors(fitted)
    else:
        standard_errors = [None] * len(origins)
        total_standard_error = None

    rows = [
        ResultRow(
            origin=origin,
            ultimate=float(ultimate),
            unpaid=float(ultimate) - float(latest),
            standard_error=standard_error,
        )
        for origin, ultimate, latest, standard_error in zip(
            origins, ultimates, latests, standard_errors
        )
    ]
    totals = ResultTotals(
        ultimate=sum(row.ultimate for row in rows),
        unpaid=sum(row.unpaid for row in rows),
        standard_error=total_standard_error,
    )

    payload = MethodResultPayload(
        applies_to=ResultAppliesTo(
            triangle_integrity=triangle_integrity,
            selection_integrity=selection_integrity,
        ),
        engine=EngineStamp(
            name=ENGINE_NAME,
            version=cl.__version__,
            convention_profile=convention_profile,
        ),
        method=METHOD_PREFIX + type(fitted).__name__,
        parameters=_json_clean(parameters if parameters is not None else fitted.get_params(deep=False)),
        rows=rows,
        totals=totals,
        # Authoring convention (shared with the TS converter): empty
        # warnings are omitted, so a warning-free result hashes identically
        # no matter which shore authored it.
        warnings=list(warnings) if warnings else None,
    )
    return Document(kind="method-result", payload=payload, created_at=created_at)
