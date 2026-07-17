"""Triangle bridge: null preservation is the sacred rule (spec 3.1 / 4.2)."""

from __future__ import annotations

import numpy as np
import pytest
import chainladder as cl

from actuarial_interchange import BadInterchangeError, parse_document, serialize_document
from actuarial_interchange.bridge_triangle import cl_to_triangle_doc, triangle_doc_to_cl
from conftest import CREATED_AT, make_triangle_doc, make_triangle_payload


class TestDocToTriangle:
    def test_values_and_nulls_land_exactly(self) -> None:
        triangle = triangle_doc_to_cl(make_triangle_doc())
        grid = triangle.values[0, 0]
        expected = np.array(
            [[100.0, 160.0, 200.0], [110.0, 170.0, np.nan], [120.0, np.nan, np.nan]]
        )
        assert np.array_equal(np.isnan(grid), np.isnan(expected))
        assert np.array_equal(np.nan_to_num(grid), np.nan_to_num(expected))
        assert triangle.is_cumulative is True
        assert list(triangle.development) == [12, 24, 36]

    def test_cumulative_flag_honored(self) -> None:
        incremental = triangle_doc_to_cl(make_triangle_doc(cumulative=False))
        assert incremental.is_cumulative is False
        # cum_to_incr on the cumulative twin equals the incremental read
        cumulative = triangle_doc_to_cl(make_triangle_doc())
        assert np.allclose(
            np.nan_to_num(cumulative.cum_to_incr().values),
            np.nan_to_num(
                triangle_doc_to_cl(
                    make_triangle_doc(
                        cumulative=False,
                        values=[[100.0, 60.0, 40.0], [110.0, 60.0, None], [120.0, None, None]],
                    )
                ).values
            ),
        )

    def test_interior_all_null_origin_row_round_trips(self) -> None:
        # chainladder pads interior origins, so an all-null INTERIOR row is
        # representable and must survive the round trip as nulls.
        doc = make_triangle_doc(values=[[100.0, 160.0, 200.0], [None, None, None], [120.0, None, None]])
        triangle = triangle_doc_to_cl(doc)
        assert triangle.shape[2] == 3
        back = cl_to_triangle_doc(triangle, measure="paid", created_at=CREATED_AT)
        assert back.payload.values[1] == [None, None, None]
        assert back.integrity() == doc.integrity()

    def test_trailing_all_null_origin_row_round_trips(self) -> None:
        # The origin axis extends to the valuation window, so even a
        # trailing all-null origin is representable and survives.
        doc = make_triangle_doc(values=[[100.0, 160.0, 200.0], [110.0, 170.0, None], [None, None, None]])
        back = cl_to_triangle_doc(
            triangle_doc_to_cl(doc), measure="paid", created_at=CREATED_AT
        )
        assert back.payload.values[2] == [None, None, None]
        assert back.integrity() == doc.integrity()

    def test_leading_all_null_origin_row_is_refused_not_dropped(self) -> None:
        # An all-null FIRST origin precedes every observation: chainladder's
        # origin range starts at the first observed origin, so the row would
        # silently vanish. Refuse instead of letting the drop pass.
        doc = make_triangle_doc(values=[[None, None, None], [110.0, 170.0, None], [120.0, None, None]])
        with pytest.raises(BadInterchangeError, match="origin"):
            triangle_doc_to_cl(doc)

    def test_nan_cell_is_refused(self) -> None:
        doc = make_triangle_doc(values=[[100.0, float("nan"), 200.0], [110.0, 170.0, None], [120.0, None, None]])
        with pytest.raises(BadInterchangeError, match="NaN"):
            triangle_doc_to_cl(doc)

    def test_ragged_row_is_refused(self) -> None:
        doc = make_triangle_doc(values=[[100.0, 160.0], [110.0, 170.0, None], [120.0, None, None]])
        with pytest.raises(BadInterchangeError, match="cells for 3 ages"):
            triangle_doc_to_cl(doc)

    def test_quarterly_cadence(self) -> None:
        from actuarial_interchange import Origin

        doc = make_triangle_doc(
            origin_length_months=3,
            origins=[
                Origin(label="2023Q1", start="2023-01-01"),
                Origin(label="2023Q2", start="2023-04-01"),
            ],
            ages_months=[3, 6],
            values=[[50.0, 80.0], [55.0, None]],
            valuation_date="2023-09-30",
        )
        triangle = triangle_doc_to_cl(doc)
        assert triangle.origin_grain == "Q"
        assert list(triangle.development) == [3, 6]


class TestTriangleToDoc:
    def test_round_trip_preserves_values_nulls_and_integrity(self) -> None:
        doc = make_triangle_doc()
        back = cl_to_triangle_doc(
            triangle_doc_to_cl(doc), measure="paid", created_at=CREATED_AT
        )
        assert back.payload.values == doc.payload.values  # nulls in place, no NaN->0
        assert back.payload.ages_months == doc.payload.ages_months
        assert [o.label for o in back.payload.origins] == ["2001", "2002", "2003"]
        assert back.payload.cumulative is True
        assert back.payload.valuation_date == "2003-12-31"
        # The integrity tag is byte-identical across the hop (spec 10).
        assert back.integrity() == doc.integrity()

    def test_genins_doc_round_trip_reproduces_latest_diagonal(self) -> None:
        genins = cl.load_sample("genins")
        doc = cl_to_triangle_doc(genins, measure="paid", created_at=CREATED_AT)
        assert doc.payload.origin_length_months == 12
        assert doc.payload.valuation_date == "2010-12-31"
        rebuilt = triangle_doc_to_cl(doc)
        assert np.allclose(
            rebuilt.latest_diagonal.values[0, 0, :, 0],
            genins.latest_diagonal.values[0, 0, :, 0],
        )
        assert np.array_equal(np.isnan(rebuilt.values), np.isnan(genins.values))

    def test_genins_doc_serializes_and_parses(self) -> None:
        doc = cl_to_triangle_doc(cl.load_sample("genins"), measure="paid", created_at=CREATED_AT)
        parsed = parse_document(serialize_document(doc))
        assert parsed.integrity() == doc.integrity()

    def test_multi_slice_triangle_is_refused(self) -> None:
        clrd = cl.load_sample("clrd")  # many index rows, many columns
        with pytest.raises(BadInterchangeError, match="one .*pair"):
            cl_to_triangle_doc(clrd, measure="paid", created_at=CREATED_AT)

    def test_no_zero_ever_replaces_a_null(self) -> None:
        # The to_json hazard, asserted from the other side: the doc built
        # from a triangle with unobserved cells must carry null there, and
        # zero must appear ONLY where the data genuinely holds zero.
        payload = make_triangle_payload(
            values=[[100.0, 160.0, 0.0], [110.0, 170.0, None], [120.0, None, None]]
        )
        back = cl_to_triangle_doc(
            triangle_doc_to_cl(payload), measure="paid", created_at=CREATED_AT
        )
        assert back.payload.values[0][2] == 0.0  # genuine zero survives
        assert back.payload.values[1][2] is None  # null stays null
        assert back.payload.values[2][1] is None
