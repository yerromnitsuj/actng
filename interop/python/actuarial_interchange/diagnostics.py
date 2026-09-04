"""Narrow, dependency-free diagnostic-definition identity and formula replay.

This is deliberately not a second diagnostic SDK. It verifies the portable
definition identities and evaluates formulas/rules over already aggregated
measure cells for cross-shore conformance.
"""

from __future__ import annotations

import math
import json
import re
from typing import Any

from ._jcs import canonical_json, fnv1a64
from .documents import Document, DiagnosticDefinitionPayload, parse_document
from .errors import BadInterchangeError

__all__ = [
    "diagnostic_identities",
    "parse_diagnostic_definition",
    "replay_diagnostic_cell",
]


def _preflight(value: Any) -> None:
    """Bound work before recursive identity serialization, with no coercion."""
    stack = [(value, "$", 1, False)]
    active: set[int] = set()
    nodes = 0
    while stack:
        item, path, depth, exiting = stack.pop()
        if exiting:
            active.remove(id(item))
            continue
        nodes += 1
        if depth > 256 or nodes > 1_000_000:
            raise BadInterchangeError(f"diagnostic JSON resource limit at {path}")
        if item is None or type(item) is bool:
            continue
        if type(item) is str:
            # Python usually decodes a surrogate pair to one scalar. Also
            # accept a caller's explicit paired code units, just as JS does.
            try:
                item.encode("utf-16", "surrogatepass").decode("utf-16")
            except UnicodeError as error:
                raise BadInterchangeError(
                    f"invalid diagnostic Unicode at {path}"
                ) from error
            if "\0" in item:
                raise BadInterchangeError(f"invalid diagnostic NUL at {path}")
            continue
        if type(item) in (int, float):
            try:
                finite = math.isfinite(item)
            except OverflowError:
                finite = False
            if not finite:
                raise BadInterchangeError(f"nonfinite diagnostic number at {path}")
            continue
        if type(item) not in (dict, list):
            raise BadInterchangeError(f"non-JSON diagnostic value at {path}")
        if id(item) in active:
            raise BadInterchangeError(f"diagnostic JSON cycle at {path}")
        active.add(id(item))
        stack.append((item, path, depth, True))
        entries = item.items() if type(item) is dict else enumerate(item)
        for key, child in entries:
            if type(item) is dict and type(key) is not str:
                raise BadInterchangeError(f"non-string diagnostic key at {path}")
            if type(key) is str:
                stack.append((key, path, depth + 1, False))
            stack.append((child, f"{path}.{key}", depth + 1, False))


def _token(value: Any, path: str) -> None:
    if (
        type(value) is not str
        or not value
        or re.search(r"^[\x09-\x0d ]|[\x09-\x0d ]$", value)
    ):
        raise BadInterchangeError(f"invalid diagnostic token at {path}")


def _finite(
    value: Any, path: str, *, nonnegative: bool = False, integer: bool = False
) -> None:
    try:
        finite = type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        finite = False
    if (
        not finite
        or (nonnegative and value < 0)
        or (integer and (value != int(value) or abs(value) > 2**53 - 1))
    ):
        raise BadInterchangeError(f"invalid diagnostic number at {path}")


def _enum(value: Any, choices: tuple[str, ...], path: str) -> None:
    if type(value) is not str or value not in choices:
        raise BadInterchangeError(f"unsupported diagnostic enum at {path}: {value!r}")


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
    unknown = sorted(
        set(value) - allowed, key=lambda item: item.encode("utf-16-be", "surrogatepass")
    )
    if unknown:
        raise BadInterchangeError(
            f"unsupported diagnostic behavior at {path}.{unknown[0]}"
        )
    missing = sorted(allowed - set(value))
    if missing:
        raise BadInterchangeError(
            f"missing normalized diagnostic field at {path}.{missing[0]}"
        )


def _validate_expression(
    root: Any, reference: str, path: str, wrapper: bool = False
) -> int:
    stack = [(root, path, 2 if wrapper else 1)]
    nodes = 1 if wrapper else 0
    while stack:
        value, current, depth = stack.pop()
        if depth > 64:
            raise BadInterchangeError(
                f"diagnostic expression depth exceeds 64 at {current}"
            )
        nodes += 1
        if nodes > 10_000:
            raise BadInterchangeError(
                f"diagnostic expression node count exceeds 10000 at {path}"
            )
        if not isinstance(value, dict):
            raise BadInterchangeError(
                f"diagnostic expression at {current} must be an object"
            )
        op = value.get("op")
        if op == reference or (reference == "claim" and op == "measure"):
            key = "role" if reference == "role" else "measureId"
            _exact(value, {"op", key}, current)
            _token(value.get(key), f"{current}.{key}")
        elif reference == "claim" and op == "claim-layer":
            _exact(value, {"op", "measureId", "attachment", "limit"}, current)
            _token(value.get("measureId"), f"{current}.measureId")
            _finite(value.get("attachment"), f"{current}.attachment", nonnegative=True)
            if value.get("limit") is not None:
                _finite(value["limit"], f"{current}.limit", nonnegative=True)
        elif op == "add":
            _exact(value, {"op", "terms"}, current)
            if not isinstance(value.get("terms"), list) or not value["terms"]:
                raise BadInterchangeError(
                    f"diagnostic add terms must be nonempty at {current}"
                )
            stack.extend(
                (child, f"{current}.terms[{index}]", depth + 1)
                for index, child in enumerate(value["terms"])
            )
        elif op == "subtract":
            _exact(value, {"op", "left", "right"}, current)
            stack.extend(
                [
                    (value.get("left"), f"{current}.left", depth + 1),
                    (value.get("right"), f"{current}.right", depth + 1),
                ]
            )
        else:
            raise BadInterchangeError(
                f"unknown diagnostic expression operator {op!r} at {current}"
            )
    return nodes


def _validate_tolerance(value: Any, path: str) -> None:
    _exact(value, {"absolute", "relative"}, path)
    for key, component in value.items():
        _finite(component, f"{path}.{key}", nonnegative=True)


def _validate_review_operand(value: Any, path: str) -> None:
    if isinstance(value, dict) and value.get("op") == "constant":
        _exact(value, {"op", "value"}, path)
        _finite(value.get("value"), f"{path}.value")
    else:
        _validate_expression(value, "measure", path)


def _validate_metric_operand(value: Any, path: str) -> None:
    if not isinstance(value, dict):
        raise BadInterchangeError(f"{path} must be an object")
    source = value.get("source")
    if source == "measure":
        _exact(value, {"source", "expression"}, path)
        _validate_expression(
            value.get("expression"), "measure", f"{path}.expression", wrapper=True
        )
    elif source == "calculation":
        _exact(value, {"source", "field"}, path)
        _enum(value.get("field"), ("numerator", "denominator"), f"{path}.field")
    elif source == "constant":
        _exact(value, {"source", "value"}, path)
        _finite(value.get("value"), f"{path}.value")
    else:
        raise BadInterchangeError(
            f"unknown diagnostic rule operand source {source!r} at {path}"
        )


def _validate_scalar_contract(definition: dict) -> None:
    """Validate portable types/enums; this reader does not plan SDK execution."""
    enums = {
        "lossRowGrain": ("claim", "aggregate"),
        "developmentSemantics": (
            "cumulative",
            "incremental",
            "point-in-time",
            "unknown",
        ),
        "aggregation": ("sum",),
        "missing": ("unknown", "zero"),
        "exposureTiming": ("origin-static", "valuation-specific"),
        "subject": ("claim", "claimant", "policy", "occurrence", "other", "unknown"),
        "basis": ("earned", "written", "in-force", "other", "unknown"),
        "perspective": ("gross", "net", "ceded", "other", "unknown"),
        "treatment": ("included", "excluded", "unknown"),
        "application": ("claim", "occurrence", "policy", "source-defined"),
        "actor": ("caller", "source"),
        "denominatorPolicy": ("positive-or-null",),
        "severity": ("warning", "fail"),
        "operator": ("lt", "lte", "eq", "neq", "gte", "gt"),
        "missingInput": ("not-evaluated", "finding"),
        "direction": ("nondecreasing", "nonincreasing"),
        "originCadence": ("month", "quarter", "year"),
        "valuationCadence": ("month", "quarter", "year"),
        "originAnchor": ("start", "end"),
        "valuationAnchor": ("start", "end"),
    }
    tokens = {
        "id",
        "version",
        "unit",
        "currency",
        "basisId",
        "countPopulationId",
        "exposureBasisId",
        "compatibilityGroup",
        "outputMeasureId",
        "formulaId",
        "transformationRef",
        "rationaleArtifactId",
        "ageUnit",
        "label",
        "role",
        "measureId",
    }
    text_fields = {
        "displayName",
        "description",
        "sourceDescription",
        "displayUnit",
        "numeratorLabel",
        "denominatorLabel",
        "code",
        "message",
    }
    for name in (
        "measures",
        "countPopulations",
        "exposureBases",
        "amountBases",
        "derivedMeasures",
        "formulas",
        "instances",
        "reviewRules",
    ):
        if type(definition.get(name)) is not list:
            raise BadInterchangeError(
                f"diagnostic catalog must be an array at $.definition.{name}"
            )
        ids = [item.get("id") for item in definition[name] if type(item) is dict]
        if (
            len(ids) != len(definition[name])
            or any(type(item) is not str for item in ids)
            or len(ids) != len(set(ids))
        ):
            raise BadInterchangeError(
                f"invalid or duplicate diagnostic catalog ID at $.definition.{name}"
            )
    stack = [(definition, "$.definition")]
    expression_nodes = 0
    while stack:
        item, path = stack.pop()
        if isinstance(item, list):
            stack.extend(
                (child, f"{path}[{index}]") for index, child in enumerate(item)
            )
            continue
        if not isinstance(item, dict):
            continue
        registry = path.endswith((".roles", ".bindings", ".attributes"))
        if not registry and (
            "op" in item or item.get("source") in ("measure", "calculation", "constant")
        ):
            expression_nodes += 1
            if expression_nodes > 100_000:
                raise BadInterchangeError(
                    "diagnostic definition expression node count exceeds 100000"
                )
        for key, value in item.items():
            current = f"{path}.{key}"
            if path.endswith((".roles", ".bindings")):
                _token(key, current)
                stack.append((value, current))
                continue
            if key == "attributes":
                if not isinstance(value, dict) or any(
                    type(v) not in (str, int, float, bool, type(None))
                    for v in value.values()
                ):
                    raise BadInterchangeError(
                        f"diagnostic attributes must contain JSON scalars at {current}"
                    )
                for attribute in value:
                    _token(attribute, current)
                continue
            nullable_enum = key == "exposureTiming" or (
                key == "developmentSemantics" and ".roles." in path
            )
            if key in enums and (value is not None or not nullable_enum):
                _enum(value, enums[key], current)
            if key in tokens and (
                value is not None
                or key
                not in {
                    "basisId",
                    "countPopulationId",
                    "exposureBasisId",
                    "compatibilityGroup",
                }
            ):
                _token(value, current)
            nullable_text = key == "sourceDescription" or (
                key == "description" and path.endswith(".limitation")
            )
            if (
                key in text_fields
                and not (value is None and nullable_text)
                and type(value) is not str
            ):
                raise BadInterchangeError(
                    f"diagnostic text must be a string at {current}"
                )
            if (
                key
                in ("ageOffset", "coordinate", "minDevelopmentAge", "maxDevelopmentAge")
                and value is not None
            ):
                _finite(
                    value,
                    current,
                    integer=True,
                    nonnegative=key not in ("ageOffset", "coordinate"),
                )
            if key in ("attachment", "limit", "scale") and value is not None:
                _finite(value, current, nonnegative=True)
            if key in ("roles", "bindings"):
                if not isinstance(value, dict):
                    raise BadInterchangeError(
                        f"diagnostic role registry must be an object at {current}"
                    )
                for role in value:
                    _token(role, current)
            stack.append((value, current))
        if "source" in item and "aggregation" in item:
            _enum(item["source"], ("loss", "exposure", "derived"), f"{path}.source")
        if "kind" in item and ("aggregation" in item or ".roles." in path):
            _enum(item["kind"], ("count", "amount", "exposure"), f"{path}.kind")
        if path.endswith(".derivation"):
            _enum(item.get("kind"), ("sdk", "external"), f"{path}.kind")
        if path.endswith(".comparability"):
            _enum(
                item.get("kind"), ("compiler-proven", "caller-asserted"), f"{path}.kind"
            )
        if path.endswith(".projection"):
            _enum(
                item.get("kind"),
                ("valuation", "latest-valuation-per-origin", "all-cells"),
                f"{path}.kind",
            )
    axis = definition.get("periodAxis", {})
    if axis.get("kind") == "calendar":
        _enum(axis.get("ageUnit"), ("month",), "$.definition.periodAxis.ageUnit")


def _validate_closed_definition(definition: Any) -> None:
    _preflight(definition)
    _validate_scalar_contract(definition)
    _exact(
        definition,
        {
            "diagnosticDefinitionVersion",
            "id",
            "version",
            "lossRowGrain",
            "measures",
            "countPopulations",
            "exposureBases",
            "amountBases",
            "derivedMeasures",
            "formulas",
            "instances",
            "reviewRules",
            "periodAxis",
        },
        "$.definition",
    )
    for index, item in enumerate(definition["measures"]):
        _exact(
            item,
            {
                "id",
                "displayName",
                "description",
                "source",
                "kind",
                "unit",
                "developmentSemantics",
                "aggregation",
                "missing",
                "basisId",
                "countPopulationId",
                "exposureBasisId",
                "exposureTiming",
            },
            f"$.definition.measures[{index}]",
        )
    for name in ("countPopulations", "exposureBases"):
        allowed = (
            {"id", "displayName", "subject", "unit", "description", "attributes"}
            if name == "countPopulations"
            else {
                "id",
                "displayName",
                "basis",
                "unit",
                "description",
                "sourceDescription",
                "attributes",
            }
        )
        for index, item in enumerate(definition[name]):
            _exact(item, allowed, f"$.definition.{name}[{index}]")
    for index, basis in enumerate(definition["amountBases"]):
        _exact(
            basis,
            {
                "id",
                "displayName",
                "currency",
                "perspective",
                "components",
                "sourceDescription",
                "attributes",
            },
            f"$.definition.amountBases[{index}]",
        )
        for component_index, component in enumerate(basis["components"]):
            base = f"$.definition.amountBases[{index}].components[{component_index}]"
            _exact(component, {"id", "treatment", "limitation"}, base)
            limitation = component["limitation"]
            kind = limitation.get("kind")
            if kind not in ("unlimited", "unknown", "layer", "pre-limited"):
                raise BadInterchangeError(
                    f"unknown amount limitation kind {kind!r} at {base}.limitation"
                )
            _exact(
                limitation,
                (
                    {"kind"}
                    if kind == "unlimited"
                    else (
                        {"kind", "description"}
                        if kind == "unknown"
                        else {
                            "kind",
                            "attachment",
                            "limit",
                            "application",
                            "derivation",
                        }
                    )
                ),
                f"{base}.limitation",
            )
            if kind in ("layer", "pre-limited"):
                derivation = limitation["derivation"]
                _exact(
                    derivation,
                    (
                        {"kind"}
                        if derivation.get("kind") == "sdk"
                        else {"kind", "actor", "transformationRef"}
                    ),
                    f"{base}.limitation.derivation",
                )
    for index, item in enumerate(definition["derivedMeasures"]):
        _exact(
            item,
            {"id", "outputMeasureId", "expression"},
            f"$.definition.derivedMeasures[{index}]",
        )
        _validate_expression(
            item["expression"],
            "claim",
            f"$.definition.derivedMeasures[{index}].expression",
        )
    for index, formula in enumerate(definition["formulas"]):
        _exact(
            formula,
            {"id", "version", "roles", "numerator", "denominator", "denominatorPolicy"},
            f"$.definition.formulas[{index}]",
        )
        for role, value in formula["roles"].items():
            _exact(
                value,
                {"kind", "compatibilityGroup", "developmentSemantics"},
                f"$.definition.formulas[{index}].roles.{role}",
            )
        _validate_expression(
            formula["numerator"], "role", f"$.definition.formulas[{index}].numerator"
        )
        _validate_expression(
            formula["denominator"],
            "role",
            f"$.definition.formulas[{index}].denominator",
        )
    for index, instance in enumerate(definition["instances"]):
        _exact(
            instance,
            {"id", "version", "formulaId", "bindings", "presentation", "rules"},
            f"$.definition.instances[{index}]",
        )
        for role, expression in instance["bindings"].items():
            _validate_expression(
                expression,
                "measure",
                f"$.definition.instances[{index}].bindings.{role}",
            )
        _exact(
            instance["presentation"],
            {
                "displayName",
                "description",
                "displayUnit",
                "scale",
                "numeratorLabel",
                "denominatorLabel",
            },
            f"$.definition.instances[{index}].presentation",
        )
        for rule_index, rule in enumerate(instance["rules"]):
            base = f"$.definition.instances[{index}].rules[{rule_index}]"
            _exact(rule, {"id", "code", "message", "severity", "when"}, base)
            _exact(
                rule["when"], {"left", "operator", "right", "tolerance"}, f"{base}.when"
            )
            _validate_metric_operand(rule["when"]["left"], f"{base}.when.left")
            _validate_metric_operand(rule["when"]["right"], f"{base}.when.right")
            if rule["when"].get("tolerance") is not None:
                _validate_tolerance(rule["when"]["tolerance"], f"{base}.when.tolerance")
    for index, rule in enumerate(definition["reviewRules"]):
        kind = rule.get("kind")
        common = {
            "kind",
            "id",
            "code",
            "description",
            "severity",
            "tolerance",
            "missingInput",
        }
        variants = {
            "compare": {"when"},
            "reconcile": {"actual", "expected"},
            "monotonic": {"expression", "direction"},
            "layer-order": {"narrower", "broader", "comparability"},
            "control-total": {"expression", "expected", "filter", "projection"},
        }
        if kind not in variants:
            raise BadInterchangeError(f"unknown diagnostic review-rule kind {kind!r}")
        _exact(rule, common | variants[kind], f"$.definition.reviewRules[{index}]")
        base = f"$.definition.reviewRules[{index}]"
        if rule.get("tolerance") is not None:
            _validate_tolerance(rule["tolerance"], f"{base}.tolerance")
        if kind == "compare":
            _exact(rule["when"], {"left", "operator", "right"}, f"{base}.when")
            _validate_review_operand(rule["when"]["left"], f"{base}.when.left")
            _validate_review_operand(rule["when"]["right"], f"{base}.when.right")
        elif kind == "reconcile":
            _validate_expression(rule["actual"], "measure", f"{base}.actual")
            _validate_review_operand(rule["expected"], f"{base}.expected")
        elif kind == "monotonic":
            _validate_expression(rule["expression"], "measure", f"{base}.expression")
        elif kind == "layer-order":
            _validate_expression(rule["narrower"], "measure", f"{base}.narrower")
            _validate_expression(rule["broader"], "measure", f"{base}.broader")
            comparability = rule["comparability"]
            _exact(
                comparability,
                (
                    {"kind"}
                    if comparability.get("kind") == "compiler-proven"
                    else {"kind", "rationaleArtifactId"}
                ),
                f"{base}.comparability",
            )
        else:
            _validate_expression(rule["expression"], "measure", f"{base}.expression")
            if rule.get("filter") is not None:
                _exact(
                    rule["filter"],
                    {
                        "sourceGroups",
                        "origins",
                        "originFrom",
                        "originThrough",
                        "valuations",
                        "valuationFrom",
                        "valuationThrough",
                        "minDevelopmentAge",
                        "maxDevelopmentAge",
                    },
                    f"{base}.filter",
                )
            projection = rule["projection"]
            _exact(
                projection,
                (
                    {"kind", "valuation"}
                    if projection.get("kind") == "valuation"
                    else {"kind"}
                ),
                f"{base}.projection",
            )
    axis = definition["periodAxis"]
    if axis.get("kind") not in ("calendar", "ordered"):
        raise BadInterchangeError(
            f"unknown diagnostic period-axis kind {axis.get('kind')!r}"
        )
    _exact(
        axis,
        (
            {
                "kind",
                "originCadence",
                "valuationCadence",
                "originAnchor",
                "valuationAnchor",
                "ageUnit",
                "ageOffset",
            }
            if axis.get("kind") == "calendar"
            else {
                "kind",
                "id",
                "version",
                "ageUnit",
                "ageOffset",
                "origins",
                "valuations",
            }
        ),
        "$.definition.periodAxis",
    )
    if axis.get("kind") == "ordered":
        for name in ("origins", "valuations"):
            for index, item in enumerate(axis[name]):
                _exact(
                    item,
                    {"label", "aliases", "coordinate"},
                    f"$.definition.periodAxis.{name}[{index}]",
                )
    _validate_references(definition)


def _validate_references(definition: dict) -> None:
    """Check declared dependencies and quantity compatibility before replay."""
    measures = {item["id"]: item for item in definition["measures"]}
    formulas = {item["id"]: item for item in definition["formulas"]}
    catalogs = {
        "amount": ("basisId", {item["id"] for item in definition["amountBases"]}),
        "count": (
            "countPopulationId",
            {item["id"] for item in definition["countPopulations"]},
        ),
        "exposure": (
            "exposureBasisId",
            {item["id"] for item in definition["exposureBases"]},
        ),
    }
    signatures = {}
    for item in measures.values():
        reference, catalog = catalogs[item["kind"]]
        if item[reference] not in catalog:
            raise BadInterchangeError(
                f"unknown diagnostic semantic reference on measure {item['id']!r}"
            )
        signatures[item["id"]] = (
            item["kind"],
            item["unit"],
            item["basisId"],
            item["countPopulationId"],
            item["exposureBasisId"],
        )

    def signature(expression: dict, registry: dict, reference: str) -> tuple | None:
        if expression["op"] == "constant":
            return None
        if expression["op"] in (reference, "claim-layer"):
            key = expression["role"] if reference == "role" else expression["measureId"]
            if key not in registry:
                raise BadInterchangeError(
                    f"unknown diagnostic expression reference {key!r}"
                )
            return registry[key]
        children = (
            expression["terms"]
            if expression["op"] == "add"
            else [expression["left"], expression["right"]]
        )
        kinds = {signature(child, registry, reference) for child in children}
        if len(kinds) != 1:
            raise BadInterchangeError("incompatible diagnostic expression quantities")
        return next(iter(kinds))

    def compatible(left: tuple | None, right: tuple | None) -> None:
        if left is not None and right is not None and left != right:
            raise BadInterchangeError("incompatible diagnostic comparison quantities")

    for derivation in definition["derivedMeasures"]:
        if derivation["outputMeasureId"] not in measures:
            raise BadInterchangeError("unknown derived diagnostic output measure")
        # A claim derivation can intentionally construct a new amount basis
        # from disjoint components. It is not a same-basis metric addition.
        if not _dependencies(derivation["expression"]).issubset(measures):
            raise BadInterchangeError("unknown derived diagnostic input measure")
    for instance in definition["instances"]:
        if instance["formulaId"] not in formulas:
            raise BadInterchangeError("unknown diagnostic formula")
        formula = formulas[instance["formulaId"]]
        if set(instance["bindings"]) != set(formula["roles"]):
            raise BadInterchangeError("diagnostic bindings must match formula roles")
        roles = {
            role: signature(expression, signatures, "measure")
            for role, expression in instance["bindings"].items()
        }
        groups = {}
        for role, quantity in roles.items():
            contract = formula["roles"][role]
            if quantity[0] != contract["kind"]:
                raise BadInterchangeError("incompatible diagnostic formula role kind")
            group = contract["compatibilityGroup"]
            if group is not None:
                if group in groups:
                    compatible(groups[group], quantity)
                groups[group] = quantity
        calculations = {
            field: signature(formula[field], roles, "role")
            for field in ("numerator", "denominator")
        }
        for rule in instance["rules"]:

            def metric_operand(value):
                if value["source"] == "constant":
                    return None
                if value["source"] == "calculation":
                    return calculations[value["field"]]
                return signature(value["expression"], signatures, "measure")

            compatible(
                metric_operand(rule["when"]["left"]),
                metric_operand(rule["when"]["right"]),
            )
    for rule in definition["reviewRules"]:
        if rule["kind"] == "compare":
            compatible(
                signature(rule["when"]["left"], signatures, "measure"),
                signature(rule["when"]["right"], signatures, "measure"),
            )
        elif rule["kind"] == "reconcile":
            compatible(
                signature(rule["actual"], signatures, "measure"),
                signature(rule["expected"], signatures, "measure"),
            )
        elif rule["kind"] == "layer-order":
            narrower = signature(rule["narrower"], signatures, "measure")
            broader = signature(rule["broader"], signatures, "measure")
            if narrower[:2] != broader[:2] or narrower[0] != "amount":
                raise BadInterchangeError("incompatible diagnostic layer quantities")
        else:
            signature(rule["expression"], signatures, "measure")


def diagnostic_identities(definition: dict) -> dict:
    """Recompute the four portable identity classes from a normalized body."""
    formulas = {item["id"]: item for item in definition["formulas"]}
    measures = {item["id"]: item for item in definition["measures"]}
    derivations = {
        item["outputMeasureId"]: item for item in definition["derivedMeasures"]
    }
    populations = {item["id"]: item for item in definition["countPopulations"]}
    exposures = {item["id"]: item for item in definition["exposureBases"]}
    amounts = {item["id"]: item for item in definition["amountBases"]}
    formula_tags = {
        key: _tag("diagnostic-formula", "formula", formulas[key])
        for key in _sort_utf16(formulas)
    }

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
        selected_measures = [
            measures[item] for item in selected_ids if item in measures
        ]
        population_ids = _sort_utf16(
            {
                m["countPopulationId"]
                for m in selected_measures
                if m["countPopulationId"] is not None
            }
        )
        exposure_ids = _sort_utf16(
            {
                m["exposureBasisId"]
                for m in selected_measures
                if m["exposureBasisId"] is not None
            }
        )
        amount_ids = _sort_utf16(
            {m["basisId"] for m in selected_measures if m["basisId"] is not None}
        )
        scope = {
            "formulaFingerprint": formula_tags[instance["formulaId"]],
            "instance": {
                key: instance[key] for key in ("id", "version", "formulaId", "bindings")
            },
            "lossRowGrain": definition["lossRowGrain"],
            "measures": [
                {
                    key: m[key]
                    for key in (
                        "id",
                        "source",
                        "kind",
                        "unit",
                        "developmentSemantics",
                        "aggregation",
                        "missing",
                        "basisId",
                        "countPopulationId",
                        "exposureBasisId",
                        "exposureTiming",
                    )
                }
                for m in selected_measures
            ],
            "countPopulations": [
                {
                    key: populations[item][key]
                    for key in ("id", "subject", "unit", "attributes")
                }
                for item in population_ids
            ],
            "exposureBases": [
                {
                    key: exposures[item][key]
                    for key in ("id", "basis", "unit", "attributes")
                }
                for item in exposure_ids
            ],
            "amountBases": [
                {
                    key: amounts[item][key]
                    for key in (
                        "id",
                        "currency",
                        "perspective",
                        "components",
                        "attributes",
                    )
                }
                for item in amount_ids
            ],
            "derivedMeasures": [
                item
                for item in definition["derivedMeasures"]
                if item["outputMeasureId"] in selected_ids
            ],
        }
        calculations[instance["id"]] = _tag(
            "diagnostic-calculation", "calculation", scope
        )
    return {
        "algorithm": "fnv1a64-jcs-v1",
        "formulaById": formula_tags,
        "calculationByInstanceId": {
            key: calculations[key] for key in _sort_utf16(calculations)
        },
        "definition": _tag("diagnostic-definition", "definition", definition),
    }


def parse_diagnostic_definition(source: str | dict) -> tuple[Document, dict]:
    if isinstance(source, str):
        try:
            source = json.loads(source)
        except (ValueError, RecursionError) as error:
            raise BadInterchangeError("invalid diagnostic JSON document") from error
    _preflight(source)
    doc = parse_document(source)
    if doc.kind != "diagnostic-definition" or not isinstance(
        doc.payload, DiagnosticDefinitionPayload
    ):
        raise BadInterchangeError(f"expected diagnostic-definition, got {doc.kind!r}")
    definition = doc.payload.definition
    if definition.get("diagnosticDefinitionVersion") != "1.0.0":
        raise BadInterchangeError("unsupported diagnosticDefinitionVersion")
    try:
        _validate_closed_definition(definition)
        expected = diagnostic_identities(definition)
    except (KeyError, TypeError, ValueError, StopIteration, RecursionError) as error:
        if isinstance(error, BadInterchangeError):
            raise
        raise BadInterchangeError(
            f"invalid diagnostic semantic definition: {error}"
        ) from error
    if expected != doc.payload.identities:
        raise BadInterchangeError(
            "diagnostic definition identities do not match semantic definition"
        )
    return doc, definition


def _evaluate(
    expression: dict, values: dict[str, float | None], reference: str
) -> float | None:
    op = expression["op"]
    if op == reference:
        value = values.get(
            expression["measureId"] if reference == "measure" else expression["role"]
        )
        return None if value is None else float(value)
    children = (
        expression["terms"]
        if op == "add"
        else [expression["left"], expression["right"]]
    )
    evaluated = [_evaluate(child, values, reference) for child in children]
    if any(value is None for value in evaluated):
        return None
    result = _compensated_sum(evaluated) if op == "add" else evaluated[0] - evaluated[1]  # type: ignore[operator]
    return result if result is not None and math.isfinite(result) else None


def _compensated_sum(values: list[float]) -> float | None:
    total = correction = 0.0
    for value in values:
        next_total = total + value
        correction += (
            (total - next_total + value)
            if abs(total) >= abs(value)
            else (value - next_total + total)
        )
        total = next_total
        if not math.isfinite(total) or not math.isfinite(correction):
            return None
    value = total + correction
    return value if math.isfinite(value) else None


def replay_diagnostic_cell(
    definition: dict, instance_id: str, values: dict[str, float | None]
) -> dict:
    instance = next(
        item for item in definition["instances"] if item["id"] == instance_id
    )
    formula = next(
        item for item in definition["formulas"] if item["id"] == instance["formulaId"]
    )
    roles = {
        role: _evaluate(expression, values, "measure")
        for role, expression in instance["bindings"].items()
    }
    numerator = _evaluate(formula["numerator"], roles, "role")
    denominator = _evaluate(formula["denominator"], roles, "role")
    value = (
        None
        if numerator is None or denominator is None or denominator <= 0
        else numerator / denominator
    )
    if value is not None and not math.isfinite(value):
        value = None
    return {"numerator": numerator, "denominator": denominator, "value": value}


def diagnostic_aggregate_cells(definition: dict, supplied: dict) -> list[dict]:
    """Adapt the conformance corpus's single-row cells, not arbitrary loss runs.

    This intentionally refuses duplicate cells: ingestion, claim derivation,
    and structural review remain the responsibility of the actual SDK.
    """
    axis = definition["periodAxis"]

    def period(label: str, side: str) -> tuple[str, int]:
        if axis["kind"] == "ordered":
            item = next(
                item
                for item in axis[side + "s"]
                if label == item["label"] or label in item["aliases"]
            )
            return item["label"], item["coordinate"]
        cadence = axis[side + "Cadence"]
        anchor = axis[side + "Anchor"]
        if cadence != "year":
            raise BadInterchangeError(
                "aggregate conformance replay currently requires an annual calendar or ordered axis"
            )
        return label, int(label) * 12 + (12 if anchor == "end" else 0)

    output = []
    seen = set()
    for row in supplied["losses"]:
        origin, origin_coordinate = period(row["origin"], "origin")
        valuation, valuation_coordinate = period(row["valuation"], "valuation")
        key = (row["sourceGroup"], origin, valuation)
        if key in seen or row["rowType"] != "aggregate" or not row["complete"]:
            raise BadInterchangeError(
                "aggregate conformance replay needs one complete row per cell"
            )
        seen.add(key)
        values = dict(row["measures"])
        for exposure in supplied["exposures"]:
            if (
                exposure["sourceGroup"] == row["sourceGroup"]
                and period(exposure["origin"], "origin")[0] == origin
            ):
                if (
                    "valuation" not in exposure
                    or period(exposure["valuation"], "valuation")[0] == valuation
                ):
                    values[exposure["measureId"]] = exposure["value"]
        values = {
            key: None if value is None else float(value)
            for key, value in values.items()
        }
        output.append(
            {
                "coordinate": {
                    "sourceGroup": key[0],
                    "origin": origin,
                    "valuation": valuation,
                    "developmentAge": valuation_coordinate
                    - origin_coordinate
                    + axis["ageOffset"],
                    "ageUnit": axis["ageUnit"],
                },
                "values": values,
            }
        )
    return sorted(
        output,
        key=lambda item: (
            item["coordinate"]["sourceGroup"].encode("utf-16-be"),
            item["coordinate"]["origin"],
            item["coordinate"]["developmentAge"],
        ),
    )


def replay_diagnostic_reviews(definition: dict, supplied: dict) -> list[dict]:
    """Independent declarative rule oracle over the frozen aggregate corpus."""
    cells = diagnostic_aggregate_cells(definition, supplied)
    results = []

    def operand(
        expression: dict, values: dict, path: str, coordinate: dict | None
    ) -> tuple:
        if expression["op"] == "constant":
            return expression["value"], [], []
        if expression["op"] == "measure":
            value = values.get(expression["measureId"])
            return value, ["missing"] if value is None else [], []
        parts = (
            expression["terms"]
            if expression["op"] == "add"
            else [expression["left"], expression["right"]]
        )
        paths = (
            [f"{path}/terms/{index}" for index in range(len(parts))]
            if expression["op"] == "add"
            else [f"{path}/left", f"{path}/right"]
        )
        children = [
            operand(child, values, child_path, coordinate)
            for child, child_path in zip(parts, paths)
        ]
        reasons = [
            reason
            for reason in ("missing", "expression-overflow")
            if any(reason in child[1] for child in children)
        ]
        overflows = [overflow for child in children for overflow in child[2]]
        if any(child[0] is None for child in children):
            return None, reasons, overflows
        value = (
            _compensated_sum([child[0] for child in children])
            if expression["op"] == "add"
            else children[0][0] - children[1][0]
        )
        if value is None or not math.isfinite(value):
            return (
                None,
                list(dict.fromkeys(reasons + ["expression-overflow"])),
                overflows
                + [{"expressionPath": path, "sources": [], "coordinate": coordinate}],
            )
        return value, reasons, overflows

    def record(rule: dict, left: tuple, right: tuple, scope: dict) -> None:
        reasons = [
            reason
            for reason in ("missing", "expression-overflow")
            if reason in left[1] + right[1]
        ]
        relation = None
        if not reasons:
            tolerance = rule["tolerance"]
            threshold = tolerance["absolute"] + tolerance["relative"] * max(
                1, abs(left[0]), abs(right[0])
            )
            if not math.isfinite(threshold):
                reasons = ["tolerance-overflow"]
            else:
                relation = (
                    "equal"
                    if abs(left[0] - right[0]) <= threshold
                    else "less" if left[0] < right[0] else "greater"
                )
        if reasons:
            status = (
                "triggered" if rule["missingInput"] == "finding" else "not-evaluated"
            )
            trigger = (
                ("missing-input" if "missing" in reasons else reasons[0])
                if status == "triggered"
                else None
            )
        else:
            if rule["kind"] == "compare":
                matches = {
                    "lt": relation == "less",
                    "lte": relation != "greater",
                    "eq": relation == "equal",
                    "neq": relation != "equal",
                    "gte": relation != "less",
                    "gt": relation == "greater",
                }
                passed = not matches[rule["when"]["operator"]]
            elif rule["kind"] in ("reconcile", "control-total"):
                passed = relation == "equal"
            elif rule["kind"] == "monotonic":
                passed = relation != (
                    "greater" if rule["direction"] == "nondecreasing" else "less"
                )
            else:
                passed = relation != "greater"
            status, trigger = ("pass", None) if passed else ("triggered", "predicate")
        result = {
            "ruleId": rule["id"],
            "ruleKind": rule["kind"],
            "severity": rule["severity"],
            "scope": scope,
            "status": status,
            "triggerReason": trigger,
            "left": left[0],
            "right": right[0],
            "relation": relation,
            "notEvaluatedReasons": reasons,
            "expressionOverflows": sorted(
                left[2] + right[2], key=lambda item: item["expressionPath"]
            ),
        }
        if rule["kind"] == "layer-order":
            result["comparability"] = rule["comparability"]
        results.append(result)

    for index, rule in enumerate(definition["reviewRules"]):
        base = f"/reviewRules/{index}"
        if rule["kind"] == "control-total":
            selected = cells
            selection = rule["filter"]
            if selection is not None:
                # The frozen corpus selects explicit groups. Refuse unsupported
                # selection rather than pretending to replay it.
                if any(
                    value is not None
                    for key, value in selection.items()
                    if key != "sourceGroups"
                ):
                    raise BadInterchangeError(
                        "unsupported aggregate conformance selection"
                    )
                if selection["sourceGroups"] is not None:
                    selected = [
                        cell
                        for cell in selected
                        if cell["coordinate"]["sourceGroup"]
                        in selection["sourceGroups"]
                    ]
            if rule["projection"]["kind"] == "latest-valuation-per-origin":
                latest = {
                    (
                        cell["coordinate"]["sourceGroup"],
                        cell["coordinate"]["origin"],
                    ): cell
                    for cell in selected
                }
                selected = list(latest.values())
            elif rule["projection"]["kind"] == "valuation":
                selected = [
                    cell
                    for cell in selected
                    if cell["coordinate"]["valuation"]
                    == rule["projection"]["valuation"]
                ]
            ids = _dependencies(rule["expression"])
            values = {
                measure: (
                    None
                    if not selected
                    or any(cell["values"].get(measure) is None for cell in selected)
                    else _compensated_sum(
                        [cell["values"][measure] for cell in selected]
                    )
                )
                for measure in ids
            }
            scope = {
                "kind": "control-total",
                "projection": rule["projection"],
                "filter": selection,
                "selectedCellCount": len(selected),
                "selectedContributionCount": len(selected) * len(ids),
                "sources": [],
            }
            record(
                rule,
                operand(rule["expression"], values, base + "/expression", None),
                (rule["expected"], [], []),
                scope,
            )
        elif rule["kind"] == "monotonic":
            for previous, current in zip(cells, cells[1:]):
                if any(
                    previous["coordinate"][key] != current["coordinate"][key]
                    for key in ("sourceGroup", "origin")
                ):
                    continue
                scope = {
                    "kind": "valuation-pair",
                    "previous": previous["coordinate"],
                    "current": current["coordinate"],
                    "sources": [],
                }
                record(
                    rule,
                    operand(
                        rule["expression"],
                        previous["values"],
                        base + "/expression",
                        previous["coordinate"],
                    ),
                    operand(
                        rule["expression"],
                        current["values"],
                        base + "/expression",
                        current["coordinate"],
                    ),
                    scope,
                )
        else:
            for cell in cells:
                if rule["kind"] == "compare":
                    left, right, left_path, right_path = (
                        rule["when"]["left"],
                        rule["when"]["right"],
                        "/when/left",
                        "/when/right",
                    )
                elif rule["kind"] == "reconcile":
                    left, right, left_path, right_path = (
                        rule["actual"],
                        rule["expected"],
                        "/actual",
                        "/expected",
                    )
                else:
                    left, right, left_path, right_path = (
                        rule["narrower"],
                        rule["broader"],
                        "/narrower",
                        "/broader",
                    )
                scope = {"kind": "cell", "cell": cell["coordinate"], "sources": []}
                record(
                    rule,
                    operand(left, cell["values"], base + left_path, cell["coordinate"]),
                    operand(
                        right, cell["values"], base + right_path, cell["coordinate"]
                    ),
                    scope,
                )
    return results
