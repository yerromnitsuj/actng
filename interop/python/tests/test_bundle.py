"""load_bundle / save_study (spec 4.2) against the TS-authored wrapped
bundle fixture (spec 3.2 BundleDoc).

The reference fixture is the COMMITTED conformance artifact
``interop/conformance/fixtures/taylor-ashe/wrapped-bundle.json``, authored
by the TS shore (@actuarial-ts/compliance) with outer tag
``3750c674d492d2ae`` — so every check here is a cross-language check: this
adapter's JCS/FNV must reproduce the TS tags byte-for-byte.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import chainladder as cl
import numpy as np
import pytest

from actuarial_interchange import (
    BadInterchangeError,
    BundlePayload,
    Document,
    MethodResultPayload,
    SelectionPayload,
    canonical_json,
    fnv1a64,
    load_bundle,
    parse_document,
    save_study,
    serialize_document,
)
from actuarial_interchange.bridge_result import extract_result
from actuarial_interchange.bridge_selection import extract_selections
from actuarial_interchange.bridge_triangle import cl_to_triangle_doc
from conftest import CREATED_AT, make_triangle_doc

WRAPPED_PATH = (
    Path(__file__).resolve().parents[2]
    / "conformance"
    / "fixtures"
    / "taylor-ashe"
    / "wrapped-bundle.json"
)

#: The TS-committed outer tag over { bundle, interchange } (spec 3.2).
OUTER_TAG = "3750c674d492d2ae"
TRIANGLE_TAG = "c568b1bbca929611"


def load_raw() -> dict:
    return json.loads(WRAPPED_PATH.read_text(encoding="utf-8"))


def recompute_outer(raw: dict) -> str:
    """The outer tag as TS verifyBundle computes it: over the raw
    two-field semantic body, exactly."""
    return fnv1a64(canonical_json({"bundle": raw["bundle"], "interchange": raw["interchange"]}))


class TestLoadBundle:
    def test_loads_from_path_with_outer_tag_verified(self) -> None:
        loaded = load_bundle(WRAPPED_PATH)
        assert isinstance(loaded.document.payload, BundlePayload)
        assert loaded.document.integrity() == OUTER_TAG

    def test_loads_from_dict(self) -> None:
        loaded = load_bundle(load_raw())
        assert loaded.document.integrity() == OUTER_TAG

    def test_triangles_arrive_as_cl_triangle_keyed_by_integrity(self) -> None:
        loaded = load_bundle(WRAPPED_PATH)
        assert set(loaded.triangles) == {TRIANGLE_TAG}
        triangle = loaded.triangles[TRIANGLE_TAG]
        assert isinstance(triangle, cl.Triangle)
        # Null preservation: every unobserved (null) doc cell is NaN in the
        # bridged triangle — never 0 (spec 3.1 null rule).
        payload = loaded.triangle_docs[TRIANGLE_TAG].payload
        doc_nulls = sum(cell is None for row in payload.values for cell in row)
        assert doc_nulls > 0  # the fixture really has a lower-right future region
        assert int(np.isnan(triangle.values).sum()) == doc_nulls

    def test_selections_parsed_and_linked_to_triangles(self) -> None:
        loaded = load_bundle(WRAPPED_PATH)
        assert len(loaded.selections) == 1
        payload = loaded.selections[0].payload
        assert isinstance(payload, SelectionPayload)
        # The appliesTo tag is exactly the triangles-dict key (the point of
        # keying by integrity rather than measure).
        assert payload.applies_to.triangle_integrity == TRIANGLE_TAG
        assert TRIANGLE_TAG in loaded.triangles

    def test_results_frames_match_the_result_docs(self) -> None:
        loaded = load_bundle(WRAPPED_PATH)
        assert len(loaded.results) == 2
        for doc in loaded.results:
            payload = doc.payload
            assert isinstance(payload, MethodResultPayload)
            tag = doc.integrity()
            total = loaded.totals_frame[loaded.totals_frame["result"] == tag]
            assert len(total) == 1
            assert float(total["ultimate"].iloc[0]) == payload.totals.ultimate
            assert float(total["unpaid"].iloc[0]) == payload.totals.unpaid
            if payload.totals.standard_error is None:
                assert np.isnan(float(total["standardError"].iloc[0]))
            else:
                assert float(total["standardError"].iloc[0]) == payload.totals.standard_error
            rows = loaded.rows_frame[loaded.rows_frame["result"] == tag]
            assert len(rows) == len(payload.rows)
            assert list(rows["origin"]) == [row.origin for row in payload.rows]
            assert list(rows["ultimate"]) == [row.ultimate for row in payload.rows]
            assert list(rows["unpaid"]) == [row.unpaid for row in payload.rows]

    def test_inner_segment_is_the_opaque_host_bundle(self) -> None:
        raw = load_raw()
        loaded = load_bundle(raw)
        assert loaded.inner == raw["bundle"]
        # For compliance-authored bundles the segment is { payload, hash };
        # it is carried opaquely, never parsed.
        assert isinstance(loaded.inner["payload"], str)
        assert isinstance(loaded.inner["hash"], str)

    def test_non_bundle_document_refused(self) -> None:
        raw = json.loads(serialize_document(make_triangle_doc()))
        with pytest.raises(BadInterchangeError, match="expected a bundle document"):
            load_bundle(raw)


class TestTamperDetection:
    def test_tampered_mirror_triangle_fails_the_outer_tag(self) -> None:
        raw = load_raw()
        raw["interchange"]["triangles"][0]["triangle"]["values"][0][0] += 1.0
        actual = recompute_outer(raw)
        with pytest.raises(BadInterchangeError) as excinfo:
            load_bundle(raw)
        # The error names BOTH tags: the committed outer tag and the hash
        # of what actually arrived.
        assert OUTER_TAG in str(excinfo.value)
        assert actual in str(excinfo.value)

    def test_tampered_inner_bundle_segment_fails_the_outer_tag(self) -> None:
        raw = load_raw()
        raw["bundle"]["payload"] += " "
        actual = recompute_outer(raw)
        with pytest.raises(BadInterchangeError) as excinfo:
            load_bundle(raw)
        assert OUTER_TAG in str(excinfo.value)
        assert actual in str(excinfo.value)

    def test_recomputed_outer_tag_still_fails_the_embedded_tag(self) -> None:
        # A tamperer who fixes up the outer tag after editing the mirror
        # still trips the embedded document's OWN stale tag.
        raw = load_raw()
        raw["interchange"]["triangles"][0]["triangle"]["values"][0][0] += 1.0
        raw["integrity"] = recompute_outer(raw)
        with pytest.raises(BadInterchangeError, match="integrity mismatch: document states"):
            load_bundle(raw)


class TestStdlibOnlyPath:
    def test_chainladder_false_returns_docs_and_no_frames(self) -> None:
        loaded = load_bundle(load_raw(), chainladder=False)
        assert loaded.document.integrity() == OUTER_TAG
        assert set(loaded.triangles) == {TRIANGLE_TAG}
        assert isinstance(loaded.triangles[TRIANGLE_TAG], Document)
        assert loaded.rows_frame is None
        assert loaded.totals_frame is None
        assert len(loaded.selections) == 1
        assert len(loaded.results) == 2

    def test_chainladder_false_never_imports_chainladder_or_pandas(self) -> None:
        # Subprocess proof: a fresh interpreter loads and fully verifies
        # the wrapped bundle without chainladder OR pandas ever appearing
        # in sys.modules (this test module imports both, so the isolation
        # must be a separate process).
        code = (
            "import sys\n"
            "from actuarial_interchange import load_bundle\n"
            f"loaded = load_bundle({str(WRAPPED_PATH)!r}, chainladder=False)\n"
            f"assert loaded.document.integrity() == {OUTER_TAG!r}\n"
            "assert 'chainladder' not in sys.modules, 'chainladder was imported'\n"
            "assert 'pandas' not in sys.modules, 'pandas was imported'\n"
            "print('stdlib-only ok')\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", code], capture_output=True, text=True, timeout=120
        )
        assert result.returncode == 0, result.stderr
        assert "stdlib-only ok" in result.stdout


class TestWrappedRoundTrip:
    def test_parse_then_serialize_is_byte_identical(self) -> None:
        raw = load_raw()
        parsed = parse_document(raw)
        assert parsed.to_dict() == raw
        assert serialize_document(parsed) == canonical_json(raw)
        assert parse_document(serialize_document(parsed)).integrity() == OUTER_TAG

    def test_embedded_documents_reserialize_byte_faithfully(self) -> None:
        raw = load_raw()
        parsed = parse_document(raw)
        out = parsed.to_dict()
        assert out["interchange"]["triangles"] == raw["interchange"]["triangles"]
        assert out["interchange"]["selections"] == raw["interchange"]["selections"]
        assert out["interchange"]["results"] == raw["interchange"]["results"]
        assert out["bundle"] == raw["bundle"]


class TestSaveStudy:
    """The save_study round-trip proof: author a StudyDoc from bridged
    chainladder objects (GenIns), re-parse it, and prove tag stability.
    (The promotion-shaped consumption happens in B4 on the TS side.)"""

    def _bridged_genins_docs(self) -> "tuple[Document, Document, Document]":
        genins = cl.load_sample("genins")
        triangle_doc = cl_to_triangle_doc(genins, measure="paid", created_at=CREATED_AT)
        development = cl.Development(average="volume").fit(genins)
        selection_doc = extract_selections(
            development,
            measure="paid",
            triangle_integrity=triangle_doc.integrity(),
            created_at=CREATED_AT,
        )
        fitted = cl.Chainladder().fit(development.transform(genins))
        result_doc = extract_result(
            fitted,
            created_at=CREATED_AT,
            triangle_integrity=triangle_doc.integrity(),
            selection_integrity=selection_doc.integrity(),
        )
        return triangle_doc, selection_doc, result_doc

    def test_genins_study_round_trips_with_stable_tags(self, tmp_path: Path) -> None:
        triangle_doc, selection_doc, result_doc = self._bridged_genins_docs()
        out_path = tmp_path / "genins-study.json"
        study = save_study(
            title="GenIns volume-weighted factor study",
            narrative={
                "analyst": "B3 round-trip proof",
                "summary": "VW all-period factors on GenIns; supporting Chainladder run.",
            },
            triangles=[triangle_doc],
            selections=[selection_doc],
            supporting_results=[result_doc],
            expectations={"replayTolerance": 0.0005},
            created_at=CREATED_AT,
            path=out_path,
        )
        reparsed = parse_document(out_path.read_text(encoding="utf-8"))
        # Tag stability: the whole study and every embedded document.
        assert reparsed.integrity() == study.integrity()
        assert serialize_document(reparsed) == serialize_document(study)
        assert reparsed.payload.triangles[0].integrity() == triangle_doc.integrity()
        assert reparsed.payload.selections[0].integrity() == selection_doc.integrity()
        assert reparsed.payload.supporting_results[0].integrity() == result_doc.integrity()
        # Linkage survives the hop.
        applies = reparsed.payload.selections[0].payload.applies_to
        assert applies.triangle_integrity == triangle_doc.integrity()

    def test_refuses_an_empty_narrative_summary(self) -> None:
        triangle_doc = make_triangle_doc()
        for narrative in ({}, {"summary": ""}, {"summary": "   "}, {"summary": None}):
            with pytest.raises(BadInterchangeError, match="narrative"):
                save_study(
                    title="t",
                    narrative=narrative,
                    triangles=[triangle_doc],
                    selections=[],
                    created_at=CREATED_AT,
                )

    def test_kind_checks_name_the_slot(self) -> None:
        triangle_doc = make_triangle_doc()
        with pytest.raises(BadInterchangeError, match="selections carries kind"):
            save_study(
                title="t",
                narrative={"summary": "s"},
                triangles=[triangle_doc],
                selections=[triangle_doc],
                created_at=CREATED_AT,
            )
