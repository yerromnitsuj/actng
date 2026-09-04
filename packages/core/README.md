# @actuarial-ts/core

Pure, framework-free P&C actuarial math for TypeScript. It includes triangles, deterministic and stochastic reserving, trends/on-leveling, limits and ILFs, discounting, and generalized definition-driven casualty diagnostics.

The package is designed to support the actuary's compliance with the ASOPs; it does not make a work product compliant and is not “ASOP-approved.” The credentialed actuary remains responsible for data, assumptions, selections, review, and communication.

## Install

```bash
npm install @actuarial-ts/core@0.6.1
```

ESM, TypeScript-first, zero runtime dependencies, Node 20+.

## Reserving quick start

```ts
import { buildTriangles, computeDevelopmentFactors, runChainLadder, runMack } from "@actuarial-ts/core";

const { paid } = buildTriangles(claimSnapshots, { cadence: "annual", asOfDate: "2025-12-31" });
const selected = computeDevelopmentFactors(paid).averages.find((item) => item.spec.key === "all-wtd")!.values;
const chainLadder = runChainLadder(paid, { selected, tailFactor: 1.02 });
const mack = runMack(paid, { selected, tailFactor: 1.02 });
```

Unobservable triangle cells are `null`. Volume-weighted factors are sum/sum over rows where both cells exist. CDFs multiply right-to-left, tail last. Missing, zero, or negative divisors yield `null`, never `NaN`.

## Generalized diagnostics

The model deliberately separates five concerns:

1. A measure declares source, quantity kind, unit, development semantics, sum aggregation, missingness, and its population/basis.
2. A formula template declares reusable arithmetic over typed roles.
3. An instance binds formula roles to measure expressions.
4. Calculation identity covers arithmetic, bindings, and all dependent measure/population/basis semantics.
5. Presentation and review rules remain visible in full definition identity without pretending to change the arithmetic.

```ts
import {
  CASUALTY_FORMULA_TEMPLATES,
  compileDiagnosticDefinition,
  createCasualtyMetricInstances,
  prepareDiagnosticData,
  runMetricDiagnostics,
} from "@actuarial-ts/core";

const instances = createCasualtyMetricInstances({
  counts: { reported: "reported", open: "open", closedNoPay: "closed-no-pay", closedWithPay: "closed-with-pay" },
  exposure: "earned-vehicle-years",
  amountBindings: [
    { id: "gross", paid: "gross-paid", incurred: "gross-incurred" },
    { id: "primary-250k", paid: "primary-paid", incurred: "primary-incurred" },
  ],
});

const compiled = compileDiagnosticDefinition({
  diagnosticDefinitionVersion: "1.0.0",
  id: "fleet-diagnostics",
  version: "1.0.0",
  lossRowGrain: "aggregate",
  measures,
  countPopulations,
  exposureBases,
  amountBases,
  derivedMeasures: [],
  formulas: CASUALTY_FORMULA_TEMPLATES,
  instances,
  reviewRules,
  periodAxis,
});

const prepared = prepareDiagnosticData({ definition: compiled, losses, exposures });
const result = runMetricDiagnostics({ prepared, groupMap: { fleet: "all-fleet" } });
```

The six built-in formulas are basis-independent. The factory creates ten count instances plus six per amount basis (`10 + 6 × basisCount`): one basis produces 16, two produce 22. A `$250K`, primary, gross, net, or ceded calculation is represented by caller-declared amount measures and a structured `AmountBasisDefinition`; it does not need a separate capped formula. Claim-level caps use `claim-layer` derivations before aggregation. Pre-limited external values record their source/transformation instead of implying the SDK recreated an unavailable claim-level operation.

All metrics are ratio-of-sums: measures are aggregated at source-group/origin/valuation, groups are mapped and merged, then division happens once. Measure-local `missing: "unknown" | "zero"` is explicit. Exposure timing is either `origin-static` or `valuation-specific`. Calendar and ordered axes derive normalized origins, valuations, development ages, and units; input rows cannot assert a trusted age.

Compilation validates the whole graph atomically: IDs, sources, role types, compatibility groups, development semantics, derivation acyclicity, expression limits, rule operands, basis/population references, and period coordinates. Authentic compiled/prepared objects are owner-branded and frozen. Formula, calculation, definition, preparation, and result identities are deterministic FNV-1a/JCS integrity aids—not cryptographic signatures.

See the generated [formula and instance catalog](https://github.com/yerromnitsuj/actng/blob/v0.6.1/docs/reference/diagnostic-formulas.md) and [0.6 migration guide](https://github.com/yerromnitsuj/actng/blob/v0.6.1/docs/migrations/0.6-generalized-diagnostics.md).

## Main method families

- Reserving: chain ladder, Mack, Bornhuetter-Ferguson, Benktander, Cape Cod/Gluck, Expected Claims, frequency-severity, Fisher-Lange, Munich chain ladder, Clark, ODP bootstrap, and Merz-Wüthrich one-year risk.
- Adjustments: Berquist-Sherman, salvage/subrogation, ULAE, tails, trends, premium on-leveling, discounting, capping, severity models, and ILFs.
- Infrastructure: triangle algebra, seeded RNG, RFC 8785 canonical JSON, integrity tags, traditional triangle diagnostics, and generalized metric diagnostics.

Published-value tests are the numerical contract. A reserving math change is not acceptable until those fixtures still pass.

## License

Apache-2.0. See LICENSE and NOTICE.
