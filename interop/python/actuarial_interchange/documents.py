"""Interchange documents: envelope, payload dataclasses, integrity, parsing.

One class per document kind (spec 3.2), one envelope shape (spec 3.1), one
integrity rule: ``integrity = fnv1a64(canonical_json(semantic body))`` where
the semantic body is the single kind-named object — NEVER the envelope. A
re-export by another adapter changes the envelope, not the tag, so
appliesTo-by-tag linkage survives cross-language hops.

Contracts enforced here:

- Version handling (spec 3.5): wrong-major documents raise
  ``UnsupportedVersionError``; same-major unknown minors are accepted.
- Unknown-field preservation: unknown fields inside a payload land in that
  payload's ``extra`` dict and re-serialize with it, so the integrity tag
  of a newer-minor document survives a hop through this adapter, and
  ``governance``/``extensions`` round-trip opaquely (spec 3.1).
- Rationale is REQUIRED for judgmental/external intents (spec 3.2).
- ``createdAt`` is caller-supplied; this module never reads a clock.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Optional, Union

from ._jcs import canonical_json, fnv1a64
from .errors import BadInterchangeError, UnsupportedVersionError

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

CROSSCHECK_VERDICTS = frozenset(
    {"agree", "disagree", "not-comparable", "verified-by-value"}
)

# Kind -> the semantic-body key (spec 3.1 names the object after the kind's
# head noun: method-result and stochastic-result both carry "result").
_BODY_KEYS: dict[str, str] = {
    "triangle": "triangle",
    "selection": "selection",
    "method-result": "result",
    "stochastic-result": "result",
    "study": "study",
    "crosscheck-report": "report",
}

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


# ---------------------------------------------------------------------------
# Envelope pieces
# ---------------------------------------------------------------------------


@dataclass
class Generator:
    """The adapter that wrote a document, stamped per spec 3.1."""

    name: str = GENERATOR_NAME
    version: str = GENERATOR_VERSION

    def to_dict(self) -> dict:
        return {"name": self.name, "version": self.version}

    @classmethod
    def from_dict(cls, raw: dict) -> "Generator":
        return cls(
            name=_require(raw, "name", "generator"),
            version=_require(raw, "version", "generator"),
        )


# ---------------------------------------------------------------------------
# TriangleDoc payload
# ---------------------------------------------------------------------------


@dataclass
class Origin:
    """One origin period: display label plus ISO period-start date."""

    label: str
    start: Optional[str] = None

    def to_dict(self) -> dict:
        out: dict = {"label": self.label}
        _put_optional(out, "start", self.start)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "Origin":
        return cls(label=_require(raw, "label", "origin"), start=raw.get("start"))


@dataclass
class TrianglePayload:
    """The semantic body of a TriangleDoc (spec 3.2).

    ``values`` is origins x agesMonths, row-major; ``None`` means UNOBSERVED
    and must never be conflated with 0 (spec 3.1 null rule).
    """

    measure: str
    cumulative: bool
    origin_length_months: int
    origins: list[Origin]
    ages_months: list[int]
    values: list[list[Optional[float]]]
    valuation_date: str
    basis: Optional[dict] = None
    units: Optional[dict] = None
    segment: Optional[dict] = None
    extra: dict = field(default_factory=dict)

    def to_body(self) -> dict:
        body: dict = {
            "measure": self.measure,
            "cumulative": self.cumulative,
            "originLengthMonths": self.origin_length_months,
            "origins": [origin.to_dict() for origin in self.origins],
            "agesMonths": list(self.ages_months),
            "values": [list(row) for row in self.values],
            "valuationDate": self.valuation_date,
        }
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
            "valuationDate",
            "basis",
            "units",
            "segment",
        }
        return cls(
            measure=_require(body, "measure", "triangle"),
            cumulative=_require(body, "cumulative", "triangle"),
            origin_length_months=_require(body, "originLengthMonths", "triangle"),
            origins=[Origin.from_dict(o) for o in _require(body, "origins", "triangle")],
            ages_months=list(_require(body, "agesMonths", "triangle")),
            values=[list(row) for row in _require(body, "values", "triangle")],
            valuation_date=_require(body, "valuationDate", "triangle"),
            basis=body.get("basis"),
            units=body.get("units"),
            segment=body.get("segment"),
            extra={k: v for k, v in body.items() if k not in known},
        )


# ---------------------------------------------------------------------------
# SelectionDoc payload
# ---------------------------------------------------------------------------


@dataclass
class Exclusion:
    """A link ratio excluded from an averaging window, with its reason."""

    origin: str
    reason: Optional[str] = None

    def to_dict(self) -> dict:
        out: dict = {"origin": self.origin}
        _put_optional(out, "reason", self.reason)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "Exclusion":
        return cls(origin=_require(raw, "origin", "exclusion"), reason=raw.get("reason"))


@dataclass
class DevelopmentIntent:
    """HOW a development factor was chosen (spec 3.2 intent vocabulary).

    ``rationale`` is REQUIRED when kind is judgmental or external — there
    the value IS the judgment and the rationale carries its justification.
    ``exclude_high``/``exclude_low`` are medial trims, valid only with
    kind="medial".
    """

    kind: str
    window_origin_periods: Optional[int] = None
    exclude_high: Optional[int] = None
    exclude_low: Optional[int] = None
    exclusions: Optional[list[Exclusion]] = None
    rationale: Optional[str] = None
    extra: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.kind in VALUE_ONLY_INTENT_KINDS and not self.rationale:
            raise BadInterchangeError(
                f"development intent kind '{self.kind}' requires a rationale (spec 3.2)"
            )
        if self.kind != "medial" and (self.exclude_high or self.exclude_low):
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
            extra={k: v for k, v in raw.items() if k not in known},
        )


@dataclass
class DevelopmentSelection:
    """One selected age-to-age factor: the value plus the intent behind it."""

    from_age_months: int
    to_age_months: int
    value: float
    intent: DevelopmentIntent

    def to_dict(self) -> dict:
        return {
            "fromAgeMonths": self.from_age_months,
            "toAgeMonths": self.to_age_months,
            "value": self.value,
            "intent": self.intent.to_dict(),
        }

    @classmethod
    def from_dict(cls, raw: dict) -> "DevelopmentSelection":
        return cls(
            from_age_months=_require(raw, "fromAgeMonths", "development selection"),
            to_age_months=_require(raw, "toAgeMonths", "development selection"),
            value=_require(raw, "value", "development selection"),
            intent=DevelopmentIntent.from_dict(_require(raw, "intent", "development selection")),
        )


@dataclass
class TailIntent:
    """HOW the tail factor was chosen: fitted (with family + params) or
    judgmental/external (rationale required, same rule as development)."""

    kind: str
    family: Optional[str] = None
    fit_from_age_months: Optional[int] = None
    params: Optional[dict] = None
    rationale: Optional[str] = None
    extra: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.kind in VALUE_ONLY_INTENT_KINDS and not self.rationale:
            raise BadInterchangeError(
                f"tail intent kind '{self.kind}' requires a rationale (spec 3.2)"
            )

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
            extra={k: v for k, v in raw.items() if k not in known},
        )


@dataclass
class TailSelection:
    """The selected tail factor plus the intent behind it."""

    value: float
    intent: TailIntent

    def to_dict(self) -> dict:
        return {"value": self.value, "intent": self.intent.to_dict()}

    @classmethod
    def from_dict(cls, raw: dict) -> "TailSelection":
        return cls(
            value=_require(raw, "value", "tail selection"),
            intent=TailIntent.from_dict(_require(raw, "intent", "tail selection")),
        )


@dataclass
class SelectionAppliesTo:
    """Links a SelectionDoc to the triangle it was selected on, by
    integrity tag (envelope-independent, so the link survives re-export)."""

    measure: str
    triangle_integrity: str

    def to_dict(self) -> dict:
        return {"measure": self.measure, "triangleIntegrity": self.triangle_integrity}

    @classmethod
    def from_dict(cls, raw: dict) -> "SelectionAppliesTo":
        return cls(
            measure=_require(raw, "measure", "selection appliesTo"),
            triangle_integrity=_require(raw, "triangleIntegrity", "selection appliesTo"),
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
            extra={k: v for k, v in body.items() if k not in known},
        )


# ---------------------------------------------------------------------------
# MethodResultDoc / StochasticResultDoc payloads
# ---------------------------------------------------------------------------


@dataclass
class ResultAppliesTo:
    """Links a result to its triangle (and selection, when one was used)."""

    triangle_integrity: Optional[str]
    selection_integrity: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "triangleIntegrity": self.triangle_integrity,
            "selectionIntegrity": self.selection_integrity,
        }

    @classmethod
    def from_dict(cls, raw: dict) -> "ResultAppliesTo":
        return cls(
            triangle_integrity=raw.get("triangleIntegrity"),
            selection_integrity=raw.get("selectionIntegrity"),
        )


@dataclass
class EngineStamp:
    """Which engine produced a result, at which version, under which
    convention profile (spec 3.2 / 5)."""

    name: str
    version: str
    convention_profile: Optional[str] = None

    def to_dict(self) -> dict:
        out: dict = {"name": self.name, "version": self.version}
        _put_optional(out, "conventionProfile", self.convention_profile)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "EngineStamp":
        return cls(
            name=_require(raw, "name", "engine"),
            version=_require(raw, "version", "engine"),
            convention_profile=raw.get("conventionProfile"),
        )


@dataclass
class ResultRow:
    """Per-origin point estimates; standardError only where the engine
    produced one (absent is honest, 0 would be a lie)."""

    origin: str
    ultimate: float
    unpaid: float
    standard_error: Optional[float] = None

    def to_dict(self) -> dict:
        out: dict = {"origin": self.origin, "ultimate": self.ultimate, "unpaid": self.unpaid}
        _put_optional(out, "standardError", self.standard_error)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "ResultRow":
        return cls(
            origin=_require(raw, "origin", "result row"),
            ultimate=_require(raw, "ultimate", "result row"),
            unpaid=_require(raw, "unpaid", "result row"),
            standard_error=raw.get("standardError"),
        )


@dataclass
class ResultTotals:
    """Whole-book totals; same standardError honesty rule as rows."""

    ultimate: float
    unpaid: float
    standard_error: Optional[float] = None

    def to_dict(self) -> dict:
        out: dict = {"ultimate": self.ultimate, "unpaid": self.unpaid}
        _put_optional(out, "standardError", self.standard_error)
        return out

    @classmethod
    def from_dict(cls, raw: dict) -> "ResultTotals":
        return cls(
            ultimate=_require(raw, "ultimate", "result totals"),
            unpaid=_require(raw, "unpaid", "result totals"),
            standard_error=raw.get("standardError"),
        )


@dataclass
class MethodResultPayload:
    """The semantic body of a MethodResultDoc (spec 3.2)."""

    applies_to: ResultAppliesTo
    engine: EngineStamp
    method: str
    parameters: dict
    rows: list[ResultRow]
    totals: ResultTotals
    effective_parameters: Optional[dict] = None
    warnings: list[str] = field(default_factory=list)
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
        if self.warnings:
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
            warnings=list(body.get("warnings", [])),
            extra={k: v for k, v in body.items() if k not in known},
        )


@dataclass
class StochasticResultPayload:
    """The semantic body of a StochasticResultDoc: a MethodResultDoc plus
    distribution-level summaries (spec 3.2). Cross-engine comparison is
    distribution-level only — samples never travel inline."""

    applies_to: ResultAppliesTo
    engine: EngineStamp
    method: str
    parameters: dict
    n_sims: int
    summary: dict
    by_origin: list[dict]
    seed: Optional[int] = None
    warnings: list[str] = field(default_factory=list)
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
        if self.warnings:
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
            warnings=list(body.get("warnings", [])),
            extra={k: v for k, v in body.items() if k not in known},
        )


# ---------------------------------------------------------------------------
# StudyDoc payload
# ---------------------------------------------------------------------------


@dataclass
class StudyPayload:
    """The promotion unit (spec 3.2): triangles + selections (+ optional
    supporting results) as FULL embedded documents, plus the narrative."""

    title: str
    narrative: dict
    triangles: list["Document"]
    selections: list["Document"]
    supporting_results: list["Document"] = field(default_factory=list)
    expectations: Optional[dict] = None
    extra: dict = field(default_factory=dict)

    def to_body(self) -> dict:
        body: dict = {
            "title": self.title,
            "narrative": self.narrative,
            "triangles": [doc.to_dict() for doc in self.triangles],
            "selections": [doc.to_dict() for doc in self.selections],
        }
        if self.supporting_results:
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
        return cls(
            title=_require(body, "title", "study"),
            narrative=_require(body, "narrative", "study"),
            triangles=[parse_document(doc) for doc in _require(body, "triangles", "study")],
            selections=[parse_document(doc) for doc in _require(body, "selections", "study")],
            supporting_results=[parse_document(doc) for doc in body.get("supportingResults", [])],
            expectations=body.get("expectations"),
            extra={k: v for k, v in body.items() if k not in known},
        )


# ---------------------------------------------------------------------------
# CrosscheckReportDoc payload
# ---------------------------------------------------------------------------


@dataclass
class CrosscheckReportPayload:
    """Referee output (spec 3.2 / 5). The referee itself lives in the TS
    package; this adapter parses and round-trips its reports, typing the
    load-bearing fields and preserving the rest in ``extra``."""

    verdict: str
    engines: list[dict] = field(default_factory=list)
    applies_to: Optional[dict] = None
    tolerance: Optional[float] = None
    extra: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.verdict not in CROSSCHECK_VERDICTS:
            raise BadInterchangeError(
                f"unknown crosscheck verdict '{self.verdict}'; "
                f"expected one of {sorted(CROSSCHECK_VERDICTS)}"
            )

    def to_body(self) -> dict:
        body: dict = {"verdict": self.verdict, "engines": list(self.engines)}
        _put_optional(body, "appliesTo", self.applies_to)
        _put_optional(body, "tolerance", self.tolerance)
        body.update(self.extra)
        return body

    @classmethod
    def from_body(cls, body: dict) -> "CrosscheckReportPayload":
        known = {"verdict", "engines", "appliesTo", "tolerance"}
        return cls(
            verdict=_require(body, "verdict", "crosscheck report"),
            engines=list(body.get("engines", [])),
            applies_to=body.get("appliesTo"),
            tolerance=body.get("tolerance"),
            extra={k: v for k, v in body.items() if k not in known},
        )


Payload = Union[
    TrianglePayload,
    SelectionPayload,
    MethodResultPayload,
    StochasticResultPayload,
    StudyPayload,
    CrosscheckReportPayload,
]

_PAYLOAD_TYPES: dict[str, type] = {
    "triangle": TrianglePayload,
    "selection": SelectionPayload,
    "method-result": MethodResultPayload,
    "stochastic-result": StochasticResultPayload,
    "study": StudyPayload,
    "crosscheck-report": CrosscheckReportPayload,
}

_KIND_BY_PAYLOAD_TYPE: dict[type, str] = {
    TrianglePayload: "triangle",
    SelectionPayload: "selection",
    MethodResultPayload: "method-result",
    StochasticResultPayload: "stochastic-result",
    StudyPayload: "study",
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
    """

    kind: str
    payload: Payload
    created_at: str
    generator: Generator = field(default_factory=Generator)
    interchange_version: str = SPEC_VERSION
    governance: Optional[dict] = None
    extensions: dict = field(default_factory=dict)

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
            _BODY_KEYS[self.kind]: self.body(),
        }
        _put_optional(doc, "governance", self.governance)
        doc["extensions"] = self.extensions
        doc["integrity"] = self.integrity()
        return doc

    def to_json(self) -> str:
        """Serialize the full document as canonical JSON (deterministic
        bytes; the envelope needs no canonical form for integrity, but
        deterministic output makes diffs and fixtures stable)."""
        return canonical_json(self.to_dict())


def _parse_version(version: Any) -> tuple[int, ...]:
    if not isinstance(version, str):
        raise BadInterchangeError("interchangeVersion must be a string")
    parts = version.split(".")
    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        raise BadInterchangeError(
            f"malformed interchangeVersion '{version}' (expected MAJOR.MINOR.PATCH)"
        )
    return tuple(int(part) for part in parts)


def parse_document(source: Union[str, dict], *, verify_integrity: bool = True) -> Document:
    """Parse an interchange document (JSON text or an already-loaded dict).

    Spec 3.5 version handling: a wrong-major document raises
    ``UnsupportedVersionError``; a same-major unknown minor is accepted,
    with unknown payload fields preserved in ``payload.extra`` (so the
    integrity tag survives a hop through this adapter) and
    ``governance``/``extensions`` round-tripped opaquely.

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

    version = _parse_version(_require(raw, "interchangeVersion", "document"))
    if version[0] != SUPPORTED_MAJOR:
        raise UnsupportedVersionError(
            f"interchangeVersion {'.'.join(map(str, version))} has major {version[0]}; "
            f"this adapter reads major {SUPPORTED_MAJOR} only"
        )

    kind = _require(raw, "kind", "document")
    if kind not in _PAYLOAD_TYPES:
        if kind == "bundle":
            raise BadInterchangeError(
                "kind 'bundle' is not supported by this adapter version (Phase B)"
            )
        raise BadInterchangeError(f"unknown document kind '{kind}'")

    body_key = _BODY_KEYS[kind]
    body = _require(raw, body_key, f"document kind '{kind}'")
    if not isinstance(body, dict):
        raise BadInterchangeError(f"'{body_key}' must be a JSON object")

    governance = raw.get("governance")
    extensions = raw.get("extensions", {})

    document = Document(
        kind=kind,
        payload=_PAYLOAD_TYPES[kind].from_body(body),
        created_at=_require(raw, "createdAt", "document"),
        generator=Generator.from_dict(_require(raw, "generator", "document")),
        interchange_version=".".join(map(str, version)),
        governance=governance,
        extensions=extensions,
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
