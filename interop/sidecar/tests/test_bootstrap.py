"""BootstrapODPSample: seed required, seeded determinism, distribution shape."""

from __future__ import annotations

from actuarial_interchange import parse_document

from .conftest import load_fixture


def _body(**extra) -> dict:
    body = {
        "triangles": {"primary": load_fixture("taylor-ashe", "triangle.json")},
        "seed": 42,
        "parameters": {"n_sims": 250},
    }
    body.update(extra)
    return body


class TestBootstrapOdp:
    def test_missing_seed_is_422(self, client, auth) -> None:
        body = _body()
        del body["seed"]
        response = client.post("/v1/run/BootstrapODPSample", json=body, headers=auth)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "MISSING_SEED"

    def test_returns_a_stochastic_result_doc(self, client, auth) -> None:
        response = client.post("/v1/run/BootstrapODPSample", json=_body(), headers=auth)
        assert response.status_code == 200, response.text
        document = response.json()
        assert document["kind"] == "stochastic-result"
        parse_document(document)  # integrity verifies against the body
        result = document["result"]
        assert result["method"] == "clpy:BootstrapODPSample"
        assert result["engine"]["conventionProfile"] == "odp-bootstrap-distribution"
        assert result["seed"] == 42
        assert result["nSims"] == 250
        assert result["parameters"]["n_sims"] == 250
        assert set(result["summary"]) == {"mean", "sd", "cv", "percentiles"}
        assert set(result["summary"]["percentiles"]) == {"5", "25", "50", "75", "90", "95", "99"}
        origins = [entry["origin"] for entry in result["byOrigin"]]
        assert origins == [str(year) for year in range(2001, 2011)]
        for entry in result["byOrigin"]:
            assert set(entry) == {"origin", "mean", "sd", "cv", "percentiles"}
        # A reserve distribution on this triangle is materially positive.
        assert result["summary"]["mean"] > 0

    def test_identical_seeded_calls_are_byte_identical(self, client, auth) -> None:
        first = client.post("/v1/run/BootstrapODPSample", json=_body(), headers=auth)
        second = client.post("/v1/run/BootstrapODPSample", json=_body(), headers=auth)
        assert first.status_code == second.status_code == 200
        # The semantic body must be EXACTLY equal — same seed, same sample.
        assert first.json()["result"] == second.json()["result"]
        assert first.json()["integrity"] == second.json()["integrity"]

    def test_different_seeds_differ(self, client, auth) -> None:
        first = client.post("/v1/run/BootstrapODPSample", json=_body(), headers=auth)
        second = client.post("/v1/run/BootstrapODPSample", json=_body(seed=43), headers=auth)
        assert first.json()["result"]["summary"] != second.json()["result"]["summary"]

    def test_selection_replay_feeds_the_bootstrap(self, client, auth) -> None:
        body = _body(selection=load_fixture("taylor-ashe", "selection.json"))
        response = client.post("/v1/run/BootstrapODPSample", json=body, headers=auth)
        assert response.status_code == 200, response.text
        result = response.json()["result"]
        selection_tag = load_fixture("taylor-ashe", "selection.json")["integrity"]
        assert result["appliesTo"]["selectionIntegrity"] == selection_tag
        assert result["parameters"]["average"] == "volume"

    def test_oversized_n_sims_is_422(self, client, auth) -> None:
        response = client.post(
            "/v1/run/BootstrapODPSample",
            json=_body(parameters={"n_sims": 1_000_000}),
            headers=auth,
        )
        assert response.status_code == 422
