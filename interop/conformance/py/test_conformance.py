"""Python shore of the Phase A cross-engine conformance suite (spec 10 / 13).

Parses the SAME committed fixture documents the TS runner asserts against
(``interop/conformance/fixtures/``) and proves, per fixture:

- the committed integrity tag survives a parse -> re-serialize hop through
  this adapter (the TS -> Python -> TS tag-stability acceptance), and the
  full chainladder bridge round trip (doc -> cl.Triangle -> doc) reproduces
  the tag byte-identically with every null preserved;
- the volume-weighted-all selection intent replays NATIVELY via
  ``Development(average="volume")`` and passes the coherence rule strictly;
- ``Chainladder`` on the replayed selection matches the TS engine's totals
  and per-origin estimates at the deterministic-cl tolerance (1e-6
  relative);
- ``MackChainladder`` with ``sigma_interpolation="mack"`` pinned matches
  the TS engine's Mack standard errors at the mack1993-vw tolerance
  (0.5% relative) and central estimates at 1e-6;
- the deliberately misaligned run (DEFAULT log-linear sigma, deliberately
  claiming the mack1993-vw profile) is authored and committed at
  ``fixtures/taylor-ashe/misaligned-mack-loglinear.json`` for the TS
  referee to return verdict "disagree" on (spec 13 Phase A acceptance 3);
- the ALIGNED Python-authored result documents (taylor-ashe
  deterministic-cl and mack1993-vw with sigma_interpolation="mack") are
  authored and committed at ``fixtures/taylor-ashe/clpy-{deterministic-cl,
  mack1993-vw}.json`` with the same author-once-then-freeze pattern, for
  the TS referee to return verdict "agree" on.

Requires the ``.venv-interop`` environment (chainladder 0.9.2 pinned):

    .venv-interop/bin/pytest interop/conformance/py -q
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import chainladder as cl
import numpy as np
import pytest

from actuarial_interchange import parse_document, serialize_document
from actuarial_interchange.bridge_result import extract_result
from actuarial_interchange.bridge_selection import (
    selection_doc_to_estimators,
    verify_coherence,
)
from actuarial_interchange.bridge_triangle import cl_to_triangle_doc, triangle_doc_to_cl

FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures"
FIXTURE_NAMES = ("taylor-ashe", "raa", "mortgage")
CREATED_AT = "2026-07-17T00:00:00Z"
MISALIGNED_PATH = FIXTURES_DIR / "taylor-ashe" / "misaligned-mack-loglinear.json"

#: Float-identity tolerance for reproducing the COMMITTED misaligned doc:
#: chainladder 0.9.2 is pinned but numpy/BLAS builds may differ in last
#: ulps across machines. Semantic freeze, not byte freeze.
REPRODUCTION_TOLERANCE = 1e-9


def load_raw(name: str, file: str) -> dict:
    return json.loads((FIXTURES_DIR / name / file).read_text())


def relative_deviation(a: float, b: float) -> float:
    """Same definition as the TS referee: |a-b| / max(|a|, |b|), 0 at 0/0."""
    scale = max(abs(a), abs(b))
    return 0.0 if scale == 0 else abs(a - b) / scale


@lru_cache(maxsize=None)
def fixture_docs(name: str):
    """Committed documents, parsed (parse_document re-verifies each stated
    integrity tag with THIS adapter's JCS/FNV — a cross-language check in
    itself)."""
    return {
        "triangle": parse_document(load_raw(name, "triangle.json")),
        "selection": parse_document(load_raw(name, "selection.json")),
        "deterministic-cl": parse_document(load_raw(name, "deterministic-cl.json")),
        "mack1993-vw": parse_document(load_raw(name, "mack1993-vw.json")),
        "expectations": load_raw(name, "expectations.json"),
    }


@lru_cache(maxsize=None)
def bridged_triangle(name: str) -> "cl.Triangle":
    return triangle_doc_to_cl(fixture_docs(name)["triangle"])


@lru_cache(maxsize=None)
def fitted_cl(name: str) -> "cl.Chainladder":
    """deterministic-cl: the committed selection replayed natively (with the
    coherence rule enforced against the referenced triangle on import),
    then a plain Chainladder fit."""
    development, tail = selection_doc_to_estimators(
        fixture_docs(name)["selection"], triangle=bridged_triangle(name), strict=True
    )
    assert tail is None
    return cl.Chainladder().fit(development.fit_transform(bridged_triangle(name)))


@lru_cache(maxsize=None)
def fitted_mack(name: str, sigma_interpolation: str) -> "cl.MackChainladder":
    """mack1993-vw alignment (or its deliberate log-linear misalignment):
    volume-weighted all-period factors with the given sigma interpolation."""
    development = cl.Development(
        average="volume", n_periods=-1, sigma_interpolation=sigma_interpolation
    )
    return cl.MackChainladder().fit(development.fit_transform(bridged_triangle(name)))


def python_cl_result_doc(name: str):
    docs = fixture_docs(name)
    return extract_result(
        fitted_cl(name),
        created_at=CREATED_AT,
        triangle_integrity=docs["triangle"].integrity(),
        selection_integrity=docs["selection"].integrity(),
        parameters={"average": "volume", "n_periods": -1},
        convention_profile="deterministic-cl",
    )


def python_mack_result_doc(name: str, sigma_interpolation: str, **kwargs):
    docs = fixture_docs(name)
    return extract_result(
        fitted_mack(name, sigma_interpolation),
        created_at=CREATED_AT,
        triangle_integrity=docs["triangle"].integrity(),
        selection_integrity=None,  # Mack runs on its own vw factors (TS parity)
        parameters={
            "average": "volume",
            "n_periods": -1,
            "sigma_interpolation": sigma_interpolation,
        },
        convention_profile="mack1993-vw",
        **kwargs,
    )


def rows_by_origin(payload) -> dict:
    return {row.origin: row for row in payload.rows}


def assert_frozen_payload_matches(frozen, fresh) -> None:
    """Semantic freeze for a committed Python-authored result doc: structure
    and provenance exactly; numbers at REPRODUCTION_TOLERANCE (numpy/BLAS
    builds may differ in last ulps across machines)."""
    assert frozen.method == fresh.method
    assert frozen.engine == fresh.engine
    assert frozen.parameters == fresh.parameters
    assert frozen.applies_to == fresh.applies_to
    assert frozen.warnings == fresh.warnings
    assert [row.origin for row in frozen.rows] == [row.origin for row in fresh.rows]
    for frozen_row, fresh_row in zip(frozen.rows, fresh.rows):
        assert relative_deviation(frozen_row.ultimate, fresh_row.ultimate) <= REPRODUCTION_TOLERANCE
        assert relative_deviation(frozen_row.unpaid, fresh_row.unpaid) <= REPRODUCTION_TOLERANCE
        assert (frozen_row.standard_error is None) == (fresh_row.standard_error is None)
        if frozen_row.standard_error is not None:
            assert (
                relative_deviation(frozen_row.standard_error, fresh_row.standard_error)
                <= REPRODUCTION_TOLERANCE
            )
    assert relative_deviation(frozen.totals.ultimate, fresh.totals.ultimate) <= REPRODUCTION_TOLERANCE
    assert relative_deviation(frozen.totals.unpaid, fresh.totals.unpaid) <= REPRODUCTION_TOLERANCE
    assert (frozen.totals.standard_error is None) == (fresh.totals.standard_error is None)
    if frozen.totals.standard_error is not None:
        assert (
            relative_deviation(frozen.totals.standard_error, fresh.totals.standard_error)
            <= REPRODUCTION_TOLERANCE
        )


@pytest.mark.parametrize("name", FIXTURE_NAMES)
class TestDocumentHop:
    def test_reserialize_preserves_the_committed_integrity_tag(self, name) -> None:
        """TS-authored doc -> Python parse -> Python re-serialize: the tag
        is byte-identical (spec 13 Phase A acceptance 1, document hop)."""
        for file in ("triangle.json", "selection.json", "deterministic-cl.json", "mack1993-vw.json"):
            raw = load_raw(name, file)
            document = parse_document(raw)  # verifies the stated tag itself
            assert document.integrity() == raw["integrity"]
            rehopped = parse_document(serialize_document(document))
            assert rehopped.integrity() == raw["integrity"]


@pytest.mark.parametrize("name", FIXTURE_NAMES)
class TestTriangleBridge:
    def test_every_null_is_preserved_into_chainladder(self, name) -> None:
        payload = fixture_docs(name)["triangle"].payload
        triangle = bridged_triangle(name)
        assert triangle.shape == (1, 1, len(payload.origins), len(payload.ages_months))
        values = triangle.values[0, 0]
        for i, row in enumerate(payload.values):
            for j, cell in enumerate(row):
                if cell is None:
                    assert np.isnan(values[i, j]), f"observed value where doc has null at [{i}][{j}]"
                else:
                    assert values[i, j] == float(cell), f"value drift at [{i}][{j}]"

    def test_full_bridge_round_trip_reproduces_the_tag(self, name) -> None:
        """doc -> cl.Triangle -> doc: identical semantic body, identical
        integrity tag, nulls back as nulls (the strong form of the
        round-trip acceptance)."""
        docs = fixture_docs(name)
        payload = docs["triangle"].payload
        round_tripped = cl_to_triangle_doc(
            bridged_triangle(name), measure=payload.measure, created_at=CREATED_AT
        )
        assert round_tripped.payload.values == payload.values
        assert round_tripped.integrity() == docs["triangle"].integrity()


@pytest.mark.parametrize("name", FIXTURE_NAMES)
class TestSelectionReplay:
    def test_intent_replays_natively_as_volume_weighted_all_periods(self, name) -> None:
        development, tail = selection_doc_to_estimators(
            fixture_docs(name)["selection"], triangle=bridged_triangle(name)
        )
        assert isinstance(development, cl.Development)
        params = development.get_params()
        assert params["average"] == "volume"
        assert params["n_periods"] == -1
        assert tail is None

    def test_selection_is_coherent_on_this_engine(self, name) -> None:
        divergences = verify_coherence(
            fixture_docs(name)["selection"], bridged_triangle(name), strict=True
        )
        assert divergences == []


@pytest.mark.parametrize("name", FIXTURE_NAMES)
class TestDeterministicCl:
    def test_ties_to_the_published_literature_where_it_publishes(self, name) -> None:
        """The only expectation that comes from OUTSIDE any engine.

        Everything else in expectations.json is the TS engine's own frozen
        output — cross-engine agreement with it proves the engines agree, not
        that they are right. `published` carries Mack's tabled values with a
        citation; asserting it HERE means chainladder-python is checked
        against the literature directly, so a shared cross-engine error
        cannot hide behind mutual agreement.
        """
        published = fixture_docs(name)["expectations"].get("published")
        assert published is not None, "the anchor's absence must be declared, not implicit"
        if published.get("citation") is None:
            return  # RAA: Mack (1994) publishes tests, not a reserve table.

        totals = python_cl_result_doc(name).payload.totals
        reserve = published["totalReserve"]
        assert (
            relative_deviation(totals.unpaid, reserve["value"]) <= reserve["tolerance"]
        ), f"{name}: chainladder-python reserve does not tie to {published['citation']}"

    def test_totals_match_the_ts_engine_within_tolerance(self, name) -> None:
        expectations = fixture_docs(name)["expectations"]
        tolerance = expectations["deterministic-cl"]["tolerance"]["central"]
        expected = expectations["deterministic-cl"]["totals"]
        totals = python_cl_result_doc(name).payload.totals
        assert relative_deviation(totals.ultimate, expected["ultimate"]) <= tolerance
        assert relative_deviation(totals.unpaid, expected["unpaid"]) <= tolerance

    def test_per_origin_estimates_match_the_committed_ts_result(self, name) -> None:
        docs = fixture_docs(name)
        tolerance = docs["expectations"]["deterministic-cl"]["tolerance"]["central"]
        ts_rows = rows_by_origin(docs["deterministic-cl"].payload)
        py_rows = rows_by_origin(python_cl_result_doc(name).payload)
        assert set(py_rows) == set(ts_rows), "origin sets differ across engines"
        for origin, ts_row in ts_rows.items():
            py_row = py_rows[origin]
            assert relative_deviation(py_row.ultimate, ts_row.ultimate) <= tolerance
            assert relative_deviation(py_row.unpaid, ts_row.unpaid) <= tolerance

    def test_result_doc_round_trips_through_a_scratch_file(self, name, tmp_path) -> None:
        document = python_cl_result_doc(name)
        scratch = tmp_path / f"{name}-deterministic-cl.json"
        scratch.write_text(serialize_document(document))
        reloaded = parse_document(scratch.read_text())
        assert reloaded.integrity() == document.integrity()
        assert reloaded.payload == document.payload


@pytest.mark.parametrize("name", FIXTURE_NAMES)
class TestMack1993Vw:
    def test_totals_match_the_ts_engine_within_tolerance(self, name) -> None:
        expectations = fixture_docs(name)["expectations"]
        tolerance = expectations["mack1993-vw"]["tolerance"]
        expected = expectations["mack1993-vw"]["totals"]
        totals = python_mack_result_doc(name, "mack").payload.totals
        assert relative_deviation(totals.ultimate, expected["ultimate"]) <= tolerance["central"]
        assert relative_deviation(totals.unpaid, expected["unpaid"]) <= tolerance["central"]
        assert totals.standard_error is not None
        assert (
            relative_deviation(totals.standard_error, expected["standardError"])
            <= tolerance["standardError"]
        )

    def test_per_origin_estimates_and_ses_match_the_committed_ts_result(self, name) -> None:
        docs = fixture_docs(name)
        tolerance = docs["expectations"]["mack1993-vw"]["tolerance"]
        ts_rows = rows_by_origin(docs["mack1993-vw"].payload)
        py_rows = rows_by_origin(python_mack_result_doc(name, "mack").payload)
        assert set(py_rows) == set(ts_rows), "origin sets differ across engines"
        for origin, ts_row in ts_rows.items():
            py_row = py_rows[origin]
            assert relative_deviation(py_row.ultimate, ts_row.ultimate) <= tolerance["central"]
            assert relative_deviation(py_row.unpaid, ts_row.unpaid) <= tolerance["central"]
            if py_row.standard_error is None:
                # A fully developed origin: chainladder reports NaN (omitted,
                # per the honesty rule); the TS engine reports exactly 0.
                assert ts_row.standard_error == 0
            else:
                assert (
                    relative_deviation(py_row.standard_error, ts_row.standard_error)
                    <= tolerance["standardError"]
                )

    def test_result_doc_round_trips_through_a_scratch_file(self, name, tmp_path) -> None:
        document = python_mack_result_doc(name, "mack")
        scratch = tmp_path / f"{name}-mack1993-vw.json"
        scratch.write_text(serialize_document(document))
        reloaded = parse_document(scratch.read_text())
        assert reloaded.integrity() == document.integrity()
        assert reloaded.payload == document.payload


class TestMisalignedRun:
    """Spec 13 Phase A acceptance 3: a deliberately misaligned Mack run —
    the DEFAULT log-linear sigma while CLAIMING mack1993-vw — authored here
    and committed for the TS referee to return verdict "disagree" on."""

    def _author(self):
        return python_mack_result_doc(
            "taylor-ashe",
            "log-linear",
            warnings=[
                "DELIBERATELY MISALIGNED conformance fixture: sigma_interpolation is the "
                "chainladder default 'log-linear' while the engine stamp claims the "
                "mack1993-vw profile (which requires 'mack'); the TS referee must return "
                "verdict 'disagree' on this document"
            ],
        )

    def test_the_misalignment_is_real_on_this_engine(self) -> None:
        aligned = rows_by_origin(python_mack_result_doc("taylor-ashe", "mack").payload)
        misaligned = rows_by_origin(self._author().payload)
        deviations = [
            relative_deviation(misaligned[o].standard_error, aligned[o].standard_error)
            for o in aligned
            if aligned[o].standard_error is not None
        ]
        assert max(deviations) > 0.005, "log-linear vs mack sigma should exceed the SE tolerance"
        # ...while the central estimates are untouched by the sigma choice.
        for origin, row in aligned.items():
            assert misaligned[origin].ultimate == row.ultimate

    def test_committed_misaligned_doc_exists_and_matches_a_fresh_run(self) -> None:
        document = self._author()
        if not MISALIGNED_PATH.exists():
            MISALIGNED_PATH.write_text(json.dumps(document.to_dict(), indent=2) + "\n")
            pytest.skip(
                f"authored {MISALIGNED_PATH.name}; commit it and rerun (the file is a frozen fixture)"
            )
        committed = parse_document(load_raw("taylor-ashe", "misaligned-mack-loglinear.json"))
        assert_frozen_payload_matches(committed.payload, document.payload)


class TestAlignedRuns:
    """The ALIGNED cross-engine fixtures: Python-authored taylor-ashe result
    documents on the SAME committed triangle/selection the TS shore froze —
    deterministic-cl (native volume-weighted replay of the committed
    selection) and mack1993-vw (sigma_interpolation="mack" pinned). Authored
    here with the same author-once-then-freeze pattern as the misaligned
    doc; a TS test referees them against the TS-authored results to
    verdict "agree" (cross-engine agreement, the mirror of acceptance 3)."""

    CASES = {
        "clpy-deterministic-cl.json": lambda: python_cl_result_doc("taylor-ashe"),
        "clpy-mack1993-vw.json": lambda: python_mack_result_doc("taylor-ashe", "mack"),
    }

    @pytest.mark.parametrize("filename", sorted(CASES))
    def test_committed_aligned_doc_exists_and_matches_a_fresh_run(self, filename) -> None:
        document = self.CASES[filename]()
        path = FIXTURES_DIR / "taylor-ashe" / filename
        if not path.exists():
            path.write_text(json.dumps(document.to_dict(), indent=2) + "\n")
            pytest.skip(
                f"authored {filename}; commit it and rerun (the file is a frozen fixture)"
            )
        committed = parse_document(load_raw("taylor-ashe", filename))
        assert_frozen_payload_matches(committed.payload, document.payload)

    def test_aligned_docs_share_the_committed_applies_to_tags(self) -> None:
        docs = fixture_docs("taylor-ashe")
        cl_doc = self.CASES["clpy-deterministic-cl.json"]()
        assert cl_doc.payload.applies_to.triangle_integrity == docs["triangle"].integrity()
        assert cl_doc.payload.applies_to.selection_integrity == docs["selection"].integrity()
        assert cl_doc.payload.engine.convention_profile == "deterministic-cl"
        mack_doc = self.CASES["clpy-mack1993-vw.json"]()
        assert mack_doc.payload.applies_to.triangle_integrity == docs["triangle"].integrity()
        assert mack_doc.payload.applies_to.selection_integrity is None
        assert mack_doc.payload.engine.convention_profile == "mack1993-vw"
        assert mack_doc.payload.parameters["sigma_interpolation"] == "mack"
