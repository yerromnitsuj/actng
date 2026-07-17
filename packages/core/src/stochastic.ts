import { ReservingError } from "./types.js";
import { isNum } from "./util.js";

/**
 * Stochastic infrastructure: a seeded, reproducible RNG and the shared
 * result shape every simulation-based method returns.
 *
 * Ground truth:
 * - NO ambient randomness anywhere in the engine: every stochastic method
 *   takes an explicit integer seed, and the same seed + same inputs must
 *   reproduce the same output bit for bit (the reproducibility-bundle
 *   contract depends on it).
 * - The generator is mulberry32: tiny, fast, well-distributed for
 *   simulation purposes. It is NOT cryptographic and does not need to be.
 */

export interface Rng {
  /** Uniform on [0, 1). */
  next(): number;
  /** Standard normal (Box-Muller with cached spare). */
  normal(): number;
  /**
   * Gamma(shape, scale = 1) via Marsaglia-Tsang squeeze (shape >= 1) with
   * the Ahrens-Dieter boost for shape < 1.
   */
  gamma(shape: number): number;
}

/** Deterministic seeded RNG. Same seed = same stream, forever. */
export function createRng(seed: number): Rng {
  if (!Number.isInteger(seed)) {
    throw new ReservingError("BAD_SEED", "The RNG seed must be an integer");
  }
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let spare: number | null = null;
  const normal = (): number => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    // Box-Muller; u clamped away from 0 so log stays finite.
    let u = next();
    if (u < 1e-12) u = 1e-12;
    const v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    const theta = 2 * Math.PI * v;
    spare = r * Math.sin(theta);
    return r * Math.cos(theta);
  };

  const gamma = (shape: number): number => {
    if (!isNum(shape) || shape <= 0) {
      throw new ReservingError("BAD_SHAPE", "Gamma shape must be a positive number");
    }
    if (shape < 1) {
      // Ahrens-Dieter boost: G(a) = G(a+1) * U^(1/a).
      const u = Math.max(next(), 1e-12);
      return gamma(shape + 1) * Math.pow(u, 1 / shape);
    }
    // Marsaglia & Tsang (2000).
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number;
      let v: number;
      do {
        x = normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = next();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(Math.max(u, 1e-300)) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  };

  return { next, normal, gamma };
}

/** The percentiles every stochastic summary reports, as fractions. */
export const STANDARD_PERCENTILES = [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99] as const;

export interface StochasticSummary {
  mean: number;
  /** Sample standard deviation (n - 1). */
  sd: number;
  /** sd / |mean|; null when the mean is 0. */
  cv: number | null;
  /** Keyed "p50", "p75", ... per STANDARD_PERCENTILES; linear interpolation. */
  percentiles: Record<string, number>;
}

export interface StochasticOriginResult {
  origin: string;
  summary: StochasticSummary;
}

export interface StochasticResult {
  /** What the simulated quantity IS (e.g. "unpaid", "ultimate", "cdr"). */
  quantity: string;
  seed: number;
  nSims: number;
  total: StochasticSummary;
  byOrigin: StochasticOriginResult[];
  /** Total-level simulated values, ascending, for caller-side percentiles/plots. */
  totalSamples: number[];
  warnings: string[];
}

/** Linear-interpolated percentile of a SORTED ascending sample. */
export function percentileOfSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    throw new ReservingError("NO_DATA", "Cannot take a percentile of an empty sample");
  }
  if (!isNum(p) || p < 0 || p > 1) {
    throw new ReservingError("BAD_PERCENTILE", `Percentile must be in [0, 1] (got ${p})`);
  }
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (idx - lo) * (sorted[hi]! - sorted[lo]!);
}

/** Summarizes a sample (sorts a copy; the input is not mutated). */
export function summarizeSample(values: number[]): StochasticSummary {
  if (values.length < 2) {
    throw new ReservingError("TOO_SMALL", "A stochastic summary needs at least two simulations");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  let sum = 0;
  for (const v of sorted) sum += v;
  const mean = sum / n;
  let ss = 0;
  for (const v of sorted) ss += (v - mean) ** 2;
  const sd = Math.sqrt(ss / (n - 1));
  const percentiles: Record<string, number> = {};
  for (const p of STANDARD_PERCENTILES) {
    percentiles[`p${Math.round(p * 100)}`] = percentileOfSorted(sorted, p);
  }
  return { mean, sd, cv: mean === 0 ? null : sd / Math.abs(mean), percentiles };
}
