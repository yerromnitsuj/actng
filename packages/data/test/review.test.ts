import { describe, expect, it } from "vitest";
import type { ClaimSnapshot } from "@actuarial-ts/core";
import { triangleFromGrid } from "@actuarial-ts/core";
import { reviewClaimData, reviewTriangles } from "../src/review.js";
import type { DataCheck, DataReviewReport } from "../src/review.js";

const CLAIM_CHECK_IDS = [
  "negative-paid",
  "negative-case",
  "paid-decreasing",
  "date-order",
  "duplicate-snapshot",
  "future-dated",
  "closed-with-case",
];

const TRIANGLE_CHECK_IDS = [
  "shape-mismatch",
  "paid-exceeds-incurred",
  "negative-incremental-paid",
  "negative-incremental-incurred",
  "interior-missing",
];

function snap(overrides: Partial<ClaimSnapshot> = {}): ClaimSnapshot {
  return {
    claimId: "CL-1",
    accidentDate: "2021-03-15",
    reportDate: "2021-04-01",
    evaluationDate: "2021-12-31",
    paidToDate: 1000,
    caseReserve: 500,
    status: "open",
    ...overrides,
  };
}

function check(report: DataReviewReport, id: string): DataCheck {
  const found = report.checks.find((c) => c.id === id);
  expect(found, `check "${id}" missing from report`).toBeDefined();
  return found!;
}

describe("reviewClaimData", () => {
  it("reports every check id, all passing, on clean data", () => {
    const clean = [
      snap(),
      snap({ claimId: "CL-1", evaluationDate: "2022-12-31", paidToDate: 1500, caseReserve: 0, status: "closed" }),
      snap({ claimId: "CL-2", paidToDate: 0 }),
    ];
    const report = reviewClaimData(clean, { asOfDate: "2023-12-31" });
    expect(report.checks.map((c) => c.id)).toEqual(CLAIM_CHECK_IDS);
    for (const c of report.checks) {
      expect(c.status).toBe("pass");
      expect(c.details).toEqual([]);
      expect(c.description.length).toBeGreaterThan(0);
    }
    expect(report.summary).toEqual({ pass: 7, warning: 0, fail: 0, notEvaluated: 0 });
  });

  it("fails negative-paid", () => {
    const report = reviewClaimData([snap({ paidToDate: -50 })]);
    const c = check(report, "negative-paid");
    expect(c.status).toBe("fail");
    expect(c.details).toHaveLength(1);
    expect(c.details[0]).toContain("CL-1");
  });

  it("warns (not fails) on negative-case", () => {
    const report = reviewClaimData([snap({ caseReserve: -25 })]);
    const c = check(report, "negative-case");
    expect(c.status).toBe("warning");
    expect(c.details[0]).toContain("CL-1");
    expect(report.summary.fail).toBe(0);
  });

  it("fails paid-decreasing across a claim's snapshots ordered by evaluation date", () => {
    // Passed out of evaluation-date order on purpose: ordering is the check's job.
    const report = reviewClaimData([
      snap({ evaluationDate: "2022-12-31", paidToDate: 800 }),
      snap({ evaluationDate: "2021-12-31", paidToDate: 1000 }),
    ]);
    const c = check(report, "paid-decreasing");
    expect(c.status).toBe("fail");
    expect(c.details).toHaveLength(1);
    expect(c.details[0]).toContain("CL-1");
    expect(c.details[0]).toContain("1000");
    expect(c.details[0]).toContain("800");
  });

  it("does not flag paid-decreasing across different claims", () => {
    const report = reviewClaimData([
      snap({ claimId: "A", paidToDate: 1000 }),
      snap({ claimId: "B", paidToDate: 10 }),
    ]);
    expect(check(report, "paid-decreasing").status).toBe("pass");
  });

  it("fails date-order when report precedes accident or evaluation precedes report", () => {
    const report = reviewClaimData([
      snap({ claimId: "A", accidentDate: "2021-06-01", reportDate: "2021-05-01" }),
      snap({ claimId: "B", reportDate: "2022-06-01", evaluationDate: "2022-05-01" }),
    ]);
    const c = check(report, "date-order");
    expect(c.status).toBe("fail");
    expect(c.details).toHaveLength(2);
  });

  it("fails duplicate-snapshot on the same claimId + evaluationDate twice", () => {
    const report = reviewClaimData([snap(), snap({ paidToDate: 999 })]);
    const c = check(report, "duplicate-snapshot");
    expect(c.status).toBe("fail");
    expect(c.details).toHaveLength(1);
    expect(c.details[0]).toContain("CL-1");
    expect(c.details[0]).toContain("2021-12-31");
  });

  it("fails future-dated when any date exceeds asOfDate", () => {
    const report = reviewClaimData([snap({ evaluationDate: "2024-06-30" })], {
      asOfDate: "2023-12-31",
    });
    const c = check(report, "future-dated");
    expect(c.status).toBe("fail");
    expect(c.details[0]).toContain("2024-06-30");
  });

  it("marks future-dated as not-evaluated when no asOfDate is given", () => {
    const report = reviewClaimData([snap({ evaluationDate: "2099-12-31" })]);
    const c = check(report, "future-dated");
    expect(c.status).toBe("not-evaluated");
    expect(c.details).toHaveLength(1);
    expect(c.details[0]).toContain("not evaluated");
  });

  it("warns on closed-with-case", () => {
    const report = reviewClaimData([snap({ status: "closed", caseReserve: 100 })]);
    const c = check(report, "closed-with-case");
    expect(c.status).toBe("warning");
    expect(c.details[0]).toContain("CL-1");
  });

  it("caps details at 20 items with a '+N more' tail", () => {
    const bad = Array.from({ length: 25 }, (_, i) =>
      snap({ claimId: `CL-${i}`, paidToDate: -1 }),
    );
    const c = check(reviewClaimData(bad), "negative-paid");
    expect(c.details).toHaveLength(21);
    expect(c.details[20]).toBe("+5 more");
  });

  it("summary counts checks by status", () => {
    const report = reviewClaimData([
      snap({ paidToDate: -1, caseReserve: -1 }),
    ]);
    expect(report.summary.fail).toBe(1); // negative-paid
    expect(report.summary.warning).toBe(1); // negative-case
    // future-dated has no asOfDate here, so it is explicitly not evaluated.
    expect(report.summary.pass).toBe(4);
    expect(report.summary.notEvaluated).toBe(1);
  });
});

describe("reviewTriangles", () => {
  const cleanPaid = () =>
    triangleFromGrid(
      "paid",
      ["2020", "2021"],
      [12, 24],
      [
        [100, 180],
        [110, null],
      ],
    );
  const cleanIncurred = () =>
    triangleFromGrid(
      "incurred",
      ["2020", "2021"],
      [12, 24],
      [
        [150, 200],
        [160, null],
      ],
    );

  it("reports every check id, all passing, on clean triangles", () => {
    const report = reviewTriangles(cleanPaid(), cleanIncurred());
    expect(report.checks.map((c) => c.id)).toEqual(TRIANGLE_CHECK_IDS);
    for (const c of report.checks) {
      expect(c.status).toBe("pass");
      expect(c.details).toEqual([]);
    }
    expect(report.summary).toEqual({ pass: 5, warning: 0, fail: 0, notEvaluated: 0 });
  });

  it("fails shape-mismatch and skips the remaining checks (still listed)", () => {
    const incurred = triangleFromGrid("incurred", ["2020"], [12, 24], [[150, 200]]);
    const report = reviewTriangles(cleanPaid(), incurred);
    expect(report.checks.map((c) => c.id)).toEqual(TRIANGLE_CHECK_IDS);
    const shape = check(report, "shape-mismatch");
    expect(shape.status).toBe("fail");
    expect(shape.details.length).toBeGreaterThan(0);
    for (const id of TRIANGLE_CHECK_IDS.slice(1)) {
      const c = check(report, id);
      expect(c.status).toBe("not-evaluated");
      expect(c.details[0]).toContain("not evaluated");
    }
    expect(report.summary).toEqual({ pass: 0, warning: 0, fail: 1, notEvaluated: 4 });
  });

  it("fails shape-mismatch on differing ages too", () => {
    const incurred = triangleFromGrid(
      "incurred",
      ["2020", "2021"],
      [12, 36],
      [
        [150, 200],
        [160, null],
      ],
    );
    expect(check(reviewTriangles(cleanPaid(), incurred), "shape-mismatch").status).toBe("fail");
  });

  it("fails paid-exceeds-incurred per offending cell", () => {
    const paid = triangleFromGrid(
      "paid",
      ["2020", "2021"],
      [12, 24],
      [
        [250, 180], // 250 > 150 at (2020, 12)
        [110, null],
      ],
    );
    const c = check(reviewTriangles(paid, cleanIncurred()), "paid-exceeds-incurred");
    expect(c.status).toBe("fail");
    expect(c.details).toHaveLength(1);
    expect(c.details[0]).toContain("2020");
    expect(c.details[0]).toContain("12");
  });

  it("tolerates paid exceeding incurred within 1e-9 relative", () => {
    const paid = triangleFromGrid(
      "paid",
      ["2020", "2021"],
      [12, 24],
      [
        [150 * (1 + 1e-12), 180],
        [110, null],
      ],
    );
    expect(check(reviewTriangles(paid, cleanIncurred()), "paid-exceeds-incurred").status).toBe(
      "pass",
    );
  });

  it("warns on negative incremental paid (salvage is legal but reportable)", () => {
    const paid = triangleFromGrid(
      "paid",
      ["2020", "2021"],
      [12, 24],
      [
        [100, 90],
        [110, null],
      ],
    );
    const c = check(reviewTriangles(paid, cleanIncurred()), "negative-incremental-paid");
    expect(c.status).toBe("warning");
    expect(c.details).toHaveLength(1);
    expect(c.details[0]).toContain("2020");
  });

  it("warns on negative incremental incurred", () => {
    const incurred = triangleFromGrid(
      "incurred",
      ["2020", "2021"],
      [12, 24],
      [
        [200, 150],
        [160, null],
      ],
    );
    const c = check(reviewTriangles(cleanPaid(), incurred), "negative-incremental-incurred");
    expect(c.status).toBe("warning");
    expect(c.details).toHaveLength(1);
  });

  it("warns on interior-missing cells but not leading/trailing nulls", () => {
    const paid = triangleFromGrid(
      "paid",
      ["2020", "2021"],
      [12, 24, 36],
      [
        [100, null, 200], // interior null
        [null, 150, null], // leading + trailing nulls: fine
      ],
    );
    const incurred = triangleFromGrid(
      "incurred",
      ["2020", "2021"],
      [12, 24, 36],
      [
        [150, 180, 250],
        [null, 160, null],
      ],
    );
    const c = check(reviewTriangles(paid, incurred), "interior-missing");
    expect(c.status).toBe("warning");
    expect(c.details).toHaveLength(1);
    expect(c.details[0]).toContain("2020");
    expect(c.details[0]).toContain("24");
  });
});
