import { describe, expect, it } from "vitest";
import { capClaims, claimSizeDiagnostics, effectiveCap } from "../src/capping.js";
import { factorVolatility } from "../src/factors.js";
import { computeDevelopmentFactors } from "../src/factors.js";
import { buildTriangles } from "../src/triangle.js";
import type { ClaimSnapshot } from "../src/types.js";

function snap(
  claimId: string,
  accidentDate: string,
  evaluationDate: string,
  paid: number,
  caseReserve: number,
  status: "open" | "closed" = "open",
): ClaimSnapshot {
  return {
    claimId,
    accidentDate,
    reportDate: accidentDate,
    evaluationDate,
    paidToDate: paid,
    caseReserve,
    status,
  };
}

describe("capClaims", () => {
  it("caps incurred at the limit and never produces a negative case reserve", () => {
    const claims = [
      snap("A", "2024-03-01", "2024-12-31", 100_000, 300_000), // incurred 400k
      snap("B", "2024-05-01", "2024-12-31", 300_000, 0, "closed"), // paid pierces alone
      snap("C", "2024-07-01", "2024-12-31", 50_000, 100_000), // under the cap
    ];
    const capped = capClaims(claims, { cap: 250_000 });
    // A: incurred capped to 250k, paid 100k untouched, case = 150k.
    expect(capped[0]!.paidToDate).toBe(100_000);
    expect(capped[0]!.caseReserve).toBe(150_000);
    // B: paid capped to 250k, case stays 0.
    expect(capped[1]!.paidToDate).toBe(250_000);
    expect(capped[1]!.caseReserve).toBe(0);
    // C untouched (same object, no copy).
    expect(capped[2]).toBe(claims[2]);
    // Statuses and counts untouched.
    expect(capped.map((c) => c.status)).toEqual(claims.map((c) => c.status));
    expect(capped).toHaveLength(3);
  });

  it("indexes the cap by accident year around the base year", () => {
    const opts = { cap: 250_000, indexRate: 0.05, baseYear: 2025 } as const;
    expect(effectiveCap(opts, 2025)).toBeCloseTo(250_000, 6);
    expect(effectiveCap(opts, 2024)).toBeCloseTo(250_000 / 1.05, 6);
    expect(effectiveCap(opts, 2020)).toBeCloseTo(250_000 / 1.05 ** 5, 6);

    const claims = [
      snap("OLD", "2020-06-01", "2020-12-31", 0, 230_000), // 2020 cap ~195,882
      snap("NEW", "2025-06-01", "2025-12-31", 0, 230_000), // 2025 cap 250,000
    ];
    const capped = capClaims(claims, { cap: 250_000, indexRate: 0.05, baseYear: 2025 });
    expect(capped[0]!.caseReserve).toBeCloseTo(250_000 / 1.05 ** 5, 4);
    expect(capped[1]!.caseReserve).toBe(230_000); // under its year's cap
  });

  it("defaults the base year to the latest accident year in the data", () => {
    const claims = [
      snap("A", "2023-01-01", "2023-12-31", 0, 1_000_000),
      snap("B", "2025-01-01", "2025-12-31", 0, 1_000_000),
    ];
    const capped = capClaims(claims, { cap: 500_000, indexRate: 0.1 });
    // Base year resolves to 2025: 2025 gets 500k, 2023 gets 500k/1.1^2.
    expect(capped[1]!.caseReserve).toBe(500_000);
    expect(capped[0]!.caseReserve).toBeCloseTo(500_000 / 1.21, 4);
  });

  it("rejects nonsense caps", () => {
    const claims = [snap("A", "2024-01-01", "2024-12-31", 1, 1)];
    expect(() => capClaims(claims, { cap: 0 })).toThrowError(/positive/);
    expect(() => capClaims(claims, { cap: -5 })).toThrowError(/positive/);
    expect(() => capClaims(claims, { cap: 100, indexRate: -1 })).toThrowError(/-100%/);
  });

  it("capping is idempotent and capped values never exceed unlimited", () => {
    const claims = [
      snap("A", "2024-01-01", "2024-06-30", 40_000, 500_000),
      snap("A", "2024-01-01", "2024-12-31", 400_000, 200_000),
    ];
    const once = capClaims(claims, { cap: 250_000 });
    const twice = capClaims(once, { cap: 250_000 });
    expect(twice).toEqual(once);
    for (let i = 0; i < claims.length; i++) {
      expect(once[i]!.paidToDate).toBeLessThanOrEqual(claims[i]!.paidToDate);
      expect(once[i]!.paidToDate + once[i]!.caseReserve).toBeLessThanOrEqual(
        claims[i]!.paidToDate + claims[i]!.caseReserve,
      );
    }
  });

  it("capped triangles are cell-wise <= unlimited triangles", () => {
    const claims: ClaimSnapshot[] = [];
    // Two accident years, two evaluations each, one big claim per year.
    for (const [year, big] of [
      ["2023", 900_000],
      ["2024", 700_000],
    ] as const) {
      claims.push(snap(`${year}-big`, `${year}-02-01`, `${year}-12-31`, big / 4, big / 2));
      claims.push(snap(`${year}-big`, `${year}-02-01`, `2025-12-31`, big, 0, "closed"));
      claims.push(snap(`${year}-small`, `${year}-03-01`, `${year}-12-31`, 10_000, 20_000));
      claims.push(snap(`${year}-small`, `${year}-03-01`, `2025-12-31`, 30_000, 0, "closed"));
    }
    const options = { cadence: "annual" as const, asOfDate: "2025-12-31" };
    const unlimited = buildTriangles(claims, options);
    const capped = buildTriangles(capClaims(claims, { cap: 250_000 }), options);
    expect(capped.paid.origins).toEqual(unlimited.paid.origins);
    expect(capped.paid.ages).toEqual(unlimited.paid.ages);
    for (const key of ["paid", "incurred"] as const) {
      unlimited[key].values.forEach((row, i) =>
        row.forEach((v, j) => {
          const c = capped[key].values[i]![j];
          if (v === null) expect(c).toBeNull();
          else expect(c!).toBeLessThanOrEqual(v + 1e-9);
        }),
      );
    }
    // Counts identical: the cap limits dollars, not claims.
    expect(capped.reportedCount.values).toEqual(unlimited.reportedCount.values);
    expect(capped.openCount.values).toEqual(unlimited.openCount.values);
  });
});

describe("claimSizeDiagnostics", () => {
  const claims = [
    // 2024: sizes 10k, 100k, 400k (latest evals). Earlier evals must be ignored.
    snap("a", "2024-01-01", "2024-06-30", 1_000, 1_000),
    snap("a", "2024-01-01", "2024-12-31", 10_000, 0, "closed"),
    snap("b", "2024-02-01", "2024-12-31", 60_000, 40_000),
    snap("c", "2024-03-01", "2024-12-31", 150_000, 250_000),
    // 2025: sizes 20k, 500k.
    snap("d", "2025-01-01", "2025-12-31", 20_000, 0, "closed"),
    snap("e", "2025-02-01", "2025-12-31", 100_000, 400_000),
  ];

  it("uses the latest evaluation per claim and computes pierce/excess shares", () => {
    const d = claimSizeDiagnostics(claims, { candidateCaps: [250_000] });
    expect(d.years.map((y) => y.year)).toEqual([2024, 2025]);
    expect(d.years[0]!.claimCount).toBe(3);
    expect(d.years[0]!.totalIncurred).toBe(510_000); // 10k + 100k + 400k
    expect(d.years[0]!.maxClaim).toBe(400_000);

    const cand = d.candidates[0]!;
    expect(cand.cap).toBe(250_000);
    const y2024 = cand.byYear[0]!;
    expect(y2024.pierceCount).toBe(1); // only the 400k claim
    expect(y2024.pierceShare).toBeCloseTo(1 / 3, 9);
    expect(y2024.excessShare).toBeCloseTo(150_000 / 510_000, 9);
    const y2025 = cand.byYear[1]!;
    expect(y2025.pierceCount).toBe(1); // the 500k claim
    expect(y2025.excessShare).toBeCloseTo(250_000 / 520_000, 9);
    expect(cand.totalPierceCount).toBe(2);
    expect(cand.totalPierceShare).toBeCloseTo(2 / 5, 9);
  });

  it("indexes candidate caps per year when an index is supplied", () => {
    const d = claimSizeDiagnostics(claims, {
      candidateCaps: [250_000],
      indexRate: 0.25,
      baseYear: 2025,
    });
    const cand = d.candidates[0]!;
    expect(cand.byYear[1]!.effectiveCap).toBe(250_000);
    expect(cand.byYear[0]!.effectiveCap).toBeCloseTo(200_000, 6); // 250k / 1.25
    // 2024 cap 200k: the 400k claim pierces by 200k.
    expect(cand.byYear[0]!.excessShare).toBeCloseTo(200_000 / 510_000, 9);
  });

  it("derives sensible default candidates spanning the distribution tail", () => {
    const d = claimSizeDiagnostics(claims);
    expect(d.candidates.length).toBeGreaterThan(0);
    const caps = d.candidates.map((c) => c.cap);
    expect([...caps].sort((a, b) => a - b)).toEqual(caps); // ascending
    for (const c of caps) expect(c).toBeGreaterThan(0);
  });
});

describe("factorVolatility", () => {
  it("computes per-column CV of individual factors and is lower for stabler data", () => {
    const stable = buildTriangles(
      [
        snap("s1", "2023-01-01", "2023-12-31", 100, 0, "closed"),
        snap("s1", "2023-01-01", "2024-12-31", 200, 0, "closed"),
        snap("s2", "2024-01-01", "2024-12-31", 100, 0, "closed"),
        snap("s2", "2024-01-01", "2025-12-31", 200, 0, "closed"),
        snap("s3", "2025-01-01", "2025-12-31", 100, 0, "closed"),
      ],
      { cadence: "annual", asOfDate: "2025-12-31" },
    );
    const vol = factorVolatility(computeDevelopmentFactors(stable.paid));
    // Column 12-24 has factors [2.0, 2.0] -> CV 0.
    expect(vol[0]).toBeCloseTo(0, 9);
    // Later columns lack two factors -> null.
    expect(vol[1]).toBeNull();
  });
});
