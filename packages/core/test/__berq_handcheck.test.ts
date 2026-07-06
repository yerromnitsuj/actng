import { describe, it } from "vitest";
import { berquistCaseAdequacy, berquistSettlement } from "../src/berquist.js";
import type { Triangle } from "../src/types.js";

function tri(kind: any, ages: number[], values: (number | null)[][]): Triangle {
  return {
    kind,
    origins: values.map((_, i) => String(2020 + i)),
    ages,
    values,
  };
}

describe("hand check", () => {
  it("prints case adequacy", () => {
    const ages = [12, 24, 36];
    const paid = tri("paid", ages, [
      [100, 200, 300],
      [110, 220, null],
      [120, null, null],
    ]);
    const incurred = tri("incurred", ages, [
      [300, 350, 360],
      [330, 396, null],
      [384, null, null],
    ]);
    const open = tri("openCount", ages, [
      [20, 10, 4],
      [20, 11, null],
      [22, null, null],
    ]);
    const r = berquistCaseAdequacy(paid, incurred, open, { severityTrend: 0.1 });
    console.log("CASE restated:", JSON.stringify(r.restatedAverageCaseReserves));
    console.log("CASE adjInc:", JSON.stringify(r.adjustedIncurred.values));
    console.log("CASE warnings:", r.warnings);
    const f = berquistCaseAdequacy(paid, incurred, open);
    console.log("FITTED trend:", f.severityTrend, f.trendSource, f.warnings);

    // Quarterly cadence: same numbers, ages [3,6,9], trend 10%/yr
    const q = (t: Triangle, kind: any): Triangle => ({ ...t, kind, ages: [3, 6, 9] });
    const rq = berquistCaseAdequacy(q(paid, "paid"), q(incurred, "incurred"), q(open, "openCount"), {
      severityTrend: 0.1,
    });
    console.log("Q restated:", JSON.stringify(rq.restatedAverageCaseReserves));
    const fq = berquistCaseAdequacy(q(paid, "paid"), q(incurred, "incurred"), q(open, "openCount"));
    console.log("Q FITTED trend:", fq.severityTrend);
  });

  it("prints settlement", () => {
    const ages = [12, 24, 36];
    const paid = tri("paid", ages, [
      [1000, 3000, 4500],
      [1200, 3400, null],
      [1300, null, null],
    ]);
    const closed = tri("closedCount", ages, [
      [100, 200, 250],
      [120, 230, null],
      [130, null, null],
    ]);
    const r = berquistSettlement(paid, closed, { ultimateCounts: [300, 320, 340] });
    console.log("SETTLE adjClosed:", JSON.stringify(r.adjustedClosedCounts));
    console.log("SETTLE adjPaid:", JSON.stringify(r.adjustedPaid.values));
    console.log("SETTLE selDisposal:", JSON.stringify(r.selectedDisposalRates));
    console.log("SETTLE warnings:", r.warnings);

    // Extrapolation-above test: make row1's target exceed its max observed closed.
    // ult row1 small => sel*ult... instead set diag disposal high via row2.
    const paid2 = tri("paid", ages, [
      [1000, 3000, 4500],
      [1200, 3400, null],
      [1300, null, null],
    ]);
    const closed2 = tri("closedCount", ages, [
      [100, 200, 250],
      [120, 230, null],
      [300, null, null], // row2 disposal 300/340 = 0.882 -> row0 target at age12 = 264.7 > 250, row1 target = 282.35 > 230
    ]);
    const r2 = berquistSettlement(paid2, closed2, { ultimateCounts: [300, 320, 340] });
    console.log("EXTRAP adjClosed:", JSON.stringify(r2.adjustedClosedCounts));
    console.log("EXTRAP adjPaid:", JSON.stringify(r2.adjustedPaid.values));
    console.log("EXTRAP warnings:", r2.warnings);

    // Below-first-point test: row2 disposal tiny -> row0/row1 age-12 targets below first point
    const closed3 = tri("closedCount", ages, [
      [100, 200, 250],
      [120, 230, null],
      [10, null, null], // sel age12 = 10/340 = 0.02941 -> row0 target 8.82 < 100, row1 target 9.41 < 120
    ]);
    const r3 = berquistSettlement(paid2, closed3, { ultimateCounts: [300, 320, 340] });
    console.log("BELOW adjPaid:", JSON.stringify(r3.adjustedPaid.values));
    console.log("BELOW warnings:", r3.warnings);

    // Zero-paid fallback: first point has paid 0
    const paid4 = tri("paid", ages, [
      [0, 3000, 4500],
      [1200, 3400, null],
      [1300, null, null],
    ]);
    const r4 = berquistSettlement(paid4, closed, { ultimateCounts: [300, 320, 340] });
    console.log("ZEROPAID adjPaid:", JSON.stringify(r4.adjustedPaid.values));
  });
});
