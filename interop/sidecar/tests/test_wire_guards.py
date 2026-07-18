"""Wire-contract guards: tenant-key rejection, engagementRef passthrough,
size limits, strict shape enforcement."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sidecar.app import create_app
from sidecar.config import SidecarConfig

from .conftest import TOKEN, load_fixture


def _run_body(**extra) -> dict:
    body = {"triangles": {"primary": load_fixture("taylor-ashe", "triangle.json")}}
    body.update(extra)
    return body


class TestTenantKeyRejection:
    """No tenant identifiers ANYWHERE in the wire (spec 7/12) — the
    agents-package tenant-lint spirit, enforced on request data."""

    @pytest.mark.parametrize("key", ["projectId", "tenantId", "project_id", "TenantID"])
    def test_tenant_key_in_parameters_is_422(self, client, auth, key) -> None:
        response = client.post(
            "/v1/run/Chainladder",
            json=_run_body(parameters={key: "acme-123"}),
            headers=auth,
        )
        assert response.status_code == 422
        error = response.json()["error"]
        assert error["code"] == "TENANT_KEY_REJECTED"
        assert key in error["message"]

    def test_tenant_key_nested_deep_is_422(self, client, auth) -> None:
        body = _run_body(parameters={"strictness": "warn"})
        body["triangles"]["primary"]["extensions"] = {"nested": {"tenant_id": "acme"}}
        response = client.post("/v1/run/Chainladder", json=body, headers=auth)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "TENANT_KEY_REJECTED"


class TestEngagementRefPassthrough:
    def test_engagement_ref_lands_in_result_extensions(self, client, auth) -> None:
        response = client.post(
            "/v1/run/Chainladder",
            json=_run_body(engagementRef="ENG-2026-071"),
            headers=auth,
        )
        assert response.status_code == 200, response.text
        assert response.json()["extensions"] == {"engagementRef": "ENG-2026-071"}

    def test_without_engagement_ref_extensions_stay_empty(self, client, auth) -> None:
        response = client.post("/v1/run/Chainladder", json=_run_body(), headers=auth)
        assert response.status_code == 200
        assert response.json()["extensions"] == {}

    def test_non_string_engagement_ref_is_422(self, client, auth) -> None:
        response = client.post(
            "/v1/run/Chainladder",
            json=_run_body(engagementRef={"id": 1}),
            headers=auth,
        )
        assert response.status_code == 422


class TestSizeLimit:
    def test_oversized_request_is_413(self, auth) -> None:
        small_limit_client = TestClient(
            create_app(SidecarConfig(token=TOKEN, max_request_bytes=500))
        )
        response = small_limit_client.post(
            "/v1/run/Chainladder", json=_run_body(), headers=auth
        )
        assert response.status_code == 413
        assert response.json()["error"]["code"] == "REQUEST_TOO_LARGE"

    def test_default_limit_admits_the_fixture(self, client, auth) -> None:
        response = client.post("/v1/run/Chainladder", json=_run_body(), headers=auth)
        assert response.status_code == 200


class TestStrictWireShape:
    def test_unknown_method_is_404_with_supported_list(self, client, auth) -> None:
        response = client.post("/v1/run/NotAMethod", json=_run_body(), headers=auth)
        assert response.status_code == 404
        error = response.json()["error"]
        assert error["code"] == "UNKNOWN_METHOD"
        assert "Chainladder" in error["message"]

    def test_unknown_top_level_key_is_422(self, client, auth) -> None:
        response = client.post(
            "/v1/run/Chainladder", json=_run_body(basis="accident-year"), headers=auth
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "UNKNOWN_FIELD"

    def test_unknown_parameter_is_422(self, client, auth) -> None:
        response = client.post(
            "/v1/run/Chainladder",
            json=_run_body(parameters={"sigma_interpolation": "mack"}),
            headers=auth,
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "UNKNOWN_PARAMETER"

    def test_missing_primary_triangle_is_422(self, client, auth) -> None:
        response = client.post(
            "/v1/run/Chainladder", json={"triangles": {}}, headers=auth
        )
        assert response.status_code == 422
        assert "triangles.primary" in response.json()["error"]["message"]

    def test_secondary_on_a_univariate_method_is_422(self, client, auth) -> None:
        body = _run_body()
        body["triangles"]["secondary"] = load_fixture("taylor-ashe", "triangle.json")
        response = client.post("/v1/run/Chainladder", json=body, headers=auth)
        assert response.status_code == 422
        assert "secondary" in response.json()["error"]["message"]

    def test_seed_on_a_deterministic_method_is_422(self, client, auth) -> None:
        response = client.post("/v1/run/Chainladder", json=_run_body(seed=42), headers=auth)
        assert response.status_code == 422
        assert "seed" in response.json()["error"]["message"]

    def test_tampered_document_integrity_is_422(self, client, auth) -> None:
        body = _run_body()
        body["triangles"]["primary"]["triangle"]["values"][0][0] = 999999.0
        response = client.post("/v1/run/Chainladder", json=body, headers=auth)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "INVALID_DOCUMENT"
