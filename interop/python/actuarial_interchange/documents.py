"""Interchange documents: envelope, payload dataclasses, integrity, parsing.

One class per document kind (spec 3.2), one envelope shape (spec 3.1), one
integrity rule: ``integrity = fnv1a64(canonical_json(semantic body))`` where
the semantic body is the single kind-named object — NEVER the envelope. A
re-export by another adapter changes the envelope, not the tag, so
appliesTo-by-tag linkage survives cross-language hops.

Contracts enforced here:

- Version handling (spec 3.5): wrong-major documents raise
  ``UnsupportedVersionError``; same-major unknown minors are accepted.
- Unknown-field preservation AT EVERY DEPTH: unknown fields inside a
  payload — including inside nested pieces such as origins, intents,
  engine stamps, rows, and totals — land in that piece's ``extra`` dict
  and re-serialize with it, so the integrity tag of a newer-minor document
  survives a hop through this adapter, and ``governance``/``extensions``
  round-trip opaquely (spec 3.1). Unknown ENVELOPE-level fields are
  carried in ``Document.extra`` for the same reason, and ``extensions``
  is emitted only when the source document carried it.
- Rationale is REQUIRED (and must be non-blank) for judgmental/external
  intents (spec 3.2).
- ``createdAt`` is caller-supplied; this module never reads a clock.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Optional, Union

from ._jcs import canonical_json, fnv1a64
from .errors import BadInterchangeError, UnsupportedVersionError

# ISO calendar-date shape shared with the TS schemas' isoDateSchema.
_ISO_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")

__all__ = [
    "SPEC_VERSION",
    "SUPPORTED_MAJOR",
    "GENERATOR_NAME",
    "GENERATOR_VERSION",
    "Generator",
    "Origin",
    "TrianglePayload",
    "Exclusion",
    "DevelopmentIntent",
    "DevelopmentSelection",
    "TailIntent",
    "TailSelection",
    "SelectionAppliesTo",
    "SelectionPayload",
    "ResultAppliesTo",
    "EngineStamp",
    "ResultRow",
    "ResultTotals",
    "MethodResultPayload",
    "StochasticResultPayload",
    "StudyPayload",
    "BundlePayload",
    "DeviationCell",
    "OriginDeviation",
    "ParameterSet",
    "CrosscheckEngines",
    "CrosscheckParameters",
    "CrosscheckTolerance",
    "CrosscheckDeviations",
    "CrosscheckReportPayload",
    "Document",
    "parse_document",
    "serialize_document",
]

SPEC_VERSION = "1.0.0"
SUPPORTED_MAJOR = 1
GENERATOR_NAME = "actuarial-interchange"
GENERATOR_VERSION = "0.1.0"

#: Intent kinds whose value is recomputable from the triangle (spec 3.2).
COMPUTABLE_INTENT_KINDS = frozenset(
    {"volume-weighted", "simple", "regression", "geometric", "medial"}
)
#: Intent kinds where the VALUE is the judgment and rationale is required.
VALUE_ONLY_INTENT_KINDS = frozenset({"judgmental", "external"})

#: The full development-intent vocabulary (spec 3.2, closed in v1).
DEVELOPMENT_INTENT_KINDS = COMPUTABLE_INTENT_KINDS | VALUE_ONLY_INTENT_KINDS

#: The tail-intent vocabulary (spec 3.2, closed in v1).
TAIL_INTENT_KINDS = frozenset({"fitted", "judgmental", "external"})

CROSSCHECK_VERDICTS = frozenset(
    {"agree", "disagree", "not-comparable", "verified-by-value"}
)

#: Spec 3.2 measure vocabulary: seven core kinds + premium (+ custom:<label>).
CORE_MEASURES = frozenset(
    {
        "paid",
        "incurred",
        "caseReserve",
        "reportedCount",
        "openCount",
        "closedCount",
        "closedWithPayCount",
        "earnedPremium",
    }
)

#: Spec 3.2 cadence vocabulary: annual/semiannual/quarterly/monthly.
ORIGIN_LENGTH_MONTHS = frozenset({12, 6, 3, 1})

_INTEGRITY_RE = re.compile(r"^[0-9a-f]{16}$")

# Kind -> the semantic-body key (spec 3.1 names the object after the kind's
# head noun: method-result and stochastic-result both carry "result").
# kind "bundle" is deliberately ABSENT: its semantic body is the TWO-field
# object { bundle, interchange } spread across two top-level keys
# (_BUNDLE_BODY_KEYS), not one kind-named object (spec 3.2 BundleDoc).
_BODY_KEYS: dict[str, str] = {
    "triangle": "triangle",
    "selection": "selection",
    "method-result": "result",
    "stochastic-result": "result",
    "study": "study",
    "crosscheck-report": "report",
}

#: The wrapped bundle's two body keys; the OUTER integrity tag is
#: fnv1a64(canonical_json({ bundle, interchange })) over exactly these.
_BUNDLE_BODY_KEYS = frozenset({"bundle", "interchange"})

#: Envelope fields this adapter models explicitly; everything else at the
#: document's top level (other than the semantic body key) is preserved in
#: ``Document.extra`` so a hop through this adapter never strips it.
_ENVELOPE_KEYS = frozenset(
    {"interchangeVersion", "kind", "generator", "createdAt", "extensions", "integrity", "governance"}
)


def _require(body: dict, key: str, context: str) -> Any:
    if key not in body:
        raise BadInterchangeError(f"{context}: missing required field '{key}'")
    return body[key]


def _put_optional(target: dict, key: str, value: Any) -> None:
    if value is not None:
        target[key] = value


def _extra_of(raw: dict, known: "frozenset[str] | set[str]") -> dict:
    return {k: v for k, v in raw.items() if k not in known}


def _validate_measure(measure: Any, context: str) -> None:
    """Spec 3.2 measure vocabulary: closed set + the custom:<label> escape."""
    if isinstance(measure, str) and (
        measure in CORE_MEASURES
        or (measure.startswith("custom:") and len(measure) > len("custom:"))
    ):
        return
    raise BadInterchangeError(
        f"{context}: measure {measure!r} is not in the spec 3.2 vocabulary "
        "(paid|incurred|caseReserve|reportedCount|openCount|closedCount|"
        "closedWithPayCount|earnedPremium|custom:<label>)"
    )


def _validate_integrity_tag(tag: Any, context: str) -> None:
    if not isinstance(tag, str) or _INTEGRITY_RE.fullmatch(tag) is None:
        raise BadInterchangeError(
            f"{context}: {tag!r} is not a 16-hex-char fnv1a64 integrity tag"
        )


def _require_rationale(kind: str, rationale: Optional[str], context: str) -> None:
    """Spec 3.2: judgmental/external intents require a NON-BLANK rationale —
    whitespace-only is refused, matching the TS schema's trim check."""
    if kind in VALUE_ONLY_INTENT_KINDS and (rationale is None or not rationale.strip()):
        raise BadInterchangeError(
            f"{context} kind '{kind}' requires a rationale (spec 3.2)"
        )


# ---------------------------------------------------------------------------
# Envelope pieces
# ---------------------------------------------------------------------------


@dataclass
class Generator:
    """The adapter that wrote a document, stamped per spec 3.1."""

    name: str = GENERATOR_NAME
    version: str = GENERATOR_VERSION
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        out: dict = {"name": self.name, "version": self.version}
        out.update(self.extra)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "Generator":
        known = {"name", "version"}
        return cls(
            name=_require(raw, "name", "generator"),
            version=_require(raw, "version", "generator"),
            extra=_extra_of(raw, known),
        )


# ---------------------------------------------------------------------------
# TriangleDoc payload
# ---------------------------------------------------------------------------


@dataclass
class Origin:
    """One origin period: display label plus ISO period-start date.

    ``start`` is REQUIRED on authoring and emission (the TS schema requires
    it). ``from_dict`` keeps one leniency for foreign documents: a missing
    start on a plain-year label derives Jan 1 of that year — note that this
    CHANGES the emitted semantic body, so a start-less foreign document's
    stated integrity tag will not verify (it was non-conforming to begin
    with). A start-less origin is never emitted.
    """

    label: str
    start: str
    extra: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.start is not None and not _ISO_DATE_RE.fullmatch(self.start):
            raise BadInterchangeError(
                f"origins[].start must be an ISO date (yyyy-mm-dd), got {self.start!r}"
            )
        if not isinstance(self.start, str) or not self.start:
            raise BadInterchangeError(
                f"origin '{self.label}' requires a start date "
                "(origins[].start is required on authoring/emission)"
            )

    def to_dict(self) -> dict:
        out: dict = {"label": self.label, "start": self.start}
        out.update(self.extra)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "Origin":
        known = {"label", "start"}
        label = _require(raw, "label", "origin")
        start = raw.get("start")
        if start is None:
            # Lenient fallback for foreign docs: only a plain-year label is
            # unambiguous enough to derive a start from.
            if isinstance(label, str) and len(label) == 4 and label.isdigit():
                start = f"{label}-01-01"
            else:
                raise BadInterchangeError(
                    f"origin '{label}' has no start date and its label is not a "
                    "plain year; supply origins[].start"
                )
        return cls(label=label, start=start, extra=_extra_of(raw, known))


@dataclass
class TrianglePayload:
    """The semantic body of a TriangleDoc (spec 3.2).

    ``values`` is origins x agesMonths, row-major; ``None`` means UNOBSERVED
    and must never be conflated with 0 (spec 3.1 null rule). A triangle
    carries inline ``values`` OR a bulk-lane ``values_ref`` (spec 3.3) —
    at least one is required, mirroring the TS schema's superRefine.
    """

    measure: str
    cumulative: bool
    origin_length_months: int
    origins: list[Origin]
    ages_months: list[int]
    valuation_date: str
    values: Optional[list[list[Optional[float]]]] = None
    values_ref: Optional[dict] = None
    basis: Optional[dict] = None
    units: Optional[dict] = None
    segment: Optional[dict] = None
    extra: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        _validate_measure(self.measure, "triangle")
        if self.origin_length_months not in ORIGIN_LENGTH_MONTHS:
            raise BadInterchangeError(
                f"triangle: originLengthMonths {self.origin_length_months!r} is not "
                "in the spec vocabulary {12, 6, 3, 1}"
            )
        if self.values is None and self.values_ref is None:
            raise BadInterchangeError(
                "a triangle needs inline 'values' or a bulk-lane 'valuesRef' (spec 3.3)"
            )
        if self.values is not None:
            if len(self.values) != len(self.origins):
                raise BadInterchangeError(
                    f"triangle: values has {len(self.values)} row(s) but origins "
                    f"has {len(self.origins)}"
                )
            for i, row in enumerate(self.values):
                if len(row) != len(self.ages_months):
                    raise BadInterchangeError(
                        f"triangle: values[{i}] has {len(row)} column(s) but "
                        f"agesMonths has {len(self.ages_months)}"
                    )

    def to_body(self) -> dict:
        body: dict = {
            "measure": self.measure,
            "cumulative": self.cumulative,
            "originLengthMonths": self.origin_length_months,
            "origins": [origin.to_dict() for origin in self.origins],
            "agesMonths": list(self.ages_months),
            "valuationDate": self.valuation_date,
        }
        if self.values is not None:
            body["values"] = [list(row) for row in self.values]
        _put_optional(body, "valuesRef", self.values_ref)
        _put_optional(body, "basis", self.basis)
        _put_optional(body, "units", self.units)
        _put_optional(body, "segment", self.segment)
        body.update(self.extra)
        return body

    @classmethod
    def from_body(cls, body: dict) -> "TrianglePayload":
        known = {
            "measure",
            "cumulative",
            "originLengthMonths",
            "origins",
            "agesMonths",
            "values",
            "valuesRef",
            "valuationDate",
            "basis",
            "units",
            "segment",
        }
        raw_values = body.get("values")
        return cls(
            measure=_require(body, "measure", "triangle"),
            cumulative=_require(body, "cumulative", "triangle"),
            origin_length_months=_require(body, "originLengthMonths", "triangle"),
            origins=[Origin.from_dict(o) for o in _require(body, "origins", "triangle")],
            ages_months=list(_require(body, "agesMonths", "triangle")),
            valuation_date=_require(body, "valuationDate", "triangle"),
            values=None if raw_values is None else [list(row) for row in raw_values],
            values_ref=body.get("valuesRef"),
            basis=body.get("basis"),
            units=body.get("units"),
            segment=body.get("segment"),
            extra=_extra_of(body, known),
        )


# ---------------------------------------------------------------------------
# SelectionDoc payload
# ---------------------------------------------------------------------------


@dataclass
class Exclusion:
    """A link ratio excluded from an averaging window, with its reason."""

    origin: str
    reason: Optional[str] = None
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        out: dict = {"origin": self.origin}
        _put_optional(out, "reason", self.reason)
        out.update(self.extra)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "Exclusion":
        known = {"origin", "reason"}
        return cls(
            origin=_require(raw, "origin", "exclusion"),
            reason=raw.get("reason"),
            extra=_extra_of(raw, known),
        )


@dataclass
class DevelopmentIntent:
    """HOW a development factor was chosen (spec 3.2 intent vocabulary).

    ``rationale`` is REQUIRED (non-blank) when kind is judgmental or
    external — there the value IS the judgment and the rationale carries
    its justification. ``exclude_high``/``exclude_low`` are medial trims,
    valid only with kind="medial" — an explicit 0 on any other kind is
    just as invalid as a positive trim (TS parity). Unknown kinds are
    rejected: the v1 vocabulary is closed.
    """

    kind: str
    window_origin_periods: Optional[int] = None
    exclude_high: Optional[int] = None
    exclude_low: Optional[int] = None
    exclusions: Optional[list[Exclusion]] = None
    rationale: Optional[str] = None
    extra: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.kind not in DEVELOPMENT_INTENT_KINDS:
            raise BadInterchangeError(
                f"unknown development intent kind '{self.kind}'; "
                f"expected one of {sorted(DEVELOPMENT_INTENT_KINDS)}"
            )
        _require_rationale(self.kind, self.rationale, "development intent")
        if self.kind != "medial" and (
            self.exclude_high is not None or self.exclude_low is not None
        ):
            raise BadInterchangeError(
                "excludeHigh/excludeLow are medial trims, valid only with kind='medial'"
            )

    def to_dict(self) -> dict:
        out: dict = {"kind": self.kind}
        _put_optional(out, "windowOriginPeriods", self.window_origin_periods)
        _put_optional(out, "excludeHigh", self.exclude_high)
        _put_optional(out, "excludeLow", self.exclude_low)
        if self.exclusions is not None:
            out["exclusions"] = [e.to_dict() for e in self.exclusions]
        _put_optional(out, "rationale", self.rationale)
        out.update(self.extra)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "DevelopmentIntent":
        known = {
            "kind",
            "windowOriginPeriods",
            "excludeHigh",
            "excludeLow",
            "exclusions",
            "rationale",
        }
        exclusions = raw.get("exclusions")
        return cls(
            kind=_require(raw, "kind", "development intent"),
            window_origin_periods=raw.get("windowOriginPeriods"),
            exclude_high=raw.get("excludeHigh"),
            exclude_low=raw.get("excludeLow"),
            exclusions=None if exclusions is None else [Exclusion.from_dict(e) for e in exclusions],
            rationale=raw.get("rationale"),
            extra=_extra_of(raw, known),
        )


@dataclass
class DevelopmentSelection:
    """One selected age-to-age factor: the value plus the intent behind it."""

    from_age_months: int
    to_age_months: int
    value: float
    intent: DevelopmentIntent
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        out: dict = {
            "fromAgeMonths": self.from_age_months,
            "toAgeMonths": self.to_age_months,
            "value": self.value,
            "intent": self.intent.to_dict(),
        }
        out.update(self.extra)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "DevelopmentSelection":
        known = {"fromAgeMonths", "toAgeMonths", "value", "intent"}
        return cls(
            from_age_months=_require(raw, "fromAgeMonths", "development selection"),
            to_age_months=_require(raw, "toAgeMonths", "development selection"),
            value=_require(raw, "value", "development selection"),
            intent=DevelopmentIntent.from_dict(_require(raw, "intent", "development selection")),
            extra=_extra_of(raw, known),
        )


@dataclass
class TailIntent:
    """HOW the tail factor was chosen: fitted (with family + params) or
    judgmental/external (non-blank rationale required, same rule as
    development). Unknown kinds are rejected (the v1 vocabulary is closed);
    kind="fitted" requires a family (TS discriminated-union parity)."""

    kind: str
    family: Optional[str] = None
    fit_from_age_months: Optional[int] = None
    params: Optional[dict] = None
    rationale: Optional[str] = None
    extra: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.kind not in TAIL_INTENT_KINDS:
            raise BadInterchangeError(
                f"unknown tail intent kind '{self.kind}'; "
                f"expected one of {sorted(TAIL_INTENT_KINDS)}"
            )
        if self.kind == "fitted" and (not isinstance(self.family, str) or not self.family):
            raise BadInterchangeError(
                "tail intent kind 'fitted' requires a family (spec 3.2)"
            )
        _require_rationale(self.kind, self.rationale, "tail intent")

    def to_dict(self) -> dict:
        out: dict = {"kind": self.kind}
        _put_optional(out, "family", self.family)
        _put_optional(out, "fitFromAgeMonths", self.fit_from_age_months)
        _put_optional(out, "params", self.params)
        _put_optional(out, "rationale", self.rationale)
        out.update(self.extra)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "TailIntent":
        known = {"kind", "family", "fitFromAgeMonths", "params", "rationale"}
        return cls(
            kind=_require(raw, "kind", "tail intent"),
            family=raw.get("family"),
            fit_from_age_months=raw.get("fitFromAgeMonths"),
            params=raw.get("params"),
            rationale=raw.get("rationale"),
            extra=_extra_of(raw, known),
        )


@dataclass
class TailSelection:
    """The selected tail factor plus the intent behind it."""

    value: float
    intent: TailIntent
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        out: dict = {"value": self.value, "intent": self.intent.to_dict()}
        out.update(self.extra)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "TailSelection":
        known = {"value", "intent"}
        return cls(
            value=_require(raw, "value", "tail selection"),
            intent=TailIntent.from_dict(_require(raw, "intent", "tail selection")),
            extra=_extra_of(raw, known),
        )


@dataclass
class SelectionAppliesTo:
    """Links a SelectionDoc to the triangle it was selected on, by
    integrity tag (envelope-independent, so the link survives re-export)."""

    measure: str
    triangle_integrity: str
    extra: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        _validate_measure(self.measure, "selection appliesTo")
        _validate_integrity_tag(self.triangle_integrity, "selection appliesTo triangleIntegrity")

    def to_dict(self) -> dict:
        out: dict = {"measure": self.measure, "triangleIntegrity": self.triangle_integrity}
        out.update(self.extra)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "SelectionAppliesTo":
        known = {"measure", "triangleIntegrity"}
        return cls(
            measure=_require(raw, "measure", "selection appliesTo"),
            triangle_integrity=_require(raw, "triangleIntegrity", "selection appliesTo"),
            extra=_extra_of(raw, known),
        )


@dataclass
class SelectionPayload:
    """The semantic body of a SelectionDoc: intent + values, subject to the
    coherence rule (spec 3.2) enforced by importers, not by this class."""

    applies_to: SelectionAppliesTo
    development: list[DevelopmentSelection]
    tail: Optional[TailSelection] = None
    extra: dict = field(default_factory=dict)

    def to_body(self) -> dict:
        body: dict = {
            "appliesTo": self.applies_to.to_dict(),
            "development": [d.to_dict() for d in self.development],
        }
        if self.tail is not None:
            body["tail"] = self.tail.to_dict()
        body.update(self.extra)
        return body

    @classmethod
    def from_body(cls, body: dict) -> "SelectionPayload":
        known = {"appliesTo", "development", "tail"}
        tail = body.get("tail")
        return cls(
            applies_to=SelectionAppliesTo.from_dict(_require(body, "appliesTo", "selection")),
            development=[
                DevelopmentSelection.from_dict(d) for d in _require(body, "development", "selection")
            ],
            tail=None if tail is None else TailSelection.from_dict(tail),
            extra=_extra_of(body, known),
        )


# ---------------------------------------------------------------------------
# MethodResultDoc / StochasticResultDoc payloads
# ---------------------------------------------------------------------------


@dataclass
class ResultAppliesTo:
    """Links a result to its triangle (and selection, when one was used).

    ``triangle_integrity`` is REQUIRED (a 16-hex fnv1a64 tag, matching the
    TS schema); ``selection_integrity`` is null for runs with no selection
    document and is always emitted (nullable, not omittable)."""

    triangle_integrity: str
    selection_integrity: Optional[str] = None
    extra: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        _validate_integrity_tag(self.triangle_integrity, "result appliesTo triangleIntegrity")
        if self.selection_integrity is not None:
            _validate_integrity_tag(
                self.selection_integrity, "result appliesTo selectionIntegrity"
            )

    def to_dict(self) -> dict:
        out: dict = {
            "triangleIntegrity": self.triangle_integrity,
            "selectionIntegrity": self.selection_integrity,
        }
        out.update(self.extra)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "ResultAppliesTo":
        known = {"triangleIntegrity", "selectionIntegrity"}
        return cls(
            triangle_integrity=_require(raw, "triangleIntegrity", "result appliesTo"),
            selection_integrity=raw.get("selectionIntegrity"),
            extra=_extra_of(raw, known),
        )


@dataclass
class EngineStamp:
    """Which engine produced a result, at which version, under which
    convention profile (spec 3.2 / 5)."""

    name: str
    version: str
    convention_profile: Optional[str] = None
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        out: dict = {"name": self.name, "version": self.version}
        _put_optional(out, "conventionProfile", self.convention_profile)
        out.update(self.extra)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "EngineStamp":
        known = {"name", "version", "conventionProfile"}
        return cls(
            name=_require(raw, "name", "engine"),
            version=_require(raw, "version", "engine"),
            convention_profile=raw.get("conventionProfile"),
            extra=_extra_of(raw, known),
        )


@dataclass
class ResultRow:
    """Per-origin point estimates; standardError only where the engine
    produced one (absent is honest, 0 would be a lie)."""

    origin: str
    ultimate: float
    unpaid: float
    standard_error: Optional[float] = None
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        out: dict = {"origin": self.origin, "ultimate": self.ultimate, "unpaid": self.unpaid}
        _put_optional(out, "standardError", self.standard_error)
        out.update(self.extra)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "ResultRow":
        known = {"origin", "ultimate", "unpaid", "standardError"}
        return cls(
            origin=_require(raw, "origin", "result row"),
            ultimate=_require(raw, "ultimate", "result row"),
            unpaid=_require(raw, "unpaid", "result row"),
            standard_error=raw.get("standardError"),
            extra=_extra_of(raw, known),
        )


@dataclass
class ResultTotals:
    """Whole-book totals; same standardError honesty rule as rows."""

    ultimate: float
    unpaid: float
    standard_error: Optional[float] = None
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        out: dict = {"ultimate": self.ultimate, "unpaid": self.unpaid}
        _put_optional(out, "standardError", self.standard_error)
        out.update(self.extra)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "ResultTotals":
        known = {"ultimate", "unpaid", "standardError"}
        return cls(
            ultimate=_require(raw, "ultimate", "result totals"),
            unpaid=_require(raw, "unpaid", "result totals"),
            standard_error=raw.get("standardError"),
            extra=_extra_of(raw, known),
        )


@dataclass
class MethodResultPayload:
    """The semantic body of a MethodResultDoc (spec 3.2).

    ``warnings=None`` means the field is ABSENT from the body; an empty
    list means it is explicitly present and empty. The distinction is
    preserved through parse -> re-serialize so another adapter's integrity
    tag survives the hop (spec 3.1); authoring code omits empty warnings.
    """

    applies_to: ResultAppliesTo
    engine: EngineStamp
    method: str
    parameters: dict
    rows: list[ResultRow]
    totals: ResultTotals
    effective_parameters: Optional[dict] = None
    warnings: Optional[list[str]] = None
    extra: dict = field(default_factory=dict)

    def to_body(self) -> dict:
        body: dict = {
            "appliesTo": self.applies_to.to_dict(),
            "engine": self.engine.to_dict(),
            "method": self.method,
            "parameters": self.parameters,
            "rows": [row.to_dict() for row in self.rows],
            "totals": self.totals.to_dict(),
        }
        _put_optional(body, "effectiveParameters", self.effective_parameters)
        if self.warnings is not None:
            body["warnings"] = list(self.warnings)
        body.update(self.extra)
        return body

    @classmethod
    def from_body(cls, body: dict) -> "MethodResultPayload":
        known = {
            "appliesTo",
            "engine",
            "method",
            "parameters",
            "rows",
            "totals",
            "effectiveParameters",
            "warnings",
        }
        return cls(
            applies_to=ResultAppliesTo.from_dict(_require(body, "appliesTo", "result")),
            engine=EngineStamp.from_dict(_require(body, "engine", "result")),
            method=_require(body, "method", "result"),
            parameters=_require(body, "parameters", "result"),
            rows=[ResultRow.from_dict(r) for r in _require(body, "rows", "result")],
            totals=ResultTotals.from_dict(_require(body, "totals", "result")),
            effective_parameters=body.get("effectiveParameters"),
            warnings=list(body["warnings"]) if "warnings" in body else None,
            extra=_extra_of(body, known),
        )


@dataclass
class StochasticResultPayload:
    """The semantic body of a StochasticResultDoc: a MethodResultDoc plus
    distribution-level summaries (spec 3.2). Cross-engine comparison is
    distribution-level only — samples never travel inline. ``warnings``
    follows the MethodResultPayload rule: None = absent, [] = present and
    empty, preserved faithfully for tag stability."""

    applies_to: ResultAppliesTo
    engine: EngineStamp
    method: str
    parameters: dict
    n_sims: int
    summary: dict
    by_origin: list[dict]
    seed: Optional[int] = None
    reproducibility: Optional[str] = None
    stability: Optional[dict] = None
    warnings: Optional[list[str]] = None
    extra: dict = field(default_factory=dict)

    def to_body(self) -> dict:
        body: dict = {
            "appliesTo": self.applies_to.to_dict(),
            "engine": self.engine.to_dict(),
            "method": self.method,
            "parameters": self.parameters,
            "nSims": self.n_sims,
            "summary": self.summary,
            "byOrigin": list(self.by_origin),
        }
        _put_optional(body, "seed", self.seed)
        # Which reproducibility promise this document carries, and the engine's
        # own repeat-run self-check. A seed alone is NOT a reproducibility
        # guarantee (spec 3.2); these say what the seed actually bought.
        _put_optional(body, "reproducibility", self.reproducibility)
        _put_optional(body, "stability", self.stability)
        if self.warnings is not None:
            body["warnings"] = list(self.warnings)
        body.update(self.extra)
        return body

    @classmethod
    def from_body(cls, body: dict) -> "StochasticResultPayload":
        known = {
            "appliesTo",
            "engine",
            "method",
            "parameters",
            "nSims",
            "summary",
            "byOrigin",
            "seed",
            "reproducibility",
            "stability",
            "warnings",
        }
        return cls(
            applies_to=ResultAppliesTo.from_dict(_require(body, "appliesTo", "stochastic result")),
            engine=EngineStamp.from_dict(_require(body, "engine", "stochastic result")),
            method=_require(body, "method", "stochastic result"),
            parameters=_require(body, "parameters", "stochastic result"),
            n_sims=_require(body, "nSims", "stochastic result"),
            summary=_require(body, "summary", "stochastic result"),
            by_origin=list(_require(body, "byOrigin", "stochastic result")),
            seed=body.get("seed"),
            reproducibility=body.get("reproducibility"),
            stability=body.get("stability"),
            warnings=list(body["warnings"]) if "warnings" in body else None,
            extra=_extra_of(body, known),
        )


# ---------------------------------------------------------------------------
# StudyDoc payload
# ---------------------------------------------------------------------------


@dataclass
class StudyPayload:
    """The promotion unit (spec 3.2): triangles + selections (+ optional
    supporting results) as FULL embedded documents, plus the narrative.

    ``supporting_results=None`` means the field is ABSENT from the body; an
    empty list means it is explicitly present and empty — exactly the
    ``warnings`` rule, preserved for tag stability. Embedded documents
    re-serialize byte-faithfully (envelope extras, ``extensions``
    presence/absence, and unknown nested fields all round-trip)."""

    title: str
    narrative: dict
    triangles: list["Document"]
    selections: list["Document"]
    supporting_results: Optional[list["Document"]] = None
    expectations: Optional[dict] = None
    extra: dict = field(default_factory=dict)

    def to_body(self) -> dict:
        body: dict = {
            "title": self.title,
            "narrative": self.narrative,
            "triangles": [doc.to_dict() for doc in self.triangles],
            "selections": [doc.to_dict() for doc in self.selections],
        }
        if self.supporting_results is not None:
            body["supportingResults"] = [doc.to_dict() for doc in self.supporting_results]
        _put_optional(body, "expectations", self.expectations)
        body.update(self.extra)
        return body

    @classmethod
    def from_body(cls, body: dict) -> "StudyPayload":
        known = {
            "title",
            "narrative",
            "triangles",
            "selections",
            "supportingResults",
            "expectations",
        }
        supporting = body.get("supportingResults")
        return cls(
            title=_require(body, "title", "study"),
            narrative=_require(body, "narrative", "study"),
            triangles=[parse_document(doc) for doc in _require(body, "triangles", "study")],
            selections=[parse_document(doc) for doc in _require(body, "selections", "study")],
            supporting_results=(
                None if supporting is None else [parse_document(doc) for doc in supporting]
            ),
            expectations=body.get("expectations"),
            extra=_extra_of(body, known),
        )


# ---------------------------------------------------------------------------
# BundleDoc payload
# ---------------------------------------------------------------------------


#: Document kinds the bundle mirror's ``results`` array may carry
#: (TS bundleInterchangeSchema: MethodResultDoc | StochasticResultDoc).
_BUNDLE_RESULT_KINDS = frozenset({"method-result", "stochastic-result"})


@dataclass
class BundlePayload:
    """The wrapped reproducibility bundle (spec 3.2 BundleDoc).

    - ``bundle`` is the HOST'S existing canonical payload (compliance's
      ``{ payload, hash }``), OPAQUE at this layer and preserved
      byte-faithfully — this adapter never parses the TS-native blob.
    - ``triangles``/``selections``/``results`` are the interchange MIRROR:
      full embedded documents, parsed (each verifying its own integrity
      tag) and re-serialized byte-faithfully, exactly like StudyPayload's
      embedded documents.
    - The semantic body is the TWO-field object ``{ bundle, interchange }``
      — the outer tag covers both, so the mirror (the only part non-TS
      consumers read) cannot drift from the wrapped payload unnoticed.
    - ``interchange_extra`` carries unknown fields inside the interchange
      block (TS passthrough parity); they are part of the outer tag and
      re-serialize in place.
    """

    bundle: dict
    triangles: list["Document"]
    selections: list["Document"]
    results: list["Document"]
    interchange_extra: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        for doc in self.triangles:
            if doc.kind != "triangle":
                raise BadInterchangeError(
                    f"bundle interchange.triangles carries kind '{doc.kind}'; "
                    "only triangle documents belong there"
                )
        for doc in self.selections:
            if doc.kind != "selection":
                raise BadInterchangeError(
                    f"bundle interchange.selections carries kind '{doc.kind}'; "
                    "only selection documents belong there"
                )
        for doc in self.results:
            if doc.kind not in _BUNDLE_RESULT_KINDS:
                raise BadInterchangeError(
                    f"bundle interchange.results carries kind '{doc.kind}'; "
                    "only method-result/stochastic-result documents belong there"
                )

    def to_body(self) -> dict:
        interchange: dict = {
            "triangles": [doc.to_dict() for doc in self.triangles],
            "selections": [doc.to_dict() for doc in self.selections],
            "results": [doc.to_dict() for doc in self.results],
        }
        interchange.update(self.interchange_extra)
        return {"bundle": self.bundle, "interchange": interchange}

    @classmethod
    def from_body(cls, body: dict) -> "BundlePayload":
        bundle = _require(body, "bundle", "bundle")
        if not isinstance(bundle, dict):
            raise BadInterchangeError("bundle: 'bundle' segment must be a JSON object")
        interchange = _require(body, "interchange", "bundle")
        if not isinstance(interchange, dict):
            raise BadInterchangeError("bundle: 'interchange' mirror must be a JSON object")
        known = {"triangles", "selections", "results"}
        return cls(
            bundle=bundle,
            triangles=[
                parse_document(doc)
                for doc in _require(interchange, "triangles", "bundle interchange")
            ],
            selections=[
                parse_document(doc)
                for doc in _require(interchange, "selections", "bundle interchange")
            ],
            results=[
                parse_document(doc)
                for doc in _require(interchange, "results", "bundle interchange")
            ],
            interchange_extra=_extra_of(interchange, known),
        )


# ---------------------------------------------------------------------------
# CrosscheckReportDoc payload
# ---------------------------------------------------------------------------


@dataclass
class DeviationCell:
    """Relative deviations per metric; None = not compared (metric absent
    on a side, or the inputs were not comparable). All three keys are
    always present in the body (nullable, not omittable — TS parity)."""

    ultimate: Optional[float]
    unpaid: Optional[float]
    standard_error: Optional[float]
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        out: dict = {
            "ultimate": self.ultimate,
            "unpaid": self.unpaid,
            "standardError": self.standard_error,
        }
        out.update(self.extra)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "DeviationCell":
        known = {"ultimate", "unpaid", "standardError"}
        return cls(
            ultimate=_require(raw, "ultimate", "deviation cell"),
            unpaid=_require(raw, "unpaid", "deviation cell"),
            standard_error=_require(raw, "standardError", "deviation cell"),
            extra=_extra_of(raw, known),
        )


@dataclass
class OriginDeviation:
    """One origin's relative deviations (a DeviationCell plus the origin)."""

    origin: str
    ultimate: Optional[float]
    unpaid: Optional[float]
    standard_error: Optional[float]
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        out: dict = {
            "origin": self.origin,
            "ultimate": self.ultimate,
            "unpaid": self.unpaid,
            "standardError": self.standard_error,
        }
        out.update(self.extra)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "OriginDeviation":
        known = {"origin", "ultimate", "unpaid", "standardError"}
        return cls(
            origin=_require(raw, "origin", "origin deviation"),
            ultimate=_require(raw, "ultimate", "origin deviation"),
            unpaid=_require(raw, "unpaid", "origin deviation"),
            standard_error=_require(raw, "standardError", "origin deviation"),
            extra=_extra_of(raw, known),
        )


@dataclass
class ParameterSet:
    """One side's parameters: what was requested, and what the engine
    EFFECTIVELY did (null = as requested)."""

    requested: dict
    effective: Optional[dict] = None
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        out: dict = {"requested": self.requested, "effective": self.effective}
        out.update(self.extra)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "ParameterSet":
        known = {"requested", "effective"}
        return cls(
            requested=_require(raw, "requested", "parameter set"),
            effective=_require(raw, "effective", "parameter set"),
            extra=_extra_of(raw, known),
        )


@dataclass
class CrosscheckEngines:
    """The two engine stamps compared, keyed a/b (an OBJECT, not a list —
    TS crosscheckBodySchema parity)."""

    a: EngineStamp
    b: EngineStamp
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        out: dict = {"a": self.a.to_dict(), "b": self.b.to_dict()}
        out.update(self.extra)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "CrosscheckEngines":
        known = {"a", "b"}
        return cls(
            a=EngineStamp.from_dict(_require(raw, "a", "crosscheck engines")),
            b=EngineStamp.from_dict(_require(raw, "b", "crosscheck engines")),
            extra=_extra_of(raw, known),
        )


@dataclass
class CrosscheckParameters:
    """Requested/effective parameter sets for both sides, keyed a/b."""

    a: ParameterSet
    b: ParameterSet
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        out: dict = {"a": self.a.to_dict(), "b": self.b.to_dict()}
        out.update(self.extra)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "CrosscheckParameters":
        known = {"a", "b"}
        return cls(
            a=ParameterSet.from_dict(_require(raw, "a", "crosscheck parameters")),
            b=ParameterSet.from_dict(_require(raw, "b", "crosscheck parameters")),
            extra=_extra_of(raw, known),
        )


@dataclass
class CrosscheckTolerance:
    """The tolerance applied: central estimates, and standard errors
    (null = SEs out of the profile's scope)."""

    central: float
    standard_error: Optional[float] = None
    extra: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if (
            not isinstance(self.central, (int, float))
            or isinstance(self.central, bool)
            or self.central <= 0
        ):
            raise BadInterchangeError(
                f"crosscheck tolerance: central must be a positive number, got {self.central!r}"
            )
        if self.standard_error is not None and (
            not isinstance(self.standard_error, (int, float))
            or isinstance(self.standard_error, bool)
            or self.standard_error <= 0
        ):
            raise BadInterchangeError(
                "crosscheck tolerance: standardError must be a positive number or null, "
                f"got {self.standard_error!r}"
            )

    def to_dict(self) -> dict:
        out: dict = {"central": self.central, "standardError": self.standard_error}
        out.update(self.extra)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "CrosscheckTolerance":
        known = {"central", "standardError"}
        return cls(
            central=_require(raw, "central", "crosscheck tolerance"),
            standard_error=_require(raw, "standardError", "crosscheck tolerance"),
            extra=_extra_of(raw, known),
        )


@dataclass
class CrosscheckDeviations:
    """Per-origin and total relative deviations."""

    per_origin: list[OriginDeviation]
    totals: DeviationCell
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        out: dict = {
            "perOrigin": [d.to_dict() for d in self.per_origin],
            "totals": self.totals.to_dict(),
        }
        out.update(self.extra)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "CrosscheckDeviations":
        known = {"perOrigin", "totals"}
        return cls(
            per_origin=[
                OriginDeviation.from_dict(d)
                for d in _require(raw, "perOrigin", "crosscheck deviations")
            ],
            totals=DeviationCell.from_dict(_require(raw, "totals", "crosscheck deviations")),
            extra=_extra_of(raw, known),
        )


@dataclass
class CrosscheckReportPayload:
    """Referee output (spec 3.2 / 5), mirroring the TS crosscheckBodySchema
    faithfully: engines {a, b}, the matched appliesTo (null when the
    inputs' tags did not match), parameters {a, b} with requested and
    effective sets, the tolerance object, per-origin and total deviations,
    the verdict, and warnings. The referee itself lives in the TS package;
    this adapter parses, validates, and round-trips its reports with
    unknown fields preserved at every depth."""

    engines: CrosscheckEngines
    applies_to: Optional[ResultAppliesTo]
    parameters: CrosscheckParameters
    tolerance: CrosscheckTolerance
    deviations: CrosscheckDeviations
    verdict: str
    warnings: list[str]
    extra: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.verdict not in CROSSCHECK_VERDICTS:
            raise BadInterchangeError(
                f"unknown crosscheck verdict '{self.verdict}'; "
                f"expected one of {sorted(CROSSCHECK_VERDICTS)}"
            )

    def to_body(self) -> dict:
        body: dict = {
            "engines": self.engines.to_dict(),
            "appliesTo": None if self.applies_to is None else self.applies_to.to_dict(),
            "parameters": self.parameters.to_dict(),
            "tolerance": self.tolerance.to_dict(),
            "deviations": self.deviations.to_dict(),
            "verdict": self.verdict,
            "warnings": list(self.warnings),
        }
        body.update(self.extra)
        return body

    @classmethod
    def from_body(cls, body: dict) -> "CrosscheckReportPayload":
        known = {
            "engines",
            "appliesTo",
            "parameters",
            "tolerance",
            "deviations",
            "verdict",
            "warnings",
        }
        applies_to = _require(body, "appliesTo", "crosscheck report")
        return cls(
            engines=CrosscheckEngines.from_dict(_require(body, "engines", "crosscheck report")),
            applies_to=None if applies_to is None else ResultAppliesTo.from_dict(applies_to),
            parameters=CrosscheckParameters.from_dict(
                _require(body, "parameters", "crosscheck report")
            ),
            tolerance=CrosscheckTolerance.from_dict(
                _require(body, "tolerance", "crosscheck report")
            ),
            deviations=CrosscheckDeviations.from_dict(
                _require(body, "deviations", "crosscheck report")
            ),
            verdict=_require(body, "verdict", "crosscheck report"),
            warnings=list(_require(body, "warnings", "crosscheck report")),
            extra=_extra_of(body, known),
        )


Payload = Union[
    TrianglePayload,
    SelectionPayload,
    MethodResultPayload,
    StochasticResultPayload,
    StudyPayload,
    BundlePayload,
    CrosscheckReportPayload,
]

_PAYLOAD_TYPES: dict[str, type] = {
    "triangle": TrianglePayload,
    "selection": SelectionPayload,
    "method-result": MethodResultPayload,
    "stochastic-result": StochasticResultPayload,
    "study": StudyPayload,
    "bundle": BundlePayload,
    "crosscheck-report": CrosscheckReportPayload,
}

_KIND_BY_PAYLOAD_TYPE: dict[type, str] = {
    TrianglePayload: "triangle",
    SelectionPayload: "selection",
    MethodResultPayload: "method-result",
    StochasticResultPayload: "stochastic-result",
    StudyPayload: "study",
    BundlePayload: "bundle",
    CrosscheckReportPayload: "crosscheck-report",
}


# ---------------------------------------------------------------------------
# Document (envelope + payload)
# ---------------------------------------------------------------------------


@dataclass
class Document:
    """One interchange document: envelope (spec 3.1) around a typed payload.

    The integrity tag is always COMPUTED from the current semantic body,
    never stored, so a parsed-then-reserialized document can never carry a
    stale tag.

    ``extensions`` semantics: ``None`` means the envelope field is ABSENT
    and stays absent on re-serialization (a TS-authored study omitting
    extensions round-trips without the key being injected); a dict —
    including the authoring default ``{}``, matching the TS converters'
    ``extensions ?? {}`` — is present and emitted. ``extra`` carries
    unknown envelope-level fields so a hop never strips them.
    """

    kind: str
    payload: Payload
    created_at: str
    generator: Generator = field(default_factory=Generator)
    interchange_version: str = SPEC_VERSION
    governance: Optional[dict] = None
    extensions: Optional[dict] = field(default_factory=dict)
    extra: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        expected = _KIND_BY_PAYLOAD_TYPE.get(type(self.payload))
        if expected is None:
            raise BadInterchangeError(
                f"unsupported payload type {type(self.payload).__name__}"
            )
        if self.kind != expected:
            raise BadInterchangeError(
                f"kind '{self.kind}' does not match payload type "
                f"{type(self.payload).__name__} (expected '{expected}')"
            )

    def body(self) -> dict:
        """The semantic body: the single kind-named object, envelope-free."""
        return self.payload.to_body()

    def integrity(self) -> str:
        """fnv1a64(canonical_json(semantic body)) — spec 3.1."""
        return fnv1a64(canonical_json(self.body()))

    def to_dict(self) -> dict:
        doc: dict = {
            "interchangeVersion": self.interchange_version,
            "kind": self.kind,
            "generator": self.generator.to_dict(),
            "createdAt": self.created_at,
        }
        if self.kind == "bundle":
            # The bundle's semantic body { bundle, interchange } spreads
            # across two top-level keys (spec 3.2 BundleDoc).
            doc.update(self.body())
        else:
            doc[_BODY_KEYS[self.kind]] = self.body()
        _put_optional(doc, "governance", self.governance)
        if self.extensions is not None:
            doc["extensions"] = self.extensions
        doc.update(self.extra)
        doc["integrity"] = self.integrity()
        return doc

    def to_json(self) -> str:
        """Serialize the full document as canonical JSON (deterministic
        bytes; the envelope needs no canonical form for integrity, but
        deterministic output makes diffs and fixtures stable)."""
        return canonical_json(self.to_dict())


_VERSION_RE = re.compile(r"\d+\.\d+\.\d+", re.ASCII)


def _parse_version(version: Any) -> "tuple[int, int, int]":
    """MAJOR.MINOR.PATCH, ASCII digits only (``str.isdigit`` would admit
    non-ASCII digit characters). The caller keeps the ORIGINAL string for
    round-tripping; this returns the numeric triple for the major check."""
    if not isinstance(version, str):
        raise BadInterchangeError("interchangeVersion must be a string")
    if _VERSION_RE.fullmatch(version) is None:
        raise BadInterchangeError(
            f"malformed interchangeVersion '{version}' (expected MAJOR.MINOR.PATCH)"
        )
    major, minor, patch = (int(part) for part in version.split("."))
    return major, minor, patch


def parse_document(source: Union[str, dict], *, verify_integrity: bool = True) -> Document:
    """Parse an interchange document (JSON text or an already-loaded dict).

    Spec 3.5 version handling: a wrong-major document raises
    ``UnsupportedVersionError``; a same-major unknown minor is accepted,
    with unknown payload fields preserved in the owning piece's ``extra``
    (so the integrity tag survives a hop through this adapter), unknown
    envelope-level fields preserved in ``Document.extra``, and
    ``governance``/``extensions`` round-tripped opaquely (``extensions``
    absence is preserved as absence).

    When ``verify_integrity`` is true (the default) and the document
    carries an ``integrity`` tag, the tag is recomputed from the semantic
    body; a mismatch raises ``BadInterchangeError``.
    """
    if isinstance(source, str):
        try:
            raw = json.loads(source)
        except json.JSONDecodeError as exc:
            raise BadInterchangeError(f"document is not valid JSON: {exc}") from exc
    else:
        raw = source
    if not isinstance(raw, dict):
        raise BadInterchangeError("document must be a JSON object")

    version_text = _require(raw, "interchangeVersion", "document")
    version = _parse_version(version_text)
    if version[0] != SUPPORTED_MAJOR:
        raise UnsupportedVersionError(
            f"interchangeVersion {version_text} has major {version[0]}; "
            f"this adapter reads major {SUPPORTED_MAJOR} only"
        )

    kind = _require(raw, "kind", "document")
    if kind not in _PAYLOAD_TYPES:
        raise BadInterchangeError(f"unknown document kind '{kind}'")

    if kind == "bundle":
        # The bundle's semantic body is the TWO-field object
        # { bundle, interchange } (spec 3.2), assembled from two top-level
        # keys rather than one kind-named object.
        body_keys: "frozenset[str] | set[str]" = _BUNDLE_BODY_KEYS
        body = {
            "bundle": _require(raw, "bundle", "document kind 'bundle'"),
            "interchange": _require(raw, "interchange", "document kind 'bundle'"),
        }
        # OUTER-tag check on the RAW body, BEFORE the embedded mirror
        # documents are parsed: a tampered mirror (or inner segment) fails
        # HERE, naming both tags — matching TS verifyBundle's wrapped mode,
        # which hashes doc.bundle/doc.interchange as committed.
        if verify_integrity and "integrity" in raw:
            stated = raw["integrity"]
            computed_outer = fnv1a64(canonical_json(body))
            if stated != computed_outer:
                raise BadInterchangeError(
                    f"outer integrity mismatch: bundle states {stated!r}, "
                    f"{{ bundle, interchange }} hashes to {computed_outer!r}"
                )
    else:
        body_key = _BODY_KEYS[kind]
        body_keys = {body_key}
        body = _require(raw, body_key, f"document kind '{kind}'")
        if not isinstance(body, dict):
            raise BadInterchangeError(f"'{body_key}' must be a JSON object")

    document = Document(
        kind=kind,
        payload=_PAYLOAD_TYPES[kind].from_body(body),
        created_at=_require(raw, "createdAt", "document"),
        generator=Generator.from_dict(_require(raw, "generator", "document")),
        interchange_version=version_text,
        governance=raw.get("governance"),
        extensions=raw.get("extensions"),  # None = absent, preserved as absent
        extra={k: v for k, v in raw.items() if k not in _ENVELOPE_KEYS and k not in body_keys},
    )

    if verify_integrity and "integrity" in raw:
        stated = raw["integrity"]
        computed = document.integrity()
        if stated != computed:
            raise BadInterchangeError(
                f"integrity mismatch: document states {stated!r}, "
                f"semantic body hashes to {computed!r}"
            )
    return document


def serialize_document(document: Document) -> str:
    """Serialize a Document to canonical JSON text (see Document.to_json)."""
    return document.to_json()
