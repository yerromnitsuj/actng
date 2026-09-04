"""Independent explicit tail continuation of native no-tail Mack uncertainty.

chainladder-python TailConstant does not accept stochastic tail inputs. This
test does not pretend otherwise: its native no-tail origin/portfolio variances
are propagated through the paper's terminal process and shared parameter step.
"""
import json
from pathlib import Path
import chainladder as cl
import numpy as np
from actuarial_interchange import parse_document
from actuarial_interchange.bridge_triangle import triangle_doc_to_cl


def test_mack_1999_tail_matches_frozen_three_shore_and_published_values():
    directory = Path(__file__).resolve().parents[1] / "fixtures" / "mortgage"
    fixture = json.loads((directory / "mack-1999-tail.json").read_text())
    raw = json.loads((directory / fixture["triangle"]).read_text())
    assert raw["integrity"] == fixture["triangleIntegrity"]
    triangle = triangle_doc_to_cl(parse_document(raw))
    model = cl.MackChainladder().fit(cl.Development(average="volume", sigma_interpolation="mack").fit_transform(triangle))
    ultimate = np.asarray(model.ultimate_.values).ravel()
    base_se = np.nan_to_num(np.asarray(model.mack_std_err_.values[..., -1]).ravel())
    total_se = float(model.total_mack_std_err_.values.ravel()[0])
    options = fixture["options"]
    tail, tail_se, tail_sigma = options["tailFactor"], options["tailStandardError"], options["tailSigma"]
    with_tail = ultimate * tail
    standard_error = np.sqrt(tail**2 * base_se**2 + tail_sigma**2 * ultimate + tail_se**2 * ultimate**2)
    # Tail parameter risk is shared between origins: square the total, not a
    # sum of squared individual ultimates. Tail process risks are independent.
    total_standard_error = np.sqrt(tail**2 * total_se**2 + tail_sigma**2 * ultimate.sum() + tail_se**2 * ultimate.sum()**2)
    tolerance = fixture["tolerances"]
    np.testing.assert_allclose(with_tail, fixture["engine"]["ultimate"], rtol=0, atol=tolerance["engineAbsolute"])
    np.testing.assert_allclose(standard_error, fixture["engine"]["standardError"], rtol=0, atol=tolerance["engineAbsolute"])
    assert abs(with_tail.sum() - fixture["engine"]["totalUltimate"]) <= tolerance["engineAbsolute"]
    assert abs(total_standard_error - fixture["engine"]["totalStandardError"]) <= tolerance["engineAbsolute"]
    np.testing.assert_allclose(with_tail / 1000, fixture["publishedThousands"]["ultimate"], rtol=0, atol=tolerance["publishedUltimateThousands"])
    np.testing.assert_allclose(standard_error / 1000, fixture["publishedThousands"]["standardError"], rtol=0, atol=tolerance["publishedStandardErrorThousands"])
    assert abs(with_tail.sum() / 1000 - fixture["publishedThousands"]["totalUltimate"]) <= tolerance["publishedTotalUltimateThousands"]
    assert abs(total_standard_error / 1000 - fixture["publishedThousands"]["totalStandardError"]) <= tolerance["publishedStandardErrorThousands"]
