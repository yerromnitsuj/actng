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


def _exact(value: Any, allowed: set[str], path: str) -> None:
    if not isinstance(value, dict):
        raise BadInterchangeError(f"{path} must be an object")
    unknown = sorted(set(value) - allowed, key=lambda item: item.encode("utf-16-be", "surrogatepass"))
    if unknown:
        raise BadInterchangeError(f"unsupported diagnostic behavior at {path}.{unknown[0]}")


def _validate_expression(root: Any, reference: str, path: str) -> int:
    stack = [(root, path, 1)]
    nodes = 0
    while stack:
        value, current, depth = stack.pop()
        if depth > 64:
            raise BadInterchangeError(f"diagnostic expression depth exceeds 64 at {current}")
        nodes += 1
        if nodes > 10_000:
            raise BadInterchangeError(f"diagnostic expression node count exceeds 10000 at {path}")
        if not isinstance(value, dict):
            raise BadInterchangeError(f"diagnostic expression at {current} must be an object")
        op = value.get("op")
        if op == reference:
            _exact(value, {"op", "measureId" if reference == "measure" else "role"}, current)
        elif op == "add":
            _exact(value, {"op", "terms"}, current)
            if not isinstance(value.get("terms"), list) or not value["terms"]:
                raise BadInterchangeError(f"diagnostic add terms must be nonempty at {current}")
            stack.extend((child, f"{current}.terms[{index}]", depth + 1) for index, child in enumerate(value["terms"]))
        elif op == "subtract":
            _exact(value, {"op", "left", "right"}, current)
            stack.extend([(value.get("left"), f"{current}.left", depth + 1), (value.get("right"), f"{current}.right", depth + 1)])
        else:
            raise BadInterchangeError(f"unknown diagnostic expression operator {op!r} at {current}")
    return nodes


def _validate_tolerance(value: Any, path: str) -> None:
    _exact(value, {"absolute", "relative"}, path)


def _validate_review_operand(value: Any, path: str) -> None:
    if isinstance(value, dict) and value.get("op") == "constant":
        _exact(value, {"op", "value"}, path)
    else:
        _validate_expression(value, "measure", path)


def _validate_metric_operand(value: Any, path: str) -> None:
    if not isinstance(value, dict):
        raise BadInterchangeError(f"{path} must be an object")
    source = value.get("source")
    if source == "measure":
        _exact(value, {"source", "expression"}, path)
        _validate_expression(value.get("expression"), "measure", f"{path}.expression")
    elif source == "calculation":
        _exact(value, {"source", "field"}, path)
    elif source == "constant":
        _exact(value, {"source", "value"}, path)
    else:
        raise BadInterchangeError(f"unknown diagnostic rule operand source {source!r} at {path}")


def _validate_closed_definition(definition: Any) -> None:
    _exact(definition, {"diagnosticDefinitionVersion", "id", "version", "lossRowGrain", "measures", "countPopulations", "exposureBases", "amountBases", "derivedMeasures", "formulas", "instances", "reviewRules", "periodAxis"}, "$.definition")
    for index, item in enumerate(definition["measures"]):
        _exact(item, {"id", "displayName", "description", "source", "kind", "unit", "developmentSemantics", "aggregation", "missing", "basisId", "countPopulationId", "exposureBasisId", "exposureTiming"}, f"$.definition.measures[{index}]")
    for name in ("countPopulations", "exposureBases"):
        allowed = {"id", "displayName", "subject", "unit", "description", "attributes"} if name == "countPopulations" else {"id", "displayName", "basis", "unit", "description", "sourceDescription", "attributes"}
        for index, item in enumerate(definition[name]): _exact(item, allowed, f"$.definition.{name}[{index}]")
    for index, basis in enumerate(definition["amountBases"]):
        _exact(basis, {"id", "displayName", "currency", "perspective", "components", "sourceDescription", "attributes"}, f"$.definition.amountBases[{index}]")
        for component_index, component in enumerate(basis["components"]):
            base = f"$.definition.amountBases[{index}].components[{component_index}]"; _exact(component, {"id", "treatment", "limitation"}, base)
            limitation = component["limitation"]; kind = limitation.get("kind")
            if kind not in ("unlimited", "unknown", "layer", "pre-limited"):
                raise BadInterchangeError(f"unknown amount limitation kind {kind!r} at {base}.limitation")
            _exact(limitation, {"kind"} if kind == "unlimited" else {"kind", "description"} if kind == "unknown" else {"kind", "attachment", "limit", "application", "derivation"}, f"{base}.limitation")
            if kind in ("layer", "pre-limited"):
                derivation=limitation["derivation"]; _exact(derivation,{"kind"} if derivation.get("kind")=="sdk" else {"kind","actor","transformationRef"},f"{base}.limitation.derivation")
    for index, item in enumerate(definition["derivedMeasures"]):
        _exact(item,{"id","outputMeasureId","expression"},f"$.definition.derivedMeasures[{index}]");_validate_expression(item["expression"],"measure",f"$.definition.derivedMeasures[{index}].expression")
    for index, formula in enumerate(definition["formulas"]):
        _exact(formula,{"id","version","roles","numerator","denominator","denominatorPolicy"},f"$.definition.formulas[{index}]")
        for role, value in formula["roles"].items(): _exact(value,{"kind","compatibilityGroup","developmentSemantics"},f"$.definition.formulas[{index}].roles.{role}")
        _validate_expression(formula["numerator"],"role",f"$.definition.formulas[{index}].numerator");_validate_expression(formula["denominator"],"role",f"$.definition.formulas[{index}].denominator")
    for index, instance in enumerate(definition["instances"]):
        _exact(instance,{"id","version","formulaId","bindings","presentation","rules"},f"$.definition.instances[{index}]")
        for role, expression in instance["bindings"].items(): _validate_expression(expression,"measure",f"$.definition.instances[{index}].bindings.{role}")
        _exact(instance["presentation"],{"displayName","description","displayUnit","scale","numeratorLabel","denominatorLabel"},f"$.definition.instances[{index}].presentation")
        for rule_index, rule in enumerate(instance["rules"]):
            base=f"$.definition.instances[{index}].rules[{rule_index}]";_exact(rule,{"id","code","message","severity","when"},base);_exact(rule["when"],{"left","operator","right","tolerance"},f"{base}.when")
            _validate_metric_operand(rule["when"]["left"], f"{base}.when.left")
            _validate_metric_operand(rule["when"]["right"], f"{base}.when.right")
            if rule["when"].get("tolerance") is not None:
                _validate_tolerance(rule["when"]["tolerance"], f"{base}.when.tolerance")
    for index, rule in enumerate(definition["reviewRules"]):
        kind=rule.get("kind"); common={"kind","id","code","description","severity","tolerance","missingInput"}; variants={"compare":{"when"},"reconcile":{"actual","expected"},"monotonic":{"expression","direction"},"layer-order":{"narrower","broader","comparability"},"control-total":{"expression","expected","filter","projection"}}
        if kind not in variants: raise BadInterchangeError(f"unknown diagnostic review-rule kind {kind!r}")
        _exact(rule,common|variants[kind],f"$.definition.reviewRules[{index}]")
        base=f"$.definition.reviewRules[{index}]"
        if rule.get("tolerance") is not None: _validate_tolerance(rule["tolerance"], f"{base}.tolerance")
        if kind == "compare":
            _exact(rule["when"], {"left", "operator", "right"}, f"{base}.when")
            _validate_review_operand(rule["when"]["left"], f"{base}.when.left")
            _validate_review_operand(rule["when"]["right"], f"{base}.when.right")
        elif kind == "reconcile":
            _validate_expression(rule["actual"], "measure", f"{base}.actual")
            _validate_review_operand(rule["expected"], f"{base}.expected")
        elif kind == "monotonic": _validate_expression(rule["expression"], "measure", f"{base}.expression")
        elif kind == "layer-order":
            _validate_expression(rule["narrower"], "measure", f"{base}.narrower"); _validate_expression(rule["broader"], "measure", f"{base}.broader")
            comparability=rule["comparability"]; _exact(comparability, {"kind"} if comparability.get("kind")=="compiler-proven" else {"kind","rationaleArtifactId"}, f"{base}.comparability")
        else:
            _validate_expression(rule["expression"], "measure", f"{base}.expression")
            if rule.get("filter") is not None: _exact(rule["filter"], {"sourceGroups","origins","originFrom","originThrough","valuations","valuationFrom","valuationThrough","minDevelopmentAge","maxDevelopmentAge"}, f"{base}.filter")
            projection=rule["projection"]; _exact(projection, {"kind","valuation"} if projection.get("kind")=="valuation" else {"kind"}, f"{base}.projection")
    axis=definition["periodAxis"]
    if axis.get("kind") not in ("calendar", "ordered"): raise BadInterchangeError(f"unknown diagnostic period-axis kind {axis.get('kind')!r}")
    _exact(axis,{"kind","originCadence","valuationCadence","originAnchor","valuationAnchor","ageUnit","ageOffset"} if axis.get("kind")=="calendar" else {"kind","id","version","ageUnit","ageOffset","origins","valuations"},"$.definition.periodAxis")
    if axis.get("kind")=="ordered":
        for name in ("origins","valuations"):
            for index,item in enumerate(axis[name]):_exact(item,{"label","aliases","coordinate"},f"$.definition.periodAxis.{name}[{index}]")


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
    _validate_closed_definition(definition)
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
