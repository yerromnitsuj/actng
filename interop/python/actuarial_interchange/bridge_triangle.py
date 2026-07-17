"""TriangleDoc <-> chainladder.Triangle, with null preservation as law.

The sacred rule (spec 3.1): null means UNOBSERVED, everywhere. This bridge
therefore:

- builds ``cl.Triangle`` from a LONG DataFrame containing only observed
  cells (a ``None`` in the doc simply has no row, so chainladder keeps it
  NaN), with ``cumulative=`` always explicit;
- converts back via ``to_frame(keepdims=True, origin_as_datetime=True)``
  and writes ``None`` for every cell the frame does not carry;
- NEVER routes through ``Triangle.to_json()``, which is source-verified to
  emit incremental values in valuation layout with ``fillna(0)`` —
  destroying the null-vs-zero distinction (fine for cl<->cl persistence,
  forbidden for the interchange);
- REFUSES payloads chainladder would silently mutilate (an all-null origin
  row or age column vanishes from the constructed triangle) instead of
  letting the drop pass.

Requires the ``[chainladder]`` extra.
"""

from __future__ import annotations

from typing import Optional, Union

try:
    import chainladder as cl
    import pandas as pd
except ImportError as exc:  # pragma: no cover - exercised only without the extra
    raise ImportError(
        "the chainladder bridges require the [chainladder] extra: "
        "pip install actuarial-interchange[chainladder]"
    ) from exc

from .documents import Document, Origin, TrianglePayload
from .errors import BadInterchangeError

__all__ = ["triangle_doc_to_cl", "cl_to_triangle_doc"]

_GRAIN_TO_MONTHS = {"Y": 12, "S": 6, "Q": 3, "M": 1}
_MONTHS_TO_GRAIN = {12: "Y", 6: "S", 3: "Q", 1: "M"}


def _triangle_payload(source: Union[Document, TrianglePayload]) -> TrianglePayload:
    if isinstance(source, Document):
        if not isinstance(source.payload, TrianglePayload):
            raise BadInterchangeError(
                f"expected a triangle document, got kind '{source.kind}'"
            )
        return source.payload
    return source


def _origin_start(origin: Origin) -> pd.Timestamp:
    """The origin period's start date. ``Origin.start`` is required on the
    dataclass (``Origin.from_dict`` supplies the lenient plain-year-label
    fallback for foreign docs), so this is a direct read."""
    return pd.Timestamp(origin.start)


def _period_end(start: pd.Timestamp, age_months: int) -> pd.Timestamp:
    """End date of the valuation period ``age_months`` months after the
    origin start (the date form chainladder's constructor requires —
    integer development ages are refused for long-frame construction)."""
    total_months = start.year * 12 + (start.month - 1) + age_months
    year, month_zero_based = divmod(total_months - 1, 12)
    return pd.Timestamp(year, month_zero_based + 1, 1) + pd.offsets.MonthEnd(0)


def triangle_doc_to_cl(source: Union[Document, TrianglePayload]) -> cl.Triangle:
    """Build a ``cl.Triangle`` from a TriangleDoc.

    Only observed cells become rows in the long frame; ``None`` cells stay
    NaN in the triangle (grid shape is validated by ``TrianglePayload``
    itself). Raises ``BadInterchangeError`` for bulk-lane (valuesRef-only)
    payloads — a capability limit, not a format error — and when
    chainladder would silently drop an all-null origin row or age column.
    """
    payload = _triangle_payload(source)
    if payload.values is None:
        raise BadInterchangeError(
            "this triangle carries only a bulk-lane valuesRef (spec 3.3); the "
            "chainladder bridge requires inline values — Phase A converters do "
            "not read the bulk lane"
        )
    n_origins = len(payload.origins)
    n_ages = len(payload.ages_months)

    rows: list[tuple[pd.Timestamp, pd.Timestamp, float]] = []
    zero_cells: list[tuple[pd.Timestamp, int]] = []
    for origin, row in zip(payload.origins, payload.values):
        start = _origin_start(origin)
        for age, cell in zip(payload.ages_months, row):
            if cell is None:
                continue  # unobserved stays unobserved — never 0
            value = float(cell)
            if value != value:  # NaN guard: JSON has no NaN; dicts might
                raise BadInterchangeError(
                    f"NaN in values for origin '{origin.label}' age {age}; "
                    "use null for unobserved cells"
                )
            if value == 0.0:
                zero_cells.append((start, age))
            rows.append((start, _period_end(start, age), value))

    if not rows:
        raise BadInterchangeError("triangle has no observed cells")

    frame = pd.DataFrame(rows, columns=["origin", "development", payload.measure])
    triangle = cl.Triangle(
        frame,
        origin="origin",
        development="development",
        columns=payload.measure,
        cumulative=payload.cumulative,
    )

    # chainladder pads INTERIOR gaps in both ladders (an interior all-null
    # origin row or age column round-trips fine), but an all-null row or
    # column at the EDGE of a ladder — or a doc ladder with deliberate
    # holes — cannot be represented and would silently change shape.
    if triangle.shape[2] != n_origins:
        raise BadInterchangeError(
            f"chainladder kept {triangle.shape[2]} of {n_origins} document "
            "origins — an all-null origin row at the edge of the origin "
            "range, or a gap in the origin ladder, cannot be represented"
        )
    if list(triangle.development) != sorted(payload.ages_months):
        raise BadInterchangeError(
            f"chainladder kept development ages {list(triangle.development)} "
            f"for document ages {sorted(payload.ages_months)} — an all-null "
            "trailing age column, or a gap in the age ladder, cannot be "
            "represented"
        )

    # chainladder's long-frame ingestion passes through a sparse
    # intermediate where an explicit 0 is indistinguishable from "no row":
    # observed zeros arrive as NaN. Restore them — 0 is DATA and the spec
    # 3.1 null rule forbids letting 0->missing leak through.
    if zero_cells:
        if triangle.array_backend != "numpy":
            triangle = triangle.set_backend("numpy")
        row_index_by_start = {
            start: i for i, start in enumerate(triangle.origin.to_timestamp(how="start"))
        }
        column_index_by_age = {int(age): j for j, age in enumerate(triangle.development)}
        for start, age in zero_cells:
            i, j = row_index_by_start[start], column_index_by_age[age]
            if triangle.values[0, 0, i, j] != triangle.values[0, 0, i, j]:
                triangle.values[0, 0, i, j] = 0.0
    return triangle


def cl_to_triangle_doc(
    triangle: cl.Triangle,
    *,
    measure: str,
    created_at: str,
    basis: Optional[dict] = None,
    units: Optional[dict] = None,
    segment: Optional[dict] = None,
) -> Document:
    """Convert a single-slice ``cl.Triangle`` to a TriangleDoc.

    ``measure`` is the interchange measure vocabulary value (spec 3.2),
    supplied by the caller because chainladder column names are free-form.
    ``created_at`` is caller-supplied (purity rule: no clock reads here).
    Every cell absent from ``to_frame`` output becomes ``null``.
    """
    if triangle.shape[0] != 1 or triangle.shape[1] != 1:
        raise BadInterchangeError(
            f"triangle has shape {triangle.shape}; one TriangleDoc carries one "
            "(index-slice, measure) pair — slice first (e.g. tri.loc[...]['col'])"
        )
    ages = list(triangle.development)
    if not all(isinstance(age, (int,)) or hasattr(age, "item") for age in ages):
        raise BadInterchangeError(
            "triangle development axis is not age-in-months (valuation "
            "layout?); convert with val_to_dev() first"
        )
    ages = [int(age) for age in ages]
    if triangle.origin_grain not in _GRAIN_TO_MONTHS:
        raise BadInterchangeError(f"unsupported origin grain '{triangle.origin_grain}'")

    origin_labels = [str(label) for label in triangle.origin.astype(str)]
    origin_starts = triangle.origin.to_timestamp(how="start")
    origins = [
        Origin(label=label, start=start.date().isoformat())
        for label, start in zip(origin_labels, origin_starts)
    ]

    row_by_start = {start: i for i, start in enumerate(origin_starts)}
    col_by_age = {age: j for j, age in enumerate(ages)}
    values: list[list[Optional[float]]] = [[None] * len(ages) for _ in origins]

    frame = triangle.to_frame(keepdims=True, origin_as_datetime=True)
    value_columns = [c for c in frame.columns if c not in ("origin", "development")]
    if len(value_columns) != 1:
        raise BadInterchangeError(
            f"expected one value column in to_frame output, got {value_columns}"
        )
    value_column = value_columns[0]

    for origin_ts, age, cell in zip(
        frame["origin"], frame["development"], frame[value_column]
    ):
        value = float(cell)
        if value != value:
            continue  # NaN row: unobserved stays null
        values[row_by_start[pd.Timestamp(origin_ts)]][col_by_age[int(age)]] = value

    payload = TrianglePayload(
        measure=measure,
        cumulative=bool(triangle.is_cumulative),
        origin_length_months=_GRAIN_TO_MONTHS[triangle.origin_grain],
        origins=origins,
        ages_months=ages,
        values=values,
        valuation_date=triangle.valuation_date.date().isoformat(),
        basis=basis,
        units=units,
        segment=segment,
    )
    return Document(kind="triangle", payload=payload, created_at=created_at)
