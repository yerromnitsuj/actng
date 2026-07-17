"""Shared document factories (stdlib only — chainladder stays inside the
bridge test modules so the core tests run without the extra)."""

from __future__ import annotations

from actuarial_interchange import (
    DevelopmentIntent,
    DevelopmentSelection,
    Document,
    Origin,
    SelectionAppliesTo,
    SelectionPayload,
    TrianglePayload,
)

CREATED_AT = "2026-07-17T00:00:00Z"


def make_triangle_payload(**overrides) -> TrianglePayload:
    """A 3x3 annual cumulative paid triangle with one INTERIOR null
    (origin 2002 at age 36 is unobserved) plus the usual future nulls."""
    fields = dict(
        measure="paid",
        cumulative=True,
        origin_length_months=12,
        origins=[
            Origin(label="2001", start="2001-01-01"),
            Origin(label="2002", start="2002-01-01"),
            Origin(label="2003", start="2003-01-01"),
        ],
        ages_months=[12, 24, 36],
        values=[
            [100.0, 160.0, 200.0],
            [110.0, 170.0, None],
            [120.0, None, None],
        ],
        valuation_date="2003-12-31",
    )
    fields.update(overrides)
    return TrianglePayload(**fields)


def make_triangle_doc(**overrides) -> Document:
    return Document(
        kind="triangle", payload=make_triangle_payload(**overrides), created_at=CREATED_AT
    )


def make_selection_payload(triangle_integrity: str, **overrides) -> SelectionPayload:
    """The volume-weighted all-period selection over make_triangle_payload:
    12-24 = (160+170)/(100+110), 24-36 = 200/160 — values coherent with
    the intent by construction."""
    fields = dict(
        applies_to=SelectionAppliesTo(measure="paid", triangle_integrity=triangle_integrity),
        development=[
            DevelopmentSelection(
                from_age_months=12,
                to_age_months=24,
                value=330.0 / 210.0,
                intent=DevelopmentIntent(kind="volume-weighted"),
            ),
            DevelopmentSelection(
                from_age_months=24,
                to_age_months=36,
                value=1.25,
                intent=DevelopmentIntent(kind="volume-weighted"),
            ),
        ],
        tail=None,
    )
    fields.update(overrides)
    return SelectionPayload(**fields)


def make_selection_doc(triangle_integrity: str, **overrides) -> Document:
    return Document(
        kind="selection",
        payload=make_selection_payload(triangle_integrity, **overrides),
        created_at=CREATED_AT,
    )
