/** Descriptor expansion only: values and outcomes come from the shared JSON corpus. */
import type {
  DiagnosticDefinition,
  DiagnosticMeasureExpression,
  DiagnosticRoleExpression,
} from "@actuarial-ts/core";

export interface ResourceVector {
  readonly id: string;
  readonly dimension: "depth" | "nodes" | "definition";
  readonly size: number;
  readonly accept: boolean;
}

export function resourceDefinition(
  base: DiagnosticDefinition,
  vector: ResourceVector,
  root: string,
): DiagnosticDefinition {
  const definition = structuredClone(base);
  definition.formulas = [definition.formulas[0]!];
  const instance = {
    ...definition.instances[0]!,
    id: "resource-metric",
    formulaId: "amount-per-claim",
    bindings: {
      amount: { op: "measure", measureId: "gross-paid" },
      claims: { op: "measure", measureId: "reported" },
    },
    rules: [],
  } as DiagnosticDefinition["instances"][number];
  definition.instances = [instance];
  definition.reviewRules = [];
  definition.derivedMeasures = [];

  function expression(
    size: number,
    reference: "measure",
    name?: string,
  ): DiagnosticMeasureExpression;
  function expression(
    size: number,
    reference: "role",
    name: string,
  ): DiagnosticRoleExpression;
  function expression(
    size: number,
    reference: "measure" | "role",
    name = "gross-paid",
  ): DiagnosticMeasureExpression | DiagnosticRoleExpression {
    const leaf =
      reference === "role"
        ? { op: "role" as const, role: name }
        : { op: "measure" as const, measureId: name };
    let result: unknown = leaf;
    if (vector.dimension === "depth") {
      for (let index = 1; index < size; index++)
        result = { op: "add", terms: [result] };
    } else if (size > 1)
      result = {
        op: "add",
        terms: Array.from({ length: size - 1 }, () => ({ ...leaf })),
      };
    return result as DiagnosticMeasureExpression | DiagnosticRoleExpression;
  }

  if (vector.dimension === "definition") {
    // Two formula nodes + nine 10,000-node instances + the final remainder.
    definition.instances = Array.from({ length: 10 }, (_, index) => ({
      ...instance,
      id: `resource-metric-${index}`,
      bindings: {
        ...instance.bindings,
        amount: expression(index < 9 ? 9999 : vector.size - 90003, "measure"),
      },
    }));
  } else if (root.startsWith("formula-")) {
    const field = root === "formula-numerator" ? "numerator" : "denominator";
    definition.formulas = [
      {
        ...definition.formulas[0]!,
        [field]: expression(
          vector.size,
          "role",
          field === "numerator" ? "amount" : "claims",
        ),
      },
    ];
  } else if (root === "instance-binding") {
    instance.bindings = {
      ...instance.bindings,
      amount: expression(vector.size, "measure"),
    };
  } else if (root === "claim-derivation") {
    definition.lossRowGrain = "claim";
    definition.measures = [
      ...definition.measures,
      {
        ...definition.measures.find((item) => item.id === "reported")!,
        id: "derived-probe",
        source: "derived",
      },
    ];
    definition.derivedMeasures = [
      {
        id: "probe",
        outputMeasureId: "derived-probe",
        expression: expression(vector.size, "measure", "reported"),
      },
    ];
  } else if (root === "review-rule") {
    definition.reviewRules = [
      {
        id: "probe",
        kind: "reconcile",
        code: "probe",
        description: "probe",
        severity: "warning",
        missingInput: "not-evaluated",
        tolerance: { absolute: 0, relative: 0 },
        actual: expression(vector.size, "measure"),
        expected: { op: "constant", value: 0 },
      },
    ];
  } else {
    instance.rules = [
      {
        id: "probe",
        code: "probe",
        message: "probe",
        severity: "warning",
        when: {
          left: {
            source: "measure",
            expression: expression(vector.size - 1, "measure"),
          },
          operator: "gt",
          right: { source: "constant", value: 0 },
          tolerance: { absolute: 0, relative: 0 },
        },
      },
    ];
  }
  return definition;
}
