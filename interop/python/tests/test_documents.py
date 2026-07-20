"""Documents: integrity envelope-exclusion, version handling, round-trips,
and unknown-field preservation (spec 3.1 / 3.5)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from actuarial_interchange import (
    BadInterchangeError,
    BundlePayload,
    CrosscheckDeviations,
    CrosscheckEngines,
    CrosscheckParameters,
    CrosscheckReportPayload,
    CrosscheckTolerance,
    DeviationCell,
    DevelopmentIntent,
    Document,
    EngineStamp,
    Generator,
    MethodResultPayload,
    Origin,
    OriginDeviation,
    ParameterSet,
    ResultAppliesTo,
    ResultRow,
    ResultTotals,
    SelectionAppliesTo,
    StochasticResultPayload,
    StudyPayload,
    TailIntent,
    TrianglePayload,
    UnsupportedVersionError,
    canonical_json,
    fnv1a64,
    parse_document,
    serialize_document,
)
from conftest import CREATED_AT, make_selection_doc, make_triangle_doc, make_triangle_payload

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


def load_fixture(name: str) -> dict:
    return json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))


def make_crosscheck_payload(**overrides) -> CrosscheckReportPayload:
    """A minimal valid crosscheck payload mirroring the TS body schema."""
    fields = dict(
        engines=CrosscheckEngines(
            a=EngineStamp(name="actuarial-ts", version="0.6.0", convention_profile="mack1993-vw"),
            b=EngineStamp(name="chainladder-python", version="0.9.2", convention_profile="mack1993-vw"),
        ),
        applies_to=ResultAppliesTo(triangle_integrity="c" * 16, selection_integrity=None),
        parameters=CrosscheckParameters(
            a=ParameterSet(requested={"sigma": "mack"}, effective=None),
            b=ParameterSet(
                requested={"sigma_interpolation": "mack"},
                effective={"sigma_interpolation": "log-linear"},
            ),
        ),
        tolerance=CrosscheckTolerance(central=1e-6, standard_error=0.005),
        deviations=CrosscheckDeviations(
            per_origin=[
                OriginDeviation(origin="2001", ultimate=0.0, unpaid=0.0, standard_error=None)
            ],
            totals=DeviationCell(ultimate=0.0, unpaid=0.0, standard_error=1e-9),
        ),
        verdict="agree",
        warnings=[],
    )
    fields.update(overrides)
    return CrosscheckReportPayload(**fields)


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

    def test_embedded_wrong_major_in_study_raises(self) -> None:
        # Finding #2: a study's embedded documents are complete envelopes in
        # their own right (spec 3.5 applies recursively, "all adapters") —
        # this pins the reference behavior TS/R parity is being aligned to.
        # interchange_version is set directly on the Document (an envelope
        # field, not part of the semantic body), so both the embedded
        # triangle's own tag and the study's outer tag stay self-consistent
        # — only the recursive version check can catch this.
        wrong_major_triangle = Document(
            kind="triangle",
            payload=make_triangle_payload(),
            created_at=CREATED_AT,
            interchange_version="2.0.0",
        )
        study = Document(
            kind="study",
            payload=StudyPayload(
                title="embedded-version guard",
                narrative={"summary": "s"},
                triangles=[wrong_major_triangle],
                selections=[],
            ),
            created_at=CREATED_AT,
        )
        with pytest.raises(UnsupportedVersionError):
            parse_document(json.loads(serialize_document(study)))

    def test_embedded_wrong_major_in_bundle_raises(self) -> None:
        wrong_major_triangle = Document(
            kind="triangle",
            payload=make_triangle_payload(),
            created_at=CREATED_AT,
            interchange_version="2.0.0",
        )
        bundle = Document(
            kind="bundle",
            payload=BundlePayload(
                bundle={"payload": "opaque"},
                triangles=[wrong_major_triangle],
                selections=[],
                results=[],
            ),
            created_at=CREATED_AT,
        )
        with pytest.raises(UnsupportedVersionError):
            parse_document(json.loads(serialize_document(bundle)))


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
        # Extras at every crosscheck nesting depth must survive the hop.
        payload = make_crosscheck_payload()
        payload.engines.extra["futureEngineNote"] = "kept"
        payload.tolerance.extra["basis"] = "relative"
        payload.parameters.a.extra["echoSource"] = "profile"
        payload.deviations.extra["method"] = "max-abs"
        payload.deviations.per_origin[0].extra["flag"] = True
        payload.extra["futureReportField"] = {"deep": [1, 2]}
        doc = Document(kind="crosscheck-report", payload=payload, created_at=CREATED_AT)
        parsed = parse_document(serialize_document(doc))
        assert parsed.payload == payload
        assert parsed.integrity() == doc.integrity()

    def test_crosscheck_body_shape_matches_the_ts_schema(self) -> None:
        # engines/tolerance/parameters are OBJECTS; appliesTo and warnings
        # are always-present keys — crosscheckBodySchema parity.
        body = make_crosscheck_payload().to_body()
        assert set(body["engines"]) == {"a", "b"}
        assert body["engines"]["a"]["name"] == "actuarial-ts"
        assert body["tolerance"] == {"central": 1e-6, "standardError": 0.005}
        assert body["parameters"]["a"] == {"requested": {"sigma": "mack"}, "effective": None}
        assert body["deviations"]["totals"]["standardError"] == 1e-9
        assert body["appliesTo"]["selectionIntegrity"] is None
        assert body["warnings"] == []


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
            make_crosscheck_payload(verdict="mostly-agree")

    def test_kind_payload_mismatch_rejected(self) -> None:
        with pytest.raises(BadInterchangeError, match="does not match"):
            Document(kind="selection", payload=make_triangle_payload(), created_at=CREATED_AT)

    def test_bundle_kind_requires_the_interchange_mirror(self) -> None:
        # kind "bundle" is supported since Phase B; a bundle without its
        # interchange mirror is structurally invalid (spec 3.2 BundleDoc).
        raw = json.loads(serialize_document(make_triangle_doc()))
        raw["kind"] = "bundle"
        raw["bundle"] = raw.pop("triangle")
        del raw["integrity"]
        with pytest.raises(BadInterchangeError, match="interchange"):
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


class TestTsAuthoredFixtures:
    """Real TS-authored documents (committed under tests/fixtures/, authored
    by the @actuarial-ts/interchange dist against the conformance fixtures)
    must parse, verify, and re-serialize byte-faithfully on this shore."""

    def test_real_ts_crosscheck_report_parses_and_round_trips(self) -> None:
        raw = load_fixture("ts-crosscheck-report.json")
        parsed = parse_document(raw)  # verifies the TS-stamped tag itself
        payload = parsed.payload
        assert isinstance(payload, CrosscheckReportPayload)
        # engines is an OBJECT {a, b} of EngineStamps (the old list shape
        # would have parsed this file as ["a", "b"]).
        assert payload.engines.a.name == "actuarial-ts"
        assert payload.engines.b.name == "chainladder-python"
        assert payload.engines.b.convention_profile == "mack1993-vw"
        # tolerance is an OBJECT {central, standardError}.
        assert payload.tolerance.central == 1e-6
        assert payload.tolerance.standard_error == 0.005
        # parameters carry requested/effective per side.
        assert payload.parameters.b.requested["sigma_interpolation"] == "log-linear"
        assert payload.parameters.a.effective is None
        # deviations and warnings preserved.
        assert len(payload.deviations.per_origin) == 10
        assert payload.deviations.totals.ultimate is not None
        assert payload.verdict == "disagree"
        assert payload.warnings == []
        assert payload.applies_to is not None
        assert payload.applies_to.selection_integrity is None
        # Byte-faithful hop: structural identity and canonical-byte identity.
        assert parsed.to_dict() == raw
        assert serialize_document(parsed) == canonical_json(raw)
        assert parse_document(serialize_document(parsed)).integrity() == raw["integrity"]

    def test_real_ts_study_without_extensions_round_trips_without_injection(self) -> None:
        raw = load_fixture("ts-study-no-extensions.json")
        assert "extensions" not in raw  # the probe premise
        parsed = parse_document(raw)
        assert parsed.extensions is None
        assert parsed.integrity() == raw["integrity"]
        # Re-serialization must NOT inject an extensions field (doing so
        # previously broke nothing at the envelope, but the same injection
        # into EMBEDDED docs changed the study body and broke the tag).
        out = json.loads(serialize_document(parsed))
        assert "extensions" not in out
        # Embedded documents re-serialize byte-faithfully.
        assert out["study"]["triangles"][0] == raw["study"]["triangles"][0]
        assert out["study"]["selections"][0] == raw["study"]["selections"][0]
        assert "supportingResults" not in out["study"]
        assert parsed.to_dict() == raw
        assert serialize_document(parsed) == canonical_json(raw)


class TestForwardCompatDeepExtras:
    """Finding 2: a synthetic 1.1.0 document with unknown optional fields at
    EVERY nesting depth parses, round-trips tag-stable, and re-serializes
    byte-identically."""

    @staticmethod
    def _stamp(raw: dict, body_key: str) -> dict:
        raw["integrity"] = fnv1a64(canonical_json(raw[body_key]))
        return raw

    def _deep_triangle_raw(self) -> dict:
        body = {
            "measure": "paid",
            "cumulative": True,
            "originLengthMonths": 12,
            "origins": [
                {"label": "2001", "start": "2001-01-01", "originNote": {"deep": [1]}},
                {"label": "2002", "start": "2002-01-01"},
            ],
            "agesMonths": [12, 24],
            "values": [[100.0, 160.0], [110.0, None]],
            "valuationDate": "2002-12-31",
            "basis": {"grossNet": "gross", "futureBasisField": True},
            "futureTriangleField": {"unit": "quarters", "n": 4},
        }
        return self._stamp(
            {
                "interchangeVersion": "1.1.0",
                "kind": "triangle",
                "generator": {"name": "future-adapter", "version": "9.9.9", "build": "abc123"},
                "createdAt": CREATED_AT,
                "extensions": {"x-vendor": 1},
                "futureEnvelopeField": ["kept"],
                "triangle": body,
            },
            "triangle",
        )

    def _deep_selection_raw(self, triangle_integrity: str) -> dict:
        body = {
            "appliesTo": {
                "measure": "paid",
                "triangleIntegrity": triangle_integrity,
                "futureAppliesToField": 7,
            },
            "development": [
                {
                    "fromAgeMonths": 12,
                    "toAgeMonths": 24,
                    "value": 1.6,
                    "intent": {
                        "kind": "volume-weighted",
                        "futureIntentField": "kept",
                        "exclusions": [
                            {"origin": "2001", "reason": "outlier", "futureExclusionField": 3}
                        ],
                    },
                    "futureSelectionField": None,
                }
            ],
            "tail": {
                "value": 1.05,
                "intent": {
                    "kind": "fitted",
                    "family": "exponential-decay",
                    "futureTailIntentField": {"a": 1},
                },
                "futureTailField": [1, 2],
            },
            "futureBodyField": "kept",
        }
        return self._stamp(
            {
                "interchangeVersion": "1.1.0",
                "kind": "selection",
                "generator": {"name": "future-adapter", "version": "9.9.9"},
                "createdAt": CREATED_AT,
                "extensions": {},
                "selection": body,
            },
            "selection",
        )

    def _deep_result_raw(self, triangle_integrity: str) -> dict:
        body = {
            "appliesTo": {
                "triangleIntegrity": triangle_integrity,
                "selectionIntegrity": None,
                "futureAppliesToField": True,
            },
            "engine": {
                "name": "chainladder-python",
                "version": "0.9.2",
                "conventionProfile": "mack1993-vw",
                "futureEngineField": "kept",
            },
            "method": "clpy:MackChainladder",
            "parameters": {"average": "volume"},
            "rows": [
                {
                    "origin": "2001",
                    "ultimate": 100.0,
                    "unpaid": 0.0,
                    "futureRowField": {"deep": True},
                }
            ],
            "totals": {"ultimate": 100.0, "unpaid": 0.0, "futureTotalsField": 1},
            "futureResultField": [{"nested": "kept"}],
        }
        return self._stamp(
            {
                "interchangeVersion": "1.1.0",
                "kind": "method-result",
                "generator": {"name": "future-adapter", "version": "9.9.9"},
                "createdAt": CREATED_AT,
                "extensions": {},
                "result": body,
            },
            "result",
        )

    def _assert_byte_stable(self, raw: dict) -> Document:
        parsed = parse_document(raw)
        assert parsed.integrity() == raw["integrity"]
        text = serialize_document(parsed)
        assert text == canonical_json(raw)  # byte-identical re-serialization
        again = parse_document(text)
        assert again.integrity() == raw["integrity"]
        return parsed

    def test_triangle_extras_at_every_depth(self) -> None:
        raw = self._deep_triangle_raw()
        parsed = self._assert_byte_stable(raw)
        assert parsed.extra == {"futureEnvelopeField": ["kept"]}
        assert parsed.generator.extra == {"build": "abc123"}
        payload = parsed.payload
        assert payload.extra == {"futureTriangleField": {"unit": "quarters", "n": 4}}
        assert payload.origins[0].extra == {"originNote": {"deep": [1]}}
        assert payload.origins[1].extra == {}

    def test_selection_extras_at_every_depth(self) -> None:
        triangle = self._deep_triangle_raw()
        raw = self._deep_selection_raw(triangle["integrity"])
        parsed = self._assert_byte_stable(raw)
        payload = parsed.payload
        assert payload.extra == {"futureBodyField": "kept"}
        assert payload.applies_to.extra == {"futureAppliesToField": 7}
        entry = payload.development[0]
        assert entry.extra == {"futureSelectionField": None}
        assert entry.intent.extra == {"futureIntentField": "kept"}
        assert entry.intent.exclusions[0].extra == {"futureExclusionField": 3}
        assert payload.tail.extra == {"futureTailField": [1, 2]}
        assert payload.tail.intent.extra == {"futureTailIntentField": {"a": 1}}

    def test_result_extras_at_every_depth(self) -> None:
        triangle = self._deep_triangle_raw()
        raw = self._deep_result_raw(triangle["integrity"])
        parsed = self._assert_byte_stable(raw)
        payload = parsed.payload
        assert payload.extra == {"futureResultField": [{"nested": "kept"}]}
        assert payload.applies_to.extra == {"futureAppliesToField": True}
        assert payload.engine.extra == {"futureEngineField": "kept"}
        assert payload.rows[0].extra == {"futureRowField": {"deep": True}}
        assert payload.totals.extra == {"futureTotalsField": 1}


class TestEnvelopeNormalization:
    """Finding 3: extensions absence is preserved as absence; unknown
    envelope-level fields survive the hop; authored documents keep the TS
    converters' extensions-{} convention."""

    def test_extensions_absence_is_preserved(self) -> None:
        raw = json.loads(serialize_document(make_triangle_doc()))
        del raw["extensions"]
        parsed = parse_document(raw)
        assert parsed.extensions is None
        assert "extensions" not in json.loads(serialize_document(parsed))

    def test_authoring_default_emits_empty_extensions(self) -> None:
        # TS converters stamp `extensions ?? {}`; Python-authored documents
        # keep that convention (and the committed Python-authored
        # conformance fixtures' bytes) unless extensions=None is explicit.
        assert make_triangle_doc().to_dict()["extensions"] == {}
        explicit_absent = Document(
            kind="triangle",
            payload=make_triangle_payload(),
            created_at=CREATED_AT,
            extensions=None,
        )
        assert "extensions" not in explicit_absent.to_dict()

    def test_unknown_envelope_fields_round_trip(self) -> None:
        raw = json.loads(serialize_document(make_triangle_doc()))
        raw["futureEnvelopeField"] = {"kept": True}
        parsed = parse_document(raw)
        assert parsed.extra == {"futureEnvelopeField": {"kept": True}}
        assert json.loads(serialize_document(parsed))["futureEnvelopeField"] == {"kept": True}


class TestSupportingResultsTruthiness:
    """Finding 5: supportingResults distinguishes absent (None) from
    present-and-empty ([]), exactly like warnings."""

    @staticmethod
    def _study(supporting_results) -> Document:
        triangle = make_triangle_doc()
        return Document(
            kind="study",
            payload=StudyPayload(
                title="truthiness probe",
                narrative={"summary": "supportingResults absent-vs-empty"},
                triangles=[triangle],
                selections=[make_selection_doc(triangle.integrity())],
                supporting_results=supporting_results,
            ),
            created_at=CREATED_AT,
        )

    def test_absent_stays_absent(self) -> None:
        doc = self._study(None)
        assert "supportingResults" not in doc.body()
        parsed = parse_document(serialize_document(doc))
        assert parsed.payload.supporting_results is None
        assert parsed.integrity() == doc.integrity()

    def test_present_and_empty_stays_present(self) -> None:
        doc = self._study([])
        assert doc.body()["supportingResults"] == []
        parsed = parse_document(serialize_document(doc))
        assert parsed.payload.supporting_results == []
        assert parsed.integrity() == doc.integrity()
        # The two forms are DIFFERENT semantic bodies with different tags.
        assert doc.integrity() != self._study(None).integrity()


class TestValidationParity:
    """Finding 7 (+6, +9): the Python shore refuses what the TS schemas
    refuse, at construction and at parse."""

    def test_explicit_zero_trims_invalid_on_non_medial(self) -> None:
        with pytest.raises(BadInterchangeError, match="medial"):
            DevelopmentIntent(kind="volume-weighted", exclude_high=0)
        with pytest.raises(BadInterchangeError, match="medial"):
            DevelopmentIntent(kind="simple", exclude_low=0)
        # ...while a genuine medial intent may carry explicit trims.
        DevelopmentIntent(kind="medial", exclude_high=1, exclude_low=0)

    def test_whitespace_only_rationale_refused(self) -> None:
        with pytest.raises(BadInterchangeError, match="rationale"):
            DevelopmentIntent(kind="judgmental", rationale="   ")
        with pytest.raises(BadInterchangeError, match="rationale"):
            TailIntent(kind="external", rationale="\t\n")

    def test_fitted_tail_requires_family(self) -> None:
        with pytest.raises(BadInterchangeError, match="family"):
            TailIntent(kind="fitted")

    def test_unknown_intent_kinds_rejected(self) -> None:
        with pytest.raises(BadInterchangeError, match="unknown development intent kind"):
            DevelopmentIntent(kind="bayesian")
        with pytest.raises(BadInterchangeError, match="unknown development intent kind"):
            DevelopmentIntent.from_dict({"kind": "bayesian"})
        with pytest.raises(BadInterchangeError, match="unknown tail intent kind"):
            TailIntent.from_dict({"kind": "extrapolated"})

    def test_measure_vocabulary_enforced(self) -> None:
        with pytest.raises(BadInterchangeError, match="measure"):
            make_triangle_payload(measure="losses")
        with pytest.raises(BadInterchangeError, match="measure"):
            SelectionAppliesTo(measure="custom:", triangle_integrity="a" * 16)
        # The escape hatch and the premium measure are valid.
        make_triangle_payload(measure="custom:reported-severity")
        make_triangle_payload(measure="earnedPremium")

    def test_origin_length_months_vocabulary_enforced(self) -> None:
        with pytest.raises(BadInterchangeError, match="originLengthMonths"):
            make_triangle_payload(origin_length_months=4)

    def test_grid_shape_validated_on_the_payload(self) -> None:
        with pytest.raises(BadInterchangeError, match="row"):
            make_triangle_payload(values=[[100.0, 160.0, 200.0]])
        with pytest.raises(BadInterchangeError, match="column"):
            make_triangle_payload(
                values=[[100.0, 160.0], [110.0, 170.0, None], [120.0, None, None]]
            )

    def test_result_triangle_integrity_required_and_16_hex(self) -> None:
        with pytest.raises(BadInterchangeError, match="integrity tag"):
            ResultAppliesTo(triangle_integrity=None)
        with pytest.raises(BadInterchangeError, match="integrity tag"):
            ResultAppliesTo(triangle_integrity="not-a-tag")
        with pytest.raises(BadInterchangeError, match="integrity tag"):
            ResultAppliesTo(triangle_integrity="a" * 16, selection_integrity="XYZ")
        # A valid link never emits a null triangleIntegrity.
        out = ResultAppliesTo(triangle_integrity="a" * 16).to_dict()
        assert out["triangleIntegrity"] == "a" * 16
        assert out["selectionIntegrity"] is None

    def test_origin_start_required_on_authoring(self) -> None:
        with pytest.raises(BadInterchangeError, match="start"):
            Origin(label="2001", start=None)

    def test_origin_from_dict_year_label_fallback(self) -> None:
        # Lenient read for foreign docs: a plain-year label derives Jan 1 —
        # and the emitted origin ALWAYS carries a start.
        origin = Origin.from_dict({"label": "2001"})
        assert origin.start == "2001-01-01"
        assert origin.to_dict() == {"label": "2001", "start": "2001-01-01"}
        with pytest.raises(BadInterchangeError, match="plain year"):
            Origin.from_dict({"label": "2001Q1"})


class TestValuesRefLane:
    """Finding 8: valuesRef-only triangles are valid documents (spec 3.3)."""

    @staticmethod
    def _bulk_payload() -> TrianglePayload:
        return make_triangle_payload(
            values=None,
            values_ref={"format": "arrow", "path": "values.arrow", "sha256": "ab" * 32},
        )

    def test_values_ref_only_parses_and_round_trips(self) -> None:
        doc = Document(kind="triangle", payload=self._bulk_payload(), created_at=CREATED_AT)
        body = doc.body()
        assert "values" not in body
        assert body["valuesRef"]["format"] == "arrow"
        parsed = parse_document(serialize_document(doc))
        assert parsed.payload.values is None
        assert parsed.payload.values_ref == self._bulk_payload().values_ref
        assert parsed.integrity() == doc.integrity()

    def test_neither_values_nor_values_ref_is_refused(self) -> None:
        with pytest.raises(BadInterchangeError, match="values"):
            make_triangle_payload(values=None)


class TestOriginStartFormat:
    """Origin.start ISO-format parity with the TS isoDateSchema."""

    def test_malformed_start_is_refused(self):
        import pytest as _pytest
        from actuarial_interchange.documents import Origin
        from actuarial_interchange.errors import BadInterchangeError

        with _pytest.raises(BadInterchangeError, match="ISO date"):
            Origin(label="2023", start="Jan 1, 2023")

    def test_valid_start_accepted(self):
        from actuarial_interchange.documents import Origin

        assert Origin(label="2023", start="2023-01-01").start == "2023-01-01"
