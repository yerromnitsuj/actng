"""Bearer auth on the compute surface; health stays open."""

from __future__ import annotations

from .conftest import load_fixture


def _run_body() -> dict:
    return {"triangles": {"primary": load_fixture("taylor-ashe", "triangle.json")}}


class TestAuth:
    def test_run_without_token_is_401(self, client) -> None:
        response = client.post("/v1/run/Chainladder", json=_run_body())
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "UNAUTHORIZED"
        assert response.headers["www-authenticate"] == "Bearer"

    def test_run_with_wrong_token_is_401(self, client) -> None:
        response = client.post(
            "/v1/run/Chainladder",
            json=_run_body(),
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert response.status_code == 401

    def test_engine_without_token_is_401(self, client) -> None:
        assert client.get("/v1/engine").status_code == 401

    def test_malformed_authorization_header_is_401(self, client) -> None:
        response = client.get("/v1/engine", headers={"Authorization": "Basic abc"})
        assert response.status_code == 401


class TestHealth:
    def test_health_is_open_and_ok(self, client) -> None:
        response = client.get("/v1/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


class TestEngine:
    def test_engine_reports_identity_methods_and_profiles(self, client, auth) -> None:
        response = client.get("/v1/engine", headers=auth)
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "chainladder-python"
        assert body["version"] == "0.9.2"
        assert body["profiles"] == [
            "deterministic-cl",
            "mack1993-vw",
            "odp-bootstrap-distribution",
        ]
        names = {entry["name"] for entry in body["methods"]}
        assert names == {
            "Chainladder",
            "MackChainladder",
            "BornhuetterFerguson",
            "Benktander",
            "CapeCod",
            "ClarkLDF",
            "BootstrapODPSample",
            "MunichAdjustment",
        }
        kinds = {entry["name"]: entry["resultKind"] for entry in body["methods"]}
        assert kinds["BootstrapODPSample"] == "stochastic-result"
        assert kinds["MackChainladder"] == "method-result"
