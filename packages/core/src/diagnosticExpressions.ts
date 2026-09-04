import type {
  DiagnosticValidationIssue,
  DiagnosticValidationIssueCode,
} from "./types.js";
import {
  isDiagnosticPlainRecord,
  isDiagnosticToken,
} from "./diagnosticRuntime.js";

export const MAX_DIAGNOSTIC_EXPRESSION_DEPTH = 64;
export const MAX_DIAGNOSTIC_EXPRESSION_NODES = 10_000;
export const MAX_DIAGNOSTIC_DEFINITION_EXPRESSION_NODES = 100_000;

export type DiagnosticMeasureExpression =
  | { op: "measure"; measureId: string }
  | { op: "add"; terms: readonly DiagnosticMeasureExpression[] }
  | {
      op: "subtract";
      left: DiagnosticMeasureExpression;
      right: DiagnosticMeasureExpression;
    };

export type DiagnosticRoleExpression =
  | { op: "role"; role: string }
  | { op: "add"; terms: readonly DiagnosticRoleExpression[] }
  | {
      op: "subtract";
      left: DiagnosticRoleExpression;
      right: DiagnosticRoleExpression;
    };

export type DiagnosticClaimExpression =
  | { op: "measure"; measureId: string }
  | { op: "add"; terms: readonly DiagnosticClaimExpression[] }
  | {
      op: "subtract";
      left: DiagnosticClaimExpression;
      right: DiagnosticClaimExpression;
    }
  | {
      op: "claim-layer";
      measureId: string;
      attachment: number;
      /** Layer width; null means unlimited above attachment. */
      limit: number | null;
    };

export type DiagnosticExpressionKind = "measure" | "role" | "claim";

export interface DiagnosticExpressionWalk {
  readonly dependencies: readonly string[];
  readonly nodeCount: number;
  readonly maxDepth: number;
}

interface WalkFrame {
  readonly value: unknown;
  readonly path: string;
  readonly depth: number;
  readonly ancestors: readonly object[];
}

function issue(
  issues: DiagnosticValidationIssue[],
  code: DiagnosticValidationIssueCode,
  path: string,
  message: string,
): void {
  issues.push({ domain: "definition", code, path, message });
}

function propertyPath(parent: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: DiagnosticValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      issue(
        issues,
        "unknown-key",
        propertyPath(path, key),
        `Unknown expression key ${key}`,
      );
    }
  }
}

/**
 * Iterative structural/resource walk used before recursive normalization. It
 * deliberately accepts unknown so hostile inputs cannot overflow the host
 * stack before the compiler can return a typed issue.
 */
export function walkDiagnosticExpression(
  value: unknown,
  kind: DiagnosticExpressionKind,
  path: string,
  issues: DiagnosticValidationIssue[],
): DiagnosticExpressionWalk {
  const dependencies = new Set<string>();
  const stack: WalkFrame[] = [{ value, path, depth: 1, ancestors: [] }];
  let nodeCount = 0;
  let maxDepth = 0;
  while (stack.length > 0) {
    const frame = stack.pop()!;
    nodeCount++;
    maxDepth = Math.max(maxDepth, frame.depth);
    if (frame.depth > MAX_DIAGNOSTIC_EXPRESSION_DEPTH) {
      issue(
        issues,
        "expression-limit",
        frame.path,
        `Expression depth exceeds ${MAX_DIAGNOSTIC_EXPRESSION_DEPTH}`,
      );
      continue;
    }
    if (nodeCount > MAX_DIAGNOSTIC_EXPRESSION_NODES) {
      issue(
        issues,
        "expression-limit",
        path,
        `Expression node count exceeds ${MAX_DIAGNOSTIC_EXPRESSION_NODES}`,
      );
      break;
    }
    if (!isDiagnosticPlainRecord(frame.value)) {
      issue(
        issues,
        "invalid-type",
        frame.path,
        "Expression node must be a plain object",
      );
      continue;
    }
    if (frame.ancestors.includes(frame.value)) {
      issue(issues, "cycle", frame.path, "Expression contains a cycle");
      continue;
    }
    const op = frame.value.op;
    const nextAncestors = [...frame.ancestors, frame.value];
    if (kind === "role" && op === "role") {
      rejectUnknownKeys(frame.value, ["op", "role"], frame.path, issues);
      if (isDiagnosticToken(frame.value.role))
        dependencies.add(frame.value.role);
      else
        issue(
          issues,
          typeof frame.value.role === "string"
            ? "invalid-string"
            : "invalid-type",
          `${frame.path}.role`,
          "Role reference must be a nonempty token",
        );
      continue;
    }
    if ((kind === "measure" || kind === "claim") && op === "measure") {
      rejectUnknownKeys(frame.value, ["op", "measureId"], frame.path, issues);
      if (isDiagnosticToken(frame.value.measureId))
        dependencies.add(frame.value.measureId);
      else
        issue(
          issues,
          typeof frame.value.measureId === "string"
            ? "invalid-string"
            : "invalid-type",
          `${frame.path}.measureId`,
          "Measure reference must be a nonempty token",
        );
      continue;
    }
    if (kind === "claim" && op === "claim-layer") {
      rejectUnknownKeys(
        frame.value,
        ["op", "measureId", "attachment", "limit"],
        frame.path,
        issues,
      );
      if (isDiagnosticToken(frame.value.measureId))
        dependencies.add(frame.value.measureId);
      else
        issue(
          issues,
          typeof frame.value.measureId === "string"
            ? "invalid-string"
            : "invalid-type",
          `${frame.path}.measureId`,
          "Measure reference must be a nonempty token",
        );
      continue;
    }
    if (op === "add") {
      rejectUnknownKeys(frame.value, ["op", "terms"], frame.path, issues);
      if (!Array.isArray(frame.value.terms) || frame.value.terms.length === 0) {
        issue(
          issues,
          "invalid-type",
          `${frame.path}.terms`,
          "Add expression requires at least one term",
        );
        continue;
      }
      for (let index = frame.value.terms.length - 1; index >= 0; index--) {
        stack.push({
          value: frame.value.terms[index],
          path: `${frame.path}.terms[${index}]`,
          depth: frame.depth + 1,
          ancestors: nextAncestors,
        });
      }
      continue;
    }
    if (op === "subtract") {
      rejectUnknownKeys(
        frame.value,
        ["op", "left", "right"],
        frame.path,
        issues,
      );
      stack.push({
        value: frame.value.right,
        path: `${frame.path}.right`,
        depth: frame.depth + 1,
        ancestors: nextAncestors,
      });
      stack.push({
        value: frame.value.left,
        path: `${frame.path}.left`,
        depth: frame.depth + 1,
        ancestors: nextAncestors,
      });
      continue;
    }
    issue(
      issues,
      "invalid-type",
      `${frame.path}.op`,
      `Unknown ${kind} expression operator`,
    );
  }
  return {
    dependencies: [...dependencies].sort(),
    nodeCount,
    maxDepth,
  };
}
