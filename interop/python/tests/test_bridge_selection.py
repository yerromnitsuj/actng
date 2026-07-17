"""Selection bridge: equivalence-table replays, the Mack-SE-less rule,
coherence enforcement, and intent extraction (spec 3.2 / 4.2)."""

from __future__ import annotations

import numpy as np
import pytest
import chainladder as cl

from actuarial_interchange import (
    DevelopmentIntent,
    DevelopmentSelection,
    IncoherentSelectionError,
    InterchangeError,
    InterchangeWarning,
    TailIntent,
    TailSelection,
    parse_document,
    serialize_document,
)
from actuarial_interchange.bridge_selection import (
    extract_selections,
    fit_mack,
    selection_doc_to_estimators,
    verify_coherence,
)
from actuarial_interchange.bridge_triangle import cl_to_triangle_doc
from conftest import CREATED_AT, make_selection_doc, make_selection_payload, make_triangle_doc


@pytest.fixture(scope="module")
def genins() -> "cl.Triangle":
    return cl.load_sample("genins")


@pytest.fixture(scope="module")
def genins_doc(genins) -> object:
    return cl_to_triangle_doc(genins, measure="paid", created_at=CREATED_AT)


def _genins_selection_doc(genins, genins_doc, **intent_overrides):
    """SelectionDoc built FROM chainladder's own volume-weighted fit, so
    its values are coherent with the intent by construction."""
    fitted = cl.Development(average="volume").fit(genins)
    ages = [int(str(label).partition("-")[0]) for label in fitted.ldf_.development]
    to_ages = [int(str(label).partition("-")[2]) for label in fitted.ldf_.development]
    values = fitted.ldf_.values[0, 0, 0, :]
    development = [
        DevelopmentSelection(
            from_age_months=from_age,
            to_age_months=to_age,
            value=float(value),
            intent=DevelopmentIntent(kind="volume-weighted", **intent_overrides),
        )
        for from_age, to_age, value in zip(ages, to_ages, values)
    ]
    return make_selection_doc(genins_doc.integrity(), development=development)


class TestReplay:
    def test_volume_weighted_intent_becomes_native_development(self, genins, genins_doc) -> None:
        doc = _genins_selection_doc(genins, genins_doc)
        development, tail = selection_doc_to_estimators(doc)
        assert isinstance(development, cl.Development)
        assert not isinstance(development, cl.DevelopmentConstant)
        assert development.get_params()["average"] == "volume"
        assert development.get_params()["n_periods"] == -1
        assert tail is None
        # The replay reproduces the doc's values exactly.
        replayed = development.fit(genins).ldf_.values[0, 0, 0, :]
        stored = [d.value for d in doc.payload.development]
        assert np.allclose(replayed, stored, rtol=1e-15)

    def test_windowed_intent_maps_to_n_periods(self, genins, genins_doc) -> None:
        fitted = cl.Development(average="volume", n_periods=5).fit(genins)
        ages = [int(str(l).partition("-")[0]) for l in fitted.ldf_.development]
        to_ages = [int(str(l).partition("-")[2]) for l in fitted.ldf_.development]
        values = fitted.ldf_.values[0, 0, 0, :]
        doc = make_selection_doc(
            genins_doc.integrity(),
            development=[
                DevelopmentSelection(
                    from_age_months=a,
                    to_age_months=t,
                    value=float(v),
                    intent=DevelopmentIntent(kind="volume-weighted", window_origin_periods=5),
                )
                for a, t, v in zip(ages, to_ages, values)
            ],
        )
        development, _ = selection_doc_to_estimators(doc)
        assert development.get_params()["n_periods"] == 5
        assert np.allclose(development.fit(genins).ldf_.values[0, 0, 0, :], values)

    def test_value_only_intent_becomes_development_constant(self, genins_doc) -> None:
        doc = make_selection_doc(
            genins_doc.integrity(),
            development=[
                DevelopmentSelection(
                    from_age_months=12,
                    to_age_months=24,
                    value=3.5,
                    intent=DevelopmentIntent(kind="judgmental", rationale="board-approved pick"),
                ),
                DevelopmentSelection(
                    from_age_months=24,
                    to_age_months=36,
                    value=1.75,
                    intent=DevelopmentIntent(kind="external", rationale="industry benchmark"),
                ),
            ],
        )
        with pytest.warns(InterchangeWarning, match="value-only"):
            development, _ = selection_doc_to_estimators(doc)
        assert isinstance(development, cl.DevelopmentConstant)
        assert development.get_params()["patterns"] == {12: 3.5, 24: 1.75}
        assert development.get_params()["style"] == "ldf"

    def test_geometric_is_demoted_to_value_only_on_this_engine(self, genins_doc) -> None:
        # chainladder 0.9.2's Development(average="geometric") raises
        # KeyError (verified); the bridge must not hand back a broken
        # estimator, and must say what it did.
        doc = make_selection_doc(
            genins_doc.integrity(),
            development=[
                DevelopmentSelection(
                    from_age_months=12,
                    to_age_months=24,
                    value=3.49,
                    intent=DevelopmentIntent(kind="geometric"),
                )
            ],
        )
        with pytest.warns(InterchangeWarning) as record:
            development, _ = selection_doc_to_estimators(doc)
        messages = [str(w.message) for w in record]
        assert any("geometric" in m and "DEMOTED" in m for m in messages)
        assert any("value-only" in m for m in messages)
        assert isinstance(development, cl.DevelopmentConstant)

    def test_judgmental_tail_becomes_tail_constant(self, genins_doc) -> None:
        doc = make_selection_doc(
            genins_doc.integrity(),
            tail=TailSelection(
                value=1.05,
                intent=TailIntent(kind="judgmental", rationale="capped per policy"),
            ),
        )
        _, tail = selection_doc_to_estimators(doc)
        assert isinstance(tail, cl.TailConstant)
        assert tail.get_params()["tail"] == 1.05

    def test_fitted_tail_becomes_tail_curve(self, genins_doc) -> None:
        doc = make_selection_doc(
            genins_doc.integrity(),
            tail=TailSelection(
                value=1.03,
                intent=TailIntent(kind="fitted", family="exponential-decay"),
            ),
        )
        _, tail = selection_doc_to_estimators(doc)
        assert isinstance(tail, cl.TailCurve)
        assert tail.get_params()["curve"] == "exponential"


class TestMackSeLessRule:
    def test_mack_on_native_development_has_standard_errors(self, genins) -> None:
        fitted = fit_mack(genins, cl.Development(average="volume"))
        assert isinstance(fitted, cl.MackChainladder)
        assert float(np.asarray(fitted.total_mack_std_err_).ravel()[0]) > 0

    def test_mack_on_constant_warns_and_answers_se_less(self, genins) -> None:
        patterns = {12: 3.49, 24: 1.75, 36: 1.46, 48: 1.17, 60: 1.10,
                    72: 1.09, 84: 1.05, 96: 1.08, 108: 1.02}
        constant = cl.DevelopmentConstant(patterns=patterns, style="ldf")
        with pytest.warns(InterchangeWarning, match="SE-less"):
            fitted = fit_mack(genins, constant)
        assert isinstance(fitted, cl.Chainladder)
        assert not isinstance(fitted, cl.MackChainladder)

    def test_mack_on_constant_strict_refuses(self, genins) -> None:
        constant = cl.DevelopmentConstant(patterns={12: 2.0}, style="ldf")
        with pytest.raises(InterchangeError, match="standard errors cannot"):
            fit_mack(genins, constant, strict=True)


class TestCoherence:
    def test_coherent_selection_passes(self) -> None:
        triangle_doc = make_triangle_doc()
        doc = make_selection_doc(triangle_doc.integrity())
        assert verify_coherence(doc, triangle_doc) == []

    def test_incoherent_value_warns_and_reports(self) -> None:
        triangle_doc = make_triangle_doc()
        payload = make_selection_payload(triangle_doc.integrity())
        payload.development[0].value = 1.999  # edited value, stale intent
        with pytest.warns(InterchangeWarning, match="incoherent"):
            divergences = verify_coherence(payload, triangle_doc)
        assert len(divergences) == 1
        assert "12-24" in divergences[0]

    def test_incoherent_value_strict_raises(self) -> None:
        triangle_doc = make_triangle_doc()
        payload = make_selection_payload(triangle_doc.integrity())
        payload.development[0].value = 1.999
        with pytest.raises(IncoherentSelectionError):
            verify_coherence(payload, triangle_doc, strict=True)

    def test_value_only_intents_are_not_refereed(self) -> None:
        # Judgmental values ARE the judgment (spec 3.2) — no recomputation
        # exists to referee them against.
        triangle_doc = make_triangle_doc()
        payload = make_selection_payload(triangle_doc.integrity())
        payload.development[0] = DevelopmentSelection(
            from_age_months=12,
            to_age_months=24,
            value=9.9,
            intent=DevelopmentIntent(kind="judgmental", rationale="stress pick"),
        )
        assert verify_coherence(payload, triangle_doc) == []

    def test_genins_coherence_via_chainladder(self, genins, genins_doc) -> None:
        doc = _genins_selection_doc(genins, genins_doc)
        assert verify_coherence(doc, genins) == []


class TestExtraction:
    def test_extract_from_development_carries_intent_and_values(self, genins, genins_doc) -> None:
        fitted = cl.Development(average="volume", n_periods=5).fit(genins)
        doc = extract_selections(
            fitted,
            measure="paid",
            triangle_integrity=genins_doc.integrity(),
            created_at=CREATED_AT,
        )
        payload = doc.payload
        assert payload.applies_to.measure == "paid"
        assert payload.applies_to.triangle_integrity == genins_doc.integrity()
        assert [d.intent.kind for d in payload.development] == ["volume-weighted"] * 9
        assert [d.intent.window_origin_periods for d in payload.development] == [5] * 9
        assert payload.development[0].from_age_months == 12
        assert payload.development[0].to_age_months == 24
        assert np.allclose(
            [d.value for d in payload.development], fitted.ldf_.values[0, 0, 0, :]
        )
        # The extracted doc round-trips and replays coherently.
        parsed = parse_document(serialize_document(doc))
        assert verify_coherence(parsed, genins) == []

    def test_extract_from_constant_requires_rationale(self) -> None:
        # DevelopmentConstant needs a pattern for EVERY development column,
        # so fit on the small conftest triangle (columns 12-24 and 24-36).
        from actuarial_interchange.bridge_triangle import triangle_doc_to_cl

        small_doc = make_triangle_doc()
        small = triangle_doc_to_cl(small_doc)
        fitted = cl.DevelopmentConstant(patterns={12: 2.0, 24: 1.5}, style="ldf").fit(small)
        with pytest.raises(InterchangeError, match="rationale"):
            extract_selections(
                fitted,
                measure="paid",
                triangle_integrity=small_doc.integrity(),
                created_at=CREATED_AT,
            )
        doc = extract_selections(
            fitted,
            measure="paid",
            triangle_integrity=small_doc.integrity(),
            created_at=CREATED_AT,
            rationale="injected from prior-year study",
        )
        assert [d.intent.kind for d in doc.payload.development] == ["external", "external"]
        assert [d.value for d in doc.payload.development] == [2.0, 1.5]

    def test_extract_fitted_tail_curve(self, genins, genins_doc) -> None:
        development = cl.Development(average="volume").fit_transform(genins)
        tail = cl.TailCurve(curve="exponential").fit(development)
        doc = extract_selections(
            cl.Development(average="volume").fit(genins),
            tail,
            measure="paid",
            triangle_integrity=genins_doc.integrity(),
            created_at=CREATED_AT,
        )
        assert doc.payload.tail is not None
        assert doc.payload.tail.intent.kind == "fitted"
        assert doc.payload.tail.intent.family == "exponential-decay"
        assert doc.payload.tail.value == pytest.approx(
            float(np.asarray(tail.tail_).ravel()[0])
        )
        assert set(doc.payload.tail.intent.params) == {"intercept", "slope"}


class TestCoherenceOnImport:
    """Finding 4: selection_doc_to_estimators enforces the coherence rule
    when the referenced triangle is supplied, and says so when it cannot."""

    def test_without_triangle_warns_coherence_not_verified(self) -> None:
        triangle_doc = make_triangle_doc()
        doc = make_selection_doc(triangle_doc.integrity())
        with pytest.warns(InterchangeWarning, match="coherence NOT verified"):
            selection_doc_to_estimators(doc)

    def test_with_triangle_verifies_silently_when_coherent(self) -> None:
        triangle_doc = make_triangle_doc()
        doc = make_selection_doc(triangle_doc.integrity())
        import warnings as _w

        with _w.catch_warnings():
            _w.simplefilter("error", InterchangeWarning)
            development, tail = selection_doc_to_estimators(doc, triangle=triangle_doc)
        assert isinstance(development, cl.Development)
        assert tail is None

    def test_with_triangle_warns_on_incoherence(self) -> None:
        triangle_doc = make_triangle_doc()
        payload = make_selection_payload(triangle_doc.integrity())
        payload.development[0].value = 1.999  # edited value, stale intent
        with pytest.warns(InterchangeWarning, match="incoherent"):
            selection_doc_to_estimators(payload, triangle=triangle_doc)

    def test_with_triangle_strict_raises_on_incoherence(self) -> None:
        triangle_doc = make_triangle_doc()
        payload = make_selection_payload(triangle_doc.integrity())
        payload.development[0].value = 1.999
        with pytest.raises(IncoherentSelectionError):
            selection_doc_to_estimators(payload, triangle=triangle_doc, strict=True)


class TestStrictRefusesDemotedReplays:
    """Finding 22: strict=True means demoted/approximate replays RAISE
    instead of warn — never a silently degraded estimator."""

    def test_strict_refuses_geometric_demotion(self, genins_doc) -> None:
        doc = make_selection_doc(
            genins_doc.integrity(),
            development=[
                DevelopmentSelection(
                    from_age_months=12,
                    to_age_months=24,
                    value=3.49,
                    intent=DevelopmentIntent(kind="geometric"),
                )
            ],
        )
        with pytest.raises(InterchangeError, match="DEMOTED"):
            selection_doc_to_estimators(doc, strict=True)

    def test_strict_refuses_approximate_medial(self, genins_doc) -> None:
        doc = make_selection_doc(
            genins_doc.integrity(),
            development=[
                DevelopmentSelection(
                    from_age_months=12,
                    to_age_months=24,
                    value=3.2,
                    intent=DevelopmentIntent(
                        kind="medial",
                        window_origin_periods=5,
                        exclude_high=1,
                        exclude_low=1,
                    ),
                )
            ],
        )
        with pytest.raises(InterchangeError, match="APPROXIMATELY"):
            selection_doc_to_estimators(doc, strict=True)

    def test_strict_refuses_computable_intents_flattened_in_a_mixed_selection(
        self, genins_doc
    ) -> None:
        doc = make_selection_doc(
            genins_doc.integrity(),
            development=[
                DevelopmentSelection(
                    from_age_months=12,
                    to_age_months=24,
                    value=3.49,
                    intent=DevelopmentIntent(kind="volume-weighted"),
                ),
                DevelopmentSelection(
                    from_age_months=24,
                    to_age_months=36,
                    value=1.75,
                    intent=DevelopmentIntent(kind="judgmental", rationale="board pick"),
                ),
            ],
        )
        with pytest.raises(InterchangeError, match="DEMOTED"):
            selection_doc_to_estimators(doc, strict=True)

    def test_strict_allows_pure_value_only_selections(self, genins_doc) -> None:
        # judgmental/external -> DevelopmentConstant IS the exact spec
        # replay, not a compromise: strict must not refuse it.
        doc = make_selection_doc(
            genins_doc.integrity(),
            development=[
                DevelopmentSelection(
                    from_age_months=12,
                    to_age_months=24,
                    value=3.5,
                    intent=DevelopmentIntent(kind="external", rationale="benchmark"),
                )
            ],
        )
        with pytest.warns(InterchangeWarning, match="value-only"):
            development, _ = selection_doc_to_estimators(doc, strict=True)
        assert isinstance(development, cl.DevelopmentConstant)
