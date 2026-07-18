import { ReservingError } from "@actuarial-ts/core";
import {
  DEFAULT_GENERATOR,
  INTERCHANGE_SPEC_VERSION,
  type GeneratorStamp,
  stampIntegrity,
  verifyIntegrity,
} from "../envelope.js";
import {
  type StochasticResultDoc,
  stochasticResultDocSchema,
} from "../schemas/result.js";
import {
  type CrosscheckBody,
  type CrosscheckReportDoc,
  crosscheckReportDocSchema,
} from "../schemas/crosscheck.js";

/**
 * The stochastic referee (spec 5 / 16): cross-implementation comparison of two
 * StochasticResultDocs. Like `crosscheck`, it is NOT an agent — no judgment,
 * no persuasion, just tags, deviations, a derived tolerance, and a verdict.
 *
 * WHY THIS IS A SEPARATE ENTRY POINT, not an overload of `crosscheck`:
 *
 * A deterministic comparison asks "did two engines DERIVE the same number?" and
 * any deviation beyond float noise is a real disagreement. A stochastic
 * comparison usually asks something different — "did two engines DRAW from the
 * same distribution?" — and there the expected disagreement is nonzero and
 * governed by sampling theory. Applying a deterministic tolerance to two Monte
 * Carlo samples manufactures `disagree` verdicts out of ordinary sampling
 * noise. (We learned this the hard way: a sidecar test asserting 1%/5%
 * agreement between two bootstrap runs flaked ~4 times in 5, because both
 * bounds sat at or below the noise floor. See docs/interop/reproducibility.md.)
 *
 * THE TOLERANCE IS DERIVED, NOT DECLARED. For n simulations with coefficient
 * of variation CV:
 *
 *   relative MC standard error of the mean      ~= CV / sqrt(n)
 *   relative MC standard error of a sample sd   ~= 1 / sqrt(2n)
 *
 * Two independent runs differ by sqrt(2) times those, and the bound is `sigmas`
 * of that (default 4). So the referee's strictness scales correctly with n:
 * more simulations, tighter bound, automatically.
 *
 * STRICTNESS ADAPTS TO THE REPRODUCIBILITY CLASS (spec 16). If BOTH results
 * declare `seeded-reproducible` and carry the SAME seed, they are claiming
 * byte-reproducibility — sampling noise is not an excuse and the MC allowance
 * is NOT granted; they are held to `exactTolerance`. The allowance exists for
 * genuinely independent draws, not as a blanket loosening.
 */

/** Relative MC standard error of a sample mean, given the CV. */
function meanMcSe(cv: number, n: number): number {
  return cv / Math.sqrt(n);
}

/** Relative MC standard error of a sample standard deviation. */
function sdMcSe(n: number): number {
  return 1 / Math.sqrt(2 * n);
}

function relativeDeviation(x: number, y: number): number {
  const scale = Math.max(Math.abs(x), Math.abs(y));
  return scale === 0 ? 0 : Math.abs(x - y) / scale;
}

export interface CrosscheckStochasticOptions {
  a: StochasticResultDoc;
  b: StochasticResultDoc;
  /**
   * Sigmas of Monte Carlo headroom for the derived tolerance. Default 4.
   * Lower it only with a reason: at 2 sigma roughly 1 comparison in 20 of two
   * genuinely-equivalent engines will be called `disagree`.
   */
  sigmas?: number;
  /**
   * The bound applied when both sides claim `seeded-reproducible` with the
   * same seed, i.e. when they assert byte-reproducibility and the MC allowance
   * is withheld. Default 1e-9 (float noise only).
   */
  exactTolerance?: number;
  /** ISO timestamp for the report envelope (caller-supplied; purity rule). */
  createdAt: string;
  generator?: GeneratorStamp;
}

function validateInput(label: "a" | "b", doc: StochasticResultDoc): StochasticResultDoc {
  const parsed = stochasticResultDocSchema.safeParse(doc);
  if (!parsed.success) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `crosscheckStochastic input "${label}" is not a valid StochasticResultDoc: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "$"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  const integrity = verifyIntegrity(parsed.data);
  if (!integrity.ok) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `crosscheckStochastic input "${label}" fails its integrity check: stated ` +
        `${integrity.actual ?? "(none)"}, semantic body hashes to ${integrity.expected}`,
    );
  }
  return parsed.data;
}

/** `summary.mean` / `summary.sd` as numbers, or null when unusable. */
function summaryStat(doc: StochasticResultDoc, key: "mean" | "sd"): number | null {
  const value = (doc.result.summary as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function originStat(row: Record<string, unknown>, key: "mean" | "sd"): number | null {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function crosscheckStochastic(
  options: CrosscheckStochasticOptions,
): CrosscheckReportDoc {
  const a = validateInput("a", options.a);
  const b = validateInput("b", options.b);

  const sigmas = options.sigmas ?? 4;
  if (!(sigmas > 0)) {
    throw new ReservingError("BAD_INTERCHANGE", "crosscheckStochastic 'sigmas' must be positive");
  }
  const exactTolerance = options.exactTolerance ?? 1e-9;
  if (!(exactTolerance > 0)) {
    // The report schema requires positive tolerances; catching it here hands
    // the caller their own mistake instead of an internal validation dump.
    throw new ReservingError(
      "BAD_INTERCHANGE",
      "crosscheckStochastic 'exactTolerance' must be positive",
    );
  }

  const warnings: string[] = [];
  const notComparable: string[] = [];

  // --- comparability: the same tags the deterministic referee requires ---
  const aTo = a.result.appliesTo;
  const bTo = b.result.appliesTo;
  const sameTriangle = aTo.triangleIntegrity === bTo.triangleIntegrity;
  const sameSelection = aTo.selectionIntegrity === bTo.selectionIntegrity;
  if (!sameTriangle) {
    notComparable.push(
      `the results apply to different triangles (${aTo.triangleIntegrity} vs ${bTo.triangleIntegrity})`,
    );
  }
  if (!sameSelection) {
    notComparable.push(
      `the results apply to different selections (${aTo.selectionIntegrity ?? "null"} vs ` +
        `${bTo.selectionIntegrity ?? "null"}); comparability requires the same selection or both null`,
    );
  }

  const profileA = a.result.engine.conventionProfile;
  const profileB = b.result.engine.conventionProfile;
  if (profileA !== undefined && profileB !== undefined && profileA !== profileB) {
    notComparable.push(
      `the results claim different convention profiles ("${profileA}" vs "${profileB}")`,
    );
  }

  // --- comparability: origin sets ---
  const aRows = a.result.byOrigin as Array<Record<string, unknown>>;
  const bRows = b.result.byOrigin as Array<Record<string, unknown>>;
  for (const [label, rows] of [["a", aRows] as const, ["b", bRows] as const]) {
    const seen = new Set<string>();
    for (const row of rows) {
      const origin = String(row["origin"]);
      if (seen.has(origin)) {
        throw new ReservingError(
          "BAD_INTERCHANGE",
          `Result "${label}" lists origin "${origin}" more than once; per-origin comparison is ill-defined`,
        );
      }
      seen.add(origin);
    }
  }
  const bByOrigin = new Map(bRows.map((r) => [String(r["origin"]), r]));
  const aOrigins = aRows.map((r) => String(r["origin"]));
  const aOnly = aOrigins.filter((o) => !bByOrigin.has(o));
  const bOnly = bRows.map((r) => String(r["origin"])).filter((o) => !aOrigins.includes(o));
  if (aOnly.length > 0 || bOnly.length > 0) {
    notComparable.push(
      `the results cover different origin sets (only in a: [${aOnly.join(", ")}]; only in b: [${bOnly.join(", ")}])`,
    );
  }

  const comparable = notComparable.length === 0;

  // --- requested vs effective downgrade (spec 3.2 / 5) ---
  for (const [label, doc] of [
    ["a", a],
    ["b", b],
  ] as const) {
    if (doc.result.effectiveParameters !== undefined) {
      warnings.push(
        `Comparability downgrade: engine "${label}" (${doc.result.engine.name}) ran with effective ` +
          `parameters ${JSON.stringify(doc.result.effectiveParameters)} deviating from the requested ` +
          `${JSON.stringify(doc.result.parameters)}`,
      );
    }
  }

  // --- reproducibility class drives how strict we are (spec 16) ---
  const classA = a.result.reproducibility;
  const classB = b.result.reproducibility;
  const witnessed = classA === "witnessed" || classB === "witnessed";
  const sameSeed = a.result.seed !== undefined && a.result.seed === b.result.seed;
  const bothSeededReproducible =
    classA === "seeded-reproducible" && classB === "seeded-reproducible";
  // The MC allowance is for genuinely independent draws. Two results that BOTH
  // claim byte-reproducibility at the SAME seed are asserting they must match
  // exactly, so sampling noise is not available to them as an excuse.
  // ...and the SAME simulation count. A 1,000-sim and a 10,000-sim run at seed
  // 42 are legitimately different samples; holding them to float noise would
  // report that difference as a broken reproducibility promise.
  const sameNSims = a.result.nSims === b.result.nSims;
  const holdToExact = bothSeededReproducible && sameSeed && sameNSims;

  for (const [label, cls] of [
    ["a", classA],
    ["b", classB],
  ] as const) {
    if (cls === undefined) {
      warnings.push(
        `Result "${label}" does not state a reproducibility class; it is being compared as if ` +
          "independently drawn (the Monte Carlo allowance is granted). An unstated class is " +
          "unknown, not a guarantee (spec 16).",
      );
    }
  }
  if (witnessed) {
    warnings.push(
      "At least one input is WITNESSED: that engine is not byte-reproducible even at a fixed " +
        "seed, so re-running this comparison will NOT reproduce these exact numbers. Agreement " +
        "here is distributional and attests that the engines drew from the same distribution; it " +
        "is not a replay a reviewer can regenerate (spec 16).",
    );
  }
  if (holdToExact) {
    warnings.push(
      `Both inputs claim seeded-reproducible at the same seed (${a.result.seed}), so the Monte ` +
        `Carlo allowance is WITHHELD and they are held to ${exactTolerance}. Two engines that ` +
        "both promise byte-reproducibility at one seed must agree exactly.",
    );
  } else if (bothSeededReproducible && sameSeed && !sameNSims) {
    warnings.push(
      `Both inputs claim seeded-reproducible at seed ${a.result.seed}, but they ran different ` +
        `simulation counts (${a.result.nSims} vs ${b.result.nSims}), so they are different draws ` +
        "and the Monte Carlo allowance is granted.",
    );
  } else if (comparable && sameSeed && witnessed) {
    warnings.push(
      `Both inputs carry seed ${a.result.seed}, but a witnessed engine does not reproduce under ` +
        "a fixed seed, so the shared seed does not imply the samples are identical.",
    );
  }

  // --- the derived tolerance ---
  const meanA = summaryStat(a, "mean");
  const meanB = summaryStat(b, "mean");
  const sdA = summaryStat(a, "sd");
  const sdB = summaryStat(b, "sd");

  // Conservative: the smaller sample governs the noise, the larger CV governs it.
  const nEffective = Math.min(a.result.nSims, b.result.nSims);
  const cvCandidates: number[] = [];
  for (const [mean, sd] of [
    [meanA, sdA],
    [meanB, sdB],
  ] as const) {
    if (mean !== null && sd !== null && mean !== 0) cvCandidates.push(Math.abs(sd / mean));
  }
  const cv = cvCandidates.length > 0 ? Math.max(...cvCandidates) : null;

  let central: number;
  let standardError: number;
  if (holdToExact) {
    central = exactTolerance;
    standardError = exactTolerance;
  } else {
    // sqrt(2) because we compare TWO independent samples, not one against truth.
    const meanBound =
      cv !== null ? meanMcSe(cv, nEffective) * Math.SQRT2 * sigmas : Number.NaN;
    const sdBound = sdMcSe(nEffective) * Math.SQRT2 * sigmas;
    if (cv === null) {
      warnings.push(
        "Neither result carries a usable summary mean and sd, so the Monte Carlo bound on the " +
          "central estimate could not be derived; the standard-error bound is used for both.",
      );
    }
    central = Number.isFinite(meanBound) ? meanBound : sdBound;
    standardError = sdBound;
    warnings.push(
      `Tolerance DERIVED from sampling theory at n=${nEffective}` +
        (cv !== null ? `, CV=${cv.toFixed(4)}` : "") +
        `, ${sigmas} sigma: central ${central.toExponential(3)}, standard error ` +
        `${standardError.toExponential(3)}. It is not a declared constant — it tightens as n grows.`,
    );
  }

  // --- deviations, each cell judged against ITS OWN derived bound ---
  //
  // `unpaid` carries the central estimate of the reserve (the bootstrap's mean)
  // and `standardError` its dispersion (the bootstrap sd IS the estimated
  // prediction error). `ultimate` has no distributional analogue here.
  //
  // The central bound is derived PER CELL, not once from the total. A single
  // origin is far more volatile than the diversified total — on a realistic
  // Taylor/Ashe bootstrap the per-origin CV runs 0.35-0.45 against a total CV
  // near 0.15 — so judging origins by the total's bound holds them to roughly
  // 3x too tight a standard and manufactures `disagree` verdicts out of
  // ordinary sampling noise. The sd bound (1/sqrt(2n)) has no CV term, so it is
  // common to every cell.
  const centralBoundFor = (cv: number | null): number =>
    holdToExact
      ? exactTolerance
      : cv !== null
        ? meanMcSe(cv, nEffective) * Math.SQRT2 * sigmas
        : standardError;

  const cvOfCell = (mean: number | null, sd: number | null): number | null =>
    mean !== null && sd !== null && mean !== 0 ? Math.abs(sd / mean) : null;

  interface JudgedCell {
    origin: string;
    ultimate: null;
    unpaid: number | null;
    standardError: number | null;
    /** The central bound this cell was judged against (passthrough disclosure). */
    centralBound: number;
  }

  const perOrigin: JudgedCell[] = aOrigins.map((origin) => {
    const rowA = aRows.find((r) => String(r["origin"]) === origin)!;
    const rowB = bByOrigin.get(origin);
    if (rowB === undefined) {
      return { origin, ultimate: null, unpaid: null, standardError: null, centralBound: central };
    }
    const oMeanA = originStat(rowA, "mean");
    const oMeanB = originStat(rowB, "mean");
    const oSdA = originStat(rowA, "sd");
    const oSdB = originStat(rowB, "sd");
    // Conservative: the more volatile of the two engines governs this cell.
    const cvs = [cvOfCell(oMeanA, oSdA), cvOfCell(oMeanB, oSdB)].filter(
      (v): v is number => v !== null,
    );
    return {
      origin,
      ultimate: null,
      unpaid: oMeanA !== null && oMeanB !== null ? relativeDeviation(oMeanA, oMeanB) : null,
      standardError: oSdA !== null && oSdB !== null ? relativeDeviation(oSdA, oSdB) : null,
      centralBound: centralBoundFor(cvs.length > 0 ? Math.max(...cvs) : null),
    };
  });

  // A stochastic body MAY carry point estimates (`rows`/`totals`) beside the
  // distribution. Ignoring them lets two results whose point ultimates differ
  // 10x still return `agree` because the distribution summaries happen to
  // match — a hole an adversarial review found. Compare them.
  const pointStat = (
    totalsRecord: Record<string, unknown> | undefined,
    key: "ultimate" | "unpaid",
  ): number | null => {
    const value = totalsRecord?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const pointA = pointStat(a.result.totals as Record<string, unknown> | undefined, "ultimate");
  const pointB = pointStat(b.result.totals as Record<string, unknown> | undefined, "ultimate");
  const comparedPointEstimates = pointA !== null && pointB !== null;
  if (comparedPointEstimates) {
    warnings.push(
      "Both results carry POINT estimates beside the distribution; their ultimates were compared " +
        "and are reported in deviations.totals.ultimate. Note they are held to the DISTRIBUTIONAL " +
        "bound, which is loose for a deterministic quantity — run crosscheck() on the " +
        "corresponding method-result documents for a strict point-estimate comparison.",
    );
  } else if (pointA !== null || pointB !== null) {
    warnings.push(
      "Only one result carries point estimates beside its distribution; point ultimates were not " +
        "compared.",
    );
  }

  const totals: {
    ultimate: number | null;
    unpaid: number | null;
    standardError: number | null;
    [k: string]: unknown;
  } = {
    ultimate: comparedPointEstimates ? relativeDeviation(pointA, pointB) : null,
    unpaid: meanA !== null && meanB !== null ? relativeDeviation(meanA, meanB) : null,
    standardError: sdA !== null && sdB !== null ? relativeDeviation(sdA, sdB) : null,
  };

  // --- verdict ---
  let verdict: CrosscheckBody["verdict"];
  let breached: string | null = null;
  if (!comparable) {
    verdict = "not-comparable";
    warnings.push(...notComparable.map((reason) => `Not comparable: ${reason}`));
  } else {
    for (const cell of perOrigin) {
      if (cell.unpaid !== null && cell.unpaid > cell.centralBound) {
        breached = `origin ${cell.origin} central deviation ${cell.unpaid.toExponential(3)} exceeds its derived bound ${cell.centralBound.toExponential(3)}`;
        break;
      }
      if (cell.standardError !== null && cell.standardError > standardError) {
        breached = `origin ${cell.origin} standard-error deviation ${cell.standardError.toExponential(3)} exceeds the derived bound ${standardError.toExponential(3)}`;
        break;
      }
    }
    if (breached === null && totals.ultimate !== null && totals.ultimate > central) {
      breached = `total point-estimate ultimate deviation ${totals.ultimate.toExponential(3)} exceeds the derived bound ${central.toExponential(3)}`;
    }
    if (breached === null && totals.unpaid !== null && totals.unpaid > central) {
      breached = `total central deviation ${totals.unpaid.toExponential(3)} exceeds the derived bound ${central.toExponential(3)}`;
    }
    if (breached === null && totals.standardError !== null && totals.standardError > standardError) {
      breached = `total standard-error deviation ${totals.standardError.toExponential(3)} exceeds the derived bound ${standardError.toExponential(3)}`;
    }
    if (breached !== null) {
      verdict = "disagree";
      warnings.push(`Disagreement: ${breached}.`);
    } else {
      verdict = "agree";
    }
  }

  const body: CrosscheckBody = {
    engines: { a: a.result.engine, b: b.result.engine },
    appliesTo: sameTriangle && sameSelection ? aTo : null,
    parameters: {
      a: { requested: a.result.parameters, effective: a.result.effectiveParameters ?? null },
      b: { requested: b.result.parameters, effective: b.result.effectiveParameters ?? null },
    },
    tolerance: { central, standardError },
    deviations: { perOrigin, totals },
    verdict,
    warnings,
    // Passthrough: what a reader needs to interpret a distributional verdict.
    comparison: {
      kind: "distributional",
      nSims: { a: a.result.nSims, b: b.result.nSims },
      seed: { a: a.result.seed ?? null, b: b.result.seed ?? null },
      reproducibility: { a: classA ?? null, b: classB ?? null },
      monteCarloAllowance: !holdToExact,
      sigmas,
      /**
       * `tolerance.central` above is the bound applied to the TOTAL. Each
       * origin is judged against its OWN bound, derived from that origin's
       * coefficient of variation, because a single origin is materially more
       * volatile than the diversified total. Those bounds are on each
       * `deviations.perOrigin[].centralBound`.
       */
      centralBoundIsPerCell: !holdToExact,
    },
    // Cast through unknown: the body carries passthrough extras (`comparison`,
    // per-cell `centralBound`) whose zod-inferred output type is not
    // structurally assignable. crosscheckReportDocSchema.safeParse below is the
    // real check — an invalid body throws rather than escaping.
  } as unknown as CrosscheckBody;

  const doc = stampIntegrity<CrosscheckReportDoc>({
    interchangeVersion: INTERCHANGE_SPEC_VERSION,
    kind: "crosscheck-report",
    generator: options.generator ?? DEFAULT_GENERATOR,
    createdAt: options.createdAt,
    extensions: {},
    report: body,
  });
  const checked = crosscheckReportDocSchema.safeParse(doc);
  if (!checked.success) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `crosscheckStochastic produced an invalid report: ${checked.error.issues
        .map((i) => `${i.path.join(".") || "$"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return checked.data;
}
