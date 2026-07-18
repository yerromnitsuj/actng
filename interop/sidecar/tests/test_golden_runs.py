"""Golden runs: the sidecar must reproduce the committed clpy-* fixtures.

The committed ``clpy-deterministic-cl.json`` and ``clpy-mack1993-vw.json``
were authored by the conformance suite's Python runner on the SAME
committed taylor-ashe triangle/selection. POSTing those inputs under the
aligned profiles must return result documents that match SEMANTICALLY:
identical structure and provenance, numbers to 1e-9 relative. Only the
envelope's ``createdAt`` (and therefore nothing in the semantic body)
may differ; the response's integrity tag must verify against its own body.
"""

from __future__ import annotations

from actuarial_interchange import parse_document

from .conftest import assert_semantically_equal, load_fixture


def _post_run(client, auth, method: str, body: dict):
    return client.post(f"/v1/run/{method}", json=body, headers=auth)


def _assert_envelope_matches(response_doc: dict, committed: dict) -> None:
    assert response_doc["interchangeVersion"] == committed["interchangeVersion"]
    assert response_doc["kind"] == committed["kind"]
    assert response_doc["generator"] == committed["generator"]
    assert response_doc["extensions"] == committed["extensions"]
    # createdAt differs by design (the sidecar stamps its own clock); the
    # integrity tag must be consistent with the RESPONSE body — parsing
    # re-verifies it with the package's own JCS/FNV.
    parse_document(response_doc)


class TestDeterministicClGolden:
    def test_chainladder_on_committed_selection_reproduces_the_fixture(self, client, auth) -> None:
        committed = load_fixture("taylor-ashe", "clpy-deterministic-cl.json")
        response = _post_run(
            client,
            auth,
            "Chainladder",
            {
                "triangles": {"primary": load_fixture("taylor-ashe", "triangle.json")},
                "selection": load_fixture("taylor-ashe", "selection.json"),
            },
        )
        assert response.status_code == 200, response.text
        document = response.json()
        _assert_envelope_matches(document, committed)
        assert_semantically_equal(document["result"], committed["result"])


class TestMack1993VwGolden:
    def test_mack_with_pinned_sigma_reproduces_the_fixture(self, client, auth) -> None:
        committed = load_fixture("taylor-ashe", "clpy-mack1993-vw.json")
        response = _post_run(
            client,
            auth,
            "MackChainladder",
            {
                "triangles": {"primary": load_fixture("taylor-ashe", "triangle.json")},
                "parameters": {
                    "average": "volume",
                    "n_periods": -1,
                    "sigma_interpolation": "mack",
                },
            },
        )
        assert response.status_code == 200, response.text
        document = response.json()
        _assert_envelope_matches(document, committed)
        assert_semantically_equal(document["result"], committed["result"])

    def test_fully_developed_origin_omits_standard_error(self, client, auth) -> None:
        """The honesty rule: chainladder's NaN SE on a fully developed origin
        is OMITTED, never zeroed — exactly as committed."""
        response = _post_run(
            client,
            auth,
            "MackChainladder",
            {
                "triangles": {"primary": load_fixture("taylor-ashe", "triangle.json")},
                "parameters": {"average": "volume", "n_periods": -1, "sigma_interpolation": "mack"},
            },
        )
        rows = {row["origin"]: row for row in response.json()["result"]["rows"]}
        assert "standardError" not in rows["2001"]
        assert "standardError" in rows["2010"]
