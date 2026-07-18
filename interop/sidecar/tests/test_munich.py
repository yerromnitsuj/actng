"""MunichAdjustment: both slots required; paired-triangle validation."""

from __future__ import annotations

from actuarial_interchange import Document, Origin, TrianglePayload, parse_document

from .conftest import load_fixture


def _incurred_document() -> dict:
    """A deterministic synthetic incurred triangle paired with the committed
    taylor-ashe paid triangle (same origins/ages/valuation/mask)."""
    primary = parse_document(load_fixture("taylor-ashe", "triangle.json")).payload
    values = [
        [
            None if cell is None else round(cell * (1.10 + 0.02 * ((i + j) % 3)), 2)
            for j, cell in enumerate(row)
        ]
        for i, row in enumerate(primary.values)
    ]
    payload = TrianglePayload(
        measure="incurred",
        cumulative=True,
        origin_length_months=primary.origin_length_months,
        origins=[Origin(label=o.label, start=o.start) for o in primary.origins],
        ages_months=list(primary.ages_months),
        valuation_date=primary.valuation_date,
        values=values,
    )
    return Document(
        kind="triangle", payload=payload, created_at="2026-07-18T00:00:00Z"
    ).to_dict()


class TestMunichSlotRefusal:
    def test_missing_secondary_is_422_naming_the_slot(self, client, auth) -> None:
        response = client.post(
            "/v1/run/MunichAdjustment",
            json={"triangles": {"primary": load_fixture("taylor-ashe", "triangle.json")}},
            headers=auth,
        )
        assert response.status_code == 422
        error = response.json()["error"]
        assert error["code"] == "MISSING_SECONDARY_TRIANGLE"
        assert "triangles.secondary" in error["message"]


class TestMunichRun:
    def test_paired_run_reports_the_primary_measure(self, client, auth) -> None:
        secondary = _incurred_document()
        response = client.post(
            "/v1/run/MunichAdjustment",
            json={
                "triangles": {
                    "primary": load_fixture("taylor-ashe", "triangle.json"),
                    "secondary": secondary,
                }
            },
            headers=auth,
        )
        assert response.status_code == 200, response.text
        document = response.json()
        parse_document(document)
        result = document["result"]
        assert result["method"] == "clpy:MunichAdjustment"
        assert result["parameters"]["paid_to_incurred"] == ["paid", "incurred"]
        assert result["parameters"]["secondary_triangle_integrity"] == secondary["integrity"]
        assert result["appliesTo"]["triangleIntegrity"] == (
            load_fixture("taylor-ashe", "triangle.json")["integrity"]
        )
        assert result["appliesTo"]["selectionIntegrity"] is None
        assert len(result["rows"]) == 10
        # The projection develops the book: total ultimate exceeds paid to date.
        assert result["totals"]["ultimate"] > 34_358_090

    def test_same_measure_on_both_slots_is_422(self, client, auth) -> None:
        response = client.post(
            "/v1/run/MunichAdjustment",
            json={
                "triangles": {
                    "primary": load_fixture("taylor-ashe", "triangle.json"),
                    "secondary": load_fixture("taylor-ashe", "triangle.json"),
                }
            },
            headers=auth,
        )
        assert response.status_code == 422
        assert "distinct measures" in response.json()["error"]["message"]

    def test_selection_is_refused(self, client, auth) -> None:
        response = client.post(
            "/v1/run/MunichAdjustment",
            json={
                "triangles": {
                    "primary": load_fixture("taylor-ashe", "triangle.json"),
                    "secondary": _incurred_document(),
                },
                "selection": load_fixture("taylor-ashe", "selection.json"),
            },
            headers=auth,
        )
        assert response.status_code == 422
