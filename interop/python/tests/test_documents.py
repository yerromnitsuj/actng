"""Documents: integrity envelope-exclusion, version handling, round-trips,
and unknown-field preservation (spec 3.1 / 3.5)."""

from __future__ import annotations

import json

import pytest

from actuarial_interchange import (
    BadInterchangeError,
    CrosscheckReportPayload,
    DevelopmentIntent,
    Document,
    EngineStamp,
    Generator,
    MethodResultPayload,
    ResultAppliesTo,
    ResultRow,
    ResultTotals,
    StochasticResultPayload,
    StudyPayload,
    TailIntent,
    UnsupportedVersionError,
    canonical_json,
    fnv1a64,
    parse_document,
    serialize_document,
)
from conftest import CREATED_AT, make_selection_doc, make_triangle_doc, make_triangle_payload


class TestIntegrity:
    def test_integrity_covers_semantic_body_only(self) -> None:
        # Same payload, different envelope: the tag must not move (spec 3.1
        # — a re-export by another adapter changes the envelope, not the
        # tag, so appliesTo-by-tag linkage survives cross-language hops).
        a = make_triangle_doc()
        b = Document(
            kind="triangle",
            payload=make_triangle_payload(),
            created_at="2030-01-01T12:34:56Z",
            generator=Generator(name="@actuarial-ts/interchange", version="9.9.9"),
            extensions={"note": "re-exported"},
        )
        assert a.integrity() == b.integrity()
        assert a.to_dict()["integrity"] == b.to_dict()["integrity"]

    def test_integrity_moves_with_the_body(self) -> None:
        a = make_triangle_doc()
        b = make_triangle_doc(measure="incurred")
        assert a.integrity() != b.integrity()

    def test_integrity_is_fnv1a64_of_canonical_body(self) -> None:
        doc = make_triangle_doc()
        assert doc.integrity() == fnv1a64(canonical_json(doc.body()))

    def test_parse_verifies_integrity(self) -> None:
        raw = json.loads(serialize_document(make_triangle_doc()))
        raw["triangle"]["values"][0][0] = 999.0  # tamper, keep stale tag
        with pytest.raises(BadInterchangeError, match="integrity mismatch"):
            parse_document(raw)
        parsed = parse_document(raw, verify_integrity=False)
        assert parsed.payload.values[0][0] == 999.0


class TestVersionHandling:
    def test_wrong_major_raises(self) -> None:
        raw = json.loads(serialize_document(make_triangle_doc()))
        raw["interchangeVersion"] = "2.0.0"
        del raw["integrity"]
        with pytest.raises(UnsupportedVersionError):
            parse_document(raw)

    def test_zero_major_raises(self) -> None:
        raw = json.loads(serialize_document(make_triangle_doc()))
        raw["interchangeVersion"] = "0.9.0"
        del raw["integrity"]
        with pytest.raises(UnsupportedVersionError):
            parse_document(raw)

    def test_same_major_unknown_minor_accepted(self) -> None:
        raw = json.loads(serialize_document(make_triangle_doc()))
        raw["interchangeVersion"] = "1.7.3"
        parsed = parse_document(raw)
        assert parsed.interchange_version == "1.7.3"

    def test_malformed_version_raises_bad_interchange(self) -> None:
        raw = json.loads(serialize_document(make_triangle_doc()))
        raw["interchangeVersion"] = "1.0"
        with pytest.raises(BadInterchangeError, match="malformed"):
            parse_document(raw)


class TestRoundTrips:
    def test_triangle_round_trip_is_byte_stable(self) -> None:
        doc = make_triangle_doc()
        text = serialize_document(doc)
        assert serialize_document(parse_document(text)) == text

    def test_selection_round_trip(self) -> None:
        doc = make_selection_doc(make_triangle_doc().integrity())
        parsed = parse_document(serialize_document(doc))
        assert parsed.payload == doc.payload
        assert parsed.integrity() == doc.integrity()

    def test_governance_and_extensions_round_trip_opaquely(self) -> None:
        doc = Document(
            kind="triangle",
            payload=make_triangle_payload(),
            created_at=CREATED_AT,
            governance={"ledger": [{"entry": 1, "unknownField": {"deep": True}}]},
            extensions={"x-vendor": {"anything": [1, 2, 3]}},
        )
        parsed = parse_document(serialize_document(doc))
        assert parsed.governance == doc.governance
        assert parsed.extensions == doc.extensions

    def test_unknown_body_fields_preserved_and_tag_stable(self) -> None:
        # A newer-minor writer added a field this adapter does not know.
        # Spec 3.1: the hop must not strip it — and the integrity tag must
        # survive the round trip.
        raw = json.loads(serialize_document(make_triangle_doc()))
        raw["interchangeVersion"] = "1.1.0"
        raw["triangle"]["futureOptionalField"] = {"unit": "quarters", "n": 4}
        raw["integrity"] = fnv1a64(canonical_json(raw["triangle"]))
        parsed = parse_document(raw)
        assert parsed.payload.extra == {"futureOptionalField": {"unit": "quarters", "n": 4}}
        assert parsed.integrity() == raw["integrity"]
        again = parse_document(serialize_document(parsed))
        assert again.integrity() == raw["integrity"]

    def test_method_result_round_trip(self) -> None:
        payload = MethodResultPayload(
            applies_to=ResultAppliesTo(triangle_integrity="a" * 16, selection_integrity=None),
            engine=EngineStamp(name="chainladder-python", version="0.9.2"),
            method="clpy:MackChainladder",
            parameters={"average": "volume", "n_periods": -1},
            rows=[ResultRow(origin="2001", ultimate=100.0, unpaid=0.0)],
            totals=ResultTotals(ultimate=100.0, unpaid=0.0, standard_error=5.5),
            warnings=["example warning"],
        )
        doc = Document(kind="method-result", payload=payload, created_at=CREATED_AT)
        parsed = parse_document(serialize_document(doc))
        assert parsed.payload == payload
        body = parsed.body()
        assert body["appliesTo"]["selectionIntegrity"] is None
        assert "standardError" not in body["rows"][0]

    def test_stochastic_result_round_trip(self) -> None:
        payload = StochasticResultPayload(
            applies_to=ResultAppliesTo(triangle_integrity="b" * 16),
            engine=EngineStamp(name="chainladder-python", version="0.9.2"),
            method="clpy:BootstrapODPSample",
            parameters={"n_sims": 1000},
            n_sims=1000,
            summary={"mean": 10.0, "sd": 2.0, "cv": 0.2, "percentiles": {"75": 11.4}},
            by_origin=[{"origin": "2001", "mean": 10.0}],
            seed=42,
        )
        doc = Document(kind="stochastic-result", payload=payload, created_at=CREATED_AT)
        parsed = parse_document(serialize_document(doc))
        assert parsed.payload == payload

    def test_study_round_trip_with_embedded_documents(self) -> None:
        triangle = make_triangle_doc()
        selection = make_selection_doc(triangle.integrity())
        study = Document(
            kind="study",
            payload=StudyPayload(
                title="GL occurrence factor study",
                narrative={"analyst": "Sam Doe", "summary": "VW all-period anchors."},
                triangles=[triangle],
                selections=[selection],
                expectations={"replayTolerance": 0.0005},
            ),
            created_at=CREATED_AT,
            governance={},
        )
        parsed = parse_document(serialize_document(study))
        assert parsed.payload.title == "GL occurrence factor study"
        assert parsed.payload.triangles[0].integrity() == triangle.integrity()
        assert parsed.payload.selections[0].integrity() == selection.integrity()
        assert parsed.integrity() == study.integrity()

    def test_crosscheck_report_round_trip(self) -> None:
        payload = CrosscheckReportPayload(
            verdict="agree",
            engines=[{"name": "actuarial-ts", "version": "0.6.0"}],
            applies_to={"triangleIntegrity": "c" * 16},
            tolerance=1e-6,
            extra={"deviations": {"total": 1e-9}},
        )
        doc = Document(kind="crosscheck-report", payload=payload, created_at=CREATED_AT)
        parsed = parse_document(serialize_document(doc))
        assert parsed.payload == payload


class TestValidation:
    def test_judgmental_intent_requires_rationale(self) -> None:
        with pytest.raises(BadInterchangeError, match="rationale"):
            DevelopmentIntent(kind="judgmental")

    def test_external_tail_requires_rationale(self) -> None:
        with pytest.raises(BadInterchangeError, match="rationale"):
            TailIntent(kind="external")

    def test_medial_trims_invalid_on_other_kinds(self) -> None:
        with pytest.raises(BadInterchangeError, match="medial"):
            DevelopmentIntent(kind="volume-weighted", exclude_high=1)

    def test_unknown_verdict_rejected(self) -> None:
        with pytest.raises(BadInterchangeError, match="verdict"):
            CrosscheckReportPayload(verdict="mostly-agree")

    def test_kind_payload_mismatch_rejected(self) -> None:
        with pytest.raises(BadInterchangeError, match="does not match"):
            Document(kind="selection", payload=make_triangle_payload(), created_at=CREATED_AT)

    def test_bundle_kind_is_phase_b(self) -> None:
        raw = json.loads(serialize_document(make_triangle_doc()))
        raw["kind"] = "bundle"
        raw["bundle"] = raw.pop("triangle")
        del raw["integrity"]
        with pytest.raises(BadInterchangeError, match="Phase B"):
            parse_document(raw)

    def test_unknown_kind_rejected(self) -> None:
        raw = json.loads(serialize_document(make_triangle_doc()))
        raw["kind"] = "portfolio"
        del raw["integrity"]
        with pytest.raises(BadInterchangeError, match="unknown document kind"):
            parse_document(raw)

    def test_missing_required_field_names_the_field(self) -> None:
        raw = json.loads(serialize_document(make_triangle_doc()))
        del raw["triangle"]["valuationDate"]
        del raw["integrity"]
        with pytest.raises(BadInterchangeError, match="valuationDate"):
            parse_document(raw)

    def test_not_json_raises(self) -> None:
        with pytest.raises(BadInterchangeError, match="not valid JSON"):
            parse_document("{nope")
