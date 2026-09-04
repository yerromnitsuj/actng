import { describe, expect, it } from "vitest";
import {
  auditDiagnosticNumber,
  DiagnosticValidationError,
  reconcileDiagnosticExposures,
  type DiagnosticExposureObservation,
  type DiagnosticPeriodAxis,
} from "../src/index.js";

describe("diagnostic exposure reconciliation", () => {
  it("uses typed observation order and retains an owned source snapshot", () => {
    const source = { artifactId: "source", sourceRow: 2 };
    const records = [
      {
        key: "z",
        sourceGroup: "all",
        origin: "later",
        measureId: "a",
        value: 10,
        complete: true,
        source,
      },
      {
        key: "z",
        sourceGroup: "all",
        origin: "earlier",
        measureId: "a",
        value: 2,
        complete: true,
        source: { ...source, sourceRow: 10 },
      },
      {
        key: "a",
        sourceGroup: "all",
        origin: "earlier",
        measureId: "z",
        value: 1,
        complete: true,
      },
    ];
    const result = reconcileDiagnosticExposures(
      records,
      { a: "origin-static", z: "origin-static" },
      {
        kind: "ordered",
        id: "axis",
        version: "1",
        ageUnit: "step",
        ageOffset: 0,
        origins: [
          { label: "later", coordinate: 10 },
          { label: "earlier", coordinate: 2 },
        ],
        valuations: [],
      },
    );
    expect(result.map((item) => item.measureId)).toEqual(["a", "z"]);
    expect(result[0]).toMatchObject({
      status: "invalid",
      observations: [
        { origin: "earlier", value: { value: 2 } },
        { origin: "later", value: { value: 10 } },
      ],
    });
    source.sourceRow = 99;
    expect(result[0]).toMatchObject({
      observations: [
        { source: { sourceRow: 10 } },
        { source: { sourceRow: 2 } },
      ],
    });
    expect(Object.isFrozen(source)).toBe(false);
  });
  it("deduplicates equal origin-static copies without multiplying exposure", () => {
    const result = reconcileDiagnosticExposures(
      [
        {
          key: "fleet",
          sourceGroup: "book",
          origin: "2024",
          valuation: "2024",
          measureId: "earned",
          value: 100,
          complete: true,
        },
        {
          key: "fleet",
          sourceGroup: "book",
          origin: "2024",
          valuation: "2025",
          measureId: "earned",
          value: 100,
          complete: true,
        },
      ],
      { earned: "origin-static" },
    );
    expect(result).toEqual([
      {
        measureId: "earned",
        key: "fleet",
        status: "valid",
        sourceGroup: "book",
        origin: "2024",
        value: 100,
        deduplicated: 1,
        sources: [],
      },
    ]);
  });

  it("retains all applicable invalid reasons in fixed order", () => {
    const result = reconcileDiagnosticExposures(
      [
        {
          key: "fleet",
          sourceGroup: "book",
          origin: "2024",
          valuation: "2025",
          measureId: "inforce",
          value: null,
          complete: false,
        },
        {
          key: "fleet",
          sourceGroup: "other",
          origin: "2024",
          valuation: "2025",
          measureId: "inforce",
          value: Infinity,
          complete: true,
        },
      ],
      { inforce: "valuation-specific" },
    );
    expect(result[0]).toMatchObject({
      status: "invalid",
      issues: ["missing", "incomplete", "non-finite", "duplicate", "conflict"],
    });
  });

  it("allows a valuation-specific key to change between valuations", () => {
    expect(
      reconcileDiagnosticExposures(
        [
          {
            key: "fleet",
            sourceGroup: "book",
            origin: "2024",
            valuation: "2024",
            measureId: "inforce",
            value: 100,
            complete: true,
          },
          {
            key: "fleet",
            sourceGroup: "book",
            origin: "2024",
            valuation: "2025",
            measureId: "inforce",
            value: 80,
            complete: true,
          },
        ],
        { inforce: "valuation-specific" },
      ).map((item) => item.status),
    ).toEqual(["valid", "valid"]);
  });
});

describe("direct exposure helper boundaries", () => {
  const observation: DiagnosticExposureObservation = {
    key: "fleet",
    sourceGroup: "book",
    origin: "2024",
    measureId: "earned",
    value: 100,
    complete: true,
  };
  function issuesOf(run: () => unknown) {
    try {
      run();
    } catch (error) {
      expect(error).toBeInstanceOf(DiagnosticValidationError);
      return (error as DiagnosticValidationError).issues;
    }
    throw new Error("Expected a typed diagnostic validation error");
  }

  it.each(["5", true, undefined, {}, []])(
    "refuses malformed numeric audit input %j",
    (value) => {
      expect(issuesOf(() => auditDiagnosticNumber(value as number))).toEqual([
        {
          domain: "input",
          code: "invalid-type",
          path: "$",
          message: "Numeric input must be a number or null",
        },
      ]);
    },
  );

  it.each([
    [NaN, "nan"],
    [Infinity, "positive-infinity"],
    [-Infinity, "negative-infinity"],
  ] as const)(
    "continues to audit supported nonfinite value %j",
    (value, kind) => {
      expect(auditDiagnosticNumber(value)).toEqual({
        status: "non-finite",
        value: null,
        nonFiniteKind: kind,
      });
      expect(
        reconcileDiagnosticExposures([{ ...observation, value }], {
          earned: "origin-static",
        })[0],
      ).toMatchObject({
        status: "invalid",
        issues: ["non-finite"],
        observations: [
          { value: { status: "non-finite", nonFiniteKind: kind } },
        ],
      });
    },
  );

  it.each(["earned", "constructor", "toString", "__proto__"])(
    "does not invent timing for absent or inherited measure %s",
    (measureId) => {
      expect(
        issuesOf(() =>
          reconcileDiagnosticExposures([{ ...observation, measureId }], {}),
        ),
      ).toEqual([
        {
          domain: "configuration",
          code: "unknown-reference",
          path: "$.observations[0].measureId",
          message: "Exposure measure has no declared timing",
        },
      ]);
    },
  );

  it("rejects unsupported timing and requires valuation-specific coordinates", () => {
    expect(
      issuesOf(() =>
        reconcileDiagnosticExposures([observation], {
          earned: "future" as "origin-static",
        }),
      ),
    ).toEqual([
      {
        domain: "configuration",
        code: "invalid-type",
        path: "$.timingByMeasure.earned",
        message: "Exposure timing must be origin-static or valuation-specific",
      },
    ]);
    expect(
      issuesOf(() =>
        reconcileDiagnosticExposures([observation], {
          earned: "valuation-specific",
        }),
      ),
    ).toEqual([
      {
        domain: "input",
        code: "missing-required",
        path: "$.observations[0].valuation",
        message: "Valuation-specific exposure requires a valuation",
      },
    ]);
  });

  it("validates malformed records and metadata before reconciliation", () => {
    expect(
      issuesOf(() =>
        reconcileDiagnosticExposures(
          [
            {
              ...observation,
              value: "100" as unknown as number,
              complete: 1 as unknown as boolean,
              source: "book" as never,
            },
          ],
          { earned: "origin-static" },
        ),
      ),
    ).toEqual([
      {
        domain: "input",
        code: "invalid-type",
        path: "$.observations[0].complete",
        message: "Exposure completeness must be boolean",
      },
      {
        domain: "input",
        code: "invalid-type",
        path: "$.observations[0].source",
        message: "Source location must be an object",
      },
      {
        domain: "input",
        code: "invalid-type",
        path: "$.observations[0].value",
        message: "Exposure value must be a number or null",
      },
    ]);
  });

  it("validates the optional axis using the compiler's axis contract", () => {
    const axis = {
      kind: "calendar",
      originCadence: "year",
      valuationCadence: "year",
      originAnchor: "middle",
      valuationAnchor: "end",
      ageUnit: "month",
      ageOffset: 0,
    } as unknown as DiagnosticPeriodAxis;
    expect(
      issuesOf(() =>
        reconcileDiagnosticExposures(
          [observation],
          { earned: "origin-static" },
          axis,
        ),
      ),
    ).toEqual([
      {
        domain: "configuration",
        code: "invalid-period",
        path: "$.periodAxis.originAnchor",
        message: "Unknown origin anchor",
      },
    ]);
  });

  it("accepts own prototype-like timing keys and freezes only owned output", () => {
    const source = { artifactId: "claims", sourceRow: 2 };
    const inputs = [
      { ...observation, measureId: "__proto__", source, value: null },
    ];
    const timings = Object.fromEntries([
      ["__proto__", "origin-static" as const],
    ]);
    const result = reconcileDiagnosticExposures(inputs, timings);
    expect(result[0]?.status).toBe("invalid");
    if (result[0]?.status !== "invalid")
      throw new Error("Expected missing audit");
    expect(Object.isFrozen(result[0].observations[0])).toBe(true);
    expect(Object.isFrozen(result[0].observations[0]?.value)).toBe(true);
    source.sourceRow = 99;
    expect(result[0].observations[0]?.source?.sourceRow).toBe(2);
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(inputs)).toBe(false);
    expect(Object.isFrozen(timings)).toBe(false);
  });
});
