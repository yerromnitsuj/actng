"""Result bridge: fitted estimators -> MethodResultDoc with an honest
engine stamp, clpy: namespace, appliesTo tags, and parameter echo."""

from __future__ import annotations

import numpy as np
import pytest
import chainladder as cl

from actuarial_interchange import BadInterchangeError, parse_document, serialize_document
from actuarial_interchange.bridge_result import extract_result
from actuarial_interchange.bridge_triangle import cl_to_triangle_doc
from conftest import CREATED_AT


@pytest.fixture(scope="module")
def genins() -> "cl.Triangle":
    return cl.load_sample("genins")


@pytest.fixture(scope="module")
def mack(genins) -> "cl.MackChainladder":
    return cl.MackChainladder().fit(
        cl.Development(average="volume").fit_transform(genins)
    )


@pytest.fixture(scope="module")
def genins_integrity(genins) -> str:
    """The genins TriangleDoc tag — extract_result REQUIRES the triangle
    linkage (a result that does not say what it applies to is not
    comparable to anything)."""
    return cl_to_triangle_doc(genins, measure="paid", created_at=CREATED_AT).integrity()


class TestMackExtraction:
    def test_totals_match_chainladders_own_numbers(self, genins, mack, genins_integrity) -> None:
        doc = extract_result(mack, created_at=CREATED_AT, triangle_integrity=genins_integrity)
        totals = doc.payload.totals
        assert totals.ultimate == pytest.approx(float(np.nansum(mack.ultimate_.values)))
        assert totals.unpaid == pytest.approx(float(np.nansum(mack.ibnr_.values)))
        assert totals.standard_error == pytest.approx(
            float(np.asarray(mack.total_mack_std_err_).ravel()[0])
        )

    def test_rows_cover_every_origin_including_fully_developed(self, mack, genins_integrity) -> None:
        doc = extract_result(mack, created_at=CREATED_AT, triangle_integrity=genins_integrity)
        rows = doc.payload.rows
        assert [row.origin for row in rows] == [str(y) for y in range(2001, 2011)]
        # 2001 is fully developed: chainladder omits it from ibnr_ and
        # reports NaN SE; the doc carries unpaid 0 and NO standardError —
        # never a fabricated zero SE.
        assert rows[0].unpaid == pytest.approx(0.0)
        assert rows[0].standard_error is None
        assert all(row.standard_error is not None for row in rows[1:])

    def test_per_origin_rows_match_summary(self, mack, genins_integrity) -> None:
        doc = extract_result(mack, created_at=CREATED_AT, triangle_integrity=genins_integrity)
        summary = mack.summary_.to_frame(origin_as_datetime=False)
        for row, (_, expected) in zip(doc.payload.rows, summary.iterrows()):
            assert row.ultimate == pytest.approx(float(expected["Ultimate"]))
            if row.standard_error is not None:
                assert row.standard_error == pytest.approx(float(expected["Mack Std Err"]))

    def test_engine_stamp_method_and_applies_to(self, genins, mack) -> None:
        triangle_doc = cl_to_triangle_doc(genins, measure="paid", created_at=CREATED_AT)
        doc = extract_result(
            mack,
            created_at=CREATED_AT,
            triangle_integrity=triangle_doc.integrity(),
            selection_integrity="d" * 16,
            parameters={"average": "volume", "n_periods": -1},
            convention_profile="mack1993-vw",
        )
        payload = doc.payload
        assert payload.method == "clpy:MackChainladder"
        assert payload.engine.name == "chainladder-python"
        assert payload.engine.version == cl.__version__
        assert payload.engine.convention_profile == "mack1993-vw"
        assert payload.applies_to.triangle_integrity == triangle_doc.integrity()
        assert payload.applies_to.selection_integrity == "d" * 16
        assert payload.parameters == {"average": "volume", "n_periods": -1}

    def test_document_round_trips(self, mack, genins_integrity) -> None:
        doc = extract_result(mack, created_at=CREATED_AT, triangle_integrity=genins_integrity)
        parsed = parse_document(serialize_document(doc))
        assert parsed.payload == doc.payload
        assert parsed.integrity() == doc.integrity()


class TestOtherEstimators:
    def test_plain_chainladder_is_se_less(self, genins, genins_integrity) -> None:
        fitted = cl.Chainladder().fit(
            cl.Development(average="volume").fit_transform(genins)
        )
        doc = extract_result(fitted, created_at=CREATED_AT, triangle_integrity=genins_integrity)
        assert doc.payload.method == "clpy:Chainladder"
        assert all(row.standard_error is None for row in doc.payload.rows)
        assert doc.payload.totals.standard_error is None
        assert doc.payload.totals.ultimate == pytest.approx(
            float(np.nansum(fitted.ultimate_.values))
        )

    def test_bornhuetter_ferguson_extracts_with_parameter_echo(self, genins, genins_integrity) -> None:
        transformed = cl.Development(average="volume").fit_transform(genins)
        base = cl.Chainladder().fit(transformed)
        fitted = cl.BornhuetterFerguson(apriori=1.0).fit(
            transformed, sample_weight=base.ultimate_ * 1.0
        )
        doc = extract_result(fitted, created_at=CREATED_AT, triangle_integrity=genins_integrity)
        assert doc.payload.method == "clpy:BornhuetterFerguson"
        assert doc.payload.parameters["apriori"] == 1.0
        assert doc.payload.totals.unpaid == pytest.approx(
            float(np.nansum(fitted.ibnr_.values)), rel=1e-9
        )
        # BF on the chainladder ultimate as apriori reproduces chainladder.
        assert doc.payload.totals.ultimate == pytest.approx(
            float(np.nansum(base.ultimate_.values)), rel=1e-6
        )

    def test_unsupported_estimator_is_refused(self, genins, genins_integrity) -> None:
        fitted = cl.Development(average="volume").fit(genins)
        with pytest.raises(BadInterchangeError, match="unsupported estimator"):
            extract_result(fitted, created_at=CREATED_AT, triangle_integrity=genins_integrity)

    def test_triangle_integrity_is_required(self, mack) -> None:
        # A result without its triangle linkage is not comparable to
        # anything; the kwarg has no default (finding: TS schema parity).
        with pytest.raises(TypeError, match="triangle_integrity"):
            extract_result(mack, created_at=CREATED_AT)

    def test_warnings_travel(self, mack, genins_integrity) -> None:
        doc = extract_result(
            mack,
            created_at=CREATED_AT,
            triangle_integrity=genins_integrity,
            warnings=["replayed at 1e-6 tolerance"],
        )
        assert doc.payload.warnings == ["replayed at 1e-6 tolerance"]
        assert parse_document(serialize_document(doc)).payload.warnings == [
            "replayed at 1e-6 tolerance"
        ]
