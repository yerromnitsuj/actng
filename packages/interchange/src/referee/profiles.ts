/**
 * Convention profiles (spec 5): normative alignment requirements as DATA,
 * executable by the conformance suite. A profile names what every engine
 * must pin so their numbers are comparable at the stated tolerances;
 * changing an existing profile's requirements is a spec MAJOR (spec 11).
 */

export interface ProfileTolerance {
  /** Relative tolerance on central estimates (ultimates, unpaid/reserves). */
  central: number;
  /** Relative tolerance on standard errors; null = SEs out of profile scope. */
  standardError: number | null;
}

/** What one engine must run for its results to claim this profile. */
export interface EngineAlignment {
  /** Human-readable entry point (estimator/function/method family). */
  entryPoint: string;
  /** The exact parameters that must be pinned. */
  parameters: Record<string, unknown>;
  /** Traps the research flagged; honesty notes the referee/report surface. */
  notes?: string[];
}

export interface ConventionProfile {
  id: string;
  description: string;
  tolerance: ProfileTolerance;
  alignment: {
    "actuarial-ts": EngineAlignment;
    "chainladder-python": EngineAlignment;
    "r-chainladder": EngineAlignment;
  };
}

export const DETERMINISTIC_CL_PROFILE: ConventionProfile = {
  id: "deterministic-cl",
  description:
    "Factor + projection point estimates: all three engines agree to ~1e-9 under identical " +
    "selections; standard errors are out of scope.",
  tolerance: { central: 1e-6, standardError: null },
  alignment: {
    "actuarial-ts": {
      entryPoint: "runChainLadder",
      parameters: { selections: "identical LdfSelections (values + tail)" },
    },
    "chainladder-python": {
      entryPoint: "Chainladder",
      parameters: {
        development:
          "Development(...) per the intent equivalence table, or DevelopmentConstant for value-only selections",
      },
    },
    "r-chainladder": {
      entryPoint: "chainladder / ata-based projection",
      parameters: {
        factors: "identical selected factors (CLFMdelta injection where feasible)",
      },
      notes: [
        "CLFMdelta returns per-element foundSolution; a failed injection makes the run not-comparable, never agreement",
      ],
    },
  },
};

export const MACK_1993_VW_PROFILE: ConventionProfile = {
  id: "mack1993-vw",
  description:
    "Volume-weighted all-period factors, Mack sigma with Mack's last-column extrapolation. " +
    "Central estimates at 1e-6 relative; standard errors at 0.5% relative.",
  tolerance: { central: 1e-6, standardError: 0.005 },
  alignment: {
    "actuarial-ts": {
      entryPoint: "runMack",
      parameters: {
        selected: "omitted (volume-weighted per Mack 1993)",
        sigma: "Mack last-column extrapolation (built in)",
      },
    },
    "chainladder-python": {
      entryPoint: "MackChainladder",
      parameters: {
        average: "volume",
        n_periods: -1,
        sigma_interpolation: "mack",
      },
      notes: [
        'The DEFAULT sigma_interpolation ("log-linear") does NOT match this profile; "mack" must be pinned',
      ],
    },
    "r-chainladder": {
      entryPoint: "MackChainLadder",
      parameters: {
        alpha: 1,
        "est.sigma": "Mack",
      },
      notes: [
        'The DEFAULT est.sigma ("log-linear") does NOT match this profile',
        'R silently falls back from est.sigma="log-linear" to "Mack" on poor regression fit; ' +
          "the adapter must record the EFFECTIVE method in effectiveParameters — the referee " +
          "downgrades requested≠effective comparisons",
        "MackChainLadder(alpha) semantics: alpha=1 volume-weighted, alpha=0 simple, alpha=2 regression; " +
          "the lower-level chainladder(delta) uses alpha = 2 − delta — never conflate the two",
      ],
    },
  },
};

/** The Phase A profile registry (odp-bootstrap-distribution arrives in Phase C). */
export const CONVENTION_PROFILES: Readonly<Record<string, ConventionProfile>> = {
  [DETERMINISTIC_CL_PROFILE.id]: DETERMINISTIC_CL_PROFILE,
  [MACK_1993_VW_PROFILE.id]: MACK_1993_VW_PROFILE,
};
