import {
  analyzeTrend,
  berquistCaseAdequacy,
  parallelogramOnLevel,
  runCapeCod,
  runExpectedClaims,
  berquistSettlement,
  buildTriangles,
  capClaims,
  claimSizeDiagnostics,
  computeDevelopmentFactors,
  factorVolatility,
  fitAllTails,
  isNum,
  fitSeverity,
  ILLUSTRATIVE_CURVES,
  latestAccidentYear,
  validateIlfTable,
  severityObservations,
  tableUncapFactor,
  uncapFactor,
  ReservingError,
  runBornhuetterFerguson,
  runChainLadder,
  runDiagnostics,
  runMack,
  type BornhuetterFergusonResult,
  type CapeCodResult,
  type ChainLadderResult,
  type ClaimSizeDiagnostics,
  type ElrMethodRow,
  type ExpectedClaimsResult,
  type ClaimSnapshot,
  type SeverityFit,
  type DevelopmentFactors,
  type DiagnosticsResult,
  type MackResult,
  type TailFit,
  type TrendFit,
  type Triangle,
  type TriangleSet,
} from "@actng/core";
import {
  defaultWorkspaceState,
  emptyLayerSelections,
  getClaims,
  getExposures,
  getWorkspaceState,
  insertAnalysis,
  latestAnalysis,
  saveWorkspaceState,
  type AnalysisRecord,
  type ElrMethod,
  type IlfState,
  type LayerKey,
  type LayerState,
  type SelectionMethodKey,
  type TrendChoice,
  type UltimateSelectionState,
  type WorkspaceState,
} from "../db/repo.js";

/**
 * The workspace service: the single implementation of "what the analysis
 * currently looks like" that both the REST API and the advisor's tools call.
 * The advisor can never bypass this layer, so anything it changes is exactly
 * what a user changing the UI would produce.
 */

export class HttpError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface WorkspaceView {
  state: WorkspaceState;
  triangles: TriangleSet;
  /** Development factors for the active basis triangle. */
  factors: { paid: DevelopmentFactors; incurred: DevelopmentFactors };
  tailFits: {
    paid: { exponentialDecay: TailFit; inversePower: TailFit };
    incurred: { exponentialDecay: TailFit; inversePower: TailFit };
  };
  diagnostics: DiagnosticsResult;
  dataAsOf: { claimRows: number; claimCount: number };
  /** Selection-of-ultimates exhibit over the latest analysis; null before any run. */
  ultimateSelection: UltimateSelectionView | null;
  /** Cap-selection evidence: claim-size distribution + layer stability comparison. */
  layerReview: LayerReview;
  /** Increased-limits exhibit data: fits, resolved factor, curve catalog. */
  ilfReview: IlfReview;
  /** Frequency/severity/trend exhibit over the latest run; null before any run. */
  trendReview: TrendReview | null;
  /** ELR compilation over the latest run; null before any run / without premium. */
  elrReview: ElrReview | null;
}

export interface IlfReview {
  config: IlfState;
  /** null until a per-occurrence cap is set (fits exist to price the layer). */
  /** Censored MLE fits at base-year cost level; null before claims exist. */
  fits: { lognormal: SeverityFit; pareto: SeverityFit } | null;
  /** The resolved uncap factor under the current config; null when unresolvable. */
  resolved: ResolvedIlf | null;
  /** Why the factor is unresolved (source none, invalid fit, missing table...). */
  unresolvedReason: string | null;
  illustrativeCurves: { id: string; label: string }[];
}

export interface ResolvedIlf {
  factor: number;
  /** Human description of the source, e.g. "fitted lognormal (mu 9.21, sigma 1.43)". */
  sourceLabel: string;
  targetLimit: number | null;
  warnings: string[];
}

/**
 * Resolves the uncap factor E[X ∧ target]/E[X ∧ cap] under the workspace's
 * ILF configuration, at the cap's base-year cost level. Returns null (with a
 * reason) rather than throwing: an unresolved factor means capped runs stay
 * honestly LIMITED.
 */
/**
 * A resolved factor beyond this is not a credible restoration - it is almost
 * always a censoring-dominated fit or a garbage table. Refusing keeps the
 * run honestly LIMITED instead of multiplying reserves into fiction.
 */
const FACTOR_SANITY_CEILING = 10;
const FACTOR_REVIEW_THRESHOLD = 3;

export function resolveIlf(
  state: WorkspaceState,
  fits: { lognormal: SeverityFit; pareto: SeverityFit } | null,
): { resolved: ResolvedIlf | null; unresolvedReason: string | null } {
  const ilf = state.ilf;
  if (ilf.source === "none") {
    return { resolved: null, unresolvedReason: "No ILF source selected" };
  }
  const cap = state.layer.cap;
  if (cap === null || cap <= 0) {
    return { resolved: null, unresolvedReason: "No per-occurrence cap is set" };
  }
  const warnings: string[] = [];
  if (state.layer.indexRate === 0) {
    warnings.push(
      "The cap is flat (index 0): real severity trend makes the true uncap factor vary by year; it is treated as constant until the trend module ships",
    );
  } else {
    warnings.push(
      `The cap index (${(state.layer.indexRate * 100).toFixed(1)}%/yr) doubles as the severity deflator: the single factor is valid to the extent the index matches real severity trend`,
    );
  }
  const guardFactor = (
    factor: number,
  ): { ok: true } | { ok: false; reason: string } => {
    if (!Number.isFinite(factor) || factor < 1) {
      return { ok: false, reason: "The resolved uncap factor is not a finite value >= 1" };
    }
    if (factor > FACTOR_SANITY_CEILING) {
      return {
        ok: false,
        reason: `The resolved uncap factor ${factor.toFixed(1)}x exceeds the ${FACTOR_SANITY_CEILING}x sanity ceiling - the severity model is not credible for restoration (typically a censoring-dominated fit); use an imported table or a different curve`,
      };
    }
    if (factor > FACTOR_REVIEW_THRESHOLD) {
      warnings.push(
        `Uncap factor ${factor.toFixed(2)}x is unusually large; verify it against the book's actual excess share before relying on it`,
      );
    }
    return { ok: true };
  };
  try {
    if (ilf.source === "table") {
      if (!ilf.table || ilf.table.length < 2) {
        return { resolved: null, unresolvedReason: "No ILF table imported" };
      }
      if (ilf.targetLimit === null) {
        return {
          resolved: null,
          unresolvedReason:
            "A table restoration needs a finite target limit (tables cannot express unlimited)",
        };
      }
      const factor = tableUncapFactor(ilf.table, cap, ilf.targetLimit);
      const guard = guardFactor(factor);
      if (!guard.ok) return { resolved: null, unresolvedReason: guard.reason };
      return {
        resolved: {
          factor,
          sourceLabel: `imported ILF table (${ilf.table.length} rows)`,
          targetLimit: ilf.targetLimit,
          warnings,
        },
        unresolvedReason: null,
      };
    }
    if (ilf.source === "illustrative") {
      const curve = ILLUSTRATIVE_CURVES.find((c) => c.id === ilf.curveId);
      if (!curve) {
        return { resolved: null, unresolvedReason: "No illustrative curve selected" };
      }
      const factor = uncapFactor(curve.distribution, cap, ilf.targetLimit);
      const curveGuard = guardFactor(factor);
      if (!curveGuard.ok) return { resolved: null, unresolvedReason: curveGuard.reason };
      warnings.push(
        "Illustrative curve: textbook-plausible parameters, NOT ISO/NCCI factors - do not book against it without judgment",
      );
      return {
        resolved: { factor, sourceLabel: curve.label, targetLimit: ilf.targetLimit, warnings },
        unresolvedReason: null,
      };
    }
    // fitted
    const fit = fits?.[ilf.fittedKind];
    if (!fit || !fit.valid) {
      return {
        resolved: null,
        unresolvedReason: `The ${ilf.fittedKind} fit is not usable${fit ? `: ${fit.warnings.join("; ")}` : ""}`,
      };
    }
    const factor = uncapFactor(fit.distribution, cap, ilf.targetLimit);
    const fitGuard = guardFactor(factor);
    if (!fitGuard.ok) return { resolved: null, unresolvedReason: fitGuard.reason };
    const d = fit.distribution;
    const paramLabel =
      d.kind === "lognormal"
        ? `mu ${d.mu.toFixed(2)}, sigma ${d.sigma.toFixed(2)}`
        : `theta ${Math.round(d.theta).toLocaleString()}, alpha ${d.alpha.toFixed(2)}`;
    return {
      resolved: {
        factor,
        sourceLabel: `fitted ${d.kind} (${paramLabel}; ${fit.nExact} closed + ${fit.nCensored} open claims)`,
        targetLimit: ilf.targetLimit,
        warnings: [...warnings, ...fit.warnings],
      },
      unresolvedReason: null,
    };
  } catch (err) {
    return {
      resolved: null,
      unresolvedReason: err instanceof Error ? err.message : "ILF resolution failed",
    };
  }
}

export interface LayerReview {
  diagnostics: ClaimSizeDiagnostics;
  /** Per-column CV of individual age-to-age factors, per basis, per layer. */
  volatility: {
    unlimited: { paid: (number | null)[]; incurred: (number | null)[] };
    /** null until a cap is set. */
    capped: { paid: (number | null)[]; incurred: (number | null)[] } | null;
  };
}

// ---------------------------------------------------------------------------
// Trends and frequency/severity

export interface TrendSeriesReview {
  fits: TrendFit[];
  selection: TrendChoice;
  /** True when a fitted-window selection no longer matches its refitted window. */
  selectionStale: boolean;
}

export interface TrendReview {
  /** Cost level the trended columns restate to (resolved). */
  targetYear: number;
  /** A-priori method: frequency/pure-premium divide by premium (loss-ratio) or units (pure-premium). */
  method: ElrMethod;
  /** Dollar level of the severity/pure-premium series (the run's exhibit level). */
  level: "unlimited" | "limited" | "restored";
  /** Which per-layer severity-trend slot this exhibit reads and writes. */
  severityLayer: LayerKey;
  rows: {
    origin: string;
    /** Fractional year for quarterly cadences (e.g. 2021Q3 -> 2021.625). */
    year: number;
    earnedPremium: number | null;
    /** Parallelogram on-level factor applied to the frequency denominator. */
    onLevelFactor: number;
    ultimateCounts: number | null;
    /** Ultimate claim counts per $1M ON-LEVEL earned premium. */
    frequency: number | null;
    /** Selected ultimate / ultimate counts, at the exhibit's dollar level. */
    severity: number | null;
    /** Selected ultimate per $1M earned premium (raw, not on-level). */
    purePremium: number | null;
    trendedFrequency: number | null;
    trendedSeverity: number | null;
  }[];
  frequency: TrendSeriesReview;
  severity: TrendSeriesReview;
  notes: string[];
}

/**
 * Origin label -> its cost-level MIDPOINT as a fractional year (annual
 * "2021" -> 2021.5; "2021Q3" -> 2021.625). Restatement targets use the same
 * convention (targetYear + 0.5), so "trended to 2025" means the midpoint of
 * accident year 2025 under EVERY cadence - an integer target on a
 * quarter-midpoint axis would silently mean January 1 instead.
 */
function originYear(origin: string): number {
  const year = Number(origin.slice(0, 4));
  const qMatch = /Q([1-4])$/.exec(origin);
  return qMatch ? year + (Number(qMatch[1]) - 0.5) / 4 : year + 0.5;
}

/**
 * The frequency/severity/trend exhibit: per-year ultimate counts, frequency
 * (per $1M earned premium - RAW premium until the rates module ships),
 * severity and pure premium from the SELECTED ultimates of the latest run,
 * log-linear trend fits over each series, and trended restatements at the
 * selected rates. Trend selections FEED the ELR machinery (BF a-priori,
 * Cape Cod, Expected Claims), so they are analysis inputs: changing them
 * flags existing results stale.
 */
export function computeTrendReview(
  state: WorkspaceState,
  record: AnalysisRecord | null,
  selectionView: UltimateSelectionView | null,
  exposures: { origin: string; earnedPremium: number | null; exposureUnits: number | null }[],
): TrendReview | null {
  if (!record || !selectionView) return null;
  const results = record.results as AnalysisResults;
  const counts = results.ultimateCounts ?? null;
  // The base for frequency/pure-premium follows the a-priori method: earned
  // premium (loss ratio) or exposure units (pure premium). Premium is expressed
  // per $1M; units per single unit.
  const isPP = state.elr.method === "pure-premium";
  const baseScale = isPP ? 1 : 1_000_000;
  const premiumByOrigin = new Map(
    exposures.map((e) => [e.origin, isPP ? e.exposureUnits : e.earnedPremium]),
  );

  const severityLayer: LayerKey = results.layer?.active ?? "unlimited";
  // Frequency divides by ON-LEVEL premium (loss-ratio): a fitted frequency trend
  // against raw premium embeds the inverse of every rate change and silently
  // double-counts once the ELR machinery on-levels the denominator again.
  // Exposure units (pure-premium) are not rate-sensitive, so they never on-level.
  const onLevelByOrigin = isPP
    ? new Map<string, number>()
    : new Map(
        parallelogramOnLevel(
          selectionView.rows.map((r) => r.origin).filter((o) => (premiumByOrigin.get(o) ?? 0) > 0),
          state.rates.history,
        ).rows.map((r) => [r.origin, r.onLevelFactor]),
      );
  const level: TrendReview["level"] =
    severityLayer === "capped" ? (results.ilf ? "restored" : "limited") : "unlimited";

  const years = selectionView.rows.map((r) => originYear(r.origin));
  const resolvedTarget =
    state.trend.targetYear ?? Math.max(...years.map((y) => Math.floor(y)));
  /** Restatement x: the midpoint of the target accident year. */
  const targetX = resolvedTarget + 0.5;

  const freqSelection = state.trend.frequency;
  const sevSelection = state.trend.severity[severityLayer];

  const rows = selectionView.rows.map((selRow) => {
    const year = originYear(selRow.origin);
    const premium = premiumByOrigin.get(selRow.origin) ?? null;
    const onLevelFactor = onLevelByOrigin.get(selRow.origin) ?? 1;
    const onLevelPremium = premium !== null ? premium * onLevelFactor : null;
    const count = counts?.[selRow.origin] ?? null;
    const frequency =
      count !== null && onLevelPremium !== null && onLevelPremium > 0
        ? count / (onLevelPremium / baseScale)
        : null;
    const severity =
      selRow.selected !== null && count !== null && count > 0 ? selRow.selected / count : null;
    const purePremium =
      selRow.selected !== null && onLevelPremium !== null && onLevelPremium > 0
        ? selRow.selected / (onLevelPremium / baseScale)
        : null;
    const trend = (value: number | null, rate: number | null): number | null =>
      value !== null && rate !== null ? value * Math.pow(1 + rate, targetX - year) : null;
    return {
      origin: selRow.origin,
      year,
      earnedPremium: premium,
      onLevelFactor,
      ultimateCounts: count,
      frequency,
      severity,
      purePremium,
      trendedFrequency: trend(frequency, freqSelection.value),
      trendedSeverity: trend(severity, sevSelection.value),
    };
  });

  const notes: string[] = [
    isPP
      ? "Frequency and pure premium divide by EXPOSURE UNITS (the pure-premium base; units are not rate-sensitive, so no on-leveling applies)"
      : state.rates.history.length > 0
        ? "Frequency and pure premium divide by ON-LEVEL earned premium (parallelogram on the rate history)"
        : "Frequency and pure premium divide by earned premium at its recorded level (no rate history imported - add one in the Rates exhibit for on-level frequency)",
    "Ultimate counts are volume-weighted chain ladder on REPORTED counts with no tail: severity is per reported claim (closed-without-payment included), and late-emerging counts on long-tail books are not tailed",
  ];
  if (level === "limited") {
    notes.push(
      "Severity and pure premium are at the LIMITED (capped) level - the excess layer is not in them",
    );
  } else if (level === "restored") {
    notes.push("Severity and pure premium are RESTORED total-limits values");
  }
  if (!counts) {
    notes.push("Ultimate claim counts are unavailable for this run; frequency and severity are blank");
  }

  const pointsPerYear = state.cadence === "quarterly" ? 4 : 1;
  const frequencyFits = analyzeTrend(
    rows.map((r) => ({ year: r.year, value: r.frequency })),
    pointsPerYear,
  ).fits;
  const severityFits = analyzeTrend(
    rows.map((r) => ({ year: r.year, value: r.severity })),
    pointsPerYear,
  ).fits;

  // A fitted-window selection whose window has since refit differently is a
  // stale judgment; label it rather than letting the source tag lie.
  const staleCheck = (selection: TrendChoice, fits: TrendFit[]): boolean => {
    if (selection.source === "manual" || selection.value === null) return false;
    const fit = fits.find((f) => f.key === selection.source);
    return !fit || fit.annualRate === null || Math.abs(fit.annualRate - selection.value) > 5e-4;
  };
  const freqStale = staleCheck(freqSelection, frequencyFits);
  const sevStale = staleCheck(sevSelection, severityFits);
  if (freqStale || sevStale) {
    notes.push(
      `${[freqStale ? "frequency" : null, sevStale ? "severity" : null]
        .filter(Boolean)
        .join(" and ")} trend selection no longer matches its refitted window (the series changed since it was selected) - re-select or treat as manual`,
    );
  }

  return {
    targetYear: resolvedTarget,
    method: state.elr.method,
    level,
    severityLayer,
    rows,
    frequency: { fits: frequencyFits, selection: freqSelection, selectionStale: freqStale },
    severity: { fits: severityFits, selection: sevSelection, selectionStale: sevStale },
    notes,
  };
}

// ---------------------------------------------------------------------------
// Expected loss ratio machinery

export interface ElrAdjustments {
  targetYear: number;
  /** Composite annual loss trend used (freq x sev); null = none selected. */
  lossTrendRate: number | null;
  byOrigin: Record<string, { lossAdj: number; premiumAdj: number; onLevelFactor: number }>;
  warnings: string[];
}

/**
 * Per-origin factors bringing losses and premium to the target cost/rate
 * level: lossAdj = composite trend (frequency x active-layer severity) from
 * the origin midpoint to the target midpoint; premiumAdj = parallelogram
 * on-level factor x premium trend over the same span.
 */
export function computeElrAdjustments(
  state: WorkspaceState,
  origins: string[],
  /**
   * The resolved target year, computed ONCE by the caller over the FULL
   * origin set - deriving it from whatever subset is passed in lets BF and
   * Cape Cod restate the same ELR to different levels in one run.
   */
  resolvedTargetYear: number,
  options: { includeSetupNotes?: boolean } = {},
): ElrAdjustments {
  const setup = options.includeSetupNotes ?? true;
  const warnings: string[] = [];
  // Pure premium divides losses by EXPOSURE UNITS, which are not rate-sensitive:
  // parallelogram on-leveling and premium trend do not apply (the base adjustment
  // is 1). Loss trend still applies to the numerator. Loss-ratio keeps the full
  // premium on-leveling below.
  const isPurePremium = state.elr.method === "pure-premium";
  const onLevel = isPurePremium
    ? { rows: [] as { origin: string; onLevelFactor: number }[], warnings: [] as string[] }
    : parallelogramOnLevel(origins, state.rates.history);
  warnings.push(...onLevel.warnings);
  if (!isPurePremium && state.rates.history.length === 0 && setup) {
    warnings.push(
      "No rate-change history: premium is treated as already on-level (factor 1)",
    );
  }
  // Premium restates to the CURRENT rate level; losses to the target-year
  // cost level. Changes effective after the target year break that pairing.
  // (Loss-ratio only - the pure-premium base does not on-level.)
  const lateChanges = isPurePremium
    ? []
    : state.rates.history.filter((rc) => Number(rc.effectiveDate.slice(0, 4)) > resolvedTargetYear);
  if (lateChanges.length > 0) {
    warnings.push(
      `${lateChanges.length} rate change(s) effective after the target year ${resolvedTargetYear}: on-level premium sits at the CURRENT rate level while losses trend to ${resolvedTargetYear} - pin the target year at or after the last rate change for a clean level match`,
    );
  }

  const freq = state.trend.frequency.value;
  const sev = state.trend.severity[state.layer.active].value;
  let lossTrendRate: number | null = null;
  if (freq !== null && sev !== null) {
    lossTrendRate = (1 + freq) * (1 + sev) - 1;
  } else if (sev !== null) {
    lossTrendRate = sev;
    if (setup) {
      warnings.push(
        "No frequency trend selected; the loss trend uses severity alone (pure-premium trend understated if frequency is drifting)",
      );
    }
  } else if (freq !== null) {
    lossTrendRate = freq;
    if (setup) {
      warnings.push(
        "No severity trend selected; the loss trend uses frequency alone (almost certainly understated)",
      );
    }
  } else if (setup) {
    warnings.push("No trend selections: losses are NOT trended (factor 1)");
  }
  const premiumTrend = isPurePremium ? null : state.rates.premiumTrend;

  const years = origins.map((o) => originYear(o));
  const targetYear = resolvedTargetYear;
  const targetX = targetYear + 0.5;

  const byOrigin: ElrAdjustments["byOrigin"] = {};
  for (let i = 0; i < origins.length; i++) {
    const origin = origins[i]!;
    const x = years[i]!;
    // Exposure units carry no on-level factor; loss-ratio premium does.
    const olf = isPurePremium ? 1 : (onLevel.rows.find((r) => r.origin === origin)?.onLevelFactor ?? 1);
    byOrigin[origin] = {
      onLevelFactor: olf,
      lossAdj: lossTrendRate !== null ? Math.pow(1 + lossTrendRate, targetX - x) : 1,
      // Loss-ratio: on-level x premium trend. Pure premium: 1 (units do not adjust).
      premiumAdj: olf * (premiumTrend !== null ? Math.pow(1 + premiumTrend, targetX - x) : 1),
    };
  }
  return { targetYear, lossTrendRate, byOrigin, warnings };
}

/** The one place the floating target year resolves: max over ALL origins. */
export function resolveElrTargetYear(state: WorkspaceState, allOrigins: string[]): number {
  return (
    state.trend.targetYear ??
    Math.max(...allOrigins.map((o) => Math.floor(originYear(o))))
  );
}

export interface ElrReview {
  targetYear: number;
  /**
   * A-priori method. "loss-ratio" -> the ratios/averages/selected are loss
   * ratios and `premium` is on-level earned premium; "pure-premium" -> they are
   * pure premiums (loss cost per unit), `premium` holds exposure UNITS, and the
   * on-level factor is always 1 (units do not on-level).
   */
  method: ElrMethod;
  /** Dollar level of the ultimates the loss ratios/pure premiums divide (the run's level). */
  level: "unlimited" | "limited" | "restored";
  rows: {
    origin: string;
    /** The exposure base: on-level earned premium (loss-ratio) or exposure units (pure-premium). */
    premium: number;
    onLevelFactor: number;
    premiumAdj: number;
    lossAdj: number;
    /** Base after adjustment: on-level trended premium (loss-ratio) or units (pure-premium, adj=1). */
    onLevelTrendedPremium: number;
    selectedUltimate: number | null;
    trendedUltimate: number | null;
    /** Trended developed ultimate / adjusted base: a loss ratio or a pure premium per `method`. */
    lossRatioAtTarget: number | null;
  }[];
  averages: { key: string; label: string; value: number | null }[];
  /** Cape Cod mechanical a-priori (loss ratio or pure premium), restated to this exhibit's level when restored. */
  capeCodElr: { paid: number | null; incurred: number | null };
  selected: number | null;
  selectedAtLevel: "unlimited" | "limited" | "restored" | null;
  warnings: string[];
}

/**
 * The ELR compilation: per-year trended developed ultimates over on-level
 * trended premium, an averages menu, and the Cape Cod mechanical ELR as the
 * cross-check. The SELECTED ELR (stored at target level) feeds BF's derived
 * a-priori and the Expected Claims method on the next run.
 */
export function computeElrReview(
  state: WorkspaceState,
  record: AnalysisRecord | null,
  selectionView: UltimateSelectionView | null,
  exposures: { origin: string; earnedPremium: number | null; exposureUnits: number | null }[],
): ElrReview | null {
  if (!record || !selectionView) return null;
  const results = record.results as AnalysisResults;
  // The base is earned premium (loss-ratio) or exposure units (pure-premium).
  const method = state.elr.method;
  const isPP = method === "pure-premium";
  const aprioriWord = isPP ? "pure premium" : "ELR";
  const baseByOrigin = new Map(
    exposures.map((e) => [e.origin, isPP ? e.exposureUnits : e.earnedPremium]),
  );
  const origins = selectionView.rows.map((r) => r.origin);
  const withPremium = origins.filter((o) => (baseByOrigin.get(o) ?? 0) > 0);
  if (withPremium.length === 0) return null;

  const resolvedTarget = resolveElrTargetYear(
    state,
    selectionView.rows.map((r) => r.origin),
  );
  const adj = computeElrAdjustments(state, withPremium, resolvedTarget);
  const level: ElrReview["level"] =
    (results.layer?.active ?? "unlimited") === "capped"
      ? results.ilf
        ? "restored"
        : "limited"
      : "unlimited";
  const warnings = [...adj.warnings];
  if (level === "limited") {
    warnings.push(
      `Ultimates are at the LIMITED (capped) level: this ${aprioriWord} excludes the excess layer - restore before selecting, or select a limited ${aprioriWord} knowingly`,
    );
  }

  const rows = withPremium.map((origin) => {
    const premium = baseByOrigin.get(origin)!;
    const a = adj.byOrigin[origin]!;
    const selRow = selectionView.rows.find((r) => r.origin === origin)!;
    const selectedUltimate = selRow.selected;
    const trendedUltimate = selectedUltimate !== null ? selectedUltimate * a.lossAdj : null;
    const onLevelTrendedPremium = premium * a.premiumAdj;
    return {
      origin,
      premium,
      onLevelFactor: a.onLevelFactor,
      premiumAdj: a.premiumAdj,
      lossAdj: a.lossAdj,
      onLevelTrendedPremium,
      selectedUltimate,
      trendedUltimate,
      lossRatioAtTarget:
        trendedUltimate !== null && onLevelTrendedPremium > 0
          ? trendedUltimate / onLevelTrendedPremium
          : null,
    };
  });

  const usable = rows.filter((r) => r.lossRatioAtTarget !== null);
  const straight = (xs: typeof usable): number | null =>
    xs.length > 0 ? xs.reduce((a, r) => a + r.lossRatioAtTarget!, 0) / xs.length : null;
  const weighted = (xs: typeof usable): number | null => {
    const prem = xs.reduce((a, r) => a + r.onLevelTrendedPremium, 0);
    return prem > 0 ? xs.reduce((a, r) => a + r.trendedUltimate!, 0) / prem : null;
  };
  const exHiLo = (): number | null => {
    if (usable.length < 5) return null;
    const sorted = [...usable].sort((a, b) => a.lossRatioAtTarget! - b.lossRatioAtTarget!);
    return straight(sorted.slice(1, -1));
  };
  // Windows span YEARS (a quarterly book's "last 5 years" is 20 quarters),
  // anchored at the newest usable origin - never sliding back over gaps.
  const maxUsableYear = usable.length > 0 ? Math.max(...usable.map((r) => originYear(r.origin))) : 0;
  const lastYears = (n: number) => usable.filter((r) => originYear(r.origin) > maxUsableYear - n);
  const averages: ElrReview["averages"] = [
    {
      key: "wtd-all",
      label: isPP ? "Exposure-weighted, all years" : "Premium-weighted, all years",
      value: weighted(usable),
    },
    { key: "all", label: "Straight average, all years", value: straight(usable) },
    { key: "last5", label: "Straight, last 5 years", value: straight(lastYears(5)) },
    { key: "last3", label: "Straight, last 3 years", value: straight(lastYears(3)) },
    { key: "exhilo", label: "Ex high/low", value: exHiLo() },
  ];

  // Circularity disclosure: these loss ratios divide the SELECTED blend; any
  // weight on a-priori methods (BF/CC/EC) makes the exhibit partially
  // reproduce whatever ELR fed those methods.
  let aprioriWeight = 0;
  let totalWeight = 0;
  for (const selRow of selectionView.rows) {
    for (const [key, w] of Object.entries(selRow.weights)) {
      totalWeight += w;
      if (["bfPaid", "bfIncurred", "ccPaid", "ccIncurred", "expectedClaims"].includes(key)) {
        aprioriWeight += w;
      }
    }
  }
  if (totalWeight > 0 && aprioriWeight > 0) {
    warnings.push(
      `${Math.round((aprioriWeight / totalWeight) * 100)}% of the blended weight sits on a-priori methods (BF/Cape Cod/Expected Claims): these ${isPP ? "pure premiums" : "loss ratios"} partially SELF-CONFIRM the prior ${aprioriWord} - anchor the selection on development-heavy weights, or read the averages as anchored accordingly`,
    );
  }

  // The Cape Cod cross-check is the RUN's mechanical a-priori, native to the
  // method the run used. If the method has since been toggled (live, no rerun)
  // the value is in the wrong unit - a pure premium ($/unit) is not a loss ratio.
  // Hide it until a rerun rather than mislabel a $454 pure premium as "45431%".
  const runMethod = results.aprioriMethod ?? "loss-ratio";
  const ccInThisMethod = runMethod === method;
  if (!ccInThisMethod) {
    warnings.push(
      `The a-priori method changed to ${method === "pure-premium" ? "pure premium" : "loss ratio"} since this run - rerun to refresh the exhibit (the Cape Cod cross-check, native to the run's ${runMethod === "pure-premium" ? "pure-premium" : "loss-ratio"} basis, is hidden until then)`,
    );
  }
  const restateCc = (v: number | null): number | null =>
    !ccInThisMethod
      ? null
      : v !== null && level === "restored" && results.ilf
        ? v * results.ilf.factor
        : v;
  if (ccInThisMethod && level === "restored" && results.ilf) {
    warnings.push(
      `The Cape Cod cross-check is restated x${results.ilf.factor.toFixed(4)} to total limits so it compares to these restored-level ratios`,
    );
  }
  if (state.elr.selectedAtLevel !== null && state.elr.selectedAtLevel !== level) {
    warnings.push(
      `The selected ${aprioriWord} was chosen at the ${state.elr.selectedAtLevel} level but this exhibit is at the ${level} level - re-select before relying on it`,
    );
  }

  return {
    targetYear: adj.targetYear,
    method,
    level,
    rows,
    averages,
    // The mechanical Cape Cod ELR is native to the run's layer; on restored
    // exhibits it is restated by the run's uncap factor so the cross-check
    // and the rows sit at the SAME dollar level.
    capeCodElr: {
      paid: restateCc(results.capeCod?.paid?.elrAtTargetLevel ?? null),
      incurred: restateCc(results.capeCod?.incurred?.elrAtTargetLevel ?? null),
    },
    selected: state.elr.selected,
    selectedAtLevel: state.elr.selectedAtLevel,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Selection of ultimates

export const SELECTION_METHODS: { key: SelectionMethodKey; label: string }[] = [
  { key: "clPaid", label: "Chain Ladder - paid" },
  { key: "clIncurred", label: "Chain Ladder - incurred" },
  { key: "bfPaid", label: "Bornhuetter-Ferguson - paid" },
  { key: "bfIncurred", label: "Bornhuetter-Ferguson - incurred" },
  { key: "bsCase", label: "Berquist-Sherman case adequacy - incurred" },
  { key: "bsSettlement", label: "Berquist-Sherman settlement rate - paid" },
  { key: "ccPaid", label: "Cape Cod - paid" },
  { key: "ccIncurred", label: "Cape Cod - incurred" },
  { key: "expectedClaims", label: "Expected Claims (a-priori)" },
];

export interface UltimateSelectionRow {
  origin: string;
  /** Indicated ultimate per method; null where the method has no value. */
  ultimates: Record<SelectionMethodKey, number | null>;
  /** The method weights in force for THIS origin period. */
  weights: Record<SelectionMethodKey, number>;
  /** True when this period's weights differ from the all-periods defaults. */
  customWeights: boolean;
  /** Weight-blended ultimate (this period's weights, renormalized over available methods). */
  weighted: number | null;
  /** Manual override, when set. */
  override: number | null;
  /** override ?? weighted. */
  selected: number | null;
  latestPaid: number;
  latestIncurred: number;
  ibnr: number | null;
  unpaid: number | null;
  /**
   * RESTORED runs only: true when this year's restored blend sits BELOW its
   * unlimited reported incurred - realized large-loss excess exceeds the
   * book-average restoration, so the uniform factor understates this year.
   */
  restorationShortfall: boolean;
}

export interface UltimateSelectionView {
  analysisId: string;
  analysisLabel: string;
  analysisRanAt: string;
  /** The development layer the blended run was built on. */
  layer: LayerState;
  /** Set when capped ultimates were restored to total limits for display. */
  restored: ResolvedIlf | null;
  /** The all-periods default weight per method. */
  methods: { key: SelectionMethodKey; label: string; weight: number }[];
  rows: UltimateSelectionRow[];
  totals: {
    latestPaid: number;
    latestIncurred: number;
    weighted: number | null;
    selected: number | null;
    ibnr: number | null;
    unpaid: number | null;
    /** Origins with no weighted value and no override (excluded from totals). */
    unselectedOrigins: string[];
  };
}

/**
 * Blends each origin period's method ultimates using that PERIOD's method
 * weights (per-origin entries where present, the all-periods defaults
 * otherwise), renormalized over the methods that produced a value for the
 * period, then applies any per-period manual override. IBNR and unpaid
 * derive from the selected ultimate against that period's latest diagonals.
 */
export function computeUltimateSelection(
  record: AnalysisRecord,
  selection: UltimateSelectionState,
): UltimateSelectionView {
  const results = record.results as AnalysisResults;
  const byOrigin = new Map<
    string,
    { ultimates: Partial<Record<SelectionMethodKey, number>>; latestPaid: number; latestIncurred: number }
  >();
  const ensure = (origin: string) => {
    let entry = byOrigin.get(origin);
    if (!entry) {
      entry = { ultimates: {}, latestPaid: 0, latestIncurred: 0 };
      byOrigin.set(origin, entry);
    }
    return entry;
  };

  const originOrder: string[] = [];
  for (const row of results.chainLadder.paid.rows) {
    originOrder.push(row.origin);
    const entry = ensure(row.origin);
    entry.ultimates.clPaid = row.ultimate;
    entry.latestPaid = row.latestValue;
  }
  for (const row of results.chainLadder.incurred.rows) {
    if (!byOrigin.has(row.origin)) originOrder.push(row.origin);
    const entry = ensure(row.origin);
    entry.ultimates.clIncurred = row.ultimate;
    entry.latestIncurred = row.latestValue;
  }
  for (const row of results.bornhuetterFerguson.paid?.rows ?? []) {
    ensure(row.origin).ultimates.bfPaid = row.ultimate;
  }
  for (const row of results.bornhuetterFerguson.incurred?.rows ?? []) {
    ensure(row.origin).ultimates.bfIncurred = row.ultimate;
  }
  for (const row of results.berquistSherman.caseAdequacy?.chainLadder.rows ?? []) {
    ensure(row.origin).ultimates.bsCase = row.ultimate;
  }
  for (const row of results.berquistSherman.settlement?.chainLadder.rows ?? []) {
    ensure(row.origin).ultimates.bsSettlement = row.ultimate;
  }
  for (const row of results.capeCod?.paid?.rows ?? []) {
    ensure(row.origin).ultimates.ccPaid = row.ultimate;
  }
  for (const row of results.capeCod?.incurred?.rows ?? []) {
    ensure(row.origin).ultimates.ccIncurred = row.ultimate;
  }
  for (const row of results.expectedClaims?.rows ?? []) {
    ensure(row.origin).ultimates.expectedClaims = row.ultimate;
  }

  // Restoration to total limits: capped runs with a resolved uncap factor
  // display restored ultimates blended against UNLIMITED diagonals.
  const restored = results.layer?.active === "capped" && results.ilf ? results.ilf : null;
  if (restored) {
    for (const [origin, entry] of byOrigin) {
      for (const key of Object.keys(entry.ultimates) as SelectionMethodKey[]) {
        const v = entry.ultimates[key];
        if (v !== undefined) entry.ultimates[key] = v * restored.factor;
      }
      const diag = results.unlimitedDiagonals?.[origin];
      if (diag) {
        entry.latestPaid = diag.paid;
        entry.latestIncurred = diag.incurred;
      }
    }
  }

  const rows: UltimateSelectionRow[] = originOrder.map((origin) => {
    const entry = byOrigin.get(origin)!;
    const ultimates = Object.fromEntries(
      SELECTION_METHODS.map((m) => [m.key, entry.ultimates[m.key] ?? null]),
    ) as Record<SelectionMethodKey, number | null>;

    const perOrigin = selection.weightsByOrigin[origin];
    const weights = Object.fromEntries(
      SELECTION_METHODS.map((m) => [
        m.key,
        perOrigin?.[m.key] ?? selection.defaultWeights[m.key] ?? 0,
      ]),
    ) as Record<SelectionMethodKey, number>;
    const customWeights = SELECTION_METHODS.some(
      (m) => weights[m.key] !== (selection.defaultWeights[m.key] ?? 0),
    );

    let weightSum = 0;
    let blend = 0;
    for (const m of SELECTION_METHODS) {
      const w = weights[m.key];
      const u = ultimates[m.key];
      if (w > 0 && u !== null && Number.isFinite(u)) {
        weightSum += w;
        blend += w * u;
      }
    }
    const weighted = weightSum > 0 ? blend / weightSum : null;
    const restorationShortfall =
      restored !== null && weighted !== null && weighted < entry.latestIncurred;
    const rawOverride = selection.overrides[origin];
    const override =
      typeof rawOverride === "number" && Number.isFinite(rawOverride) && rawOverride > 0
        ? rawOverride
        : null;
    const selected = override ?? weighted;
    return {
      origin,
      ultimates,
      weights,
      customWeights,
      weighted,
      override,
      selected,
      latestPaid: entry.latestPaid,
      latestIncurred: entry.latestIncurred,
      restorationShortfall,
      ibnr: selected !== null ? selected - entry.latestIncurred : null,
      unpaid: selected !== null ? selected - entry.latestPaid : null,
    };
  });

  const unselectedOrigins = rows.filter((r) => r.selected === null).map((r) => r.origin);
  const sum = (pick: (r: UltimateSelectionRow) => number | null): number | null => {
    let total = 0;
    let any = false;
    for (const r of rows) {
      const v = pick(r);
      if (v !== null) {
        total += v;
        any = true;
      }
    }
    return any ? total : null;
  };

  return {
    analysisId: record.id,
    analysisLabel: record.label,
    layer: results.layer ?? { active: "unlimited", cap: null, indexRate: 0, baseYear: null },
    restored,
    analysisRanAt: results.ranAt,
    methods: SELECTION_METHODS.map((m) => ({
      ...m,
      weight: selection.defaultWeights[m.key] ?? 0,
    })),
    rows,
    totals: {
      latestPaid: rows.reduce((a, r) => a + r.latestPaid, 0),
      latestIncurred: rows.reduce((a, r) => a + r.latestIncurred, 0),
      weighted: sum((r) => r.weighted),
      selected: sum((r) => r.selected),
      ibnr: sum((r) => r.ibnr),
      unpaid: sum((r) => r.unpaid),
      unselectedOrigins,
    },
  };
}

function latestEvaluationDate(projectId: string): string | null {
  const claims = getClaims(projectId);
  if (claims.length === 0) return null;
  let latest = claims[0]!.evaluationDate;
  for (const c of claims) if (c.evaluationDate > latest) latest = c.evaluationDate;
  return latest;
}

export function ensureWorkspaceState(projectId: string): WorkspaceState {
  const existing = getWorkspaceState(projectId);
  if (existing) return existing;
  const asOf = latestEvaluationDate(projectId) ?? new Date().toISOString().slice(0, 10);
  const state = defaultWorkspaceState(asOf);
  saveWorkspaceState(projectId, state);
  return state;
}

/** The active layer's selections; capped and unlimited are independent. */
export function activeSelections(state: WorkspaceState) {
  return state.selections[state.layer.active];
}

/** The active layer's tail choices. */
export function activeTail(state: WorkspaceState) {
  return state.tail[state.layer.active];
}

/** The active layer's BF a-priori override. */
export function activeBf(state: WorkspaceState) {
  return state.bf[state.layer.active];
}

/** The active layer's Berquist-Sherman assumptions. */
export function activeBerquist(state: WorkspaceState) {
  return state.berquist[state.layer.active];
}

/** Caps the claim set at the workspace's per-occurrence limit. */
function capProjectClaims(claims: Parameters<typeof capClaims>[0], state: WorkspaceState) {
  if (state.layer.cap === null || state.layer.cap <= 0) {
    throw new HttpError(
      422,
      "CAP_REQUIRED",
      "The capped layer is active but no per-occurrence cap is set",
    );
  }
  return capClaims(claims, {
    cap: state.layer.cap,
    indexRate: state.layer.indexRate,
    // Resolve the default base year with the SAME convention the exhibits
    // use (latest accident year evaluated on or before asOfDate) - a
    // divergent default silently shifts every applied cap.
    baseYear: state.layer.baseYear ?? latestAccidentYear(claims, state.asOfDate),
  });
}

/** Builds one layer's triangle set from raw claims. */
function buildLayerTriangles(
  claims: Parameters<typeof buildTriangles>[0],
  state: WorkspaceState,
  layer: LayerKey,
): TriangleSet {
  const input = layer === "capped" ? capProjectClaims(claims, state) : claims;
  try {
    return buildTriangles(input, { cadence: state.cadence, asOfDate: state.asOfDate });
  } catch (err) {
    if (err instanceof ReservingError) {
      throw new HttpError(422, err.code, err.message);
    }
    throw err;
  }
}

/** Memo for the censored severity MLEs, keyed on everything that feeds them. */
const severityFitCache = new Map<
  string,
  { key: string; fits: { lognormal: SeverityFit; pareto: SeverityFit } }
>();

function getSeverityFits(
  projectId: string,
  claims: ClaimSnapshot[],
  state: WorkspaceState,
): { lognormal: SeverityFit; pareto: SeverityFit } {
  const capBaseYear = state.layer.baseYear ?? latestAccidentYear(claims, state.asOfDate);
  let checksum = 0;
  for (const c of claims) checksum += c.paidToDate + c.caseReserve;
  const key = `${claims.length}:${checksum}:${state.asOfDate}:${state.layer.indexRate}:${capBaseYear}`;
  const cached = severityFitCache.get(projectId);
  if (cached && cached.key === key) return cached.fits;
  const observations = severityObservations(claims, {
    asOfDate: state.asOfDate,
    indexRate: state.layer.indexRate,
    baseYear: capBaseYear,
  });
  const fits = {
    lognormal: fitSeverity(observations, "lognormal"),
    pareto: fitSeverity(observations, "pareto"),
  };
  severityFitCache.set(projectId, { key, fits });
  return fits;
}

/**
 * The ACTIVE layer's triangles: the one seam where the layer dial is
 * resolved. Everything downstream (factors, tails, methods, Mack,
 * diagnostics) consumes triangles unchanged.
 */
export function buildProjectTriangles(projectId: string, state: WorkspaceState): TriangleSet {
  const claims = getClaims(projectId);
  if (claims.length === 0) {
    throw new HttpError(
      422,
      "NO_CLAIMS",
      "This project has no claim data yet; import a loss run first",
    );
  }
  return buildLayerTriangles(claims, state, state.layer.active);
}

/** Resizes a selections vector to the triangle's column count, preserving overlap. */
function fitSelections(selected: (number | null)[], nColumns: number): (number | null)[] {
  const out: (number | null)[] = new Array(nColumns).fill(null);
  for (let j = 0; j < Math.min(nColumns, selected.length); j++) out[j] = selected[j] ?? null;
  return out;
}

export function getWorkspaceView(projectId: string): WorkspaceView {
  const state = ensureWorkspaceState(projectId);
  const claims = getClaims(projectId);
  if (claims.length === 0) {
    throw new HttpError(
      422,
      "NO_CLAIMS",
      "This project has no claim data yet; import a loss run first",
    );
  }
  const capSet = state.layer.cap !== null && state.layer.cap > 0;
  const unlimitedSet = buildLayerTriangles(claims, state, "unlimited");
  const cappedSet = capSet ? buildLayerTriangles(claims, state, "capped") : null;
  const triangles = state.layer.active === "capped" ? cappedSet! : unlimitedSet;
  const nCols = Math.max(0, triangles.paid.ages.length - 1);

  // Keep stored selections consistent with the current triangle shape - both
  // layers share origins/ages (same claims), so fit all four vectors.
  // In-memory only: persisting on a pure GET would make every page view a
  // one-way schema migration (fitSelections is deterministic, so nothing is
  // lost by refitting on each read; mutations persist via patchWorkspace).
  for (const layer of ["unlimited", "capped"] as const) {
    for (const basis of ["paid", "incurred"] as const) {
      state.selections[layer][basis] = fitSelections(state.selections[layer][basis], nCols);
    }
  }

  // Cap-selection evidence for the Layer exhibit.
  const layerReview: LayerReview = {
    diagnostics: claimSizeDiagnostics(claims, {
      asOfDate: state.asOfDate,
      indexRate: state.layer.indexRate,
      // Same base-year convention as the applied caps (capProjectClaims).
      baseYear: state.layer.baseYear ?? latestAccidentYear(claims, state.asOfDate),
      extraCaps: capSet ? [state.layer.cap!] : undefined,
    }),
    volatility: {
      unlimited: {
        paid: factorVolatility(computeDevelopmentFactors(unlimitedSet.paid)),
        incurred: factorVolatility(computeDevelopmentFactors(unlimitedSet.incurred)),
      },
      capped: cappedSet
        ? {
            paid: factorVolatility(computeDevelopmentFactors(cappedSet.paid)),
            incurred: factorVolatility(computeDevelopmentFactors(cappedSet.incurred)),
          }
        : null,
    },
  };

  // Severity fits only when a cap exists (they exist to price the layer) and
  // memoized per data shape: two censored MLEs are ~0.4s at 10k claims and
  // getWorkspaceView runs on every patch and advisor tool call.
  const fits = capSet ? getSeverityFits(projectId, claims, state) : null;
  const ilfResolution = resolveIlf(state, fits);
  const ilfReview: IlfReview = {
    config: state.ilf,
    fits,
    resolved: ilfResolution.resolved,
    unresolvedReason: ilfResolution.unresolvedReason,
    illustrativeCurves: ILLUSTRATIVE_CURVES.map((c) => ({ id: c.id, label: c.label })),
  };

  const latest = latestAnalysis(projectId);
  const ultimateSelection = latest
    ? computeUltimateSelection(latest, state.ultimateSelection)
    : null;
  return {
    state,
    triangles,
    layerReview,
    ilfReview,
    trendReview: computeTrendReview(state, latest, ultimateSelection, getExposures(projectId)),
    elrReview: computeElrReview(state, latest, ultimateSelection, getExposures(projectId)),
    ultimateSelection,
    factors: {
      paid: computeDevelopmentFactors(triangles.paid),
      incurred: computeDevelopmentFactors(triangles.incurred),
    },
    tailFits: {
      paid: fitAllTails(activeSelections(state).paid),
      incurred: fitAllTails(activeSelections(state).incurred),
    },
    diagnostics: runDiagnostics({
      paid: triangles.paid,
      incurred: triangles.incurred,
      openCounts: triangles.openCount,
      reportedCounts: triangles.reportedCount,
      closedCounts: triangles.closedCount,
    }),
    dataAsOf: {
      claimRows: claims.length,
      claimCount: new Set(claims.map((c) => c.claimId)).size,
    },
  };
}

export interface WorkspacePatch {
  cadence?: WorkspaceState["cadence"];
  asOfDate?: string;
  basis?: WorkspaceState["basis"];
  layer?: {
    active?: LayerKey;
    cap?: number | null;
    indexRate?: number;
    baseYear?: number | null;
  };
  rates?: {
    history?: { effectiveDate: string; change: number }[];
    premiumTrend?: number | null;
  };
  elr?: { method?: ElrMethod; selected?: number | null };
  trend?: {
    frequency?: TrendChoice;
    severity?: { layer: LayerKey; source: TrendChoice["source"]; value: number | null };
    targetYear?: number | null;
  };
  ilf?: {
    source?: IlfState["source"];
    fittedKind?: IlfState["fittedKind"];
    curveId?: string | null;
    targetLimit?: number | null;
    table?: IlfState["table"];
  };
  selections?: { basis: "paid" | "incurred"; selected: (number | null)[] };
  tail?: {
    basis: "paid" | "incurred";
    source: "manual" | "exponentialDecay" | "inversePower";
    value?: number;
  };
  bf?: { aprioriLossRatio: number | null };
  berquist?: { severityTrend?: number | null; interpolation?: "exponential" | "linear" };
  ultimateSelection?: {
    /**
     * "All periods" weight updates (non-negative): sets the default AND
     * overwrites any per-period entry for that method.
     */
    weights?: Partial<Record<SelectionMethodKey, number>>;
    /** Per-origin-period weight updates, merged onto that period's weights. */
    weightsByOrigin?: Record<string, Partial<Record<SelectionMethodKey, number>>>;
    /** Per-origin override updates; null clears the override for that origin. */
    overrides?: Record<string, number | null>;
  };
}

export function patchWorkspace(projectId: string, patch: WorkspacePatch): WorkspaceView {
  // Validate the ENTIRE patch against an in-memory copy first; persist once
  // at the end. A rejected patch must leave the stored workspace untouched.
  const state = ensureWorkspaceState(projectId);

  if (patch.cadence && patch.cadence !== state.cadence) {
    state.cadence = patch.cadence;
    state.selections = emptyLayerSelections();
  }
  if (patch.asOfDate && patch.asOfDate !== state.asOfDate) {
    state.asOfDate = patch.asOfDate;
    state.selections = emptyLayerSelections();
  }
  if (patch.basis) state.basis = patch.basis;
  if (patch.layer) {
    const l = patch.layer;
    const before = { ...state.layer };
    if (l.cap !== undefined) {
      if (l.cap !== null && (!isNum(l.cap) || l.cap <= 0)) {
        throw new HttpError(422, "BAD_CAP", "The per-occurrence cap must be a positive number");
      }
      state.layer.cap = l.cap;
    }
    if (l.indexRate !== undefined) {
      if (!isNum(l.indexRate) || l.indexRate <= -1) {
        throw new HttpError(
          422,
          "BAD_CAP",
          "The cap index rate must be a number greater than -100%",
        );
      }
      state.layer.indexRate = l.indexRate;
    }
    if (l.baseYear !== undefined) {
      if (
        l.baseYear !== null &&
        (!Number.isInteger(l.baseYear) || l.baseYear < 1900 || l.baseYear > 2200)
      ) {
        throw new HttpError(
          422,
          "BAD_CAP",
          "The cap base year must be a year between 1900 and 2200, or null",
        );
      }
      state.layer.baseYear = l.baseYear;
    }
    if (l.active) state.layer.active = l.active;
    if (state.layer.active === "capped" && (state.layer.cap === null || state.layer.cap <= 0)) {
      throw new HttpError(
        422,
        "CAP_REQUIRED",
        "Set a per-occurrence cap before activating the capped layer",
      );
    }

    // Changing cap/indexRate/baseYear REDEFINES the capped triangles, so
    // judgments made against the old layer are invalid: clear the capped
    // selections and re-fit the capped tails (the same principle as the
    // cadence/asOfDate resets above). A no-op patch changes nothing.
    const capParamsChanged =
      state.layer.cap !== before.cap ||
      state.layer.indexRate !== before.indexRate ||
      state.layer.baseYear !== before.baseYear;
    // Fit pristine capped tails only when the patch actually TRANSITIONS
    // into the capped layer - a deliberate manual unit tail must survive
    // unrelated layer patches (value equality is not intent).
    const activatedCapped = before.active !== "capped" && state.layer.active === "capped";
    const cappedPristine =
      state.tail.capped.paid.source === "manual" &&
      state.tail.capped.paid.value === 1 &&
      state.tail.capped.incurred.source === "manual" &&
      state.tail.capped.incurred.value === 1;

    if (capParamsChanged) {
      state.selections.capped = { paid: [], incurred: [] };
    }
    // Overrides are dollar judgments at a specific exhibit level; a layer
    // switch or cap redefinition changes that level, so they cannot survive.
    if (capParamsChanged || state.layer.active !== before.active) {
      state.ultimateSelection.overrides = {};
    }
    // The capped severity-trend selection was fitted on the OLD capped
    // series; a redefined cap changes that series (same principle as the
    // selections/tails/overrides resets above).
    if (capParamsChanged) {
      state.trend.severity.capped = { source: "manual", value: null };
    }
    const capSet = state.layer.cap !== null && state.layer.cap > 0;
    if (capSet && (capParamsChanged || (activatedCapped && cappedPristine))) {
      const cappedTriangles = buildLayerTriangles(getClaims(projectId), state, "capped");
      for (const basis of ["paid", "incurred"] as const) {
        const dev = computeDevelopmentFactors(cappedTriangles[basis]);
        const vw = dev.averages.find((a) => a.spec.key === "all-wtd")?.values ?? [];
        const fits = fitAllTails(vw);
        const candidates = [fits.exponentialDecay, fits.inversePower].filter((f) => f.valid);
        if (candidates.length === 0) {
          // Honest fallback: a redefined layer resets to a unit tail rather
          // than keeping a tail fitted to different data.
          if (capParamsChanged) {
            state.tail.capped[basis] = { source: "manual", value: 1 };
          }
          continue;
        }
        const best = candidates.reduce((a, b) => (b.rSquared > a.rSquared ? b : a));
        state.tail.capped[basis] = { source: best.method, value: best.tailFactor };
      }
    }
  }
  if (patch.ilf) {
    const i = patch.ilf;
    const ilfBefore = JSON.stringify(state.ilf);
    if (i.table !== undefined) {
      // Same structural validation as the import route, so garbage never
      // persists regardless of which door it came through.
      if (i.table !== null) {
        try {
          state.ilf.table = validateIlfTable(i.table);
        } catch (err) {
          if (err instanceof ReservingError) {
            throw new HttpError(422, err.code, err.message);
          }
          throw err;
        }
      } else {
        state.ilf.table = null;
      }
    }
    if (i.source) {
      // Guard against the POST-patch table so {source:'table', table:null}
      // in one patch cannot defeat it.
      if (i.source === "table" && !state.ilf.table) {
        throw new HttpError(422, "NO_TABLE", "Import an ILF table before selecting the table source");
      }
      state.ilf.source = i.source;
    }
    if (i.fittedKind) state.ilf.fittedKind = i.fittedKind;
    if (i.curveId !== undefined) {
      if (i.curveId !== null && !ILLUSTRATIVE_CURVES.some((c) => c.id === i.curveId)) {
        throw new HttpError(422, "BAD_CURVE", "Unknown illustrative curve id");
      }
      state.ilf.curveId = i.curveId;
    }
    if (i.targetLimit !== undefined) {
      if (i.targetLimit !== null && (!isNum(i.targetLimit) || i.targetLimit <= 0)) {
        throw new HttpError(422, "BAD_LIMIT", "The restoration target limit must be a positive number or null (unlimited)");
      }
      state.ilf.targetLimit = i.targetLimit;
    }
    // A changed restoration config changes the level the selection exhibit
    // is stated at; dollar overrides typed against the old level are void,
    // and so is a capped severity trend fitted at the old level
    // (limited <-> restored flips the series' dollar basis).
    if (JSON.stringify(state.ilf) !== ilfBefore) {
      state.ultimateSelection.overrides = {};
      state.trend.severity.capped = { source: "manual", value: null };
    }
  }
  if (patch.trend) {
    const t = patch.trend;
    const validateRate = (v: number | null) => {
      if (v !== null && (!isNum(v) || v <= -1)) {
        throw new HttpError(422, "BAD_TREND", "A trend rate must be a number greater than -100%");
      }
    };
    if (t.frequency) {
      validateRate(t.frequency.value);
      state.trend.frequency = { source: t.frequency.source, value: t.frequency.value };
    }
    if (t.severity) {
      validateRate(t.severity.value);
      state.trend.severity[t.severity.layer] = {
        source: t.severity.source,
        value: t.severity.value,
      };
    }
    if (t.targetYear !== undefined) {
      if (
        t.targetYear !== null &&
        (!Number.isInteger(t.targetYear) || t.targetYear < 1900 || t.targetYear > 2200)
      ) {
        throw new HttpError(
          422,
          "BAD_TREND",
          "The trend target year must be a year between 1900 and 2200, or null",
        );
      }
      state.trend.targetYear = t.targetYear;
    }
  }
  if (patch.rates) {
    if (patch.rates.history !== undefined) {
      for (const rc of patch.rates.history) {
        if (!isNum(rc.change) || rc.change <= -1) {
          throw new HttpError(
            422,
            "BAD_RATE_CHANGE",
            "A rate change must be a number greater than -100%",
          );
        }
        const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rc.effectiveDate);
        const valid =
          dm !== null &&
          (() => {
            const t = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]));
            const d = new Date(t);
            return (
              d.getUTCFullYear() === Number(dm[1]) &&
              d.getUTCMonth() === Number(dm[2]) - 1 &&
              d.getUTCDate() === Number(dm[3])
            );
          })();
        if (!valid) {
          throw new HttpError(
            422,
            "BAD_DATE",
            "Rate-change dates must be real calendar dates in yyyy-mm-dd",
          );
        }
      }
      state.rates.history = [...patch.rates.history].sort((a, b) =>
        a.effectiveDate.localeCompare(b.effectiveDate),
      );
    }
    if (patch.rates.premiumTrend !== undefined) {
      if (
        patch.rates.premiumTrend !== null &&
        (!isNum(patch.rates.premiumTrend) || patch.rates.premiumTrend <= -1)
      ) {
        throw new HttpError(
          422,
          "BAD_TREND",
          "The premium trend must be a number greater than -100%",
        );
      }
      state.rates.premiumTrend = patch.rates.premiumTrend;
    }
  }
  if (patch.elr) {
    if (patch.elr.method !== undefined && patch.elr.method !== state.elr.method) {
      if (patch.elr.method !== "loss-ratio" && patch.elr.method !== "pure-premium") {
        throw new HttpError(
          422,
          "BAD_ELR_METHOD",
          "The a-priori method must be 'loss-ratio' or 'pure-premium'",
        );
      }
      state.elr.method = patch.elr.method;
      // A loss ratio and a pure premium are different units: a selected a-priori
      // or a manual BF a-priori judged under one method is meaningless under the
      // other, so a method switch clears them (same as a layer switch clearing
      // level-specific judgments).
      state.elr.selected = null;
      state.elr.selectedAtLevel = null;
      state.bf.unlimited.aprioriLossRatio = null;
      state.bf.capped.aprioriLossRatio = null;
    }
    if (patch.elr.selected !== undefined) {
      if (
        patch.elr.selected !== null &&
        (!isNum(patch.elr.selected) || patch.elr.selected <= 0)
      ) {
        throw new HttpError(
          422,
          "BAD_ELR",
          "The selected a-priori (loss ratio or pure premium) must be a positive number or null",
        );
      }
      state.elr.selected = patch.elr.selected;
      // Stamp the dollar level of the exhibit this number was read from: a
      // later run at a different level must refuse it, not misapply it.
      if (patch.elr.selected === null) {
        state.elr.selectedAtLevel = null;
      } else {
        const latest = latestAnalysis(projectId);
        const latestResults = latest ? (latest.results as AnalysisResults) : null;
        state.elr.selectedAtLevel =
          (latestResults?.layer?.active ?? "unlimited") === "capped"
            ? latestResults?.ilf
              ? "restored"
              : "limited"
            : "unlimited";
      }
    }
  }
  if (patch.bf) activeBf(state).aprioriLossRatio = patch.bf.aprioriLossRatio;
  if (patch.berquist) {
    if (patch.berquist.severityTrend !== undefined) {
      activeBerquist(state).severityTrend = patch.berquist.severityTrend;
    }
    if (patch.berquist.interpolation) {
      activeBerquist(state).interpolation = patch.berquist.interpolation;
    }
  }
  if (patch.ultimateSelection) {
    const { weights, weightsByOrigin, overrides } = patch.ultimateSelection;
    const validateWeight = (w: number | null | undefined, label: string): number => {
      if (!isNum(w) || w < 0) {
        throw new HttpError(
          422,
          "BAD_WEIGHT",
          `Weight for ${label} must be a non-negative number`,
        );
      }
      return w;
    };
    if (weights) {
      for (const method of SELECTION_METHODS) {
        const w = weights[method.key];
        if (w === undefined) continue;
        const value = validateWeight(w, method.label);
        // "All periods" is literal: update the default and every per-period entry.
        state.ultimateSelection.defaultWeights[method.key] = value;
        for (const entry of Object.values(state.ultimateSelection.weightsByOrigin)) {
          entry[method.key] = value;
        }
      }
      // Per-period entries that now match the defaults are redundant; drop them.
      for (const [origin, entry] of Object.entries(state.ultimateSelection.weightsByOrigin)) {
        const matchesDefault = SELECTION_METHODS.every(
          (m) => (entry[m.key] ?? 0) === (state.ultimateSelection.defaultWeights[m.key] ?? 0),
        );
        if (matchesDefault) delete state.ultimateSelection.weightsByOrigin[origin];
      }
    }
    if (weightsByOrigin) {
      for (const [origin, partial] of Object.entries(weightsByOrigin)) {
        // Start from the period's effective weights so a partial update
        // never silently zeroes the untouched methods.
        const base =
          state.ultimateSelection.weightsByOrigin[origin] ??
          ({ ...state.ultimateSelection.defaultWeights } as Record<SelectionMethodKey, number>);
        for (const method of SELECTION_METHODS) {
          const w = partial[method.key];
          if (w === undefined) continue;
          base[method.key] = validateWeight(w, `${method.label} (origin ${origin})`);
        }
        const matchesDefault = SELECTION_METHODS.every(
          (m) => (base[m.key] ?? 0) === (state.ultimateSelection.defaultWeights[m.key] ?? 0),
        );
        if (matchesDefault) {
          delete state.ultimateSelection.weightsByOrigin[origin];
        } else {
          state.ultimateSelection.weightsByOrigin[origin] = base;
        }
      }
    }
    if (overrides) {
      for (const [origin, value] of Object.entries(overrides)) {
        if (value === null) {
          delete state.ultimateSelection.overrides[origin];
        } else if (isNum(value) && value > 0) {
          state.ultimateSelection.overrides[origin] = value;
        } else {
          throw new HttpError(
            422,
            "BAD_OVERRIDE",
            `Override for origin ${origin} must be a positive number (or null to clear)`,
          );
        }
      }
    }
  }

  // Selections validate against the current triangle shape (also verifies the
  // cadence/asOf combination can actually build triangles).
  if (patch.selections) {
    const triangles = buildProjectTriangles(projectId, state);
    const nCols = Math.max(0, triangles.paid.ages.length - 1);
    if (patch.selections.selected.length !== nCols) {
      throw new HttpError(
        422,
        "SELECTION_SHAPE",
        `Expected ${nCols} LDF selections (one per development interval), got ${patch.selections.selected.length}`,
      );
    }
    for (const v of patch.selections.selected) {
      if (v !== null && (!isNum(v) || v <= 0)) {
        throw new HttpError(422, "BAD_SELECTION", "Selected LDFs must be positive numbers or null");
      }
    }
    activeSelections(state)[patch.selections.basis] = patch.selections.selected;
  }
  if (patch.tail) {
    const basis = patch.tail.basis;
    if (patch.tail.source === "manual") {
      if (!isNum(patch.tail.value ?? null) || patch.tail.value! <= 0) {
        throw new HttpError(422, "BAD_TAIL", "A manual tail requires a positive numeric value");
      }
      activeTail(state)[basis] = { source: "manual", value: patch.tail.value! };
    } else {
      const fits = fitAllTails(activeSelections(state)[basis]);
      const fit = fits[patch.tail.source];
      if (!fit.valid) {
        throw new HttpError(
          422,
          "TAIL_FIT_INVALID",
          `The ${patch.tail.source} fit is not usable: ${fit.warnings.join("; ")}`,
        );
      }
      activeTail(state)[basis] = { source: patch.tail.source, value: fit.tailFactor };
    }
  }

  saveWorkspaceState(projectId, state);
  return getWorkspaceView(projectId);
}

/**
 * Fits a default tail per basis from the all-year volume-weighted factors of
 * the current data and stores the better valid fit (by R^2). Runs when a
 * dataset is established or replaced - import and seed - so BOTH bases start
 * on a fitted tail instead of a silent flat 1.000 that quietly biases the
 * incurred methods. A basis with no valid fit keeps a unit tail (reported in
 * warnings). Tail choices the user makes afterwards win until the next
 * import replaces the data, at which point refitting to the new extract is
 * the correct default.
 */
export function autoFitTailsFromData(projectId: string): {
  applied: Partial<
    Record<LayerKey, Partial<Record<"paid" | "incurred", { source: string; value: number }>>>
  >;
  warnings: string[];
} {
  const state = ensureWorkspaceState(projectId);
  const claims = getClaims(projectId);
  const applied: Partial<
    Record<LayerKey, Partial<Record<"paid" | "incurred", { source: string; value: number }>>>
  > = {};
  const warnings: string[] = [];
  const capSet = state.layer.cap !== null && state.layer.cap > 0;
  // A new extract invalidates BOTH layers' fitted tails, not just the active
  // one - a layer toggled later must not silently keep tails fitted to data
  // that no longer exists.
  const layers: LayerKey[] = capSet ? ["unlimited", "capped"] : ["unlimited"];
  for (const layer of layers) {
    const triangles = buildLayerTriangles(claims, state, layer);
    const layerApplied: Partial<
      Record<"paid" | "incurred", { source: string; value: number }>
    > = {};
    for (const basis of ["paid", "incurred"] as const) {
      const dev = computeDevelopmentFactors(triangles[basis]);
      const vw = dev.averages.find((a) => a.spec.key === "all-wtd")?.values ?? [];
      const fits = fitAllTails(vw);
      const candidates = [fits.exponentialDecay, fits.inversePower].filter((f) => f.valid);
      if (candidates.length === 0) {
        state.tail[layer][basis] = { source: "manual", value: 1 };
        warnings.push(
          `No valid tail fit for the ${layer} ${basis} basis (development already flat or too few usable factors); tail left at 1.000`,
        );
        continue;
      }
      const best = candidates.reduce((a, b) => (b.rSquared > a.rSquared ? b : a));
      state.tail[layer][basis] = { source: best.method, value: best.tailFactor };
      layerApplied[basis] = { source: best.method, value: best.tailFactor };
    }
    applied[layer] = layerApplied;
  }
  saveWorkspaceState(projectId, state);
  return { applied, warnings };
}

// ---------------------------------------------------------------------------
// Full analysis run

export interface MethodSummary {
  method: string;
  basis: "paid" | "incurred";
  ultimate: number;
  ibnr: number;
  unpaid: number;
  note?: string;
}

export interface AnalysisResults {
  ranAt: string;
  asOfDate: string;
  cadence: string;
  /** The development layer this run was built on (absent on pre-layer runs = unlimited). */
  layer?: LayerState;
  /** Why a CONFIGURED ILF source failed to resolve on a capped run (null when none/applied). */
  ilfUnresolvedReason?: string | null;
  /** Ultimate claim counts by origin (CL on reported counts, no tail). */
  ultimateCounts?: Record<string, number>;
  capeCod?: {
    paid: CapeCodResult | null;
    incurred: CapeCodResult | null;
    skippedReason?: string;
  };
  expectedClaims?: ExpectedClaimsResult | null;
  /** Set when a selected ELR could NOT drive Expected Claims / the ELR-derived BF
   * a-priori this run (its level did not match the run's level), so those columns
   * are deliberately blank. Lets the selection exhibit state WHY, not just show "-". */
  elrDerivedSkipReason?: string | null;
  /** The a-priori method this run used. The Cape Cod cross-check is native to it;
   * a later live method toggle must not reinterpret a pure premium as a ratio. */
  aprioriMethod?: ElrMethod;
  /** Per-origin adjustment factors the ELR methods ran with (audit trail). */
  elrAdjustments?: Record<
    string,
    { lossAdj: number; premiumAdj: number; onLevelFactor: number }
  >;
  /** The uncap factor applied to restore capped ultimates; null/absent = still limited. */
  ilf?: ResolvedIlf | null;
  /** Unlimited latest diagonals per origin (capped runs only): the true
   * reported/paid base for total-limits IBNR and unpaid. */
  unlimitedDiagonals?: Record<string, { paid: number; incurred: number }>;
  chainLadder: { paid: ChainLadderResult; incurred: ChainLadderResult };
  bornhuetterFerguson: {
    paid: BornhuetterFergusonResult | null;
    incurred: BornhuetterFergusonResult | null;
    skippedReason?: string;
  };
  berquistSherman: {
    caseAdequacy: {
      severityTrend: number;
      trendSource: string;
      warnings: string[];
      adjustedIncurredTriangle: Triangle;
      chainLadder: ChainLadderResult;
    } | null;
    settlement: {
      interpolation: string;
      warnings: string[];
      ultimateCounts: number[];
      adjustedPaidTriangle: Triangle;
      chainLadder: ChainLadderResult;
    } | null;
    skippedReason?: string;
  };
  mack: { paid: MackResult | null; incurred: MackResult | null; skippedReason?: string };
  diagnostics: DiagnosticsResult;
  summary: MethodSummary[];
  warnings: string[];
}

/** Total paid on the latest diagonal (for IBNR vs unpaid on incurred bases). */
function latestDiagonalTotal(tri: Triangle): number {
  let total = 0;
  for (const row of tri.values) {
    for (let j = row.length - 1; j >= 0; j--) {
      const v = row[j];
      if (v !== null && v !== undefined) {
        total += v;
        break;
      }
    }
  }
  return total;
}

/** Latest observed diagonal value per origin. */
function latestDiagonalByOrigin(tri: Triangle): Record<string, number> {
  const out: Record<string, number> = {};
  tri.values.forEach((row, i) => {
    for (let j = row.length - 1; j >= 0; j--) {
      const v = row[j];
      if (v !== null && v !== undefined) {
        out[tri.origins[i]!] = v;
        break;
      }
    }
  });
  return out;
}

/** Volume-weighted all-year selections for a triangle (used for adjusted triangles and counts). */
function volumeWeightedSelections(tri: Triangle): (number | null)[] {
  const dev = computeDevelopmentFactors(tri);
  return dev.averages.find((a) => a.spec.key === "all-wtd")?.values ?? [];
}

export function runFullAnalysis(projectId: string, label?: string): AnalysisRecord {
  const view = getWorkspaceView(projectId);
  const { state, triangles } = view;
  const warnings: string[] = [];

  const paidCl = runChainLadderOr422(
    triangles.paid,
    activeSelections(state).paid,
    activeTail(state).paid.value,
    "paid",
  );
  const incurredCl = runChainLadderOr422(
    triangles.incurred,
    activeSelections(state).incurred,
    activeTail(state).incurred.value,
    "incurred",
  );
  const paidAtDiagonal = latestDiagonalTotal(triangles.paid);

  // Bornhuetter-Ferguson (needs exposure data). The a-priori METHOD picks the
  // base: earned premium (loss ratio) or exposure units (pure premium). Feed the
  // chosen base into earnedPremium so the base-agnostic BF / Cape Cod / Expected
  // Claims compute a loss ratio or a pure premium; exposureUnits is carried for
  // reference. `hasBase` gates on a USABLE base, not just any row (a premium-only
  // project has rows but no base under the pure-premium method).
  const isPPMethod = state.elr.method === "pure-premium";
  const aprioriWord = isPPMethod ? "pure premium" : "ELR";
  const exposures = getExposures(projectId).map((e) => ({
    origin: e.origin,
    earnedPremium: isPPMethod ? e.exposureUnits : e.earnedPremium,
    exposureUnits: e.exposureUnits,
  }));
  const hasBase = exposures.some((e) => (e.earnedPremium ?? 0) > 0);
  const noBaseMsg = isPPMethod
    ? "No exposure units imported (the pure-premium method needs them)"
    : "No exposure/premium data imported";

  // ELR level coherence, resolved ONCE for BF, Cape Cod, and Expected Claims.
  const runResolvedIlf = state.layer.active === "capped" ? view.ilfReview.resolved : null;
  const runLevel: "unlimited" | "limited" | "restored" =
    state.layer.active === "capped" ? (runResolvedIlf ? "restored" : "limited") : "unlimited";
  const elrTargetYear = resolveElrTargetYear(state, triangles.paid.origins);
  let elrNativeToRun: number | null = null;
  let elrDerivedSkipReason: string | null = null;
  if (state.elr.selected !== null) {
    const selLevel = state.elr.selectedAtLevel ?? "unlimited";
    if (selLevel !== runLevel) {
      elrDerivedSkipReason = `The selected ${aprioriWord} was chosen at the ${selLevel} level but this run is ${runLevel}, so Expected Claims and the ${aprioriWord}-derived BF a-priori were skipped (the levels must match, or the a-priori would sit at the wrong dollar level). Re-select the ${aprioriWord} on the current ${runLevel} exhibit, then rerun.`;
      warnings.push(elrDerivedSkipReason);
    } else if (runLevel === "restored") {
      // De-restate to the capped level: the a-priori (loss ratio or pure premium)
      // is native to the run layer and the selection matrix restores it exactly
      // once. Restoration scales losses, and a pure premium is losses per unit,
      // so it scales by the same uncap factor.
      elrNativeToRun = state.elr.selected / runResolvedIlf!.factor;
    } else {
      elrNativeToRun = state.elr.selected;
    }
  }

  let bfPaid: BornhuetterFergusonResult | null = null;
  let bfIncurred: BornhuetterFergusonResult | null = null;
  let bfSkipped: string | undefined;
  if (!hasBase) {
    bfSkipped = `${noBaseMsg}; Bornhuetter-Ferguson was skipped.`;
    warnings.push(bfSkipped);
  } else {
    // A-priori precedence: explicit manual override > per-origin restatement
    // of the selected ELR > BF's own CL-derived default. The selected ELR is
    // stored at the level of the exhibit it was chosen from; a run at a
    // DIFFERENT level must not consume it, and a restored-level ELR feeding
    // a capped run is first de-restated to the capped level so the uniform
    // restoration in the selection matrix applies exactly once.
    const manualApriori = activeBf(state).aprioriLossRatio;
    let aprioriByOrigin: Record<string, number> | undefined;
    if (manualApriori === null && elrNativeToRun !== null) {
      const adj = computeElrAdjustments(state, triangles.paid.origins, elrTargetYear, {
        includeSetupNotes: false,
      });
      aprioriByOrigin = {};
      for (const origin of triangles.paid.origins) {
        const a = adj.byOrigin[origin]!;
        aprioriByOrigin[origin] = (elrNativeToRun * a.premiumAdj) / a.lossAdj;
      }
    }
    const bfOptions = {
      aprioriLossRatio: manualApriori ?? undefined,
      aprioriByOrigin,
    };
    bfPaid = runBornhuetterFerguson(triangles.paid, paidCl, exposures, bfOptions);
    bfIncurred = runBornhuetterFerguson(triangles.incurred, incurredCl, exposures, bfOptions);
    warnings.push(...bfPaid.warnings, ...bfIncurred.warnings);
  }

  // Berquist-Sherman. Adjusted triangles get fresh volume-weighted selections
  // (the user's selections describe the unadjusted data, not the restated one).
  // Ultimate claim counts: chain ladder on reported counts, no tail. Used by
  // Berquist-Sherman settlement AND the frequency/severity exhibit, so they
  // are computed (and stamped on the results) independent of B-S success.
  let ultimateCountsByOrigin: Record<string, number> | undefined;
  let countError: string | undefined;
  try {
    const countSelections = volumeWeightedSelections(triangles.reportedCount);
    const countCl = runChainLadder(triangles.reportedCount, {
      selected: countSelections,
      tailFactor: 1,
    });
    ultimateCountsByOrigin = {};
    for (const origin of triangles.reportedCount.origins) {
      const row = countCl.rows.find((r) => r.origin === origin);
      ultimateCountsByOrigin[origin] = row ? row.ultimate : 0;
    }
  } catch (err) {
    ultimateCountsByOrigin = undefined;
    countError = err instanceof Error ? err.message : String(err);
  }

  let bsCase: AnalysisResults["berquistSherman"]["caseAdequacy"] = null;
  let bsSettlement: AnalysisResults["berquistSherman"]["settlement"] = null;
  let bsSkipped: string | undefined;
  try {
    const caseAdj = berquistCaseAdequacy(
      triangles.paid,
      triangles.incurred,
      triangles.openCount,
      activeBerquist(state).severityTrend !== null
        ? { severityTrend: activeBerquist(state).severityTrend! }
        : {},
    );
    const caseSelections = volumeWeightedSelections(caseAdj.adjustedIncurred);
    bsCase = {
      severityTrend: caseAdj.severityTrend,
      trendSource: caseAdj.trendSource,
      warnings: caseAdj.warnings,
      adjustedIncurredTriangle: caseAdj.adjustedIncurred,
      chainLadder: runChainLadder(caseAdj.adjustedIncurred, {
        selected: caseSelections,
        tailFactor: activeTail(state).incurred.value,
      }),
    };

    if (!ultimateCountsByOrigin) {
      throw new ReservingError(
        "NO_FACTOR",
        `Count development is unavailable for this data${countError ? `: ${countError}` : ""}`,
      );
    }
    const ultimateCounts = triangles.reportedCount.origins.map(
      (origin) => ultimateCountsByOrigin![origin] ?? 0,
    );
    const settlement = berquistSettlement(triangles.paid, triangles.closedCount, {
      ultimateCounts,
      interpolation: activeBerquist(state).interpolation,
    });
    const settlementSelections = volumeWeightedSelections(settlement.adjustedPaid);
    bsSettlement = {
      interpolation: settlement.interpolation,
      warnings: settlement.warnings,
      ultimateCounts,
      adjustedPaidTriangle: settlement.adjustedPaid,
      chainLadder: runChainLadder(settlement.adjustedPaid, {
        selected: settlementSelections,
        tailFactor: activeTail(state).paid.value,
      }),
    };
  } catch (err) {
    bsSkipped =
      err instanceof Error
        ? `Berquist-Sherman was skipped: ${err.message}`
        : "Berquist-Sherman was skipped";
    warnings.push(bsSkipped);
  }

  // Mack standard errors on the selected basis: the same LDF selections and
  // tail the chain ladder uses, so the Mack central reserve agrees with the
  // headline CL reserve (sigma^2 stays estimated from the data, Mack 1999).
  let mackPaid: MackResult | null = null;
  let mackIncurred: MackResult | null = null;
  let mackSkipped: string | undefined;
  try {
    mackPaid = runMack(triangles.paid, {
      selected: activeSelections(state).paid,
      tailFactor: activeTail(state).paid.value,
    });
    mackIncurred = runMack(triangles.incurred, {
      selected: activeSelections(state).incurred,
      tailFactor: activeTail(state).incurred.value,
    });
  } catch (err) {
    mackSkipped =
      err instanceof Error ? `Mack was skipped: ${err.message}` : "Mack was skipped";
    warnings.push(mackSkipped);
  }

  // Cape Cod (mechanical ELR) and Expected Claims (selected ELR), both on
  // trended on-level terms via the per-origin adjustment factors.
  let ccPaid: CapeCodResult | null = null;
  let ccIncurred: CapeCodResult | null = null;
  let expectedClaimsResult: ExpectedClaimsResult | null = null;
  let ccSkipped: string | undefined;
  let elrAdjustmentsByOrigin: AnalysisResults["elrAdjustments"];
  if (!hasBase) {
    ccSkipped = `${noBaseMsg}; Cape Cod and Expected Claims were skipped.`;
    warnings.push(ccSkipped);
  } else {
    try {
      const premiumByOrigin = new Map(exposures.map((e) => [e.origin, e.earnedPremium]));
      const originsWithPremium = triangles.paid.origins.filter(
        (o) => (premiumByOrigin.get(o) ?? 0) > 0,
      );
      if (originsWithPremium.length < triangles.paid.origins.length) {
        warnings.push(
          `${triangles.paid.origins.length - originsWithPremium.length} origin(s) lack ${isPPMethod ? "exposure units" : "premium"} and are excluded from Cape Cod / Expected Claims`,
        );
      }
      const elrArmed =
        state.rates.history.length > 0 ||
        state.elr.selected !== null ||
        state.trend.frequency.value !== null ||
        state.trend.severity[state.layer.active].value !== null;
      const adj = computeElrAdjustments(state, originsWithPremium, elrTargetYear, {
        // A pristine workspace shouldn't read like it has data problems:
        // setup guidance stays on the ELR exhibit until the machinery is armed.
        includeSetupNotes: elrArmed,
      });
      warnings.push(...adj.warnings.filter((w) => !warnings.includes(w)));
      elrAdjustmentsByOrigin = adj.byOrigin;
      const mkRows = (cl: ChainLadderResult): ElrMethodRow[] =>
        originsWithPremium.flatMap((origin) => {
          const row = cl.rows.find((r) => r.origin === origin);
          if (!row) return [];
          const a = adj.byOrigin[origin]!;
          return [
            {
              origin,
              reported: row.latestValue,
              cdf: row.cdf,
              premium: premiumByOrigin.get(origin)!,
              lossAdj: a.lossAdj,
              premiumAdj: a.premiumAdj,
            },
          ];
        });
      ccPaid = runCapeCod(mkRows(paidCl), { baseIsPurePremium: isPPMethod });
      ccIncurred = runCapeCod(mkRows(incurredCl), { baseIsPurePremium: isPPMethod });
      warnings.push(...ccPaid.warnings, ...ccIncurred.warnings);
      if (elrNativeToRun !== null) {
        expectedClaimsResult = runExpectedClaims(mkRows(paidCl), elrNativeToRun);
      }
    } catch (err) {
      ccSkipped =
        err instanceof Error
          ? `Cape Cod / Expected Claims skipped: ${err.message}`
          : "Cape Cod / Expected Claims skipped";
      warnings.push(ccSkipped);
    }
  }

  const summary: MethodSummary[] = [];
  const push = (
    method: string,
    basis: "paid" | "incurred",
    totals: { ultimate: number },
    note?: string,
  ) => {
    const ibnr = totals.ultimate - latestDiagonalTotal(triangles.incurred);
    const unpaid = totals.ultimate - paidAtDiagonal;
    summary.push({ method, basis, ultimate: totals.ultimate, ibnr, unpaid, note });
  };
  push("Chain Ladder", "paid", paidCl.totals);
  push("Chain Ladder", "incurred", incurredCl.totals);
  if (bfPaid) push("Bornhuetter-Ferguson", "paid", bfPaid.totals);
  if (bfIncurred) push("Bornhuetter-Ferguson", "incurred", bfIncurred.totals);
  if (bsCase) {
    push(
      "Berquist-Sherman (case adequacy)",
      "incurred",
      bsCase.chainLadder.totals,
      "CL on adjusted incurred, fresh volume-weighted factors",
    );
  }
  if (bsSettlement) {
    push(
      "Berquist-Sherman (settlement rate)",
      "paid",
      bsSettlement.chainLadder.totals,
      "CL on adjusted paid, fresh volume-weighted factors",
    );
  }
  if (ccPaid) {
    push(
      "Cape Cod",
      "paid",
      { ultimate: ccPaid.totals.ultimate },
      `mechanical ELR ${(ccPaid.elrAtTargetLevel * 100).toFixed(1)}% at target level`,
    );
  }
  if (ccIncurred) {
    push(
      "Cape Cod",
      "incurred",
      { ultimate: ccIncurred.totals.ultimate },
      `mechanical ELR ${(ccIncurred.elrAtTargetLevel * 100).toFixed(1)}% at target level`,
    );
  }
  if (expectedClaimsResult) {
    push(
      "Expected Claims",
      "paid",
      { ultimate: expectedClaimsResult.totals.ultimate },
      `selected ELR ${(expectedClaimsResult.selectedElrAtTargetLevel * 100).toFixed(1)}% at target level, restated per year`,
    );
  }

  warnings.push(...paidCl.warnings, ...incurredCl.warnings);

  // Capped runs carry their restoration factor and the UNLIMITED diagonals
  // (total-limits IBNR/unpaid must subtract the real reported/paid, not the
  // capped ones).
  let ilfApplied: ResolvedIlf | null = null;
  let ilfUnresolvedReason: string | null = null;
  let unlimitedDiagonals: Record<string, { paid: number; incurred: number }> | undefined;
  if (state.layer.active === "capped") {
    ilfApplied = view.ilfReview.resolved;
    const rawSet = buildLayerTriangles(getClaims(projectId), state, "unlimited");
    const paidDiag = latestDiagonalByOrigin(rawSet.paid);
    const incDiag = latestDiagonalByOrigin(rawSet.incurred);
    unlimitedDiagonals = {};
    for (const origin of rawSet.paid.origins) {
      unlimitedDiagonals[origin] = {
        paid: paidDiag[origin] ?? 0,
        incurred: incDiag[origin] ?? 0,
      };
    }
    if (ilfApplied) {
      warnings.push(
        `Selection-of-ultimates figures are restored to ${
          ilfApplied.targetLimit === null
            ? "unlimited"
            : `a ${ilfApplied.targetLimit.toLocaleString()} limit`
        } via ${ilfApplied.sourceLabel} (factor ${ilfApplied.factor.toFixed(4)})`,
        ...ilfApplied.warnings,
      );
    } else if (state.ilf.source !== "none") {
      // A configured source that fails to resolve must not masquerade as a
      // deliberately-limited run.
      ilfUnresolvedReason = view.ilfReview.unresolvedReason ?? "ILF resolution failed";
      warnings.push(
        `An ILF source is configured but did not resolve (${ilfUnresolvedReason}); this run is LIMITED`,
      );
    }
  }

  const results: AnalysisResults = {
    ranAt: new Date().toISOString(),
    asOfDate: state.asOfDate,
    cadence: state.cadence,
    layer: { ...state.layer },
    ilf: ilfApplied,
    ilfUnresolvedReason,
    elrDerivedSkipReason,
    aprioriMethod: state.elr.method,
    ultimateCounts: ultimateCountsByOrigin,
    capeCod: { paid: ccPaid, incurred: ccIncurred, skippedReason: ccSkipped },
    expectedClaims: expectedClaimsResult,
    elrAdjustments: elrAdjustmentsByOrigin,
    unlimitedDiagonals,
    chainLadder: { paid: paidCl, incurred: incurredCl },
    bornhuetterFerguson: { paid: bfPaid, incurred: bfIncurred, skippedReason: bfSkipped },
    berquistSherman: { caseAdequacy: bsCase, settlement: bsSettlement, skippedReason: bsSkipped },
    mack: { paid: mackPaid, incurred: mackIncurred, skippedReason: mackSkipped },
    diagnostics: view.diagnostics,
    summary,
    warnings,
  };

  const inputs = {
    layer: state.layer,
    ilf: state.ilf,
    selections: state.selections,
    tail: state.tail,
    rates: state.rates,
    elr: state.elr,
    trend: state.trend,
    bf: state.bf,
    berquist: state.berquist,
    cadence: state.cadence,
    asOfDate: state.asOfDate,
  };
  return insertAnalysis(
    projectId,
    label ?? `Analysis as of ${state.asOfDate}`,
    inputs,
    results,
  );
}

function runChainLadderOr422(
  tri: Triangle,
  selected: (number | null)[],
  tailFactor: number,
  basisLabel?: string,
): ChainLadderResult {
  try {
    return runChainLadder(tri, { selected, tailFactor });
  } catch (err) {
    if (err instanceof ReservingError) {
      const message =
        err.code === "NO_SELECTIONS" && basisLabel
          ? `No LDFs are selected on the ${basisLabel} basis. Switch to that basis and select factors (or ask the advisor to apply them) before running the full analysis.`
          : err.message;
      throw new HttpError(422, err.code, message);
    }
    throw err;
  }
}

/** Chain ladder under alternative inputs without persisting anything. */
export function runSensitivity(
  projectId: string,
  scenario: {
    basis: "paid" | "incurred";
    selections?: (number | null)[];
    tailFactor?: number;
  },
): {
  scenario: ChainLadderResult;
  current: ChainLadderResult;
  deltaUltimate: number;
  deltaUnpaid: number;
} {
  const view = getWorkspaceView(projectId);
  const tri = view.triangles[scenario.basis];
  const baseSelections = activeSelections(view.state)[scenario.basis];
  const baseTail = activeTail(view.state)[scenario.basis].value;
  const current = runChainLadderOr422(tri, baseSelections, baseTail);
  const alt = runChainLadderOr422(
    tri,
    scenario.selections ?? baseSelections,
    scenario.tailFactor ?? baseTail,
  );
  return {
    scenario: alt,
    current,
    deltaUltimate: alt.totals.ultimate - current.totals.ultimate,
    deltaUnpaid: alt.totals.unpaid - current.totals.unpaid,
  };
}
