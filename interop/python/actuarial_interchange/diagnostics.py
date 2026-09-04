"""Narrow, dependency-free diagnostic-definition identity and formula replay.

This is deliberately not a second diagnostic SDK. It verifies the portable
definition identities and evaluates formulas/rules over already aggregated
measure cells for cross-shore conformance.
"""

from __future__ import annotations

import math
from typing import Any

from ._jcs import canonical_json, fnv1a64
from .documents import Document, DiagnosticDefinitionPayload, parse_document
from .errors import BadInterchangeError

__all__ = ["diagnostic_identities", "parse_diagnostic_definition", "replay_diagnostic_cell"]


def _sort_utf16(values: Any) -> list[str]:
    """Sort exactly like ECMAScript's default string order (UTF-16 units)."""
    return sorted(values, key=lambda value: value.encode("utf-16-be", "surrogatepass"))


def _tag(kind: str, key: str, value: Any) -> str:
    return f"fnv1a64-jcs-v1:{fnv1a64(canonical_json({'identityVersion': 1, 'kind': kind, key: value}))}"


def _dependencies(expression: dict) -> set[str]:
    op = expression.get("op")
    if op in ("measure", "claim-layer"):
        return {expression["measureId"]}
    if op == "add":
        result: set[str] = set()
        for term in expression["terms"]:
            result.update(_dependencies(term))
        return result
    if op == "subtract":
        return _dependencies(expression["left"]) | _dependencies(expression["right"])
    raise BadInterchangeError(f"unknown diagnostic expression operator {op!r}")


def diagnostic_identities(definition: dict) -> dict:
    """Recompute the four portable identity classes from a normalized body."""
    formulas = {item["id"]: item for item in definition["formulas"]}
    measures = {item["id"]: item for item in definition["measures"]}
    derivations = {item["outputMeasureId"]: item for item in definition["derivedMeasures"]}
    populations = {item["id"]: item for item in definition["countPopulations"]}
    exposures = {item["id"]: item for item in definition["exposureBases"]}
    amounts = {item["id"]: item for item in definition["amountBases"]}
    formula_tags = {key: _tag("diagnostic-formula", "formula", formulas[key]) for key in _sort_utf16(formulas)}

    def transitive(roots: set[str]) -> list[str]:
        found: set[str] = set()
        stack = list(roots)
        while stack:
            item = stack.pop()
            if item in found:
                continue
            found.add(item)
            if item in derivations:
                stack.extend(_dependencies(derivations[item]["expression"]))
        return _sort_utf16(found)

    calculations: dict[str, str] = {}
    for instance in definition["instances"]:
        dependencies: set[str] = set()
        for expression in instance["bindings"].values():
            dependencies.update(_dependencies(expression))
        selected_ids = transitive(dependencies)
        selected_measures = [measures[item] for item in selected_ids if item in measures]
        population_ids = _sort_utf16({m["countPopulationId"] for m in selected_measures if m["countPopulationId"] is not None})
        exposure_ids = _sort_utf16({m["exposureBasisId"] for m in selected_measures if m["exposureBasisId"] is not None})
        amount_ids = _sort_utf16({m["basisId"] for m in selected_measures if m["basisId"] is not None})
        scope = {
            "formulaFingerprint": formula_tags[instance["formulaId"]],
            "instance": {key: instance[key] for key in ("id", "version", "formulaId", "bindings")},
            "lossRowGrain": definition["lossRowGrain"],
            "measures": [{key: m[key] for key in ("id", "source", "kind", "unit", "developmentSemantics", "aggregation", "missing", "basisId", "countPopulationId", "exposureBasisId", "exposureTiming")} for m in selected_measures],
            "countPopulations": [{key: populations[item][key] for key in ("id", "subject", "unit", "attributes")} for item in population_ids],
            "exposureBases": [{key: exposures[item][key] for key in ("id", "basis", "unit", "attributes")} for item in exposure_ids],
            "amountBases": [{key: amounts[item][key] for key in ("id", "currency", "perspective", "components", "attributes")} for item in amount_ids],
            "derivedMeasures": [item for item in definition["derivedMeasures"] if item["outputMeasureId"] in selected_ids],
        }
        calculations[instance["id"]] = _tag("diagnostic-calculation", "calculation", scope)
    return {
        "algorithm": "fnv1a64-jcs-v1",
        "formulaById": formula_tags,
        "calculationByInstanceId": {key: calculations[key] for key in _sort_utf16(calculations)},
        "definition": _tag("diagnostic-definition", "definition", definition),
    }


def parse_diagnostic_definition(source: str | dict) -> tuple[Document, dict]:
    doc = parse_document(source)
    if doc.kind != "diagnostic-definition" or not isinstance(doc.payload, DiagnosticDefinitionPayload):
        raise BadInterchangeError(f"expected diagnostic-definition, got {doc.kind!r}")
    definition = doc.payload.definition
    if definition.get("diagnosticDefinitionVersion") != "1.0.0":
        raise BadInterchangeError("unsupported diagnosticDefinitionVersion")
    expected = diagnostic_identities(definition)
    if expected != doc.payload.identities:
        raise BadInterchangeError("diagnostic definition identities do not match semantic definition")
    return doc, definition


def _evaluate(expression: dict, values: dict[str, float | None], reference: str) -> float | None:
    op = expression["op"]
    if op == reference:
        return values.get(expression["measureId"] if reference == "measure" else expression["role"])
    children = expression["terms"] if op == "add" else [expression["left"], expression["right"]]
    evaluated = [_evaluate(child, values, reference) for child in children]
    if any(value is None for value in evaluated):
        return None
    result = sum(evaluated) if op == "add" else evaluated[0] - evaluated[1]  # type: ignore[operator]
    return result if math.isfinite(result) else None


def replay_diagnostic_cell(definition: dict, instance_id: str, values: dict[str, float | None]) -> dict:
    instance = next(item for item in definition["instances"] if item["id"] == instance_id)
    formula = next(item for item in definition["formulas"] if item["id"] == instance["formulaId"])
    roles = {role: _evaluate(expression, values, "measure") for role, expression in instance["bindings"].items()}
    numerator = _evaluate(formula["numerator"], roles, "role")
    denominator = _evaluate(formula["denominator"], roles, "role")
    value = None if numerator is None or denominator is None or denominator <= 0 else numerator / denominator
    if value is not None and not math.isfinite(value):
        value = None
    return {"numerator": numerator, "denominator": denominator, "value": value}
