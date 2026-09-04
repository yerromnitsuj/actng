import type {
  DiagnosticValidationDomain,
  DiagnosticValidationIssue,
} from "./types.js";

export const MAX_DIAGNOSTIC_JSON_DEPTH = 256;
export const MAX_DIAGNOSTIC_JSON_NODES = 1_000_000;

/** True only for ordinary data records, including deliberately prototype-free records. */
export function isDiagnosticPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Own-property lookup which remains correct for every legal string key. */
export function hasDiagnosticOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** Creates a record in which `__proto__`, `constructor`, and `toString` are ordinary keys. */
export function diagnosticRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export function normalizeDiagnosticNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

/** Rejects U+0000 and unpaired UTF-16 surrogate code units. */
export function isWellFormedDiagnosticString(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index++;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

export function isDiagnosticToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    isWellFormedDiagnosticString(value) &&
    value.length > 0 &&
    !/^[\u0009-\u000d\u0020]|[\u0009-\u000d\u0020]$/.test(value)
  );
}

/** Strict Gregorian date validation for public SDK date boundaries. */
export function isRealIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !isWellFormedDiagnosticString(value))
    return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1)
    return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1]!;
}

interface JsonFrame {
  readonly value: unknown;
  readonly path: string;
  readonly depth: number;
  readonly exiting: boolean;
}

/**
 * Iterative JSON boundary preflight. It never invokes getters and reports
 * malformed values before recursive normalization or hashing can run.
 */
export function diagnosticJsonPreflight(
  value: unknown,
  domain: DiagnosticValidationDomain,
  options: { readonly maxDepth?: number; readonly maxNodes?: number } = {},
): readonly DiagnosticValidationIssue[] {
  const maxDepth = options.maxDepth ?? MAX_DIAGNOSTIC_JSON_DEPTH;
  const maxNodes = options.maxNodes ?? MAX_DIAGNOSTIC_JSON_NODES;
  const issues: DiagnosticValidationIssue[] = [];
  const active = new WeakSet<object>();
  const stack: JsonFrame[] = [{ value, path: "$", depth: 1, exiting: false }];
  let nodes = 0;
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.exiting) {
      active.delete(frame.value as object);
      continue;
    }
    nodes++;
    if (nodes > maxNodes) {
      issues.push({
        domain,
        code: "expression-limit",
        path: "$",
        message: `JSON node count exceeds ${maxNodes}`,
      });
      break;
    }
    if (frame.depth > maxDepth) {
      issues.push({
        domain,
        code: "expression-limit",
        path: frame.path,
        message: `JSON depth exceeds ${maxDepth}`,
      });
      continue;
    }
    const item = frame.value;
    if (item === null || typeof item === "boolean") continue;
    if (typeof item === "string") {
      if (!isWellFormedDiagnosticString(item))
        issues.push({
          domain,
          code: "invalid-json-value",
          path: frame.path,
          message: "String is not well-formed UTF-16 or contains U+0000",
        });
      continue;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item))
        issues.push({
          domain,
          code: "invalid-json-value",
          path: frame.path,
          message: "JSON numeric value must be finite",
        });
      continue;
    }
    if (typeof item !== "object") {
      issues.push({
        domain,
        code: "invalid-json-value",
        path: frame.path,
        message: "Value is not plain JSON data",
      });
      continue;
    }
    if (!Array.isArray(item) && !isDiagnosticPlainRecord(item)) {
      issues.push({
        domain,
        code: "invalid-json-value",
        path: frame.path,
        message: "Value must use a plain object or array prototype",
      });
      continue;
    }
    if (active.has(item)) {
      issues.push({
        domain,
        code: "cycle",
        path: frame.path,
        message: "JSON value contains a cycle",
      });
      continue;
    }
    active.add(item);
    stack.push({ ...frame, exiting: true });
    if (Array.isArray(item)) {
      for (let index = item.length - 1; index >= 0; index--) {
        stack.push({
          value: item[index],
          path: `${frame.path}[${index}]`,
          depth: frame.depth + 1,
          exiting: false,
        });
      }
      continue;
    }
    for (const key of Object.keys(item).sort().reverse()) {
      const path = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
        ? `${frame.path}.${key}`
        : `${frame.path}[${JSON.stringify(key)}]`;
      if (!isWellFormedDiagnosticString(key))
        issues.push({
          domain,
          code: "invalid-json-value",
          path,
          message: "Object key is not well-formed UTF-16 or contains U+0000",
        });
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !("value" in descriptor)) {
        issues.push({
          domain,
          code: "invalid-json-value",
          path,
          message: "JSON objects may contain only data properties",
        });
      } else {
        stack.push({
          value: descriptor.value,
          path,
          depth: frame.depth + 1,
          exiting: false,
        });
      }
    }
  }
  return issues;
}

/** Snapshot JSON-shaped data into owned, deeply frozen arrays/null-prototype records. */
export function snapshotDiagnosticJson<T>(value: T): T {
  const issues = diagnosticJsonPreflight(value, "input");
  if (issues.length > 0) throw new TypeError(issues[0]!.message);
  const clone = (item: unknown): unknown => {
    if (item === null || typeof item !== "object") {
      return typeof item === "number" ? normalizeDiagnosticNumber(item) : item;
    }
    if (Array.isArray(item)) return Object.freeze(item.map(clone));
    const result = diagnosticRecord<unknown>();
    for (const key of Object.keys(item).sort()) {
      result[key] = clone((item as Record<string, unknown>)[key]);
    }
    return Object.freeze(result);
  };
  return clone(value) as T;
}
