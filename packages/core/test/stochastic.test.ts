import { describe, expect, it } from "vitest";
import {
  createRng,
  percentileOfSorted,
  summarizeSample,
  STANDARD_PERCENTILES,
} from "../src/stochastic.js";
import {
  addTriangles,
  cumulativeToIncremental,
  incrementalToCumulative,
  subtractTriangles,
} from "../src/triangleAlgebra.js";
import { triangleFromGrid } from "../src/triangle.js";
import { raa } from "./fixtures/mack1994raa.js";

describe("createRng", () => {
  it("is deterministic: same seed, same stream", () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 10; i++) expect(a.next()).toBe(b.next());
  });

  it("different seeds diverge", () => {
    const a = createRng(1);
    const b = createRng(2);
    const sa = Array.from({ length: 5 }, () => a.next());
    const sb = Array.from({ length: 5 }, () => b.next());
    expect(sa).not.toEqual(sb);
  });

  it("uniforms live in [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 10_000; i++) {
      const u = rng.next();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });

  it("normal() has mean ~0 and sd ~1 (seeded, so exact-tolerance)", () => {
    const rng = createRng(2024);
    const n = 40_000;
    let sum = 0;
    let ss = 0;
    for (let i = 0; i < n; i++) {
      const v = rng.normal();
      sum += v;
      ss += v * v;
    }
    const mean = sum / n;
    const sd = Math.sqrt(ss / n - mean * mean);
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(Math.abs(sd - 1)).toBeLessThan(0.02);
  });

  it("gamma(shape) has mean ~shape and variance ~shape, incl. shape < 1", () => {
    for (const shape of [0.5, 2, 7.3]) {
      const rng = createRng(99);
      const n = 40_000;
      let sum = 0;
      let ss = 0;
      for (let i = 0; i < n; i++) {
        const v = rng.gamma(shape);
        expect(v).toBeGreaterThan(0);
        sum += v;
      }
      const mean = sum / n;
      const rng2 = createRng(99);
      for (let i = 0; i < n; i++) {
        const v = rng2.gamma(shape);
        ss += (v - mean) ** 2;
      }
      const variance = ss / (n - 1);
      expect(Math.abs(mean - shape) / shape).toBeLessThan(0.03);
      expect(Math.abs(variance - shape) / shape).toBeLessThan(0.06);
    }
  });

  it("rejects non-integer seeds and non-positive gamma shapes", () => {
    expect(() => createRng(1.5)).toThrowError(/integer/);
    expect(() => createRng(3).gamma(0)).toThrowError(/positive/);
  });
});

describe("percentiles and summaries", () => {
  it("interpolates percentiles of a sorted sample", () => {
    const s = [1, 2, 3, 4, 5];
    expect(percentileOfSorted(s, 0.5)).toBe(3);
    expect(percentileOfSorted(s, 0)).toBe(1);
    expect(percentileOfSorted(s, 1)).toBe(5);
    expect(percentileOfSorted(s, 0.75)).toBe(4);
    expect(percentileOfSorted(s, 0.625)).toBeCloseTo(3.5, 12);
  });

  it("summarizeSample reports mean, sample sd, cv, and the standard percentiles", () => {
    const summary = summarizeSample([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(summary.mean).toBeCloseTo(5, 12);
    expect(summary.sd).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(summary.cv).toBeCloseTo(Math.sqrt(32 / 7) / 5, 12);
    for (const p of STANDARD_PERCENTILES) {
      expect(summary.percentiles[`p${Math.round(p * 100)}`]).toBeDefined();
    }
    expect(summary.percentiles["p50"]).toBeCloseTo(4.5, 12);
  });
});

describe("triangle algebra", () => {
  it("cumulative -> incremental -> cumulative round-trips on RAA", () => {
    const incr = cumulativeToIncremental(raa);
    const back = incrementalToCumulative(incr);
    raa.values.forEach((row, i) => {
      row.forEach((v, j) => {
        if (v === null) expect(back.values[i]![j]).toBeNull();
        else expect(back.values[i]![j]).toBeCloseTo(v, 9);
      });
    });
    // First cell is its own increment.
    expect(incr.values[0]![0]).toBe(raa.values[0]![0]);
    expect(incr.values[0]![1]).toBe(raa.values[0]![1]! - raa.values[0]![0]!);
  });

  it("an interior hole yields nulls from the hole onward (no fabrication)", () => {
    const holed = triangleFromGrid(
      "paid",
      ["a"],
      [12, 24, 36, 48],
      [[100, null, 300, 350]],
    );
    const incr = cumulativeToIncremental(holed);
    expect(incr.values[0]).toEqual([100, null, null, 50]);
    const cum = incrementalToCumulative(incr);
    // Accumulation stops at the first null.
    expect(cum.values[0]).toEqual([100, null, null, null]);
  });

  it("add/subtract are cell-wise, null-safe inverses (gross - ceded = net)", () => {
    const gross = triangleFromGrid(
      "paid",
      ["a", "b"],
      [12, 24],
      [
        [100, 180],
        [120, null],
      ],
    );
    const ceded = triangleFromGrid(
      "paid",
      ["a", "b"],
      [12, 24],
      [
        [20, 45],
        [30, null],
      ],
    );
    const net = subtractTriangles(gross, ceded);
    expect(net.values[0]).toEqual([80, 135]);
    expect(net.values[1]).toEqual([90, null]);
    const back = addTriangles(net, ceded);
    expect(back.values[0]).toEqual([100, 180]);
    expect(back.values[1]).toEqual([120, null]);
  });

  it("rejects mismatched shapes", () => {
    const a = triangleFromGrid("paid", ["a"], [12], [[1]]);
    const b = triangleFromGrid("paid", ["a", "b"], [12], [[1], [2]]);
    expect(() => addTriangles(a, b)).toThrowError(/identical origins/);
  });
});
