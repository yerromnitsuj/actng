"""The Mack-SE-less rule (spec 3.2): a Mack request atop a value-only
selection is answered SE-less with an explicit warning (default), or
refused with 422 under parameters.strictness = "strict". Never silent."""

from __future__ import annotations

from actuarial_interchange import (
    DevelopmentIntent,
    DevelopmentSelection,
    Document,
    SelectionAppliesTo,
    SelectionPayload,
    parse_document,
)

from .conftest import load_fixture


def _judgmental_selection() -> dict:
    """The committed taylor-ashe factor values re-authored as judgmental
    (value-only) intents — the values ARE the judgment."""
    committed = parse_document(load_fixture("taylor-ashe", "selection.json")).payload
    payload = SelectionPayload(
        applies_to=SelectionAppliesTo(
            measure=committed.applies_to.measure,
            triangle_integrity=committed.applies_to.triangle_integrity,
        ),
        development=[
            DevelopmentSelection(
                from_age_months=item.from_age_months,
                to_age_months=item.to_age_months,
                value=item.value,
                intent=DevelopmentIntent(
                    kind="judgmental", rationale="committee-selected factors (test)"
                ),
            )
            for item in committed.development
        ],
    )
    return Document(
        kind="selection", payload=payload, created_at="2026-07-18T00:00:00Z"
    ).to_dict()


def _body(**parameters) -> dict:
    return {
        "triangles": {"primary": load_fixture("taylor-ashe", "triangle.json")},
        "selection": _judgmental_selection(),
        "parameters": parameters,
    }


class TestSeLessWarnMode:
    def test_default_answers_se_less_with_explicit_warnings(self, client, auth) -> None:
        response = client.post("/v1/run/MackChainladder", json=_body(), headers=auth)
        assert response.status_code == 200, response.text
        document = response.json()
        parse_document(document)
        result = document["result"]
        # What actually ran is a plain Chainladder fit — the method label
        # says so; pretending an SE-less answer is Mack would be a lie.
        assert result["method"] == "clpy:Chainladder"
        warnings_text = " ".join(result["warnings"])
        assert "value-only" in warnings_text
        assert "standard errors cannot be computed" in warnings_text
        for row in result["rows"]:
            assert "standardError" not in row
        assert "standardError" not in result["totals"]
        # The value-only replay is echoed honestly.
        assert result["parameters"]["style"] == "ldf"
        assert "patterns" in result["parameters"]

    def test_se_less_answer_matches_the_deterministic_projection(self, client, auth) -> None:
        """The judgmental factors equal the committed volume-weighted values,
        so the SE-less point estimates must equal the golden chain ladder."""
        committed = load_fixture("taylor-ashe", "clpy-deterministic-cl.json")
        response = client.post("/v1/run/MackChainladder", json=_body(), headers=auth)
        totals = response.json()["result"]["totals"]
        assert abs(totals["ultimate"] - committed["result"]["totals"]["ultimate"]) < 1.0


class TestSeLessStrictMode:
    def test_strict_refuses_with_422(self, client, auth) -> None:
        response = client.post(
            "/v1/run/MackChainladder", json=_body(strictness="strict"), headers=auth
        )
        assert response.status_code == 422
        error = response.json()["error"]
        assert error["code"] == "SE_LESS_REFUSED"
        assert "standard errors" in error["message"]

    def test_strict_chainladder_on_value_only_still_runs(self, client, auth) -> None:
        """Strictness refuses the SE-less MACK answer; a plain Chainladder on
        a value-only selection is the exact spec replay, not a compromise."""
        response = client.post(
            "/v1/run/Chainladder", json=_body(strictness="strict"), headers=auth
        )
        assert response.status_code == 200, response.text

    def test_invalid_strictness_value_is_422(self, client, auth) -> None:
        response = client.post(
            "/v1/run/MackChainladder", json=_body(strictness="pedantic"), headers=auth
        )
        assert response.status_code == 422
