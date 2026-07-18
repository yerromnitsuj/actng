"""Exposure-based methods (BF / Benktander / CapeCod) and ClarkLDF."""

from __future__ import annotations

import pytest
from actuarial_interchange import parse_document

from .conftest import load_fixture

EXPOSURE = {
    "origins": [str(year) for year in range(2001, 2011)],
    "values": [10_000_000.0] * 10,
    "kind": "earnedPremium",
}


def _body(**extra) -> dict:
    body = {"triangles": {"primary": load_fixture("taylor-ashe", "triangle.json")}}
    body.update(extra)
    return body


class TestExposureRequirement:
    @pytest.mark.parametrize("method", ["BornhuetterFerguson", "Benktander", "CapeCod"])
    def test_missing_exposure_is_422_naming_the_slot(self, client, auth, method) -> None:
        response = client.post(f"/v1/run/{method}", json=_body(), headers=auth)
        assert response.status_code == 422
        error = response.json()["error"]
        assert error["code"] == "MISSING_EXPOSURE"
        assert "exposure" in error["message"]

    def test_exposure_origin_mismatch_is_422(self, client, auth) -> None:
        exposure = dict(EXPOSURE, origins=[str(year) for year in range(1995, 2005)])
        response = client.post(
            "/v1/run/BornhuetterFerguson",
            json=_body(exposure=exposure),
            headers=auth,
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "INVALID_EXPOSURE"

    def test_exposure_on_chainladder_is_422(self, client, auth) -> None:
        response = client.post(
            "/v1/run/Chainladder", json=_body(exposure=EXPOSURE), headers=auth
        )
        assert response.status_code == 422


class TestBornhuetterFerguson:
    def test_runs_with_typed_exposure(self, client, auth) -> None:
        response = client.post(
            "/v1/run/BornhuetterFerguson",
            json=_body(exposure=EXPOSURE, parameters={"apriori": 0.65}),
            headers=auth,
        )
        assert response.status_code == 200, response.text
        document = response.json()
        parse_document(document)
        result = document["result"]
        assert result["method"] == "clpy:BornhuetterFerguson"
        assert result["parameters"]["apriori"] == 0.65
        assert result["parameters"]["exposure_kind"] == "earnedPremium"
        assert result["engine"].get("conventionProfile") is None
        assert len(result["rows"]) == 10
        assert result["totals"]["ultimate"] > 0

    def test_selection_replay_is_consumed(self, client, auth) -> None:
        response = client.post(
            "/v1/run/BornhuetterFerguson",
            json=_body(
                exposure=EXPOSURE,
                selection=load_fixture("taylor-ashe", "selection.json"),
            ),
            headers=auth,
        )
        assert response.status_code == 200, response.text
        result = response.json()["result"]
        selection_tag = load_fixture("taylor-ashe", "selection.json")["integrity"]
        assert result["appliesTo"]["selectionIntegrity"] == selection_tag


class TestBenktanderAndCapeCod:
    def test_benktander_n_iters_one_equals_bf(self, client, auth) -> None:
        bf = client.post(
            "/v1/run/BornhuetterFerguson",
            json=_body(exposure=EXPOSURE, parameters={"apriori": 0.65}),
            headers=auth,
        ).json()["result"]["totals"]
        bk = client.post(
            "/v1/run/Benktander",
            json=_body(exposure=EXPOSURE, parameters={"apriori": 0.65, "n_iters": 1}),
            headers=auth,
        ).json()["result"]["totals"]
        assert abs(bf["ultimate"] - bk["ultimate"]) < 1e-6 * bf["ultimate"]

    def test_cape_cod_runs_and_echoes_knobs(self, client, auth) -> None:
        response = client.post(
            "/v1/run/CapeCod",
            json=_body(exposure=EXPOSURE, parameters={"trend": 0.02, "decay": 0.9}),
            headers=auth,
        )
        assert response.status_code == 200, response.text
        result = response.json()["result"]
        assert result["method"] == "clpy:CapeCod"
        assert result["parameters"]["trend"] == 0.02
        assert result["parameters"]["decay"] == 0.9


class TestClarkLdf:
    def test_runs_and_is_labeled_clark(self, client, auth) -> None:
        response = client.post(
            "/v1/run/ClarkLDF", json=_body(parameters={"growth": "weibull"}), headers=auth
        )
        assert response.status_code == 200, response.text
        document = response.json()
        parse_document(document)
        result = document["result"]
        assert result["method"] == "clpy:ClarkLDF"
        assert result["parameters"] == {"growth": "weibull"}
        assert result["totals"]["ultimate"] > 0

    def test_selection_is_refused(self, client, auth) -> None:
        response = client.post(
            "/v1/run/ClarkLDF",
            json=_body(selection=load_fixture("taylor-ashe", "selection.json")),
            headers=auth,
        )
        assert response.status_code == 422

    def test_unknown_growth_family_is_422(self, client, auth) -> None:
        response = client.post(
            "/v1/run/ClarkLDF", json=_body(parameters={"growth": "gompertz"}), headers=auth
        )
        assert response.status_code == 422
