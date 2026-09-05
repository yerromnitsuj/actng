import { describe, expect, it } from "vitest";
import { createDiagnosticEvidenceInterner } from "../src/diagnosticEvidenceIntern.js";
import {
  compileDiagnosticDefinition,
  evaluateDiagnosticReviewRules,
  getPreparedDiagnosticDataIdentity,
  prepareDiagnosticData,
  projectDiagnosticIdentity,
  type DiagnosticDefinition,
} from "../src/index.js";

// Independent pre-sharing projection for valid fixtures. Do not use JSON
// equality: it hides prototype, descriptor, key-order and signed-zero changes.
function referenceProjection(
  value: unknown,
  sourceSlot = false,
  freeJson = false,
): unknown {
  if (value === null || typeof value !== "object")
    return typeof value === "number" && Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value))
    return Object.freeze(
      value.map((child) => referenceProjection(child, sourceSlot, freeJson)),
    );
  const record = value as Record<string, unknown>;
  if (sourceSlot && typeof record.artifactId === "string")
    return Object.freeze({
      artifactId: record.artifactId,
      sourceFile: record.sourceFile ?? null,
      sourceSheet: record.sourceSheet ?? null,
      sourceRow: Object.is(record.sourceRow, -0)
        ? 0
        : (record.sourceRow ?? null),
      sourceCell: record.sourceCell ?? null,
    });
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(record).sort()) {
    const opaque =
      freeJson || key === "groupDimensions" || key === "dimensions";
    result[key] = referenceProjection(
      record[key],
      !opaque && (key === "source" || key === "sources"),
      opaque,
    );
  }
  return Object.freeze(result);
}

function expectExactStructure(actual: unknown, expected: unknown): void {
  if (expected === null || typeof expected !== "object") {
    expect(Object.is(actual, expected)).toBe(true);
    return;
  }
  expect(actual !== null && typeof actual === "object").toBe(true);
  const object = actual as object;
  expect(Object.getPrototypeOf(object)).toBe(Object.getPrototypeOf(expected));
  expect(Reflect.ownKeys(object)).toEqual(Reflect.ownKeys(expected));
  expect(Object.isFrozen(object)).toBe(Object.isFrozen(expected));
  for (const key of Reflect.ownKeys(expected)) {
    const left = Object.getOwnPropertyDescriptor(object, key)!;
    const right = Object.getOwnPropertyDescriptor(expected, key)!;
    expect(left.enumerable).toBe(right.enumerable);
    expect(left.configurable).toBe(right.configurable);
    expect(left.writable).toBe(right.writable);
    expect(left.get).toBe(right.get);
    expect(left.set).toBe(right.set);
    expectExactStructure(left.value, right.value);
  }
}

function objectsIn(value: unknown, objects = new Set<object>()): Set<object> {
  if (value === null || typeof value !== "object" || objects.has(value))
    return objects;
  objects.add(value);
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  ))
    if ("value" in descriptor) objectsIn(descriptor.value, objects);
  return objects;
}

function expectDisjoint(left: unknown, right: unknown): void {
  const rightObjects = objectsIn(right);
  for (const object of objectsIn(left))
    expect(rightObjects.has(object)).toBe(false);
}

function definition(unit: string): DiagnosticDefinition {
  return {
    diagnosticDefinitionVersion: "1.0.0",
    id: `intern-isolation-${unit}`,
    version: "1",
    lossRowGrain: "aggregate",
    measures: ["reported", "open"].map((id) => ({
      id,
      displayName: id,
      description: id,
      source: "loss",
      kind: "count",
      unit,
      developmentSemantics: "point-in-time",
      aggregation: "sum",
      missing: "unknown",
      countPopulationId: "population",
    })),
    countPopulations: [
      {
        id: "population",
        displayName: "Population",
        description: "Population",
        subject: "other",
        unit,
      },
    ],
    exposureBases: [],
    amountBases: [],
    derivedMeasures: [],
    formulas: [],
    instances: [],
    reviewRules: ["first", "second"].map((id) => ({
      kind: "compare",
      id,
      code: "open-exceeds-reported",
      description: "Open does not exceed reported",
      severity: "fail",
      missingInput: "not-evaluated",
      when: {
        left: { op: "measure", measureId: "open" },
        operator: "gt",
        right: { op: "measure", measureId: "reported" },
      },
    })),
    periodAxis: {
      kind: "calendar",
      originCadence: "year",
      valuationCadence: "year",
      originAnchor: "start",
      valuationAnchor: "end",
      ageUnit: "month",
      ageOffset: 0,
    },
  };
}

describe("private evidence sharing through public diagnostic boundaries", () => {
  it("normalizes an aliased object independently in source and free-JSON slots", () => {
    const source = { artifactId: "file", sourceRow: -0 };
    const input = {
      source,
      sources: [source, { artifactId: "file", sourceRow: 0 }],
      dimensions: { source, sources: [source] },
      groupDimensions: { all: { source } },
    };
    const actual = projectDiagnosticIdentity(input);
    expectExactStructure(actual, referenceProjection(input));
    expect(actual.source).not.toBe(actual.dimensions.source);
    expect(Object.getPrototypeOf(actual.source)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(actual.dimensions.source)).toBeNull();
    expect(actual.dimensions.source).not.toHaveProperty("sourceFile");
    expect(actual.source.sourceFile).toBeNull();
    expectDisjoint(actual, input);
    expect(Object.is(source.sourceRow, -0)).toBe(true);
  });

  it("does not let a valid opaque alias hide an invalid source occurrence", () => {
    const source = { artifactId: "file", futureEvidence: true };
    expect(() =>
      projectDiagnosticIdentity({ dimensions: { source }, source }),
    ).toThrowError(
      expect.objectContaining({
        issues: [
          {
            domain: "input",
            code: "unknown-key",
            path: "$.source.futureEvidence",
            message: "Unknown source-location key futureEvidence",
          },
        ],
      }),
    );
  });

  it("keeps absent/null distinctions while applying only existing zero normalization", () => {
    const input = {
      dimensions: [{}, { a: null }, { a: -0 }, { a: 0 }, { a: "0" }],
      sources: [
        { artifactId: "file" },
        { artifactId: "file", sourceFile: null },
      ],
    };
    const actual = projectDiagnosticIdentity(input);
    expectExactStructure(actual, referenceProjection(input));
    expect(actual.dimensions[0]).not.toBe(actual.dimensions[1]);
    expect(actual.dimensions[1]).not.toBe(actual.dimensions[2]);
    expect(actual.dimensions[3]).not.toBe(actual.dimensions[4]);
    expect(() =>
      projectDiagnosticIdentity({ dimensions: { a: undefined } }),
    ).toThrow();
    expect(() =>
      projectDiagnosticIdentity({ dimensions: { a: Number.NaN } }),
    ).toThrow();
    expect(() =>
      projectDiagnosticIdentity({
        dimensions: { a: Number.POSITIVE_INFINITY },
      }),
    ).toThrow();
  });

  it("owns every projected child even when the caller supplies a shallow-frozen root", () => {
    const child = { nested: { value: 1 }, list: [1, 2] };
    const input = Object.freeze({ dimensions: [child, child] });
    const first = projectDiagnosticIdentity(input);
    const second = projectDiagnosticIdentity(input);
    expectDisjoint(input, first);
    expectDisjoint(first, second);
    child.nested.value = 9;
    child.list.push(3);
    expect(first.dimensions[0]!.nested.value).toBe(1);
    expect(first.dimensions[0]!.list).toEqual([1, 2]);
    expect(Object.isFrozen(child)).toBe(false);
    expectExactStructure(first, second);
  });

  it("preserves exact projected structure for seeded mixed prototypes, keys and Unicode", () => {
    let seed = 0x912a75;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    const keys = [
      "a",
      "b",
      "__proto__",
      "constructor",
      "01",
      "2",
      "source",
      "sources",
      "é",
      "🌍",
    ];
    const leaves = [
      null,
      true,
      false,
      -0,
      0,
      1,
      -1,
      0.125,
      "",
      "a|b",
      '["a"]',
      "é🌍",
    ];
    const make = (depth: number): unknown => {
      if (depth === 0 || random() % 3 === 0)
        return leaves[random() % leaves.length];
      if (random() % 3 === 0) return [make(depth - 1), make(depth - 1)];
      const record = Object.create(
        random() % 2 ? Object.prototype : null,
      ) as Record<string, unknown>;
      for (let index = 0; index < 3; index++)
        Object.defineProperty(record, keys[random() % keys.length]!, {
          value: make(depth - 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      return record;
    };
    for (let index = 0; index < 100; index++) {
      const value = make(3);
      const input = { dimensions: [value, value] };
      const actual = projectDiagnosticIdentity(input);
      expectExactStructure(actual, referenceProjection(input));
      expectDisjoint(actual, input);
    }
  });

  it("does not invoke hostile accessors or hide cycles behind repeated content", () => {
    let calls = 0;
    const bad = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        calls++;
        throw new Error("Getter executed");
      },
    });
    expect(() =>
      projectDiagnosticIdentity({ dimensions: [{ value: 1 }, bad] }),
    ).toThrowError(
      expect.objectContaining({
        name: "DiagnosticValidationError",
        issues: [
          {
            domain: "input",
            code: "invalid-json-value",
            path: "$.dimensions[1].value",
            message: "JSON objects may contain only data properties",
          },
        ],
      }),
    );
    expect(calls).toBe(0);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() =>
      projectDiagnosticIdentity({ dimensions: [{ self: null }, cyclic] }),
    ).toThrowError(
      expect.objectContaining({
        name: "DiagnosticValidationError",
        issues: [
          {
            domain: "input",
            code: "cycle",
            path: "$.dimensions[1].self",
            message: "JSON value contains a cycle",
          },
        ],
      }),
    );
  });

  it("keeps preparations and identities separate across equal-valued definitions", () => {
    const prepare = (unit: string) =>
      prepareDiagnosticData({
        definition: compileDiagnosticDefinition(definition(unit)),
        losses: [
          {
            rowType: "aggregate",
            recordId: "r",
            sourceGroup: "all",
            origin: "2024",
            valuation: "2024",
            complete: true,
            measures: { reported: 5, open: 6 },
            source: { artifactId: "loss", sourceRow: 1 },
          },
        ],
        exposures: [],
      });
    const first = prepare("claim");
    const second = prepare("occurrence");
    expect(first.cells).toEqual(second.cells);
    expect(first.cells[0]).not.toBe(second.cells[0]);
    expectDisjoint(
      getPreparedDiagnosticDataIdentity(first),
      getPreparedDiagnosticDataIdentity(second),
    );
    const firstReview = evaluateDiagnosticReviewRules(first);
    const secondReview = evaluateDiagnosticReviewRules(second);
    expect(firstReview).toHaveLength(2);
    expect(firstReview.map((item) => item.ruleId)).toEqual(["first", "second"]);
    expect(firstReview.map((item) => item.status)).toEqual([
      "triggered",
      "triggered",
    ]);
    expectExactStructure(firstReview, secondReview);
    expect(evaluateDiagnosticReviewRules(first)).toEqual(firstReview);
  });
});

describe("private evidence interner adversarial structural equality", () => {
  it("shares finalized child graphs but never infers equality of unregistered children", () => {
    const pool = createDiagnosticEvidenceInterner();
    const child = pool.internOwned(Object.freeze({ value: 1 }), "plain");
    const equalChild = pool.internOwned(Object.freeze({ value: 1 }), "plain");
    expect(equalChild).toBe(child);
    const first = pool.internOwned(Object.freeze({ child }), "plain");
    expect(
      pool.internOwned(Object.freeze({ child: equalChild }), "plain"),
    ).toBe(first);
    expect(
      pool.internOwned(
        Object.freeze({ child: Object.freeze({ value: 1 }) }),
        "plain",
      ),
    ).not.toBe(first);
  });

  it("separates mode, prototype, insertion order, descriptors and array shape", () => {
    const pool = createDiagnosticEvidenceInterner();
    const base = Object.freeze({ a: 1, b: 2 });
    const candidates = [
      base,
      Object.freeze({ b: 2, a: 1 }),
      Object.freeze(Object.assign(Object.create(null), { a: 1, b: 2 })),
      Object.freeze(
        Object.defineProperties(
          {},
          {
            a: { value: 1, enumerable: false },
            b: { value: 2, enumerable: true },
          },
        ),
      ),
      Object.freeze([1, 2]),
      Object.freeze({ 0: 1, 1: 2, length: 2 }),
      Object.freeze([1, 2, 3]),
    ];
    const shared = candidates.map((candidate) =>
      pool.internOwned(candidate, "plain"),
    );
    expect(new Set(shared).size).toBe(candidates.length);
    for (let index = 0; index < candidates.length; index++)
      expectExactStructure(shared[index], candidates[index]);
    expect(pool.internOwned(Object.freeze({ a: 1, b: 2 }), "plain")).toBe(base);
    expect(pool.internOwned(Object.freeze({ a: 1, b: 2 }), "source")).not.toBe(
      base,
    );
    expect(pool.internOwned(Object.freeze({ a: 1, b: 2 }), "free")).not.toBe(
      base,
    );
  });

  it("uses unambiguous typed signatures for adversarial strings and scalar values", () => {
    const pool = createDiagnosticEvidenceInterner();
    const leaves = [
      null,
      undefined,
      -0,
      0,
      "-0",
      "0",
      false,
      "false",
      1,
      "1",
      "null",
      "undefined",
      '["number",0]',
      'x\",[\"object\",1]',
      "a|b",
      "é🌍",
    ];
    const values: object[] = leaves.map((value) => Object.freeze({ value }));
    values.push(Object.freeze({}));
    const shared = values.map((value) => pool.internOwned(value, "plain"));
    expect(new Set(shared).size).toBe(values.length);
    for (let index = 0; index < leaves.length; index++)
      expect(
        pool.internOwned(Object.freeze({ value: leaves[index] }), "plain"),
      ).toBe(shared[index]);
    const split = pool.internOwned(Object.freeze({ a: "b|c" }), "plain");
    expect(pool.internOwned(Object.freeze({ "a|b": "c" }), "plain")).not.toBe(
      split,
    );
    const numericZero = pool.internOwned(Object.freeze({ "0": 0 }), "plain");
    expect(pool.internOwned(Object.freeze([0]), "plain")).not.toBe(numericZero);
  });

  it.each([
    { maxEntries: 0 },
    { maxSignatureCharacters: 0 },
    { maxCandidateProperties: 0 },
  ])("preserves output when a bounded pool declines sharing: %j", (options) => {
    const pool = createDiagnosticEvidenceInterner(options);
    const first = Object.freeze({ value: 1 });
    const second = Object.freeze({ value: 1 });
    expect(pool.internOwned(first, "plain")).toBe(first);
    expect(pool.internOwned(second, "plain")).toBe(second);
    expectExactStructure(first, second);
  });

  it("retains only eligible entries when the entry budget is exhausted", () => {
    const pool = createDiagnosticEvidenceInterner({ maxEntries: 1 });
    const first = pool.internOwned(Object.freeze({ value: 1 }), "plain");
    const second = Object.freeze({ value: 2 });
    expect(pool.internOwned(second, "plain")).toBe(second);
    expect(pool.internOwned(Object.freeze({ value: 1 }), "plain")).toBe(first);
    const third = Object.freeze({ value: 2 });
    expect(pool.internOwned(third, "plain")).toBe(third);
    expectExactStructure(second, third);
  });

  it("declines unsupported or unfinished candidates without invoking their accessors", () => {
    const pool = createDiagnosticEvidenceInterner();
    let calls = 0;
    const getter = Object.freeze(
      Object.defineProperty({}, "value", {
        enumerable: true,
        get() {
          calls++;
          throw new Error("Getter executed");
        },
      }),
    );
    const mutable = { value: 1 };
    const shallow = Object.freeze({ child: { value: 1 } });
    const symbol = Object.freeze({ [Symbol("value")]: 1 });
    const custom = Object.freeze(Object.create({ value: 1 }));
    const oversized = Object.freeze({ value: "x".repeat(5000) });
    for (const value of [
      getter,
      mutable,
      shallow,
      symbol,
      custom,
      oversized,
      Object.freeze({ value: Number.NaN }),
      Object.freeze({ value: Number.POSITIVE_INFINITY }),
    ])
      expect(pool.internOwned(value, "plain")).toBe(value);
    expect(calls).toBe(0);
    expect(Object.isFrozen(shallow.child)).toBe(false);
  });

  it("does not share children between separate pools", () => {
    const firstPool = createDiagnosticEvidenceInterner();
    const secondPool = createDiagnosticEvidenceInterner();
    const first = firstPool.internOwned(Object.freeze({ value: 1 }), "plain");
    const second = secondPool.internOwned(Object.freeze({ value: 1 }), "plain");
    expect(first).not.toBe(second);
    expectExactStructure(first, second);
  });
});
