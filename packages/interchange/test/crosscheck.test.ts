import { describe, expect, it } from "vitest";
import { CREATED_AT, allWtdSelections, annualPaidDoc, annualPaidTriangle } from "./helpers.js";
import {
  CONVENTION_PROFILES,
  type MethodResultDoc,
  type MethodResultRow,
  INTERCHANGE_SPEC_VERSION,
  crosscheck,
  crosscheckReportDocSchema,
  selectionsToDoc,
  stampIntegrity,
  verifyIntegrity,
} from "../src/index.js";

const triangleDoc = annualPaidDoc();
const TRI_TAG = triangleDoc.integrity;

interface BuildOptions {
  engine?: { name: string; version: string };
  profile?: string;
  selectionIntegrity?: string | null;
  triangleIntegrity?: string;
  effectiveParameters?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  scale?: number;
  seScale?: number;
  withSe?: boolean;
  /** Replaces the first row's zero unpaid with 1e-11 of float dust. */
  dustOnFirstUnpaid?: boolean;
}

/** Hand-built MethodResultDoc for referee tests (spec 5). */
function buildResultDoc(options: BuildOptions = {}): MethodResultDoc {
  const scale = options.scale ?? 1;
  const seScale = options.seScale ?? 1;
  const baseRows = [
    { origin: "2021", ultimate: 3335, unpaid: 0, standardError: 0 },
    { origin: "2022", ultimate: 3800.5, unpaid: 378.5, standardError: 42.1 },
    { origin: "2023", ultimate: 4482.25, unpaid: 1249.25, standardError: 111.4 },
  ];
  const rows: MethodResultRow[] = baseRows.map((r, index) => {
    if (options.dustOnFirstUnpaid === true && index === 0) r = { ...r, unpaid: 1e-11 };
    const row: MethodResultRow = {
      origin: r.origin,
      ultimate: r.ultimate * scale,
      unpaid: r.unpaid * scale,
    };
    if (options.withSe !== false) row.standardError = r.standardError * seScale;
    return row;
  });
  const totals: MethodResultDoc["result"]["totals"] = {
    ultimate: rows.reduce((a, r) => a + r.ultimate, 0),
    unpaid: rows.reduce((a, r) => a + r.unpaid, 0),
  };
  if (options.withSe !== false) {
    totals.standardError = 130.7 * seScale;
  }
  const engine: MethodResultDoc["result"]["engine"] = {
    ...(options.engine ?? { name: "actuarial-ts", version: "0.1.0" }),
  };
  if (options.profile !== undefined) engine.conventionProfile = options.profile;
  const body: MethodResultDoc["result"] = {
    appliesTo: {
      triangleIntegrity: options.triangleIntegrity ?? TRI_TAG,
      selectionIntegrity: options.selectionIntegrity ?? null,
    },
    engine,
    method: "mack",
    parameters: options.parameters ?? {},
    rows,
    totals,
    warnings: [],
  };
  if (options.effectiveParameters !== undefined) {
    body.effectiveParameters = options.effectiveParameters;
  }
  return stampIntegrity<MethodResultDoc>({
    interchangeVersion: INTERCHANGE_SPEC_VERSION,
    kind: "method-result",
    generator: { name: "test", version: "0" },
    createdAt: CREATED_AT,
    extensions: {},
    result: body,
  });
}

describe("crosscheck verdicts (spec 5)", () => {
  it("agree: identical results under a shared profile, schema-valid report", () => {
    const report = crosscheck({
      a: buildResultDoc({ profile: "mack1993-vw" }),
      b: buildResultDoc({
        engine: { name: "chainladder-python", version: "0.9.2" },
        profile: "mack1993-vw",
        parameters: { average: "volume", n_periods: -1, sigma_interpolation: "mack" },
      }),
      createdAt: CREATED_AT,
    });
    expect(crosscheckReportDocSchema.safeParse(report).success).toBe(true);
    expect(verifyIntegrity(report).ok).toBe(true);
    expect(report.report.verdict).toBe("agree");
    expect(report.report.tolerance).toEqual({ central: 1e-6, standardError: 0.005 });
    expect(report.report.appliesTo).toEqual({
      triangleIntegrity: TRI_TAG,
      selectionIntegrity: null,
    });
    expect(report.report.deviations.perOrigin).toHaveLength(3);
    expect(report.report.deviations.totals.ultimate).toBe(0);
  });

  it("agree within tolerance: tiny central deviation stays agree", () => {
    const report = crosscheck({
      a: buildResultDoc({ profile: "deterministic-cl", withSe: false }),
      b: buildResultDoc({ profile: "deterministic-cl", withSe: false, scale: 1 + 1e-9 }),
      createdAt: CREATED_AT,
    });
    expect(report.report.verdict).toBe("agree");
  });

  it("disagree beyond the central tolerance", () => {
    const report = crosscheck({
      a: buildResultDoc({ profile: "deterministic-cl", withSe: false }),
      b: buildResultDoc({ profile: "deterministic-cl", withSe: false, scale: 1.01 }),
      createdAt: CREATED_AT,
    });
    expect(report.report.verdict).toBe("disagree");
  });

  it("mack1993-vw: SEs within 0.5% agree, beyond 0.5% disagree", () => {
    const within = crosscheck({
      a: buildResultDoc({ profile: "mack1993-vw" }),
      b: buildResultDoc({ profile: "mack1993-vw", seScale: 1.003 }),
      createdAt: CREATED_AT,
    });
    expect(within.report.verdict).toBe("agree");
    const beyond = crosscheck({
      a: buildResultDoc({ profile: "mack1993-vw" }),
      b: buildResultDoc({ profile: "mack1993-vw", seScale: 1.007 }),
      createdAt: CREATED_AT,
    });
    expect(beyond.report.verdict).toBe("disagree");
  });

  it("not-comparable: mismatched triangle tags", () => {
    const report = crosscheck({
      a: buildResultDoc(),
      b: buildResultDoc({ triangleIntegrity: "fedcba9876543210" }),
      createdAt: CREATED_AT,
    });
    expect(report.report.verdict).toBe("not-comparable");
    expect(report.report.appliesTo).toBeNull();
    expect(report.report.deviations.perOrigin).toEqual([]);
    expect(report.report.deviations.totals).toEqual({
      ultimate: null,
      unpaid: null,
      standardError: null,
    });
  });

  it("not-comparable: one selection null, the other not", () => {
    const report = crosscheck({
      a: buildResultDoc({ selectionIntegrity: "0123456789abcdef" }),
      b: buildResultDoc({ selectionIntegrity: null }),
      createdAt: CREATED_AT,
    });
    expect(report.report.verdict).toBe("not-comparable");
  });

  it("not-comparable: differing convention profiles", () => {
    const report = crosscheck({
      a: buildResultDoc({ profile: "mack1993-vw" }),
      b: buildResultDoc({ profile: "deterministic-cl" }),
      createdAt: CREATED_AT,
    });
    expect(report.report.verdict).toBe("not-comparable");
  });

  it("verified-by-value: agreement on a value-only selection is labeled honestly", () => {
    const tri = annualPaidTriangle();
    const sel = allWtdSelections(tri);
    const { doc: valueOnlySelection } = selectionsToDoc(sel, {
      triangleDoc,
      createdAt: CREATED_AT,
      intents: sel.selected.map(() => ({
        kind: "external" as const,
        rationale: "carried from the prior review",
      })),
    });
    const report = crosscheck({
      a: buildResultDoc({ selectionIntegrity: valueOnlySelection.integrity }),
      b: buildResultDoc({ selectionIntegrity: valueOnlySelection.integrity }),
      selection: valueOnlySelection,
      createdAt: CREATED_AT,
    });
    expect(report.report.verdict).toBe("verified-by-value");
    expect(report.report.warnings.some((w) => w.includes("value transport"))).toBe(true);
  });

  it("a computable-intent selection still verdicts agree, not verified-by-value", () => {
    const tri = annualPaidTriangle();
    const sel = allWtdSelections(tri);
    const { doc: computable } = selectionsToDoc(sel, {
      triangleDoc,
      createdAt: CREATED_AT,
      intents: ["all-wtd", "all-wtd", "all-wtd", "all-wtd"],
    });
    const report = crosscheck({
      a: buildResultDoc({ selectionIntegrity: computable.integrity }),
      b: buildResultDoc({ selectionIntegrity: computable.integrity }),
      selection: computable,
      createdAt: CREATED_AT,
    });
    expect(report.report.verdict).toBe("agree");
  });

  it("effectiveParameters ≠ requested downgrades with a comparability warning", () => {
    const report = crosscheck({
      a: buildResultDoc({ profile: "mack1993-vw" }),
      b: buildResultDoc({
        engine: { name: "r-chainladder", version: "0.2.20" },
        profile: "mack1993-vw",
        parameters: { alpha: 1, "est.sigma": "log-linear" },
        effectiveParameters: { "est.sigma": "Mack" },
      }),
      createdAt: CREATED_AT,
    });
    expect(report.report.verdict).toBe("agree");
    expect(report.report.warnings.some((w) => w.includes("Comparability downgrade"))).toBe(
      true,
    );
    expect(report.report.parameters.b.effective).toEqual({ "est.sigma": "Mack" });
  });

  it("tampered inputs are refused (integrity check)", () => {
    const tampered = { ...buildResultDoc(), integrity: "0000000000000000" };
    expect(() =>
      crosscheck({ a: tampered, b: buildResultDoc(), createdAt: CREATED_AT }),
    ).toThrowError(expect.objectContaining({ code: "BAD_INTERCHANGE" }));
  });

  it("explicit tolerance overrides the profile", () => {
    const report = crosscheck({
      a: buildResultDoc({ profile: "deterministic-cl", withSe: false }),
      b: buildResultDoc({ profile: "deterministic-cl", withSe: false, scale: 1.01 }),
      tolerance: 0.05,
      createdAt: CREATED_AT,
    });
    expect(report.report.verdict).toBe("agree");
    expect(report.report.tolerance.central).toBe(0.05);
  });

  it("no shared profile falls back to deterministic-cl central with a warning", () => {
    const report = crosscheck({
      a: buildResultDoc(),
      b: buildResultDoc(),
      createdAt: CREATED_AT,
    });
    expect(report.report.tolerance.central).toBe(
      CONVENTION_PROFILES["deterministic-cl"]!.tolerance.central,
    );
    expect(report.report.warnings.some((w) => w.includes("No shared convention profile"))).toBe(
      true,
    );
  });
});

describe("convention profiles are normative data (spec 5)", () => {
  it("ships deterministic-cl and mack1993-vw with the pinned alignments", () => {
    const detCl = CONVENTION_PROFILES["deterministic-cl"]!;
    expect(detCl.tolerance).toEqual({ central: 1e-6, standardError: null });
    const mack = CONVENTION_PROFILES["mack1993-vw"]!;
    expect(mack.tolerance).toEqual({ central: 1e-6, standardError: 0.005 });
    expect(mack.alignment["chainladder-python"].parameters).toEqual({
      average: "volume",
      n_periods: -1,
      sigma_interpolation: "mack",
    });
    expect(mack.alignment["r-chainladder"].parameters).toEqual({
      alpha: 1,
      "est.sigma": "Mack",
    });
  });
});

describe("a metric the profile covers must actually be compared (spec 5)", () => {
  // `agree` is read as "these engines agree". It must therefore never mean
  // "nothing the profile asked about was checked". Each case below returned
  // `agree` before this rule existed; two of them silently.

  it("refuses when the profile scopes SEs in but one side carries none", () => {
    const report = crosscheck({
      a: buildResultDoc({ profile: "mack1993-vw" }),
      b: buildResultDoc({ profile: "mack1993-vw", withSe: false }),
      createdAt: CREATED_AT,
    });
    expect(report.report.verdict).toBe("not-comparable");
    expect(report.report.warnings.join(" ")).toMatch(/standard error/i);
  });

  it("applies the one stated profile rather than silently falling back", () => {
    // A claims mack1993-vw (SE tolerance 0.005); B states nothing. Falling back
    // to deterministic-cl puts SEs out of scope, so a 50% SE divergence passed.
    const report = crosscheck({
      a: buildResultDoc({ profile: "mack1993-vw" }),
      b: buildResultDoc({ seScale: 1.5 }),
      createdAt: CREATED_AT,
    });
    expect(report.report.verdict).toBe("disagree");
    expect(report.report.warnings.join(" ")).toMatch(/only .*a.* states a convention profile/i);
  });

  it("says so when it cannot tell whether the replayed selection was value-only", () => {
    // verified-by-value needs the selection document. Without it the referee
    // cannot know whether the engines recomputed or merely replayed values —
    // and the caller supplying it is the party being audited, so silence here
    // let them choose whether the disclosure appeared.
    const report = crosscheck({
      a: buildResultDoc({ selectionIntegrity: "0123456789abcdef" }),
      b: buildResultDoc({ selectionIntegrity: "0123456789abcdef" }),
      createdAt: CREATED_AT,
    });
    expect(report.report.warnings.join(" ")).toMatch(/could not be checked/i);
  });

  it("records which metrics were compared, and on how many cells", () => {
    const report = crosscheck({
      a: buildResultDoc({ profile: "mack1993-vw" }),
      b: buildResultDoc({ profile: "mack1993-vw" }),
      createdAt: CREATED_AT,
    });
    const coverage = (report.report as unknown as { coverage: Record<string, unknown> }).coverage;
    expect(coverage["central"]).toMatchObject({ inScope: true });
    expect(coverage["standardError"]).toMatchObject({ inScope: true });
    expect((coverage["central"] as { comparedCells: number }).comparedCells).toBeGreaterThan(0);
  });

  it("treats float dust against an exact zero as agreement when told the scale", () => {
    // A fully developed origin is unpaid 0 in one engine and 1e-11 of float
    // dust in another. Pure relative deviation calls that a 100% disagreement.
    const a = buildResultDoc();
    const b = buildResultDoc({ dustOnFirstUnpaid: true });
    expect(crosscheck({ a, b, createdAt: CREATED_AT }).report.verdict).toBe("disagree");
    expect(
      crosscheck({ a, b, createdAt: CREATED_AT, absoluteTolerance: 1e-6 }).report.verdict,
    ).toBe("agree");
  });
});
