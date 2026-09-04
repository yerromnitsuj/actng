import {
  getCompiledDiagnosticDefinitionInternals,
  type DiagnosticControlTotalProjection,
  type DiagnosticDeepReadonly,
  type DiagnosticReviewFilter,
  type DiagnosticReviewRule,
  type DiagnosticSourceLocation,
} from "./diagnosticDefinitions.js";
import type { NormalizedDiagnosticReviewFilterIdentity } from "./diagnosticIdentity.js";
import { canonicalJson } from "./canonical.js";
import { normalizeDiagnosticPeriod } from "./diagnosticPeriods.js";
import {
  evaluateDiagnosticMeasureExpression,
  type FinalizedDiagnosticMeasure,
} from "./diagnosticFormulas.js";
import {
  assertPreparedDiagnosticData,
  type PreparedDiagnosticData,
} from "./diagnosticPreparation.js";
import {
  classifyDiagnosticComparison,
  diagnosticPredicateMatches,
  type DiagnosticExpressionOverflow,
  type DiagnosticRuleNotEvaluatedReason,
} from "./diagnosticRules.js";
import { finalizeDiagnosticContributions } from "./diagnosticAggregation.js";
import {
  compareDiagnosticSourceLocations,
  normalizeDiagnosticSourceLocations,
} from "./diagnosticSourceOrdering.js";

export interface DiagnosticReviewCoordinate {
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation: string;
  readonly developmentAge: number;
  readonly ageUnit: string;
}

export type DiagnosticCellReviewScope = {
  readonly kind: "cell";
  readonly cell: DiagnosticReviewCoordinate;
  readonly sources: readonly DiagnosticSourceLocation[];
};
export type DiagnosticValuationPairReviewScope = {
  readonly kind: "valuation-pair";
  readonly previous: DiagnosticReviewCoordinate;
  readonly current: DiagnosticReviewCoordinate;
  readonly sources: readonly DiagnosticSourceLocation[];
};
export type DiagnosticControlTotalReviewScope = {
  readonly kind: "control-total";
  readonly projection: DiagnosticDeepReadonly<DiagnosticControlTotalProjection>;
  readonly filter: NormalizedDiagnosticReviewFilterIdentity | null;
  readonly selectedCellCount: number;
  readonly selectedContributionCount: number;
  readonly sources: readonly DiagnosticSourceLocation[];
};

export type DiagnosticReviewEvaluationScope =
  | DiagnosticCellReviewScope
  | DiagnosticValuationPairReviewScope
  | DiagnosticControlTotalReviewScope;

export interface DiagnosticReviewExpressionOverflow
  extends DiagnosticExpressionOverflow {
  readonly coordinate: DiagnosticReviewCoordinate | null;
}

interface DiagnosticReviewRuleEvaluationBase {
  readonly ruleId: string;
  readonly ruleKind: DiagnosticReviewRule["kind"];
  readonly status: "pass" | "triggered" | "not-evaluated";
  readonly severity: "warning" | "fail";
  readonly triggerReason:
    | "predicate"
    | "missing-input"
    | "aggregation-overflow"
    | "expression-overflow"
    | "tolerance-overflow"
    | null;
  readonly left: number | null;
  readonly right: number | null;
  readonly relation: "less" | "equal" | "greater" | null;
  readonly notEvaluatedReasons: readonly DiagnosticRuleNotEvaluatedReason[];
  readonly expressionOverflows: readonly DiagnosticReviewExpressionOverflow[];
  readonly scope: DiagnosticReviewEvaluationScope;
}

export type DiagnosticReviewRuleEvaluation =
  | (DiagnosticReviewRuleEvaluationBase & {
      readonly ruleKind: "compare" | "reconcile";
      readonly scope: DiagnosticCellReviewScope;
    })
  | (DiagnosticReviewRuleEvaluationBase & {
      readonly ruleKind: "monotonic";
      readonly scope: DiagnosticValuationPairReviewScope;
    })
  | (DiagnosticReviewRuleEvaluationBase & {
      readonly ruleKind: "layer-order";
      readonly scope: DiagnosticCellReviewScope;
      readonly comparability: Extract<
        DiagnosticReviewRule,
        { kind: "layer-order" }
      >["comparability"];
    })
  | (DiagnosticReviewRuleEvaluationBase & {
      readonly ruleKind: "control-total";
      readonly scope: DiagnosticControlTotalReviewScope;
    });

interface EvaluatedOperand {
  readonly value: number | null;
  readonly reasons: readonly DiagnosticRuleNotEvaluatedReason[];
  readonly overflows: readonly DiagnosticReviewExpressionOverflow[];
  readonly sources: readonly DiagnosticSourceLocation[];
}

const REASON_ORDER: readonly DiagnosticRuleNotEvaluatedReason[] = [
  "missing",
  "imputed",
  "non-finite",
  "structural-ambiguity",
  "aggregation-overflow",
  "expression-overflow",
  "tolerance-overflow",
];

function codeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueReasons(
  values: readonly DiagnosticRuleNotEvaluatedReason[],
): DiagnosticRuleNotEvaluatedReason[] {
  return REASON_ORDER.filter((reason) => values.includes(reason));
}

function uniqueSources(
  values: readonly DiagnosticSourceLocation[],
): DiagnosticSourceLocation[] {
  return normalizeDiagnosticSourceLocations(values);
}

function expressionMeasureIds(
  expression: import("./diagnosticExpressions.js").DiagnosticMeasureExpression,
): string[] {
  if (expression.op === "measure") return [expression.measureId];
  return [
    ...new Set(
      (expression.op === "add"
        ? expression.terms
        : [expression.left, expression.right]
      ).flatMap(expressionMeasureIds),
    ),
  ].sort(codeUnit);
}

function expressionLeafPaths(
  expression: import("./diagnosticExpressions.js").DiagnosticMeasureExpression,
  path: string,
): readonly { readonly measureId: string; readonly expressionPath: string }[] {
  if (expression.op === "measure")
    return [{ measureId: expression.measureId, expressionPath: path }];
  if (expression.op === "add")
    return expression.terms.flatMap((term, index) =>
      expressionLeafPaths(term, `${path}/terms/${index}`),
    );
  return [
    ...expressionLeafPaths(expression.left, `${path}/left`),
    ...expressionLeafPaths(expression.right, `${path}/right`),
  ];
}

function states(
  prepared: PreparedDiagnosticData,
  cell: PreparedDiagnosticData["cells"][number],
): Record<string, FinalizedDiagnosticMeasure> {
  const internals = getCompiledDiagnosticDefinitionInternals(
    prepared.definition,
  );
  return Object.fromEntries(
    Object.entries(cell.components).map(([id, stats]) => {
      const measure = internals.measuresById.get(id)!;
      const readiness: DiagnosticRuleNotEvaluatedReason[] = [];
      if (stats.missing)
        readiness.push(stats.imputedZero ? "imputed" : "missing");
      if (stats.nonFinite) readiness.push("non-finite");
      if (stats.structural) readiness.push("structural-ambiguity");
      if (stats.sum === null && !stats.nonFinite && !stats.structural)
        readiness.push("aggregation-overflow");
      return [
        id,
        {
          quantity: {
            kind: measure.kind,
            unit: measure.unit,
            ...(measure.basisId ? { basisId: measure.basisId } : {}),
            ...(measure.countPopulationId
              ? { countPopulationId: measure.countPopulationId }
              : {}),
            ...(measure.exposureBasisId
              ? { exposureBasisId: measure.exposureBasisId }
              : {}),
            value: stats.value,
          },
          stats,
          readiness,
          sources: cellSources(cell, [id]),
        },
      ];
    }),
  );
}

function coordinate(
  cell: PreparedDiagnosticData["cells"][number],
): DiagnosticReviewCoordinate {
  return {
    sourceGroup: cell.sourceGroup,
    origin: cell.origin,
    valuation: cell.valuation,
    developmentAge: cell.developmentAge,
    ageUnit: cell.ageUnit,
  };
}

function coordinateFromLabels(
  prepared: PreparedDiagnosticData,
  sourceGroup: string,
  originLabel: string,
  valuationLabel: string,
): DiagnosticReviewCoordinate {
  const origin = normalizeDiagnosticPeriod(
    prepared.definition,
    "origin",
    originLabel,
  );
  const valuation = normalizeDiagnosticPeriod(
    prepared.definition,
    "valuation",
    valuationLabel,
  );
  return {
    sourceGroup,
    origin: origin.label,
    valuation: valuation.label,
    developmentAge:
      valuation.coordinate -
      origin.coordinate +
      prepared.definition.definition.periodAxis.ageOffset,
    ageUnit: prepared.definition.definition.periodAxis.ageUnit,
  };
}

function cellSources(
  cell: PreparedDiagnosticData["cells"][number],
  measureIds?: readonly string[],
): DiagnosticSourceLocation[] {
  const ids = measureIds ?? Object.keys(cell.contributions);
  return uniqueSources(
    ids.flatMap((measureId) => [
      ...(cell.contributions[measureId] ?? []).flatMap(
        (contribution) => contribution.sources,
      ),
      ...(cell.structuralBlockers[measureId] ?? []).flatMap(
        (blocker) => blocker.sources,
      ),
    ]),
  );
}

function cellSourcesForSelection(
  cells: readonly PreparedDiagnosticData["cells"][number][],
  measureId: string,
): DiagnosticSourceLocation[] {
  return uniqueSources(
    cells.flatMap((cell) => [
      ...(cell.contributions[measureId] ?? []).flatMap(
        (contribution) => contribution.sources,
      ),
      ...(cell.structuralBlockers[measureId] ?? []).flatMap(
        (blocker) => blocker.sources,
      ),
    ]),
  );
}

function evaluateExpression(
  prepared: PreparedDiagnosticData,
  cell: PreparedDiagnosticData["cells"][number],
  expression: import("./diagnosticExpressions.js").DiagnosticMeasureExpression,
  path: string,
): EvaluatedOperand {
  const result = evaluateDiagnosticMeasureExpression(
    expression,
    states(prepared, cell),
    path,
  );
  const sources = cellSources(cell, expressionMeasureIds(expression));
  return {
    value: result.value,
    reasons: result.reasons,
    overflows: result.overflows.map((overflow) => ({
      ...overflow,
      coordinate: coordinate(cell),
      sources,
    })),
    sources,
  };
}

function constant(value: number): EvaluatedOperand {
  return { value, reasons: [], overflows: [], sources: [] };
}

function evaluation(
  prepared: PreparedDiagnosticData,
  rule: DiagnosticReviewRule,
  scope: DiagnosticReviewEvaluationScope,
  left: EvaluatedOperand,
  right: EvaluatedOperand,
  passes: (relation: "less" | "equal" | "greater") => boolean,
  extraReasons: readonly DiagnosticRuleNotEvaluatedReason[] = [],
): DiagnosticReviewRuleEvaluation {
  const expressionOverflows = [
    ...new Map(
      [...left.overflows, ...right.overflows].map((item) => [
        canonicalJson(item),
        item,
      ]),
    ).values(),
  ].sort((a, b) => {
    const path = codeUnit(a.expressionPath, b.expressionPath);
    if (path !== 0) return path;
    if (a.coordinate === null) return b.coordinate === null ? 0 : 1;
    if (b.coordinate === null) return -1;
    const coordinate =
      codeUnit(a.coordinate.sourceGroup, b.coordinate.sourceGroup) ||
      normalizeDiagnosticPeriod(
        prepared.definition,
        "origin",
        a.coordinate.origin,
      ).coordinate -
        normalizeDiagnosticPeriod(
          prepared.definition,
          "origin",
          b.coordinate.origin,
        ).coordinate ||
      normalizeDiagnosticPeriod(
        prepared.definition,
        "valuation",
        a.coordinate.valuation,
      ).coordinate -
        normalizeDiagnosticPeriod(
          prepared.definition,
          "valuation",
          b.coordinate.valuation,
        ).coordinate ||
      codeUnit(a.coordinate.origin, b.coordinate.origin) ||
      codeUnit(a.coordinate.valuation, b.coordinate.valuation);
    if (coordinate !== 0) return coordinate;
    for (
      let index = 0;
      index < Math.min(a.sources.length, b.sources.length);
      index++
    ) {
      const source = compareDiagnosticSourceLocations(
        a.sources[index]!,
        b.sources[index]!,
      );
      if (source !== 0) return source;
    }
    return a.sources.length - b.sources.length;
  });
  const reasons = uniqueReasons([
    ...left.reasons,
    ...right.reasons,
    ...extraReasons,
    ...(expressionOverflows.length > 0 ? ["expression-overflow" as const] : []),
    ...((left.value === null || right.value === null) &&
    left.reasons.length === 0 &&
    right.reasons.length === 0 &&
    expressionOverflows.length === 0
      ? ["missing" as const]
      : []),
  ]);
  const missingReason = (): DiagnosticReviewRuleEvaluation["triggerReason"] => {
    if (
      reasons.some((reason) =>
        ["missing", "imputed", "non-finite", "structural-ambiguity"].includes(
          reason,
        ),
      )
    )
      return "missing-input";
    if (reasons.includes("aggregation-overflow")) return "aggregation-overflow";
    if (reasons.includes("expression-overflow")) return "expression-overflow";
    if (reasons.includes("tolerance-overflow")) return "tolerance-overflow";
    return "missing-input";
  };
  const result = (
    value: Omit<
      DiagnosticReviewRuleEvaluationBase,
      "ruleId" | "ruleKind" | "severity" | "scope"
    >,
  ): DiagnosticReviewRuleEvaluation =>
    ({
      ruleId: rule.id,
      ruleKind: rule.kind,
      severity: rule.severity,
      scope,
      ...value,
      ...(rule.kind === "layer-order"
        ? { comparability: rule.comparability }
        : {}),
    }) as DiagnosticReviewRuleEvaluation;
  if (reasons.length > 0)
    return result({
      status: rule.missingInput === "finding" ? "triggered" : "not-evaluated",
      triggerReason: rule.missingInput === "finding" ? missingReason() : null,
      left: left.value,
      right: right.value,
      relation: null,
      notEvaluatedReasons: reasons,
      expressionOverflows,
    });
  const compared = classifyDiagnosticComparison(
    left.value,
    right.value,
    rule.tolerance,
  );
  if (compared.status === "not-evaluated")
    return result({
      status: rule.missingInput === "finding" ? "triggered" : "not-evaluated",
      triggerReason:
        rule.missingInput === "finding"
          ? compared.reason === "tolerance-overflow"
            ? "tolerance-overflow"
            : "missing-input"
          : null,
      left: left.value,
      right: right.value,
      relation: null,
      notEvaluatedReasons: [compared.reason],
      expressionOverflows: [],
    });
  const pass = passes(compared.relation);
  return result({
    status: pass ? "pass" : "triggered",
    triggerReason: pass ? null : "predicate",
    left: left.value,
    right: right.value,
    relation: compared.relation,
    notEvaluatedReasons: [],
    expressionOverflows: [],
  });
}

function filterCells(
  prepared: PreparedDiagnosticData,
  filter: DiagnosticReviewFilter | null | undefined,
): readonly PreparedDiagnosticData["cells"][number][] {
  if (!filter) return prepared.cells;
  const originFrom =
    filter.originFrom == null
      ? null
      : normalizeDiagnosticPeriod(
          prepared.definition,
          "origin",
          filter.originFrom,
        ).coordinate;
  const originThrough =
    filter.originThrough == null
      ? null
      : normalizeDiagnosticPeriod(
          prepared.definition,
          "origin",
          filter.originThrough,
        ).coordinate;
  const valuationFrom =
    filter.valuationFrom == null
      ? null
      : normalizeDiagnosticPeriod(
          prepared.definition,
          "valuation",
          filter.valuationFrom,
        ).coordinate;
  const valuationThrough =
    filter.valuationThrough == null
      ? null
      : normalizeDiagnosticPeriod(
          prepared.definition,
          "valuation",
          filter.valuationThrough,
        ).coordinate;
  return prepared.cells.filter((cell) => {
    const origin = normalizeDiagnosticPeriod(
      prepared.definition,
      "origin",
      cell.origin,
    ).coordinate;
    const valuation = normalizeDiagnosticPeriod(
      prepared.definition,
      "valuation",
      cell.valuation,
    ).coordinate;
    return (
      (filter.sourceGroups == null ||
        filter.sourceGroups.includes(cell.sourceGroup)) &&
      (filter.origins == null || filter.origins.includes(cell.origin)) &&
      (originFrom === null || origin >= originFrom) &&
      (originThrough === null || origin <= originThrough) &&
      (filter.valuations == null ||
        filter.valuations.includes(cell.valuation)) &&
      (valuationFrom === null || valuation >= valuationFrom) &&
      (valuationThrough === null || valuation <= valuationThrough) &&
      (filter.minDevelopmentAge == null ||
        cell.developmentAge >= filter.minDevelopmentAge) &&
      (filter.maxDevelopmentAge == null ||
        cell.developmentAge <= filter.maxDevelopmentAge)
    );
  });
}

function projectedCells(
  prepared: PreparedDiagnosticData,
  rule: Extract<DiagnosticReviewRule, { kind: "control-total" }>,
): readonly PreparedDiagnosticData["cells"][number][] {
  const selected = filterCells(prepared, rule.filter);
  if (rule.projection.kind === "all-cells") return selected;
  if (rule.projection.kind === "valuation") {
    const valuation = normalizeDiagnosticPeriod(
      prepared.definition,
      "valuation",
      rule.projection.valuation,
    ).label;
    return selected.filter((cell) => cell.valuation === valuation);
  }
  const latest = new Map<string, PreparedDiagnosticData["cells"][number]>();
  for (const cell of selected) {
    const key = canonicalJson([cell.sourceGroup, cell.origin]);
    const previous = latest.get(key);
    if (!previous || cell.developmentAge > previous.developmentAge)
      latest.set(key, cell);
  }
  return [...latest.values()].sort(
    (left, right) =>
      codeUnit(left.sourceGroup, right.sourceGroup) ||
      codeUnit(left.origin, right.origin),
  );
}

/** Evaluates definition-owned semantic review rules over authenticated prepared cells. */
export function evaluateDiagnosticReviewRules(
  prepared: PreparedDiagnosticData,
): readonly DiagnosticReviewRuleEvaluation[] {
  assertPreparedDiagnosticData(prepared);
  const results: DiagnosticReviewRuleEvaluation[] = [];
  for (const [ruleIndex, rule] of (
    prepared.definition.definition
      .reviewRules as unknown as readonly DiagnosticReviewRule[]
  ).entries()) {
    const basePath = `/reviewRules/${ruleIndex}`;
    if (rule.kind === "control-total") {
      const cells = projectedCells(prepared, rule);
      const internals = getCompiledDiagnosticDefinitionInternals(
        prepared.definition,
      );
      const measureIds = expressionMeasureIds(rule.expression);
      const sourceByMeasure = Object.fromEntries(
        measureIds.map((measureId) => [
          measureId,
          cellSourcesForSelection(cells, measureId),
        ]),
      );
      const globalStates: Record<string, FinalizedDiagnosticMeasure> =
        Object.create(null);
      const leaves = expressionLeafPaths(
        rule.expression,
        `/reviewRules/${ruleIndex}/expression`,
      );
      for (const measureId of measureIds) {
        const measure = internals.measuresById.get(measureId)!;
        const contributions = cells.flatMap(
          (cell) => cell.contributions[measureId] ?? [],
        );
        const blockers = [
          ...new Map(
            cells
              .flatMap((cell) => cell.structuralBlockers[measureId] ?? [])
              .map((blocker) => [canonicalJson(blocker), blocker]),
          ).entries(),
        ]
          .sort(([left], [right]) => codeUnit(left, right))
          .map(([, blocker]) => blocker);
        const stats = finalizeDiagnosticContributions(
          contributions,
          measure.missing,
          blockers,
        );
        const sourceCellOverflow = cells.some((cell) => {
          const component = cell.components[measureId];
          return (
            component !== undefined &&
            component.sum === null &&
            component.nonFinite === 0 &&
            component.structural === 0
          );
        });
        const selectionOverflow =
          stats.sum === null && stats.nonFinite === 0 && stats.structural === 0;
        const emptySelection = cells.length === 0;
        const expressionOverflows =
          selectionOverflow && !sourceCellOverflow
            ? leaves
                .filter((leaf) => leaf.measureId === measureId)
                .map((leaf) => ({
                  expressionPath: leaf.expressionPath,
                  sources: sourceByMeasure[measureId]!,
                }))
            : [];
        const reasons: DiagnosticRuleNotEvaluatedReason[] = [];
        if (emptySelection || stats.missing)
          reasons.push(stats.imputedZero ? "imputed" : "missing");
        if (stats.nonFinite) reasons.push("non-finite");
        if (stats.structural) reasons.push("structural-ambiguity");
        if (sourceCellOverflow) reasons.push("aggregation-overflow");
        else if (selectionOverflow) reasons.push("expression-overflow");
        globalStates[measureId] = {
          quantity: {
            kind: measure.kind,
            unit: measure.unit,
            ...(measure.basisId ? { basisId: measure.basisId } : {}),
            ...(measure.countPopulationId
              ? { countPopulationId: measure.countPopulationId }
              : {}),
            ...(measure.exposureBasisId
              ? { exposureBasisId: measure.exposureBasisId }
              : {}),
            value:
              emptySelection || sourceCellOverflow || selectionOverflow
                ? null
                : stats.value,
          },
          stats,
          readiness: reasons,
          expressionOverflows,
          sources: sourceByMeasure[measureId],
        };
      }
      const evaluated = evaluateDiagnosticMeasureExpression(
        rule.expression,
        globalStates,
        `/reviewRules/${ruleIndex}/expression`,
      );
      const sources = uniqueSources(
        measureIds.flatMap((measureId) => sourceByMeasure[measureId] ?? []),
      );
      const left: EvaluatedOperand = {
        value: evaluated.value,
        reasons: evaluated.reasons,
        overflows: evaluated.overflows.map((overflow) => ({
          ...overflow,
          coordinate: null,
          sources: overflow.sources.length > 0 ? overflow.sources : sources,
        })),
        sources,
      };
      const scope: DiagnosticReviewEvaluationScope = {
        kind: "control-total",
        projection: rule.projection,
        filter: (rule.filter ??
          null) as NormalizedDiagnosticReviewFilterIdentity | null,
        selectedCellCount: cells.length,
        selectedContributionCount: cells.reduce(
          (sum, cell) =>
            sum +
            measureIds.reduce(
              (count, measureId) =>
                count + (cell.contributions[measureId]?.length ?? 0),
              0,
            ),
          0,
        ),
        sources,
      };
      results.push(
        evaluation(
          prepared,
          rule,
          scope,
          left,
          constant(rule.expected),
          (relation) => relation === "equal",
        ),
      );
      continue;
    }
    if (rule.kind === "monotonic") {
      const groups = new Map<string, Set<string>>();
      for (const cell of prepared.cells) {
        const key = canonicalJson([cell.sourceGroup, cell.origin]);
        const values = groups.get(key) ?? new Set<string>();
        values.add(cell.valuation);
        groups.set(key, values);
      }
      for (const expected of prepared.expectedCells) {
        const key = canonicalJson([expected.sourceGroup, expected.origin]);
        const values = groups.get(key) ?? new Set<string>();
        values.add(expected.valuation);
        groups.set(key, values);
      }
      for (const [key, valuations] of [...groups.entries()].sort(
        ([left], [right]) => codeUnit(left, right),
      )) {
        const [sourceGroup, origin] = JSON.parse(key) as [string, string];
        const sorted = [...valuations].sort(
          (left, right) =>
            normalizeDiagnosticPeriod(prepared.definition, "valuation", left)
              .coordinate -
              normalizeDiagnosticPeriod(prepared.definition, "valuation", right)
                .coordinate || codeUnit(left, right),
        );
        for (let index = 1; index < sorted.length; index++) {
          const previousValuation = sorted[index - 1]!;
          const currentValuation = sorted[index]!;
          const previous = prepared.cells.find(
            (cell) =>
              cell.sourceGroup === sourceGroup &&
              cell.origin === origin &&
              cell.valuation === previousValuation,
          );
          const current = prepared.cells.find(
            (cell) =>
              cell.sourceGroup === sourceGroup &&
              cell.origin === origin &&
              cell.valuation === currentValuation,
          );
          const expectedSources = (valuation: string) =>
            prepared.expectedCells
              .filter(
                (cell) =>
                  cell.sourceGroup === sourceGroup &&
                  cell.origin === origin &&
                  cell.valuation === valuation,
              )
              .flatMap((cell) => (cell.source ? [cell.source] : []));
          const left = previous
            ? evaluateExpression(
                prepared,
                previous,
                rule.expression,
                `${basePath}/expression`,
              )
            : {
                value: null,
                reasons: ["missing" as const],
                overflows: [],
                sources: uniqueSources(expectedSources(previousValuation)),
              };
          const right = current
            ? evaluateExpression(
                prepared,
                current,
                rule.expression,
                `${basePath}/expression`,
              )
            : {
                value: null,
                reasons: ["missing" as const],
                overflows: [],
                sources: uniqueSources(expectedSources(currentValuation)),
              };
          const scope: DiagnosticReviewEvaluationScope = {
            kind: "valuation-pair",
            previous: previous
              ? coordinate(previous)
              : coordinateFromLabels(
                  prepared,
                  sourceGroup,
                  origin,
                  previousValuation,
                ),
            current: current
              ? coordinate(current)
              : coordinateFromLabels(
                  prepared,
                  sourceGroup,
                  origin,
                  currentValuation,
                ),
            sources: uniqueSources([...left.sources, ...right.sources]),
          };
          results.push(
            evaluation(prepared, rule, scope, left, right, (relation) =>
              rule.direction === "nondecreasing"
                ? relation !== "greater"
                : relation !== "less",
            ),
          );
        }
      }
      continue;
    }
    for (const cell of prepared.cells) {
      const scopeFor = (
        sources: readonly DiagnosticSourceLocation[],
      ): DiagnosticCellReviewScope => ({
        kind: "cell",
        cell: coordinate(cell),
        sources: uniqueSources(sources),
      });
      if (rule.kind === "compare") {
        const operand = (item: typeof rule.when.left, path: string) =>
          item.op === "constant"
            ? constant(item.value)
            : evaluateExpression(prepared, cell, item, path);
        const left = operand(rule.when.left, `${basePath}/when/left`);
        const right = operand(rule.when.right, `${basePath}/when/right`);
        results.push(
          evaluation(
            prepared,
            rule,
            scopeFor([...left.sources, ...right.sources]),
            left,
            right,
            (relation) =>
              !diagnosticPredicateMatches(rule.when.operator, relation),
          ),
        );
      } else if (rule.kind === "reconcile") {
        const left = evaluateExpression(
          prepared,
          cell,
          rule.actual,
          `${basePath}/actual`,
        );
        const right =
          rule.expected.op === "constant"
            ? constant(rule.expected.value)
            : evaluateExpression(
                prepared,
                cell,
                rule.expected,
                `${basePath}/expected`,
              );
        results.push(
          evaluation(
            prepared,
            rule,
            scopeFor([...left.sources, ...right.sources]),
            left,
            right,
            (relation) => relation === "equal",
          ),
        );
      } else {
        const left = evaluateExpression(
          prepared,
          cell,
          rule.narrower,
          `${basePath}/narrower`,
        );
        const right = evaluateExpression(
          prepared,
          cell,
          rule.broader,
          `${basePath}/broader`,
        );
        results.push(
          evaluation(
            prepared,
            rule,
            scopeFor([...left.sources, ...right.sources]),
            left,
            right,
            (relation) => relation !== "greater",
          ),
        );
      }
    }
  }
  return deepFreeze(results);
}

function deepFreeze<T>(
  value: T,
  seen = new WeakSet<object>(),
): DiagnosticDeepReadonly<T> {
  if (value === null || typeof value !== "object" || seen.has(value))
    return value as DiagnosticDeepReadonly<T>;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>))
    deepFreeze(child, seen);
  return Object.freeze(value) as DiagnosticDeepReadonly<T>;
}
