import json
from copy import deepcopy
from pathlib import Path

import pytest

from actuarial_interchange import parse_diagnostic_definition, replay_diagnostic_cell
from actuarial_interchange.errors import BadInterchangeError
from actuarial_interchange.diagnostics import (
    diagnostic_aggregate_cells,
    replay_diagnostic_reviews,
)


FIXTURE = (
    Path(__file__).parents[2]
    / "conformance"
    / "fixtures"
    / "diagnostics"
    / "generalized-casualty"
)


@pytest.mark.parametrize("prefix", ["calendar", "ordered-axis"])
def test_generalized_casualty_definition_identities_and_all_formula_replays(prefix):
    document, definition = parse_diagnostic_definition(
        (FIXTURE / f"{prefix}-definition.json").read_text()
    )
    cells = json.loads((FIXTURE / f"{prefix}-aggregate-cells.json").read_text())
    expected = json.loads((FIXTURE / f"{prefix}-expected-output.json").read_text())
    assert document.interchange_version == "1.1.0"
    assert len(definition["formulas"]) == 6
    assert len(definition["instances"]) == 22
    from actuarial_interchange._jcs import canonical_json

    assert canonical_json(definition) == expected["canonicalDefinitionJson"]
    replay_cells = diagnostic_aggregate_cells(definition, cells)
    assert len(replay_cells) == len(expected["result"]["emergence"]) == 12
    for cell, output in zip(replay_cells, expected["result"]["emergence"]):
        assert (
            cell["coordinate"]["sourceGroup"],
            cell["coordinate"]["origin"],
            cell["coordinate"]["valuation"],
        ) == (output["group"], output["origin"], output["valuation"])
        for instance_id, metric in output["metrics"].items():
            actual = replay_diagnostic_cell(definition, instance_id, cell["values"])
            assert actual["numerator"] == metric["calculation"]["numerator"]["value"]
            assert (
                actual["denominator"] == metric["calculation"]["denominator"]["value"]
            )
            assert actual["value"] == pytest.approx(metric["calculation"]["value"])
    assert replay_diagnostic_reviews(definition, cells) == expected["reviews"]
    assert {item["ruleKind"] for item in expected["reviews"]} == {
        "compare",
        "reconcile",
        "monotonic",
        "layer-order",
        "control-total",
    }
    assert {item["status"] for item in expected["reviews"]} == {
        "pass",
        "triggered",
        "not-evaluated",
    }


def test_diagnostic_definition_rejects_identity_tampering():
    candidate = json.loads((FIXTURE / "calendar-definition.json").read_text())
    candidate["diagnosticDefinition"]["identities"][
        "definition"
    ] = "fnv1a64-jcs-v1:0000000000000000"
    # Restamp the outer envelope so this reaches semantic identity validation.
    from actuarial_interchange.documents import parse_document

    candidate = parse_document(candidate, verify_integrity=False).to_dict()
    with pytest.raises(BadInterchangeError, match="identities do not match"):
        parse_diagnostic_definition(candidate)


def test_diagnostic_definition_rejects_restamped_unknown_behavior():
    candidate = json.loads((FIXTURE / "calendar-definition.json").read_text())
    candidate["diagnosticDefinition"]["definition"]["measures"][0][
        "futureBehavior"
    ] = True
    from actuarial_interchange.diagnostics import diagnostic_identities
    from actuarial_interchange.documents import parse_document

    candidate["diagnosticDefinition"]["identities"] = diagnostic_identities(
        candidate["diagnosticDefinition"]["definition"]
    )
    candidate = parse_document(candidate, verify_integrity=False).to_dict()
    with pytest.raises(BadInterchangeError, match="unsupported diagnostic behavior"):
        parse_diagnostic_definition(candidate)

    nested = json.loads((FIXTURE / "calendar-definition.json").read_text())
    rule = next(
        rule
        for rule in nested["diagnosticDefinition"]["definition"]["reviewRules"]
        if rule["kind"] == "reconcile"
    )
    rule["actual"]["futureBehavior"] = True
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


BOUNDARIES = json.loads((FIXTURE.parent / "hostile-boundaries.json").read_text())


def test_shared_opaque_envelope_extension_is_not_executable_behavior():
    candidate = json.loads((FIXTURE / "calendar-definition.json").read_text())
    vector = BOUNDARIES["opaqueEnvelope"]
    candidate[vector["field"]] = vector["value"]
    document, _ = parse_diagnostic_definition(candidate)
    assert document.to_dict()[vector["field"]] == vector["value"]


def _restamp(definition):
    from actuarial_interchange.diagnostics import diagnostic_identities
    from actuarial_interchange.documents import parse_document

    doc = json.loads((FIXTURE / "calendar-definition.json").read_text())
    doc["diagnosticDefinition"]["definition"] = definition
    try:
        doc["diagnosticDefinition"]["identities"] = diagnostic_identities(definition)
    except (KeyError, TypeError, BadInterchangeError):
        pass  # malformed syntax must fail before semantic identity comparison
    return parse_document(doc, verify_integrity=False).to_dict()


@pytest.mark.parametrize(
    "vector", BOUNDARIES["mutations"], ids=lambda vector: vector["id"]
)
def test_shared_hostile_semantic_mutations(vector):
    definition = json.loads((FIXTURE / "calendar-definition.json").read_text())[
        "diagnosticDefinition"
    ]["definition"]
    target = definition
    for key in vector["path"][:-1]:
        target = target[key]
    target[vector["path"][-1]] = vector["value"]
    candidate = _restamp(definition)
    if vector["accept"]:
        parse_diagnostic_definition(candidate)
    else:
        with pytest.raises(BadInterchangeError):
            parse_diagnostic_definition(candidate)


@pytest.mark.parametrize(
    "vector", BOUNDARIES["escapedStrings"], ids=lambda vector: vector["id"]
)
def test_shared_utf16_escapes(vector):
    definition = json.loads((FIXTURE / "calendar-definition.json").read_text())[
        "diagnosticDefinition"
    ]["definition"]
    definition["id"] = json.loads(vector["json"])
    candidate = _restamp(definition)
    if vector["accept"]:
        parse_diagnostic_definition(candidate)
    else:
        with pytest.raises(BadInterchangeError, match="Unicode|NUL"):
            parse_diagnostic_definition(candidate)


def _resource_definition(vector, root):
    definition = json.loads((FIXTURE / "calendar-definition.json").read_text())[
        "diagnosticDefinition"
    ]["definition"]
    definition["formulas"] = [definition["formulas"][0]]
    instance = definition["instances"][0]
    instance.update(
        id="resource-metric",
        formulaId="amount-per-claim",
        bindings={
            "amount": {"op": "measure", "measureId": "gross-paid"},
            "claims": {"op": "measure", "measureId": "reported"},
        },
        rules=[],
    )
    definition["instances"] = [instance]
    definition["reviewRules"] = []
    definition["derivedMeasures"] = []

    def expression(size, reference="measure", name="gross-paid"):
        leaf = {"op": reference, "role" if reference == "role" else "measureId": name}
        if vector["dimension"] == "depth":
            for _ in range(size - 1):
                leaf = {"op": "add", "terms": [leaf]}
            return leaf
        return (
            leaf
            if size == 1
            else {"op": "add", "terms": [dict(leaf) for _ in range(size - 1)]}
        )

    if vector["dimension"] == "definition":
        definition["instances"] = []
        for index in range(10):
            item = deepcopy(instance)
            item["id"] = f"resource-metric-{index}"
            item["bindings"]["amount"] = expression(
                9999 if index < 9 else vector["size"] - 90003
            )
            definition["instances"].append(item)
    elif root.startswith("formula-"):
        field = root.removeprefix("formula-")
        definition["formulas"][0][field] = expression(
            vector["size"], "role", "amount" if field == "numerator" else "claims"
        )
    elif root == "instance-binding":
        instance["bindings"]["amount"] = expression(vector["size"])
    elif root == "claim-derivation":
        definition["lossRowGrain"] = "claim"
        measure = deepcopy(
            next(item for item in definition["measures"] if item["id"] == "reported")
        )
        measure.update(id="derived-probe", source="derived")
        definition["measures"].append(measure)
        definition["derivedMeasures"] = [
            {
                "id": "probe",
                "outputMeasureId": "derived-probe",
                "expression": expression(vector["size"], name="reported"),
            }
        ]
    elif root == "review-rule":
        definition["reviewRules"] = [
            {
                "id": "probe",
                "kind": "reconcile",
                "code": "probe",
                "description": "probe",
                "severity": "warning",
                "missingInput": "not-evaluated",
                "tolerance": {"absolute": 0, "relative": 0},
                "actual": expression(vector["size"]),
                "expected": {"op": "constant", "value": 0},
            }
        ]
    else:
        instance["rules"] = [
            {
                "id": "probe",
                "code": "probe",
                "message": "probe",
                "severity": "warning",
                "when": {
                    "left": {
                        "source": "measure",
                        "expression": expression(vector["size"] - 1),
                    },
                    "operator": "gt",
                    "right": {"source": "constant", "value": 0},
                    "tolerance": {"absolute": 0, "relative": 0},
                },
            }
        ]
    return definition


RESOURCE_CASES = [
    (vector, root)
    for vector in BOUNDARIES["resources"]
    for root in (
        ["definition"]
        if vector["dimension"] == "definition"
        else BOUNDARIES["expressionRoots"]
    )
]


@pytest.mark.parametrize(
    "vector,root",
    RESOURCE_CASES,
    ids=[f"{vector['id']}-{root}" for vector, root in RESOURCE_CASES],
)
def test_shared_exact_semantic_resource_limits(vector, root):
    from actuarial_interchange.diagnostics import _validate_closed_definition

    definition = _resource_definition(vector, root)
    if vector["accept"]:
        _validate_closed_definition(definition)
    else:
        with pytest.raises(BadInterchangeError, match="exceeds|resource limit"):
            _validate_closed_definition(definition)


def test_non_json_direct_boundary_terminates_with_typed_error():
    from actuarial_interchange.diagnostics import _preflight

    cyclic = {}
    cyclic["self"] = cyclic
    for value in (
        cyclic,
        object(),
        float("inf"),
        float("nan"),
        10**10000,
        {1: "non-string"},
    ):
        with pytest.raises(BadInterchangeError):
            _preflight(value)
