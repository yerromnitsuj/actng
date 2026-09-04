import json
from pathlib import Path

import pytest

from actuarial_interchange import parse_diagnostic_definition, replay_diagnostic_cell
from actuarial_interchange.errors import BadInterchangeError


FIXTURE = Path(__file__).parents[2] / "conformance" / "fixtures" / "diagnostics" / "generalized-casualty"


@pytest.mark.parametrize("prefix", ["calendar", "ordered-axis"])
def test_generalized_casualty_definition_identities_and_all_formula_replays(prefix):
    document, definition = parse_diagnostic_definition((FIXTURE / f"{prefix}-definition.json").read_text())
    cells = json.loads((FIXTURE / f"{prefix}-aggregate-cells.json").read_text())
    expected = json.loads((FIXTURE / f"{prefix}-expected-output.json").read_text())
    values = dict(cells["losses"][0]["measures"])
    values.update({item["measureId"]: item["value"] for item in cells["exposures"]})
    assert document.interchange_version == "1.1.0"
    assert len(definition["formulas"]) == 6
    assert len(definition["instances"]) == 22
    metrics = expected["result"]["emergence"][0]["metrics"]
    for instance_id, metric in metrics.items():
        actual = replay_diagnostic_cell(definition, instance_id, values)
        assert actual["numerator"] == metric["calculation"]["numerator"]["value"]
        assert actual["denominator"] == metric["calculation"]["denominator"]["value"]
        assert actual["value"] == pytest.approx(metric["calculation"]["value"])


def test_diagnostic_definition_rejects_identity_tampering():
    candidate = json.loads((FIXTURE / "calendar-definition.json").read_text())
    candidate["diagnosticDefinition"]["identities"]["definition"] = "fnv1a64-jcs-v1:0000000000000000"
    # Restamp the outer envelope so this reaches semantic identity validation.
    from actuarial_interchange.documents import parse_document
    candidate = parse_document(candidate, verify_integrity=False).to_dict()
    with pytest.raises(BadInterchangeError, match="identities do not match"):
        parse_diagnostic_definition(candidate)


def test_diagnostic_definition_rejects_restamped_unknown_behavior():
    candidate = json.loads((FIXTURE / "calendar-definition.json").read_text())
    candidate["diagnosticDefinition"]["definition"]["measures"][0]["futureBehavior"] = True
    from actuarial_interchange.diagnostics import diagnostic_identities
    from actuarial_interchange.documents import parse_document
    candidate["diagnosticDefinition"]["identities"] = diagnostic_identities(
        candidate["diagnosticDefinition"]["definition"]
    )
    candidate = parse_document(candidate, verify_integrity=False).to_dict()
    with pytest.raises(BadInterchangeError, match="unsupported diagnostic behavior"):
        parse_diagnostic_definition(candidate)

    nested = json.loads((FIXTURE / "calendar-definition.json").read_text())
    nested["diagnosticDefinition"]["definition"]["reviewRules"][0]["actual"]["futureBehavior"] = True
    nested["diagnosticDefinition"]["identities"] = diagnostic_identities(
        nested["diagnosticDefinition"]["definition"]
    )
    nested = parse_document(nested, verify_integrity=False).to_dict()
    with pytest.raises(BadInterchangeError, match="unsupported diagnostic behavior"):
        parse_diagnostic_definition(nested)


def test_utf16_identifier_order_matches_ecmascript_code_units():
    # U+10000 begins with surrogate D800, so JavaScript sorts it before U+E000;
    # Python's default code-point order does the opposite.
    from actuarial_interchange.diagnostics import _sort_utf16
    assert _sort_utf16(["\ue000", "\U00010000"]) == ["\U00010000", "\ue000"]
