import { describe, expect, it } from "vitest";
import { triangleFromGrid } from "../src/triangle.js";
import { runChainLadder } from "../src/chainladder.js";
import { payoutPatternFromChainLadder } from "../src/discounting.js";
import { runFisherLange } from "../src/fisherLange.js";
import { runCaseOutstanding } from "../src/caseOutstanding.js";
import { runSalvageSubro, netOfRecoveries } from "../src/salvageSubro.js";

/**
 * Warning guards added by the pre-0.1.0 adversarial review: each covers a
 * silently-wrong-answer path a reviewer found in the modules without
 * published-value pins. Every guard warns; none changes a computed number.
 */

describe("discounting: off-diagonal (stale origin) guard", () => {
  const ages = [12, 24, 36];
  const selected = [1.6, 1.25];

  it("warns when a stale origin's timing would discount calendar-past development as future", () => {
    // 2023's feed stopped at age 12 while 2024 reached 24: 2023 is off the
    // valuation diagonal and its age-12-36 development is calendar-past.
    const ragged = triangleFromGrid("paid", ["2023", "2024", "2025"], ages, [
      [100, null, null],
      [100, 160, null],
      [100, null, null],
    ]);
    const cl = runChainLadder(ragged, { selected, tailFactor: 1 });
    const pattern = payoutPatternFromChainLadder(cl, ages);
    const joined = pattern.warnings.join("\n");
    expect(joined).toContain("Origin 2023 appears stale");
    expect(joined).toContain("valuation date");
  });

  it("does not warn on a proper single-diagonal triangle", () => {
    const diagonal = triangleFromGrid("paid", ["2023", "2024", "2025"], ages, [
      [100, 160, 200],
      [100, 160, null],
      [100, null, null],
    ]);
    const cl = runChainLadder(diagonal, { selected, tailFactor: 1 });
    const pattern = payoutPatternFromChainLadder(cl, ages);
    expect(pattern.warnings.join("\n")).not.toContain("stale");
  });

  it("does not flag fully-developed origins clamped at the last age column", () => {
    // Truncated-wide grid: two old origins legitimately share the max age.
    const clamped = triangleFromGrid("paid", ["2021", "2022", "2023"], ages, [
      [100, 160, 200],
      [100, 160, 200],
      [100, 160, null],
    ]);
    const cl = runChainLadder(clamped, { selected, tailFactor: 1 });
    const pattern = payoutPatternFromChainLadder(cl, ages);
    expect(pattern.warnings.join("\n")).not.toContain("stale");
  });
});

describe("fisher-lange: non-consecutive numeric origin guard", () => {
  const ages = [12, 24];
  const mk = (origins: string[]) => ({
    paid: triangleFromGrid("paid", origins, ages, [
      [100, 180],
      [110, null],
    ]),
    closed: triangleFromGrid("closedCount", origins, ages, [
      [10, 18],
      [11, null],
    ]),
  });

  it("warns on gap years (silently compressed trend distances)", () => {
    const { paid, closed } = mk(["2020", "2024"]);
    const r = runFisherLange(paid, closed, [20, 20], { severityTrend: 0.1 });
    expect(r.warnings.join("\n")).toContain("4 years apart but are trended as consecutive");
  });

  it("does not warn on consecutive years", () => {
    const { paid, closed } = mk(["2024", "2025"]);
    const r = runFisherLange(paid, closed, [20, 20], { severityTrend: 0.1 });
    expect(r.warnings.join("\n")).not.toContain("trended as consecutive");
  });

  it("does not false-positive on quarterly integer-index labels", () => {
    const qAges = [3, 6];
    const paid = triangleFromGrid("paid", ["1", "3"], qAges, [
      [100, 180],
      [110, null],
    ]);
    const closed = triangleFromGrid("closedCount", ["1", "3"], qAges, [
      [10, 18],
      [11, null],
    ]);
    const r = runFisherLange(paid, closed, [20, 20], { severityTrend: 0.1 });
    expect(r.warnings.join("\n")).not.toContain("trended as consecutive");
  });
});

describe("case outstanding: negative case guard", () => {
  const origins = ["2024", "2025"];
  const ages = [12, 24];

  it("warns on a negative seed and carries the sign through", () => {
    const paid = triangleFromGrid("paid", origins, ages, [
      [100, 150],
      [110, null],
    ]);
    const caseTri = triangleFromGrid("caseReserve", origins, ages, [
      [50, 20],
      [-30, null],
    ]);
    const r = runCaseOutstanding(paid, caseTri, {
      caseSelections: [0.5],
      paidOnCaseSelections: [0.6],
      tailPaidOnCase: 1,
    });
    expect(r.warnings.join("\n")).toContain("Origin 2025: case outstanding at the seed age is negative");
    const row = r.rows.find((x) => x.origin === "2025")!;
    expect(row.unpaid).toBeLessThan(0);
  });
});

describe("netOfRecoveries: valuation-age alignment guard", () => {
  it("warns when gross and recovery diagonals sit at different ages", () => {
    const ages = [12, 24];
    // Gross observed through 24; recoveries only through 12 (slower feed).
    const grossTri = triangleFromGrid("paid", ["2025"], ages, [[100, 160]]);
    const recTri = triangleFromGrid("paid", ["2025"], ages, [[10, null]]);
    const gross = runChainLadder(grossTri, { selected: [1.6], tailFactor: 1 });
    const rec = runSalvageSubro(recTri, { selected: [2.0], tailFactor: 1 });
    const net = netOfRecoveries(gross, rec);
    expect(net.warnings.join("\n")).toContain(
      "gross projected from age 24 months but recoveries from age 12",
    );
  });
});
