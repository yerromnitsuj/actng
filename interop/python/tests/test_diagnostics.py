import json
from pathlib import Path

import pytest

from actuarial_interchange import parse_diagnostic_definition, replay_diagnostic_cell
from actuarial_interchange.errors import BadInterchangeError


FIXTURE = Path(__file__).parents[2] / "conformance" / "fixtures" / "diagnostics" / "generalized-casualty"


def test_generalized_casualty_definition_identities_and_all_formula_replays():
    document, definition = parse_diagnostic_definition((FIXTURE / "definition.json").read_text())
    cell = json.loads((FIXTURE / "cell.json").read_text())
    assert document.interchange_version == "1.1.0"
    assert len(definition["formulas"]) == 6
    assert len(definition["instances"]) == 22
    for expected in cell["expected"]:
        assert replay_diagnostic_cell(definition, expected["instanceId"], cell["values"]) == {
            "numerator": expected["numerator"],
            "denominator": expected["denominator"],
            "value": pytest.approx(expected["value"]) if expected["value"] is not None else None,
        }


def test_diagnostic_definition_rejects_identity_tampering():
    candidate = json.loads((FIXTURE / "definition.json").read_text())
    candidate["diagnosticDefinition"]["identities"]["definition"] = "fnv1a64-jcs-v1:0000000000000000"
    # Restamp the outer envelope so this reaches semantic identity validation.
    from actuarial_interchange.documents import parse_document
    candidate = parse_document(candidate, verify_integrity=False).to_dict()
    with pytest.raises(BadInterchangeError, match="identities do not match"):
        parse_diagnostic_definition(candidate)


def test_utf16_identifier_order_matches_ecmascript_code_units():
    # U+10000 begins with surrogate D800, so JavaScript sorts it before U+E000;
    # Python's default code-point order does the opposite.
    from actuarial_interchange.diagnostics import _sort_utf16
    assert _sort_utf16(["\ue000", "\U00010000"]) == ["\U00010000", "\ue000"]
