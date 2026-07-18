"""BootstrapODPSample: seed required, WITNESSED reproducibility, distribution shape."""

from __future__ import annotations

from actuarial_interchange import parse_document

from .conftest import load_fixture, relative_deviation


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

    def test_identical_seeded_calls_agree_within_tolerance_and_are_witnessed(
        self, client, auth
    ) -> None:
        """A seed does NOT make this engine byte-reproducible.

        chainladder 0.9.2's BootstrapODPSample returns different samples for
        IDENTICAL seeded calls in a single process — measured, roughly 1-in-4
        of the time, and not fixed by pinning BLAS/OpenMP threads or by forcing
        the dense array backend (see docs/interop/reproducibility.md).

        This test previously asserted byte-identity, which is a contract the
        engine does not honour; it flaked accordingly. The honest contract is
        the one asserted here: the two runs agree DISTRIBUTIONALLY within the
        profile tolerance, and the document says out loud that it is a witness
        rather than a reproducible derivation.
        """
        first = client.post("/v1/run/BootstrapODPSample", json=_body(), headers=auth)
        second = client.post("/v1/run/BootstrapODPSample", json=_body(), headers=auth)
        assert first.status_code == second.status_code == 200
        one, two = first.json()["result"], second.json()["result"]

        # Same seed, same request: the DISTRIBUTIONS must agree closely even
        # though the bytes may not. 1% on the mean is far tighter than the
        # Monte Carlo error at n_sims=250 and still catches a real regression
        # (a wrong seed or a dropped selection replay moves it far more).
        assert relative_deviation(one["summary"]["mean"], two["summary"]["mean"]) < 0.01
        assert relative_deviation(one["summary"]["sd"], two["summary"]["sd"]) < 0.05
        assert [e["origin"] for e in one["byOrigin"]] == [e["origin"] for e in two["byOrigin"]]

        # And the promise is stated on the document, not assumed by the reader.
        assert one["reproducibility"] == "witnessed"
        assert two["reproducibility"] == "witnessed"

    def test_witnessed_result_discloses_its_measured_stability(self, client, auth) -> None:
        """The engine self-checks and reports the answer on the document.

        This is the point of the witness model: instability is MEASURED and
        DISCLOSED at run time, instead of lying dormant until something
        downstream fails to reproduce a number.
        """
        response = client.post("/v1/run/BootstrapODPSample", json=_body(), headers=auth)
        assert response.status_code == 200, response.text
        stability = response.json()["result"]["stability"]
        assert stability["repeats"] >= 2
        assert isinstance(stability["byteIdentical"], bool)
        # Whatever the engine did, the deviation is quantified — and if the
        # repeats WERE byte-identical, the deviation must be exactly zero.
        assert stability["maxRelativeDeviation"] >= 0.0
        if stability["byteIdentical"]:
            assert stability["maxRelativeDeviation"] == 0.0

    def test_stability_check_can_be_skipped(self, client, auth) -> None:
        """Opting out costs the evidence, never the honesty of the class."""
        body = _body(parameters={"n_sims": 250, "stability_repeats": 1})
        response = client.post("/v1/run/BootstrapODPSample", json=body, headers=auth)
        assert response.status_code == 200, response.text
        result = response.json()["result"]
        assert "stability" not in result
        assert result["reproducibility"] == "witnessed"

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
