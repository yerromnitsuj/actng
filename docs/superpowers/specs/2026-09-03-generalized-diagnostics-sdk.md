# Generalized actuarial diagnostics SDK design

> **Status: SHIPPED IN 0.6.0 ON 2026-09-03 (`v0.6.0`); PREPARATION/REVIEW
> DEFECTS CORRECTED IN 0.6.1.**
> This specification supersedes the 2026-08-27 quarterly-diagnostics design
> as the current shipped diagnostics contract.
> The `0.4.0` and `0.5.0` records remain historically correct and must not be
> rewritten. The implementation plan is
> [`../plans/2026-09-03-generalized-diagnostics-sdk.md`](../plans/2026-09-03-generalized-diagnostics-sdk.md).

## 1. Decisions of record

The following decisions are settled for this implementation:

1. `0.6.0` is a clean pre-1.0 breaking release. Compatibility aliases,
   deprecated wrappers, duplicated `0.5.0` formula IDs, and dual old/new result
   shapes are not part of the design.
2. A formula is not a basis. A formula template describes arithmetic over
   typed roles; a metric instance binds those roles to caller-defined measures
   and amount bases.
3. The reference casualty catalog has exactly six reusable formula templates.
   With one amount basis it creates 16 instances: ten count instances and six
   amount instances. Supplying two amount bases creates 22 instances while
   still using only six templates.
4. Capping and layering are claim-measure derivations performed before
   aggregation. A cap, attachment, gross/net selection, or expense treatment
   never creates a new underlying formula type.
5. Measures are declared. Aggregation, missing-value behavior, source, kind,
   amount basis, and exposure timing are measure-level semantics rather than
   run-global switches.
6. Period ordering and development age are explicit and serializable. The
   engine has calendar-month, calendar-quarter, calendar-year, and ordered-axis
   definitions and never falls back to lexical sorting.
7. Warning and semantic review rules are declarative JSON data. Executable
   callbacks are removed from the portable public definition.
8. The unscaled calculation and its scaled presentation are separate result
   fields. Labels or display scaling cannot masquerade as a change to the
   underlying actuarial calculation.
9. Definitions have deterministic content identities at three levels:
   formula, bound calculation, and complete definition. They use the SDK's
   existing JCS plus FNV-1a convention and are described honestly as
   non-cryptographic drift-detection aids, never signatures or tamper evidence.
10. Diagnostics gain a typed, semantic `diagnostic-definition` interchange
    document in wire version `1.1.0`. Opaque `extensions` are not used as the
    claimed integrity boundary because the current envelope deliberately does
    not hash them.
11. Agents do not author formula ASTs, bases, measure catalogs, period axes, or
    rules. If a host exposes diagnostics to an agent, the host supplies a
    compiled trusted catalog and model input is limited to registered instance
    IDs plus a host-approved run-preset ID and a display-view enum. The returned
    verified run must carry that exact calculation selection.
12. Claim derivations are part of the portable definition, and a separate run
    manifest ties that definition to input artifacts, preparation, selections,
    results, and the executing package version.

## 2. Why this shape

The `0.5.0` implementation proved the numeric engine, but one public object —
`MetricDefinition` — currently mixes seven separate concerns: arithmetic,
source bindings, basis, aggregation assumptions, presentation, versioning, and
warning behavior. The casualty preset then repeats the same six amount
relationships for `$250K` and primary inputs, making those input bases appear
to be distinct formula types.

The generalized design makes the review path explicit:

```text
measure catalog
      + amount-basis catalog
              ↓
formula template ── role bindings ── metric instance
              ↓                         ↓
       aggregate once             presentation metadata
              ↓                         ↓
          raw calculation ─────── scaled display value
              ↓
   declarative rule evaluations
              ↓
 fingerprints + provenance + typed interchange
```

That separation is the transparency benefit: an actuary can inspect the
inputs, basis, calculation, assumptions, warnings, and presentation as
distinct reviewable artifacts. It is designed to support the actuary's
compliance with the ASOPs; it does not make the SDK or an AI system
"ASOP-approved," and it does not transfer professional responsibility.

## 3. Goals and non-goals

### Goals

- Reuse the same actuarial formula across capped, uncapped, primary, excess,
  gross, net, ceded, indemnity-only, and indemnity-plus-expense measures.
- Make every behavioral input serializable, validated, fingerprinted, and
  suitable for compliance provenance.
- Preserve the established ratio-of-sums and fail-closed numeric semantics.
- Allow count and amount measures with different missing-value behavior in the
  same run; exposure absence always remains unknown in `0.6.0`.
- Support origin-static and valuation-specific exposure in the same run.
- Support annual, quarterly, monthly, and explicitly ordered custom periods.
- Turn the current casualty checks into one optional declarative reference
  rule pack rather than universal assumptions.
- Provide one typed definition document that TypeScript, Python, and R can
  parse, integrity-check, and evaluate against frozen aggregate-cell vectors.
- Make count populations, exposure bases, development semantics, claim
  derivations, and run selections inspectable rather than relying on labels.
- Keep the core implementation pure, deterministic, browser-safe, readable,
  and independent of I/O or application state.

### Non-goals

- A spreadsheet engine, arbitrary user code, `eval`, dynamically loaded
  functions, or an unrestricted expression language.
- Statistical modeling, distribution fitting, GLMs, simulation, or automatic
  actuarial selections.
- Inferring a cap or layer from a field name.
- Treating a source's exposure revision timestamp as economic exposure timing.
- Normalizing incremental data to cumulative data in core; callers must do
  that at an input boundary and disclose the transformation.
- Adding diagnostic documents to reserving promotion or letting an agent
  change diagnostic assumptions without a separate, explicit judgment gate.
- Replacing existing reserving triangles, `TriangleKind`, `runDiagnostics`,
  `capClaims`, or any published-value reserving calculation.

## 4. Terminology

- **Measure definition:** the declared meaning and aggregation behavior of one
  input or derived numeric field.
- **Amount basis:** structured financial semantics shared by amount measures,
  such as currency, gross/net perspective, covered components, and limitation.
- **Formula template:** basis-independent arithmetic over named, typed roles.
- **Metric instance:** one formula template bound to concrete measures with a
  stable instance ID and separate presentation metadata.
- **Definition:** the complete serializable configuration for a run: catalogs,
  formula templates, instances, rules, and period axis.
- **Compiled definition:** a validated, normalized, immutable in-memory form
  with derived dependencies and fingerprints.
- **Calculation value:** the raw numerator divided by the raw denominator once,
  before presentation scale.
- **Display value:** calculation value multiplied by presentation scale.
- **Structural check:** an input-shape or identity rule that is universally
  required, such as duplicate-cell rejection.
- **Semantic rule:** a caller-selected actuarial relationship, such as paid not
  exceeding incurred or reported reconciling to status counts.

## 5. Public definition model

The exact property names below are the `0.6.0` target contract. Data-package
Zod schemas mirror these shapes for unknown input. Core accepts typed values
and still validates semantic relationships at compilation.

```ts
export type DiagnosticMeasureKind = "count" | "amount" | "exposure";
export type DiagnosticMeasureSource = "loss" | "exposure" | "derived";
export type DiagnosticMissingPolicy = "unknown" | "zero";
export type DiagnosticAggregation = "sum";
export type DiagnosticExposureTiming = "origin-static" | "valuation-specific";
export type DiagnosticDevelopmentSemantics =
  | "cumulative"
  | "incremental"
  | "point-in-time"
  | "unknown";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type DiagnosticDeepReadonly<T> =
  T extends readonly (infer U)[]
    ? readonly DiagnosticDeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DiagnosticDeepReadonly<T[K]> }
      : T;

export interface DiagnosticMeasureDefinition {
  id: string;
  displayName: string;
  description: string;
  source: DiagnosticMeasureSource;
  kind: DiagnosticMeasureKind;
  unit: string;
  developmentSemantics: DiagnosticDevelopmentSemantics;
  aggregation: DiagnosticAggregation;
  missing: DiagnosticMissingPolicy;
  basisId?: string;
  countPopulationId?: string;
  exposureBasisId?: string;
  exposureTiming?: DiagnosticExposureTiming;
}

export interface DiagnosticCountPopulationDefinition {
  id: string;
  displayName: string;
  subject: "claim" | "claimant" | "policy" | "occurrence" | "other" | "unknown";
  unit: string;
  description: string;
  attributes?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface DiagnosticExposureBasisDefinition {
  id: string;
  displayName: string;
  basis: "earned" | "written" | "in-force" | "other" | "unknown";
  unit: string;
  description: string;
  sourceDescription?: string;
  attributes?: Readonly<Record<string, string | number | boolean | null>>;
}
```

The authored and compiled top-level shapes are:

```ts
export interface DiagnosticDefinition {
  diagnosticDefinitionVersion: "1.0.0";
  id: string;
  version: string;
  lossRowGrain: "claim" | "aggregate";
  measures: readonly DiagnosticMeasureDefinition[];
  countPopulations: readonly DiagnosticCountPopulationDefinition[];
  exposureBases: readonly DiagnosticExposureBasisDefinition[];
  amountBases: readonly AmountBasisDefinition[];
  derivedMeasures: readonly DiagnosticDerivedMeasureDefinition[];
  formulas: readonly DiagnosticFormulaTemplate[];
  instances: readonly DiagnosticMetricInstance[];
  reviewRules: readonly DiagnosticReviewRule[];
  periodAxis: DiagnosticPeriodAxis;
}

declare const compiledDiagnosticDefinitionBrand: unique symbol;

export interface CompiledDiagnosticDefinition {
  readonly [compiledDiagnosticDefinitionBrand]: true;
  readonly definition: DiagnosticDeepReadonly<NormalizedDiagnosticDefinitionIdentity>;
  readonly formulaFingerprints: Readonly<Record<string, string>>;
  readonly calculationFingerprints: Readonly<Record<string, string>>;
  readonly definitionIntegrity: string;
}

export interface DiagnosticLossRecordBase {
  /** Globally unique snapshot-row identity, not the stable claim identity. */
  recordId: string;
  sourceGroup: string;
  origin: string;
  valuation: string;
  complete: boolean;
  source?: DiagnosticSourceLocation;
  /** Missing keys are absent; explicit `undefined` is rejected. */
  measures: Readonly<Record<string, number | null>>;
}

export interface DiagnosticSourceLocation {
  readonly artifactId: string;
  readonly sourceFile?: string;
  readonly sourceSheet?: string;
  readonly sourceRow?: number;
  readonly sourceCell?: string;
}

export function compileDiagnosticDefinition(
  definition: DiagnosticDefinition | NormalizedDiagnosticDefinitionIdentity,
): CompiledDiagnosticDefinition;

export function assertCompiledDiagnosticDefinition(
  value: unknown,
): asserts value is CompiledDiagnosticDefinition;

export type DiagnosticValidationErrorCode =
  | "INVALID_DIAGNOSTIC_DEFINITION"
  | "INVALID_DIAGNOSTIC_INPUT"
  | "INVALID_DIAGNOSTIC_CONFIGURATION"
  | "INVALID_DIAGNOSTIC_VIEW";

export type DiagnosticValidationIssueCode =
  | "missing-required"
  | "invalid-type"
  | "unknown-key"
  | "invalid-string"
  | "invalid-number"
  | "invalid-json-value"
  | "duplicate-id"
  | "unknown-reference"
  | "incompatible-semantics"
  | "invalid-period"
  | "invalid-input-relationship"
  | "invalid-configuration"
  | "expression-limit"
  | "cycle";

export type DiagnosticValidationDomain =
  | "definition"
  | "input"
  | "configuration"
  | "view";

export interface DiagnosticValidationIssue {
  readonly domain: DiagnosticValidationDomain;
  readonly code: DiagnosticValidationIssueCode;
  /** Canonical singular JSONPath, rooted at `$`. */
  readonly path: string;
  readonly message: string;
}

export class DiagnosticValidationError extends Error {
  readonly code: DiagnosticValidationErrorCode;
  /** Always `issues[0].path`. */
  readonly path: string;
  /** Complete, nonempty, exact-deduplicated, and deterministically sorted. */
  readonly issues: readonly DiagnosticValidationIssue[];
  constructor(issues: readonly DiagnosticValidationIssue[]);
}
```

The compiled wrapper is opaque to callers: its module-private brand can be
created only by `compileDiagnosticDefinition`. Its public enumerable fields are
serializable, deeply frozen snapshots. Private indexes and derived dependency
sets are implementation details and must not leak into provenance or
interchange. The exported owner-controlled assertion uses private runtime
authenticity state rather than trusting a copied symbol or structural shape;
cross-package data/interchange adapters call it before consuming a compiled
value.
The compiler accepts either the authored shape or its exact normalized wire
projection. Normalization is idempotent: compiling
`compiled.definition` produces the same normalized definition and all three
identity levels. The data run boundary accepts only the authored
`DiagnosticDefinition`; interchange semantic conversion accepts the normalized
wire shape and calls this same compiler, so neither package owns a denormalizer
or a second semantic compiler.

All core diagnostic public entry points use this error contract; existing
reserving errors remain unchanged. Construction rejects an empty issue list,
exact-deduplicates `(domain, code, path, message)`, recursively freezes it, and sets
`name` to `DiagnosticValidationError`, `path` to `issues[0].path`, and
`message` to `issues[0].message`, and derives its high-level `code` from the
first issue's domain under the mapping below. Paths use `.name` for ASCII identifier
properties, `[index]` for arrays, and `[<JSON.stringify(key)>]` for every other
object key. Issues sort first by domain in the declaration order above, then
by the exact `DiagnosticValidationIssueCode` declaration order, then by typed path segments (prefix first; array
indices numerically; property names by code unit), code, and message. A
downstream reference or semantic issue is suppressed only when an earlier
shape issue makes that same node unreadable; unrelated nodes are still fully
reported, including independently parseable issues in later domains.
Definition maps to `INVALID_DIAGNOSTIC_DEFINITION`, raw
row/preparation relationships to `INVALID_DIAGNOSTIC_INPUT`, filters/cutoffs/
maps/expected grids to `INVALID_DIAGNOSTIC_CONFIGURATION`, and view arguments
to `INVALID_DIAGNOSTIC_VIEW`. Data converts Zod and core failures into this
exact shape. Shared-problem parity means the same domain, high-level code,
issue code, message, and relative typed-path suffix in the same issue order
after applying the documented public-boundary root. In particular, data
prefixes a direct compiler definition path of `$...` with `$.definition...`;
that intentional root prefix is not a parity failure. Tests snapshot complete
issue arrays at each boundary, not localized message text alone.

For the composed data boundary, domain ownership is field-based and inherited
by every descendant (including its source-location fields):

| Domain | Exact public path roots |
|---|---|
| `definition` | `$.definition`; direct compiler issues rooted at `$` |
| `input` | a non-object run body at `$`; `$.losses`, `$.exposures`, and `$.reviewEvidence` |
| `configuration` | `$.filter`, `$.completePeriodCutoffs`, `$.expectedCells`, `$.groupMap`, `$.groupDimensions`, `$.policy`, `$.runPresetId`, `$.datasetArtifactId`, and any unknown top-level run key |
| `view` | arguments to `sameMaturity` and `commonMaturity`, rooted at their public argument path |

An unknown nested key inherits the nearest listed root. Direct core preparation
uses the same semantic ownership for its corresponding fields. A cross-field
issue is owned by the path where the caller must repair it—for example a row
grain mismatch is `input` at `$.losses[index].rowType`, while an alias-duplicate
expected cell is `configuration` at the later `$.expectedCells[index]` path.
At the direct `reviewPreparedDiagnosticData` boundary, evidence issues use
domain `input` and root `$.evidence`, preserving the same relative suffix,
message, and issue order as composed-run `$.reviewEvidence` errors. An
unauthentic prepared value yields one `input` / `invalid-input-relationship`
issue at `$.prepared`, message `Prepared diagnostic data is not authentic`, and
high-level code `INVALID_DIAGNOSTIC_INPUT`; evidence is not inspected after
that owner check fails.

Rules enforced by the compiler:

- IDs are non-empty and unique by code-unit equality within their catalog.
  Display names and descriptions are non-empty, but display names need not be
  unique.
- Definition, formula, instance, and ordered-axis versions are non-empty.
  Required raw/population/exposure units, amount currency, ordered-axis age
  unit, and every presentation string are non-empty. Supplied optional source
  descriptions and transformation
  references are non-empty. Empty semantic strings are rejected rather than
  becoming identity-bearing placeholders.
- Only `sum` is supported in `0.6.0`. Unknown or non-additive aggregations are
  rejected rather than silently coerced.
- An `amount` measure requires an existing `basisId`. Every amount basis has at
  least one component and at least one component whose treatment is not
  `excluded`; an all-excluded or empty basis has no usable amount semantics and
  is rejected.
- A `count` measure requires a compatible count-population ID; an `exposure`
  measure requires a compatible exposure-basis ID and timing. Inapplicable
  semantic IDs are rejected.
- A count/exposure measure's raw `unit` must equal its referenced population or
  exposure-basis unit. An amount measure's raw `unit` must equal its basis
  currency. No implicit conversion is performed.
- An `exposure` measure must use source `exposure`. A non-exposure measure uses
  source `loss` or `derived` and may not declare exposure timing.
- Exposure measures must use `missing: "unknown"` in `0.6.0`. A known zero
  exposure is an explicit observed numeric zero; the SDK never imputes an
  absent exposure to zero.
- Every derived-source measure is the output of exactly one declared
  derivation. Raw rows may contain only declared loss-source keys; caller data
  may not overwrite a derived or exposure key.
- Ordinary `DiagnosticMeasureExpression` and `DiagnosticRoleExpression`
  add/subtract expressions require compatible kind, semantic unit, count
  population, and—when applicable—one exact amount basis or exposure basis.
  Claim-expression amount addition is the sole exception: Section 6 defines
  its disjoint-component union projection. Claim subtraction still requires
  one exact basis.
- Every measure declares development semantics. Standard formulas evaluate the
  supplied snapshot pointwise and never infer cumulative normalization.
  `compatibilityGroup` enforces semantic catalog identity only. A formula role
  may separately require one exact development semantic; an unconstrained role
  may combine pointwise values with different declared semantics, and the
  definition retains every leaf's declaration rather than relabeling the
  expression. Monotonic review accepts only leaves declared cumulative or
  point-in-time and applies its direction literally to ordered snapshots.
- Row measure keys must be declared. At preparation, a row with undeclared or
  wrong-source keys is excluded from arithmetic and retained as a top-level
  structural finding so a typo cannot become either a silently unused column
  or an unreviewable pre-report throw.
- `lossRowGrain` is explicit. Unique claim rows may share a normalized
  group/origin/valuation cell and are summed; aggregate rows may not duplicate
  that cell.
- Exposure input is long-form — one observation names one `measureId` and one
  value — so measures with different timing cannot be ambiguously combined in
  one wide row.
- All public definition metadata is plain JSON: no `undefined`, functions,
  symbols, bigints, non-finite numbers, dates, maps, sets, prototypes, or cycles.

Every string boundary uses one portable validation rule before any lookup,
sorting, or hashing. A well-formed string contains no unpaired UTF-16 surrogate
and no U+0000. A **token string** additionally has no leading or trailing ASCII
whitespace (`U+0009` through `U+000D` or `U+0020`) and contains at least one
code point outside that set. No Unicode normalization or case folding is
performed. The stricter calendar grammar below takes precedence for calendar
labels.

| String class | Fields | Rule |
|---|---|---|
| Token | every definition/catalog/formula/instance/derivation/rule/preset/evidence/artifact ID or version, including amount-binding IDs; role names, binding keys, `compatibilityGroup`, measure-map keys, `recordId`, `claimId`, exposure `key`, `sourceGroup`, group-map keys/targets, evidence grouping keys/groups, rule codes, units, currency, `rationaleRef`, `transformationRef`, and caller-declared digest algorithm/value/scope | token string |
| Human text | display names, descriptions, rule messages, presentation labels, optional source descriptions, cached formula text, and source file/sheet/cell fields when supplied | token string; internal ASCII whitespace and line breaks are retained exactly |
| Period text | ordered-axis IDs/versions/age units and labels/aliases | token string plus the axis-specific uniqueness rules; calendar labels use the stricter grammar in Section 12 |
| Free JSON text | attribute-record keys and string values; every nested object key and string value inside `groupDimensions` | well-formed string; empty keys/values and surrounding whitespace are retained because this is caller metadata |

Optional token/human fields are either absent or valid; an explicit empty
string is never treated as absence. Object-map own keys in the token class are
validated even for prototype-like names. TypeScript, Python, R, Zod, and JSON
Schema tests share malformed-surrogate, NUL, blank, edge-whitespace, Unicode,
and prototype-key vectors so the shores cannot silently disagree.

Generic interchange-envelope `extensions` and preserved same-major unknown
fields are deliberately outside this diagnostics string matrix. They retain
the existing opaque parse/round-trip contract and are not part of diagnostic
definition semantic content or identity. Diagnostic behavior must never be
encoded only in either opaque location.

`unit` describes the raw measure (`claim`, `vehicle-year`, `USD`, and so on).
It is metadata, not a conversion instruction. Automatic unit or currency
conversion is out of scope.

## 6. Structured amount bases

An amount basis is centrally declared and referenced by every amount measure.
It must be expressive enough for common casualty data without pretending the
SDK knows source mechanics that were not supplied.

```ts
export type AmountPerspective =
  | "gross"
  | "net"
  | "ceded"
  | "other"
  | "unknown";

export type AmountLimitation =
  | { kind: "unlimited" }
  | {
      kind: "layer" | "pre-limited";
      attachment: number;
      /** Layer width. `null` means no upper limit above the attachment. */
      limit: number | null;
      application: "claim" | "occurrence" | "policy" | "source-defined";
      derivation:
        | { kind: "sdk" }
        | {
            kind: "external";
            actor: "caller" | "source";
            transformationRef: string;
          };
    }
  | { kind: "unknown"; description?: string };

export interface AmountBasisComponent {
  id: string;
  treatment: "included" | "excluded" | "unknown";
  limitation: AmountLimitation;
}

export interface AmountBasisDefinition {
  id: string;
  displayName: string;
  currency: string;
  perspective: AmountPerspective;
  components: readonly AmountBasisComponent[];
  sourceDescription?: string;
  attributes?: Readonly<Record<string, string | number | boolean | null>>;
}
```

Examples:

- A source-provided total capped at `$250K` is a `pre-limited` basis and can
  honestly use `application: "source-defined"` when the source mechanics are
  not known.
- A primary basis with `$1M` capped indemnity plus unlimited expense has two
  components with separate limitation definitions.
- Gross and net versions are two bases even if every other field matches.

Unknown semantics remain `unknown`; they are never guessed from IDs or labels.
Paid and incurred roles that interact in one formula must reference the same
basis ID. Currency and basis mismatches are compile errors, not warnings.
Amount-basis component IDs are non-empty and unique within a basis. Component
order is semantically irrelevant and is normalized by ID. A basis describes
the result, not one particular paid or incurred derivation, so it never embeds
a derivation ID. Instead, every derived measure has its own definition linked
by `outputMeasureId`, and the compiler proves that the expression's projected
amount basis equals that output measure's declared basis. This permits paid and
incurred measures to use separate source fields and derivation graphs while
sharing one honest amount basis.

For amount-valued claim expressions, a direct measure projects its declared
basis; `subtract` requires two exact bases and preserves that basis;
`claim-layer` requires a source basis containing exactly one component, with
`treatment: "included"` and `limitation: { kind: "unlimited" }`, and no other
component entries. It applies the expression's declared attachment and width
to that unlimited component and projects exactly one SDK-derived
`application: "claim"` layer. A layer may therefore never be stacked over a
`pre-limited`, `unknown`, external-layer, or already SDK-layered source basis.
`add` requires one exact currency and perspective across every term plus
pairwise-disjoint component IDs, and projects their sorted component union.
The output basis must exactly match that
projection, including currency, perspective, component treatments, and
limitations. This makes a capped indemnity component plus an unlimited expense
component representable without pretending either input already has the
combined basis. Overlapping components, mixed currencies, and mixed
perspectives are rejected rather than risking double counting or implying a
conversion. Non-amount add/subtract retains the exact population/basis rules
in Section 7.

An SDK `layer` limitation must be established by every derived output measure's
own claim-layer graph; it is not a pointer to one reusable derivation. An amount
measure whose basis contains an SDK limitation must therefore use
`source: "derived"`; a raw loss measure can claim a limited basis only through
the external form.
Externally pre-limited data must carry a non-empty transformation/source
artifact reference, whose actual content assurance is recorded in run
provenance rather than guessed by core. `pre-limited` therefore requires an
external derivation record; `layer` may be SDK-derived or external.
Every `layer` or `pre-limited` limitation—SDK or external—requires a finite
attachment greater than or equal to zero and either `limit: null` or a finite
limit strictly greater than zero. An SDK derivation is legal only for
`kind: "layer"` with `application: "claim"`; a raw loss measure may name a
limited basis only when that limitation's derivation is external. Exhaustion
is computed only for comparison as `attachment + limit`; overflow makes the
definition invalid rather than converting the interval to unlimited.

## 7. Expressions, formula templates, and bindings

The language remains deliberately small.

```ts
export type DiagnosticMeasureExpression =
  | { op: "measure"; measureId: string }
  | { op: "add"; terms: readonly DiagnosticMeasureExpression[] }
  | {
      op: "subtract";
      left: DiagnosticMeasureExpression;
      right: DiagnosticMeasureExpression;
    };

export type DiagnosticRoleExpression =
  | { op: "role"; role: string }
  | { op: "add"; terms: readonly DiagnosticRoleExpression[] }
  | {
      op: "subtract";
      left: DiagnosticRoleExpression;
      right: DiagnosticRoleExpression;
    };

export interface DiagnosticFormulaRole {
  kind: DiagnosticMeasureKind;
  compatibilityGroup?: string;
  /** When present, every transitive binding leaf must declare this value. */
  developmentSemantics?: DiagnosticDevelopmentSemantics;
}

export interface DiagnosticFormulaTemplate {
  id: string;
  version: string;
  roles: Readonly<Record<string, DiagnosticFormulaRole>>;
  numerator: DiagnosticRoleExpression;
  denominator: DiagnosticRoleExpression;
  denominatorPolicy: "positive-or-null";
}

export interface DiagnosticMetricPresentation {
  displayName: string;
  description: string;
  /** Communication-only label; raw dimensional semantics remain separate. */
  displayUnit: string;
  scale: number;
  numeratorLabel: string;
  denominatorLabel: string;
}

export interface DiagnosticMetricInstance {
  id: string;
  version: string;
  formulaId: string;
  bindings: Readonly<Record<string, DiagnosticMeasureExpression>>;
  presentation: DiagnosticMetricPresentation;
  rules: readonly DiagnosticComparisonRule[];
}
```

Bindings may use a small measure expression. That supports, for example,
`reported - closedNoPay` without forcing the caller to materialize another
column. Required components are always derived transitively; there is no
caller-authored `requiredComponents` field.

Compilation rejects unknown formula IDs, missing or extra bindings, unknown or
unused declared roles, unknown measures, empty additions, kind mismatches,
incompatible basis groups, non-finite or non-positive scales, duplicate IDs,
and recursive/cyclic structures. Every declared formula role must occur at
least once in its numerator or denominator. Repeated occurrences are legal;
dead roles and their otherwise identity-bearing bindings are not.

Expression resource bounds are portable contract, not implementation defaults:

```ts
export const MAX_DIAGNOSTIC_EXPRESSION_DEPTH = 64;
export const MAX_DIAGNOSTIC_EXPRESSION_NODES = 10_000;
export const MAX_DIAGNOSTIC_DEFINITION_EXPRESSION_NODES = 100_000;
```

The root expression is depth 1 and every expression object—including a leaf—
counts as one node. The first two limits apply independently to each formula
numerator and denominator; each metric binding; each metric-rule left and
right operand; each derived claim expression; each compare-rule left and right
operand; each reconcile-rule actual and expected operand; each monotonic
expression; each layer-order narrower and broader expression; and each
control-total expression. A metric-rule `{ source: "measure", expression }`
operand counts its outer operand object plus every contained measure-expression
node; its calculation-field and constant alternatives each count as one-node
roots. A review constant operand is likewise a one-node root. The numeric
`control-total.expected` scalar is not an expression and contributes no node.
The third limit counts every node in every one of those roots in normalized
definition traversal order; a reused JavaScript object is counted again at
each syntactic occurrence. It does not count tolerance, presentation, or other
non-expression configuration objects. Cycles are rejected before an ancestry
edge is revisited. Unknown-input validators use an iterative preflight before
recursive Zod parsing, so an over-depth object cannot overflow the host stack.
TypeScript, Python, and R share exact boundary vectors at 64/65,
10,000/10,001, and 100,000/100,001, including multi-operand and outer-wrapper
vectors that prevent either side of a rule from hiding in another root's
budget.

All ordinary measure-expression and role-expression add/subtract operands must
have compatible kind, unit, and one exact semantic catalog reference. They are
pointwise operations and do not, by themselves, assert that leaf development
semantics are equal. A formula role's optional `developmentSemantics` is an
independent constraint over every transitive leaf in the bound expression; an
omitted constraint means “inspect the leaf semantics, but do not restrict
them.” The
separate amount-valued `DiagnosticClaimExpression.add` instead follows the
pairwise-disjoint component-union rule in Section 6; no other expression form
may use that projection. Formula roles sharing a `compatibilityGroup` must bind
to the same count population, amount basis, or exposure basis as applicable;
the group never implies temporal compatibility. Claim derivations are stricter:
their output measure and every transitive input leaf must share one exact
development semantic because a derivation materializes a new catalog measure.
The
compiler derives two explicit sets: `calculationDependencies` contains binding
leaves plus their transitive derivations, while `evaluationDependencies` adds
metric-rule-only measure operands. Result component statistics cover the
evaluation set, but only the calculation set enters the calculation
fingerprint. Adding or changing a rule therefore changes definition integrity
and rule output without pretending the underlying numeric calculation changed.

### Standard formula templates

The casualty reference catalog exports exactly these templates, each with
version `1.0.0`:

| Formula ID | Roles | Numerator | Denominator | Intended family |
|---|---|---|---|---|
| `frequency` | `claims: count`, `exposure: exposure` | `claims` | `exposure` | Counts per exposure |
| `share` | `part: count`, `whole: count`, same population group | `part` | `whole` | Count shares |
| `paid-to-incurred` | `paid: cumulative amount`, `incurred: cumulative amount`, same basis group | `paid` | `incurred` | Payment emergence |
| `amount-per-exposure` | `amount: amount`, `exposure: exposure` | `amount` | `exposure` | Loss cost / pure premium diagnostic |
| `amount-per-claim` | `amount: amount`, `claims: count` | `amount` | `claims` | Severity diagnostic |
| `case-per-open` | `incurred: cumulative amount`, `paid: cumulative amount`, same basis group; `open: point-in-time count` | `incurred - paid` | `open` | Case reserve adequacy diagnostic |

All six use the same invariant: aggregate every leaf first, evaluate the
numerator and denominator from aggregate values, require a finite denominator
strictly greater than zero, and divide once.

Their identity-bearing authored content is exactly the following. Omitted
`compatibilityGroup` and `developmentSemantics` properties are genuinely
absent; the two fixed compatibility-group tokens are part of the portable
contract, not implementation-chosen labels.

```ts
export const CASUALTY_FORMULA_TEMPLATES = [
  {
    id: "frequency",
    version: "1.0.0",
    roles: { claims: { kind: "count" }, exposure: { kind: "exposure" } },
    numerator: { op: "role", role: "claims" },
    denominator: { op: "role", role: "exposure" },
    denominatorPolicy: "positive-or-null",
  },
  {
    id: "share",
    version: "1.0.0",
    roles: {
      part: { kind: "count", compatibilityGroup: "count-population" },
      whole: { kind: "count", compatibilityGroup: "count-population" },
    },
    numerator: { op: "role", role: "part" },
    denominator: { op: "role", role: "whole" },
    denominatorPolicy: "positive-or-null",
  },
  {
    id: "paid-to-incurred",
    version: "1.0.0",
    roles: {
      paid: {
        kind: "amount",
        compatibilityGroup: "amount-basis",
        developmentSemantics: "cumulative",
      },
      incurred: {
        kind: "amount",
        compatibilityGroup: "amount-basis",
        developmentSemantics: "cumulative",
      },
    },
    numerator: { op: "role", role: "paid" },
    denominator: { op: "role", role: "incurred" },
    denominatorPolicy: "positive-or-null",
  },
  {
    id: "amount-per-exposure",
    version: "1.0.0",
    roles: { amount: { kind: "amount" }, exposure: { kind: "exposure" } },
    numerator: { op: "role", role: "amount" },
    denominator: { op: "role", role: "exposure" },
    denominatorPolicy: "positive-or-null",
  },
  {
    id: "amount-per-claim",
    version: "1.0.0",
    roles: { amount: { kind: "amount" }, claims: { kind: "count" } },
    numerator: { op: "role", role: "amount" },
    denominator: { op: "role", role: "claims" },
    denominatorPolicy: "positive-or-null",
  },
  {
    id: "case-per-open",
    version: "1.0.0",
    roles: {
      incurred: {
        kind: "amount",
        compatibilityGroup: "amount-basis",
        developmentSemantics: "cumulative",
      },
      paid: {
        kind: "amount",
        compatibilityGroup: "amount-basis",
        developmentSemantics: "cumulative",
      },
      open: { kind: "count", developmentSemantics: "point-in-time" },
    },
    numerator: {
      op: "subtract",
      left: { op: "role", role: "incurred" },
      right: { op: "role", role: "paid" },
    },
    denominator: { op: "role", role: "open" },
    denominatorPolicy: "positive-or-null",
  },
] as const satisfies readonly DiagnosticFormulaTemplate[];
```

Expression evaluation is normative across all three shores. An `add` evaluates
its terms in declared order with the same Neumaier accumulator used for leaf
aggregation and finalizes once; a `subtract` evaluates left and right, then
performs one subtraction. Any null operand, non-finite intermediate, accumulator
overflow, or non-finite subtraction result yields null plus a finding. Claim
expressions use the same rule independently on each claim row. Declared term
order is therefore both identity-significant and runtime-significant.

Caller-authored templates are permitted only through the same role/expression
contract. There is no multiplication, division inside expressions, condition,
loop, lookup, arbitrary function, or remote code hook in `0.6.0`.

## 8. Casualty reference factory

`createCasualtyMetricInstances` is cadence-neutral and accepts arbitrary
source measures and zero or more amount-basis bindings.

```ts
export interface CasualtyCountBindings {
  reported: string;
  open: string;
  closedNoPay: string;
  closedWithPay: string;
}

export interface CasualtyAmountBinding {
  id: string;
  paid: string;
  incurred: string;
}

export interface DiagnosticMetricPresentationOverride {
  displayName?: string;
  description?: string;
  displayUnit?: string;
  scale?: number;
  numeratorLabel?: string;
  denominatorLabel?: string;
}

export interface CreateCasualtyMetricInstancesInput {
  counts: CasualtyCountBindings;
  exposure: string;
  amountBindings: readonly CasualtyAmountBinding[];
  /** Keys are deterministic output instance IDs. */
  presentationOverrides?: Readonly<
    Record<string, DiagnosticMetricPresentationOverride>
  >;
}

export function createCasualtyMetricInstances(
  input: CreateCasualtyMetricInstancesInput,
): readonly DiagnosticMetricInstance[];

createCasualtyMetricInstances({
  counts: {
    reported: "reportedCount",
    open: "openCount",
    closedNoPay: "closedNoPayCount",
    closedWithPay: "closedWithPayCount",
  },
  exposure: "vehicleYears",
  amountBindings: [
    {
      id: "net",
      paid: "netPaid",
      incurred: "netIncurred",
    },
  ],
});
```

The ten count instances are:

1. reported frequency;
2. open frequency;
3. closed-no-pay frequency;
4. closed-with-pay frequency;
5. non-closed-no-pay frequency;
6. closed-no-pay share of reported;
7. closed-with-pay share of reported;
8. closed-with-pay share of non-closed-no-pay;
9. open share of reported; and
10. open share of non-closed-no-pay.

Each amount binding adds exactly six instances:

1. paid to incurred;
2. incurred per exposure;
3. incurred per non-closed-no-pay claim;
4. paid per exposure;
5. paid per closed-with-pay claim; and
6. case reserve per open claim.

The factory's identity strings are part of the public contract. All generated
instances use version `1.0.0`. Count IDs, in order, are:

```text
casualty/count/reported-frequency
casualty/count/open-frequency
casualty/count/closed-no-pay-frequency
casualty/count/closed-with-pay-frequency
casualty/count/non-closed-no-pay-frequency
casualty/count/closed-no-pay-share
casualty/count/closed-with-pay-share
casualty/count/closed-with-pay-share-of-non-closed-no-pay
casualty/count/open-share
casualty/count/open-share-of-non-closed-no-pay
```

Each amount binding produces these suffixes, in order:

```text
paid-to-incurred
incurred-per-exposure
incurred-per-non-closed-no-pay-claim
paid-per-exposure
paid-per-closed-with-pay-claim
case-per-open-claim
```

Only two metric-local rule families are generated. The paid-to-incurred
instance has one warning rule with ID
`{instanceId}/rule/paid-exceeds-incurred` and code
`paid-exceeds-incurred`, comparing calculation numerator `>` denominator. The
case-per-open instance has one warning rule with ID
`{instanceId}/rule/negative-case` and code `negative-case`, comparing its
calculation numerator `<` contextual constant zero. Both use zero absolute and
relative tolerance serialized exactly as `{ absolute: 0, relative: 0 }` and
the standard not-evaluated behavior. Their exact
messages are `Paid exceeds incurred on the bound amount basis` and
`Incurred less paid is negative on the bound amount basis`, respectively. No
other generated instance receives an implicit metric rule;
cross-cell/status/layer/control relationships belong to the optional data
review pack.

Its full ID is `casualty/amount/{encodedBindingId}/{suffix}`. Binding IDs are
token strings under Section 5. `encodedBindingId` is UTF-8 RFC 3986
percent encoding: ASCII letters, digits, `-`, `.`, `_`, and `~` remain literal;
every other byte becomes uppercase `%HH`. Unpaired UTF-16 surrogates are
rejected by the shared token rule, as are NUL and leading/trailing ASCII
whitespace. This makes `/`, `%`, prototype-like strings, and Unicode IDs
unambiguous without locale behavior. Duplicate binding IDs, unknown
presentation-override keys, and duplicate resulting instance IDs are errors.

Instance IDs are deterministic and namespaced by the caller's amount-binding
ID. Formula IDs are not. No standard formula, default measure, or preset ID
contains `250`, `250k`, `primary`, a currency, or a fixed limit.

The amount binding intentionally does not accept a caller-asserted `basisId`.
The factory validates only its own structural inputs; the catalog-aware
compiler derives and verifies the exact shared basis from the paid and incurred
measure definitions. Count-population compatibility is verified the same way.

The factory may accept presentation overrides but cannot change the formulas.
Its exact basis-neutral defaults are below. Every row uses `scale: 1`.

| Instance ID or amount suffix | `displayName` | `description` | `displayUnit` | `numeratorLabel` | `denominatorLabel` |
|---|---|---|---|---|---|
| `casualty/count/reported-frequency` | Reported frequency | Reported count divided by exposure | count per exposure | reported | exposure |
| `casualty/count/open-frequency` | Open frequency | Open count divided by exposure | count per exposure | open | exposure |
| `casualty/count/closed-no-pay-frequency` | Closed-no-pay frequency | Closed-no-pay count divided by exposure | count per exposure | closed-no-pay | exposure |
| `casualty/count/closed-with-pay-frequency` | Closed-with-pay frequency | Closed-with-pay count divided by exposure | count per exposure | closed-with-pay | exposure |
| `casualty/count/non-closed-no-pay-frequency` | Non-closed-no-pay frequency | Reported less closed-no-pay count divided by exposure | count per exposure | reported less closed-no-pay | exposure |
| `casualty/count/closed-no-pay-share` | Closed-no-pay share | Closed-no-pay count divided by reported count | ratio | closed-no-pay | reported |
| `casualty/count/closed-with-pay-share` | Closed-with-pay share | Closed-with-pay count divided by reported count | ratio | closed-with-pay | reported |
| `casualty/count/closed-with-pay-share-of-non-closed-no-pay` | Closed-with-pay share of non-closed-no-pay | Closed-with-pay count divided by reported less closed-no-pay count | ratio | closed-with-pay | reported less closed-no-pay |
| `casualty/count/open-share` | Open share | Open count divided by reported count | ratio | open | reported |
| `casualty/count/open-share-of-non-closed-no-pay` | Open share of non-closed-no-pay | Open count divided by reported less closed-no-pay count | ratio | open | reported less closed-no-pay |
| `paid-to-incurred` | Paid to incurred | Paid divided by incurred on the bound amount basis | ratio | paid | incurred |
| `incurred-per-exposure` | Incurred per exposure | Incurred divided by exposure | amount per exposure | incurred | exposure |
| `incurred-per-non-closed-no-pay-claim` | Incurred per non-closed-no-pay claim | Incurred divided by reported less closed-no-pay count | amount per claim | incurred | reported less closed-no-pay |
| `paid-per-exposure` | Paid per exposure | Paid divided by exposure | amount per exposure | paid | exposure |
| `paid-per-closed-with-pay-claim` | Paid per closed-with-pay claim | Paid divided by closed-with-pay count | amount per claim | paid | closed-with-pay |
| `case-per-open-claim` | Case reserve per open claim | Incurred less paid divided by open count | amount per claim | incurred less paid | open |

Amount rows are keyed by the suffix of
`casualty/amount/{encodedBindingId}/{suffix}` and deliberately do not
interpolate a binding ID, currency, limit, or catalog display name. A caller
wanting per-million frequency, percentages, a currency symbol, or
jurisdiction-specific wording supplies presentation overrides; those choices
affect definition integrity and display values, never formula/calculation
fingerprints. Overrides are keyed by the deterministic full instance ID;
unknown keys and explicit `undefined` are rejected.
One amount basis yields 16 instances; two yield 22. A count-only pack with ten
instances is valid.

## 9. Claim-level derived measures

Capping and layering use a separate expression type because their position in
the pipeline is semantically important.

```ts
export type DiagnosticClaimExpression =
  | { op: "measure"; measureId: string }
  | { op: "add"; terms: readonly DiagnosticClaimExpression[] }
  | {
      op: "subtract";
      left: DiagnosticClaimExpression;
      right: DiagnosticClaimExpression;
    }
  | {
      op: "claim-layer";
      measureId: string;
      attachment: number;
      /** Layer width; null means unlimited above attachment. */
      limit: number | null;
    };

export interface DiagnosticDerivedMeasureDefinition {
  id: string;
  outputMeasureId: string;
  expression: DiagnosticClaimExpression;
}

export type DiagnosticMeasureValues = Readonly<
  Record<string, number | null>
>;

export type DiagnosticRowWithDerivedMeasures<
  TRow extends { measures: DiagnosticMeasureValues },
> = Omit<TRow, "measures"> & { measures: DiagnosticMeasureValues };

export function deriveDiagnosticClaimMeasures<
  TRow extends { measures: DiagnosticMeasureValues },
>(
  rows: readonly TRow[],
  definition: CompiledDiagnosticDefinition,
): readonly DiagnosticRowWithDerivedMeasures<TRow>[];
```

`claim-layer` evaluates `min(max(value - attachment, 0), limit)` on each claim
row when `limit` is finite, where `limit` is layer width rather than an
exhaustion point. With `limit: null`, it evaluates `max(value - attachment, 0)`.
An unlimited ground-up component is represented by a normal measure expression.
The output measure's structured basis lives in the measure catalog.

Every raw and derived measure is declared exactly once in the top-level measure
catalog. Each derivation has a unique ID and output; `outputMeasureId` must
resolve to a `source: "derived"` catalog measure, and each derived-source
measure must have exactly one definition. Expression leaves may reference raw
loss measures or other derived outputs. The compiler rejects duplicate outputs,
unknown inputs, row-key overwrite, incompatible expression semantics,
negative/non-finite attachment, a non-positive or non-finite non-null width, and
dependency cycles. Derivations require `lossRowGrain: "claim"` and run before
aggregation. Evaluation does not mutate caller rows. Missing or non-finite
inputs propagate as null. The standalone helper is intentionally value-only
and writes null for every non-observed derived result; it never applies a
missing-zero policy. The shared internal evaluator uses this exact quality
precedence for each derived output: any transitive non-finite input or
finite-input expression overflow → `non-finite`; otherwise any missing input →
`missing`; otherwise `observed`. For a non-finite output, collect the
`nonFiniteKind` values of every transitive non-finite input and failed finite
intermediate: one unique kind is retained, while mixed kinds normalize to
`nan`. Every finite-input overflow also retains its separate exact
`diagnostic-expression-overflow` path finding; propagation through a later
derivation is not itself another operation overflow.

`prepareDiagnosticData` turns `missing` into a missing contribution or an
`imputed-zero` contribution according to the **output measure's** policy;
`non-finite` is never imputed and becomes a non-finite contribution with the
normalized kind. Normal measure missing/imputed/non-finite findings and stats
therefore coexist with any expression-path finding. Quality propagates through
chained derived outputs even when an intermediate zero-imputed value is
numerically available, so a later rule cannot treat that chain as fully
observed. Accepting the
compiled definition, rather than a loose derivation array, ensures all catalog,
basis-projection, graph, and row-grain validation happened atomically before
any row is evaluated. Existing `capClaims` continues unchanged for its separate
fixed `ClaimSnapshot` workflow.

## 10. Aggregation and missingness

Aggregation receives the compiled measure catalog rather than discovering its
meaning from keys present in the rows. Every finalized batch retains auditable
statistics:

```ts
export interface DiagnosticMeasureStats {
  readonly value: number | null;
  readonly sum: number | null;
  readonly observed: number;
  readonly missing: number;
  readonly nonFinite: number;
  readonly imputedZero: number;
  readonly deduplicated: number;
  readonly structural: number;
}
```

The rules are:

- `structural` is exactly the number of normalized distinct
  `DiagnosticStructuralBlocker` records for that measure in the cell. Blockers
  are retained separately from numeric contributions, force `sum` and `value`
  null, and survive group mapping by deterministic union/deduplication before
  stats are recomputed. A valid source group can never wash out another mapped
  source group's blocker.

- Within the population selected after source, period, cutoff, and remaining
  filters, loss `recordId` values are unique across every source cell. Under
  `lossRowGrain: "claim"`, a stable `claimId` may repeat across valuations, but
  at most one observation for `(claimId, sourceGroup, origin, valuation)` is
  permitted; otherwise claim layers could be applied twice to one claim at one
  valuation. `claimId` is selected-population-global and repeated observations
  must retain the same source group and origin;
  a conflict blocks every affected cell and the claim contributes no derived
  or aggregate value. Distinct claims in one cell are expected contributors. Under
  `"aggregate"`, a second normalized cell is blocked before summation. These
  dataset relationships produce fail-closed structural findings in prepared
  data rather than throwing away the reviewable report; malformed scalar/type
  boundaries and invalid definitions still reject atomically.
- `missing: "unknown"`: any missing contributor makes the finalized measure
  value null. When all present contributors are finite and no structural
  ambiguity exists, `sum` retains their deterministic observed subtotal for
  audit; it is not used as the measure value.
- `missing: "zero"`: an omitted or null field on an otherwise valid expected
  row contributes zero, but `missing` and `imputedZero` remain visible and a
  structured finding is emitted.
- An explicit numeric zero is observed and never counted as imputed.
- A non-finite input always forces both `sum` and `value` to null under both
  policies; non-finite contributors are never silently excluded from the
  exposed subtotal. Aggregate overflow also yields null for both fields.
- The engine does not infer that every source group must exist at every
  coordinate. Only an expected-cell grid asserts an otherwise absent source
  cell; its absence emits a top-level structural finding and default-gate
  failure but never fabricates a numeric cell. Within an existing loss cell,
  an incomplete record, exposure conflict, or missing required exposure is
  structural absence and forces the affected measure's `sum` and `value` to
  null. `missing: "zero"` cannot manufacture a source record or exposure.
- Before numeric accumulation, contributors are sorted by canonical source
  group, origin, valuation, measure ID, and source-record identity (loss `recordId`
  or exposure key) using code-unit ordering.
  Finite values use a specified Neumaier compensated sum, finalized once. Thus
  a batch over the same identified records is byte-reproducible regardless of
  caller row order. `0.6.0` exposes no arbitrary partial-aggregate merge API and
  makes no false claim that IEEE-754 partition merges are associative.

`deduplicated` counts redundant observations actually suppressed, never the
retained observation: one canonical observation reports `0`, two identical
origin-static copies report `1`, and three report `2`. The count is carried on
the retained exposure contribution and therefore appears in every source cell
to which that origin-static exposure is attached. When source groups are
mapped together, component stats sum those retained contribution counts once
per mapped source-cell contribution. Loss rows and valuation-specific exposure
observations always carry `deduplicated: 0` in `0.6.0`.

Adversarial cancellation, subnormal values, signed zero normalization, and
overflow are pinned by tests. `-0` is normalized to `0` before serialization.
If distributed aggregation is added later, it must define a reproducible
accumulator/state format rather than summing already-rounded partial totals.

These distinctions prevent a count field that legitimately zero-fills from
forcing amount or exposure omissions to zero in the same run.

## 11. Exposure timing

Timing is declared per exposure measure. The clean-break input shape is:

```ts
export interface DiagnosticExposureObservation {
  key: string;
  sourceGroup: string;
  origin: string;
  valuation?: string;
  measureId: string;
  value: number | null;
  complete: boolean;
  source?: DiagnosticSourceLocation;
}
```

The long form makes identity and expected presence unambiguous; an observation
cannot silently mix origin-static and valuation-specific measures.

### Origin-static

- The stable identity is `(measureId, key)` across all valuation copies.
- `sourceGroups`, `origins`, origin ranges, and `originThrough` cutoffs apply to
  origin-static observations. Their optional `valuation` is normalized and
  period-validated when present, but is source-copy provenance rather than
  economic timing: valuation lists/ranges, development-age filters, and
  `valuationThrough` cutoffs do not select or exclude origin-static copies.
- Selection happens before identity reconciliation. The remaining copies for
  one stable identity are then compared/deduplicated, and the resolved
  exposure attaches only to retained matching loss cells. An excluded copy
  cannot create a conflict in the selected population.
- Copies are equal when their audited numeric state, `sourceGroup`, `origin`,
  and `complete` fields match. Two observed states compare their finite values
  after signed-zero normalization; two missing states are equal; two
  non-finite states are equal only when `nonFiniteKind` matches. Different
  statuses or non-finite kinds conflict. `measureId` and `key` already match by
  identity; `valuation` and source location are deliberately ignored for this
  equality test. A non-observed cohort remains invalid even when its copies are
  equal: repeated nulls yield `missing` without `conflict`, repeated matching
  non-finite kinds yield `non-finite` without `conflict`, and mixed states add
  `conflict`; all observations remain in the invalid audit record.
- Equal complete, finite-observed copies collapse and the measure contributes
  once to the source-group/origin bucket used by every valuation cell for that
  origin. Equality among invalid copies only determines whether `conflict` is
  added to their other issues; it never makes them valid.
- The reconciled valid record always omits its optional `valuation` property.
  Copy valuations remain visible in `inputAudit` and source provenance, but no
  first/last copy is promoted into economic timing or preparation identity.
- Their distinct normalized source locations are unioned. Such copies are
  permitted input, not a structural failure: `N` copies produce one retained
  contribution with `deduplicated: N - 1`, including when their valuation
  labels or source locations differ.
- Conflicting values, source-group/origin assignments, or completeness states produce
  a conflict and null that measure for the affected origin.
- Different stable keys with equal values remain separate contributions.
- A source revision/as-of history must be selected upstream; the engine does
  not choose a revision.

### Valuation-specific

- `valuation` is definition-aware required input. Its absence is an atomic
  `INVALID_DIAGNOSTIC_INPUT` at the observation's `.valuation` path in both
  direct core preparation and the data boundary; it never becomes an audit
  record, reconciled exposure, or finding.
- The stable identity is `(measureId, key, valuation)`.
- Source, origin, valuation, development-age, and both complete-period cutoff
  dimensions apply before identity reconciliation. Reconciliation considers
  only observations remaining in the selected population.
- A changing value across valuations is legal and represents economic
  earned-to-date or other valuation-specific exposure.
- A second valuation-specific record with the exact same identity is a
  structural duplicate even when all other fields match; it always adds
  `duplicate` and fails that cell closed rather than inviting accidental
  joined-row duplication. Add `conflict` exactly when the full audited numeric
  state (using the origin-static equality rules), `sourceGroup`, `origin`, or
  `complete` differs; source location is audit evidence and does not itself
  create conflict.
- The measure attaches only to the matching source-group/origin/valuation cell.
- The reconciled valid record always includes the one canonical `valuation`.
- A missing or conflicting valuation affects only that valuation cell and
  never leaks a future exposure backward.

One dataset may contain multiple exposure measures with different timing.
Reconciliation operates by `measureId`, and `measureId` must reference a
declared exposure measure. Identity reconciliation and conflict detection use
the source `sourceGroup` and `origin` before any group mapping; mapping happens only
after valid source observations are resolved.

Every declared catalog measure with `kind: "exposure"` and
`source: "exposure"` is a **required exposure measure** for every retained loss
cell to which its timing applies, whether or not `instanceIds` later selects a
metric that uses it. A definition is the asserted dataset contract; callers
must omit an optional/irrelevant exposure measure from that definition or run
a separate definition rather than making completeness depend on a display or
calculation selection. This exact set drives `loss-without-exposure`, exposure
check applicability, prepared component keys, and blocker cardinality.

An exposure row whose `measureId` is undeclared or names a non-exposure source
has **unknown timing**. It remains reviewable under this deterministic
selection rule: source-group selection applies first; origin is always
normalized and origin lists/ranges plus `originThrough` apply; an optional
valuation is normalized and period/age validated when present solely so its
audit and any period finding are truthful. Valuation lists/ranges,
development-age filters, and `valuationThrough` do not select an unknown-timing
row, even when it supplied a valuation, because the SDK cannot know whether
that value is economic timing or copy provenance. If it survives those steps,
phase 5 marks it invalid, emits the exact measure-contract finding, and omits
it from `PreparedDiagnosticData.exposures`; it never creates a contribution or
join. If period validation fails first, the earlier terminal period finding
applies and the later measure-contract check is not run.

An invalid reconciled exposure retains every applicable issue rather than
choosing one lossy primary status. Issues are exact-deduplicated and stored in
this order: `missing`, `incomplete`, `non-finite`, `duplicate`, `conflict`.
`missing` means at least one explicit null observation and retains it; total
absence instead emits `loss-without-exposure` on the affected loss cell and
does not fabricate an audit observation. All issues retain every canonical
audit observation. Mixed cases—for example, duplicate
valuation-specific records that are also incomplete and disagree—therefore
produce one `status: "invalid"` record with all three issues. The fixed issue
rank applies only inside that record's `issues` array. Projected blockers and
findings use the global deterministic ordering in Section 15, so the two
ordering contracts never compete.

For an existing loss cell, a missing required valuation-specific exposure is
detectable and makes that measure null. The engine cannot infer a wholly absent
expected loss cell from rows that do not exist. Callers needing that control
must supply an expected-cell grid to data review and record it in the run
manifest.

## 12. Period axes

Loss rows no longer carry trusted `ageMonths`. They carry origin and valuation
labels; the compiled period axis normalizes, orders, and derives age.

```ts
export interface DiagnosticPeriodCoordinate {
  label: string;
  aliases?: readonly string[];
  coordinate: number;
}

export type DiagnosticPeriodAxis =
  | {
      kind: "calendar";
      originCadence: "month" | "quarter" | "year";
      valuationCadence: "month" | "quarter" | "year";
      originAnchor: "start" | "end";
      valuationAnchor: "start" | "end";
      ageUnit: "month";
      ageOffset: number;
    }
  | {
      kind: "ordered";
      id: string;
      version: string;
      ageUnit: string;
      ageOffset: number;
      origins: readonly DiagnosticPeriodCoordinate[];
      valuations: readonly DiagnosticPeriodCoordinate[];
    };
```

Calendar axes accept and canonicalize only these ASCII, case-sensitive formats,
with exactly four year digits and no leading/trailing whitespace: quarters
accept `YYYYQn`, `YYYY-Qn`, or `Qn YYYY` with uppercase `Q` and `n` in 1–4 and
canonicalize to `YYYY-Qn`; months accept only `YYYY-MM` with `MM` in 01–12; and
years accept only `YYYY`. Extra whitespace, lowercase `q`, one-digit months,
locale month names, and signed or five-digit years are rejected. A calendar
coordinate is the period's start month or end-exclusive month, as selected
independently for origin and valuation. That permits accident-year origins with
quarterly or monthly valuations. An ordered axis has separate finite origin and
valuation label catalogs whose integer coordinates are expressed in the same
declared age unit; aliases may not collide within either side.

Development age is always:

```text
valuationCoordinate - originCoordinate + ageOffset
```

Calendar coordinates use an absolute month index. Ordered coordinates are
caller-declared safe integers; gaps are allowed and meaningful rather than
silently filled. `ageOffset` is a safe integer. Compilation validates only the
axis definition: unique canonical labels, aliases, and coordinates within each
side, plus safe coordinate and offset scalars. It has no run rows to inspect.

`developmentAge` and `ageUnit` replace `ageMonths` in diagnostic rows, filters,
findings, emergence, and triangles. The engine derives age from normalized
origin and valuation coordinates. Invalid definition-axis catalogs and invalid
run configuration (unknown or reversed filter/cutoff labels, an invalid
expected-cell coordinate, duplicate expected cells after alias normalization,
or a negative/unsafe configured age bound) reject atomically. A view helper validates
its requested age at call time. By contrast, a shape-valid loss or exposure
row with an unknown origin or valuation, valuation before origin, or
unsafe/negative derived age is excluded from arithmetic and retained in the
prepared input audit with a top-level structural finding; this keeps
valid-but-questionable dataset relationships reviewable. Duplicate
normalized source identities are likewise fail-closed structural findings.
Ordered coordinate catalogs are normalized by numeric
coordinate and then code-unit label; gaps are preserved. Duplicate-cell
rejection is applied to aggregate-grain source snapshots before group mapping;
claim-grain records may
share a cell and are accumulated by unique `recordId`. The engine never invokes a
quarter parser from generic execution and never falls back to locale or string
ordering.

Expected-cell validation is whole-configuration validation: every coordinate
is normalized and the complete submitted grid is checked for duplicate
canonical `(sourceGroup, origin, valuation)` keys before any cutoff or filter
is applied. Thus two alias-equivalent expected cells are an error even when
both would later be excluded. Selection affects the validated grid's audit
dispositions, never its uniqueness contract.

Custom callbacks are intentionally not supported in the portable definition.
A caller with a proprietary calendar can pre-normalize its periods into an
ordered axis, preserving portability and content identity.

## 13. Declarative warnings and data review

### Core metric rules

```ts
export type DiagnosticRuleOperand =
  | { source: "measure"; expression: DiagnosticMeasureExpression }
  | { source: "calculation"; field: "numerator" | "denominator" }
  | { source: "constant"; value: number };

export interface DiagnosticComparisonPredicate {
  left: DiagnosticRuleOperand;
  operator: "lt" | "lte" | "eq" | "neq" | "gte" | "gt";
  right: DiagnosticRuleOperand;
  tolerance?: { absolute?: number; relative?: number };
}

export type DiagnosticComparisonClassification =
  | { status: "evaluated"; relation: "less" | "equal" | "greater" }
  | {
      status: "not-evaluated";
      reason: "missing" | "non-finite" | "tolerance-overflow";
    };

export function classifyDiagnosticComparison(
  left: number | null,
  right: number | null,
  tolerance?: { absolute?: number; relative?: number },
): DiagnosticComparisonClassification;

export interface DiagnosticComparisonRule {
  id: string;
  code: string;
  message: string;
  severity: "warning" | "fail";
  when: DiagnosticComparisonPredicate;
}

export interface DiagnosticRuleEvaluation {
  ruleId: string;
  status: "pass" | "triggered" | "not-evaluated";
  severity: "warning" | "fail";
  left: number | null;
  right: number | null;
  relation: "less" | "equal" | "greater" | null;
  notEvaluatedReasons: readonly (
    | "missing"
    | "imputed"
    | "non-finite"
    | "structural-ambiguity"
    | "aggregation-overflow"
    | "expression-overflow"
    | "tolerance-overflow"
  )[];
  /** Complete failed rule-operand operation nodes for this mapped metric cell. */
  expressionOverflows: readonly {
    readonly expressionPath: string;
    readonly sources: readonly DiagnosticSourceLocation[];
  }[];
  code: string | null;
  message: string | null;
}
```

Every metric rule is a finding predicate: when `when` is true, status is
`triggered`; when false, status is `pass`. Missing or non-finite operands are
`not-evaluated`, never a pass. A triggered rule projects exactly one structured
finding at its declared severity; a not-evaluated rule projects a separate
not-evaluated finding so absence cannot disappear. That projected finding has
severity `info`, code `diagnostic-rule-not-evaluated`, and the rule ID; the
rule's declared warning/fail severity remains on `DiagnosticRuleEvaluation` and
is not misreported as a triggered failure.

The serialization state table is exact: `pass` has the evaluated relation,
`notEvaluatedReasons: []`, `expressionOverflows: []`, and null
`code`/`message`; `triggered` has the evaluated relation, both arrays empty,
and the authored rule
`code`/`message`; `not-evaluated` has `relation: null`, every applicable reason,
and code/message `diagnostic-rule-not-evaluated` / `Diagnostic metric rule was
not evaluated`. `left` and `right` retain finite evaluated operands when a
tolerance overflow occurs and are otherwise null exactly where the underlying
operand is unavailable. No state uses property omission.

Operand readiness is determined from the operand's complete transitive
contribution set and finalized stats, not merely from its finalized numeric
value. A formula may calculate with `missing: "zero"`, but a metric rule
depending on any missing, imputed-zero, non-finite, structurally ambiguous, or
aggregation-overflowed measure is `not-evaluated` with the matching reason.
`aggregation-overflow` means finite observed contributions could not finalize
to a finite source-cell or mapped-group measure; the existing
`diagnostic-measure-overflow` finding remains the fail-severity evidence. Thus
zero imputation remains a declared calculation policy without becoming
evidence that an actuarial assertion passed.
All applicable not-evaluated reasons are retained once in the fixed order
missing → imputed → non-finite → structural-ambiguity → aggregation-overflow
→ expression-overflow → tolerance-overflow;
the array is empty for pass/triggered evaluations.

A measure-expression operand uses Section 7's checked arithmetic. If finite
leaves overflow at an operation node, that operand becomes null, the rule is
`not-evaluated` with `expression-overflow`, and `expressionOverflows` retains
every exact-deduplicated failed node in code-unit `expressionPath` order with
its transitive available source union. Each record also emits the standard
fail-severity `diagnostic-expression-overflow` finding at the mapped metric
cell with `instanceId`, `ruleId`, `expressionPath`, coordinate, and those
sources. It coexists with the info-severity
`diagnostic-rule-not-evaluated` finding, so the metric gate cannot mistake
arithmetic overflow for a harmless unavailable assertion. A failed child does
not cascade overflow findings into ancestors whose null merely propagated.
A `{ source: "calculation" }` operand inherits the complete readiness causes
of the selected numerator or denominator. If that field is null because its
binding or formula expression overflowed, the rule records
`expression-overflow` and reuses the original `expressionPath`/source records
in `expressionOverflows`; if a leaf finalization overflowed it records
`aggregation-overflow`. The already-emitted fail finding is referenced through
the normal metric finding union and semantic deduplication, not emitted a
second time merely because a rule read the calculation field. Other missing,
imputed, non-finite, or structural causes propagate the same way. Thus every
null calculation operand has at least one exact readiness reason.

For finite operands, let
`t = absolute + relative * max(1, abs(left), abs(right))`, with omitted
components equal to zero. Absolute and relative tolerances must be finite and
nonnegative. A non-finite runtime `t` makes the rule not evaluated with a
structured tolerance-overflow finding. The three-way relation is exactly:

- `less` when `left < right - t`;
- `equal` when `abs(left - right) <= t`; and
- `greater` when `left > right + t`.

The boundary therefore belongs to `equal`. Operators map to the relation in
the ordinary way: `lt` = less, `lte` = less/equal, `eq` = equal, `neq` =
less/greater, `gte` = equal/greater, and `gt` = greater. These truth conditions
are mathematical real-number semantics: implementations use an overflow-safe
classifier rather than assuming `left - right` is representable. Shared frozen
TypeScript/Python/R vectors include opposite-sign maximum-magnitude operands.

Comparison constants are contextual quantities: when exactly one operand is a
constant, it inherits the other operand's inferred semantics and the absolute
tolerance uses that same unit; the relative tolerance is dimensionless. Two
constants are dimensionless. Two nonconstant operands must infer identical
quantity semantics, including kind/unit and any amount basis, count population,
or exposure basis. This makes comparisons such as a negative amount versus zero
portable without allowing a bare number to erase a currency or population
mismatch.

Rules preserve declared order. Metric comparison-rule IDs and top-level review
rule IDs are globally unique across the entire definition and disjoint from
one another, not merely unique within one instance; the
`diagnostic/structural/` prefix is reserved. The casualty instance
factory owns metric-local paid-over-incurred and negative-case predicates.
Those relationships are not repeated in the data-review pack. There is no
`evaluateWarnings` escape hatch.

### Data review

The data package separates universal structural checks from optional semantic
rules.

Universal structural checks cover:

- duplicate loss record IDs, duplicate claim/cell snapshots, plus duplicate
  normalized group/origin/valuation cells
  when `lossRowGrain` is `aggregate`;
- duplicate/conflicting exposure identities under each timing mode;
- invalid or reversed period coordinates;
- undeclared or wrong-source measure keys on otherwise shape-valid rows;
- incomplete loss/exposure records and loss/exposure join gaps;
- inconsistent caller grouping assignments; and
- cached-formula provenance when the caller declares workbook-derived values.

`DataReviewReport.checks` begins with the following fixed catalog in this exact
order. A check with applicable findings has its listed warning/fail status; an
applicable check with none passes. Exposure checks are `not-evaluated` when the
definition has no exposure measures. Expected-cell coverage is
`not-evaluated` when the grid was omitted. The two evidence checks are
`not-evaluated` when all review evidence was omitted and pass for an explicitly
reviewed-empty evidence object. All other checks are applicable even for an
empty dataset and therefore pass when they have no findings.

| Check ID | Finding code(s), each with its exact constant message | Finding status |
|---|---|---|
| `diagnostic/structural/loss-identity` | `duplicate-loss-record-id`: `Loss record identity is duplicated`; `duplicate-claim-snapshot`: `Claim snapshot identity is duplicated`; `claim-identity-conflict`: `Claim identity has conflicting source group or origin`; `duplicate-aggregate-snapshot`: `Aggregate source-cell identity is duplicated` | fail |
| `diagnostic/structural/exposure-identity` | `duplicate-exposure-identity`: `Exposure identity is duplicated`; `conflicting-exposure-identity`: `Exposure identity has conflicting observations` | fail |
| `diagnostic/structural/period-validity` | `unknown-origin-period`: `Origin period is not declared by the period axis`; `unknown-valuation-period`: `Valuation period is not declared by the period axis`; `valuation-before-origin`: `Valuation precedes origin`; `unsafe-development-age`: `Derived development age is not a nonnegative safe integer` | fail |
| `diagnostic/structural/measure-contract` | `undeclared-loss-measure`: `Loss input contains an undeclared measure`; `wrong-source-loss-measure`: `Loss input contains a measure that is not raw loss input`; `undeclared-exposure-measure`: `Exposure input contains an undeclared measure`; `wrong-source-exposure-measure`: `Exposure input names a measure that is not exposure input` | fail |
| `diagnostic/structural/loss-completeness` | `incomplete-loss-record`: `Loss record is marked incomplete` | fail |
| `diagnostic/structural/exposure-completeness` | `missing-exposure-value`: `Exposure observation has a missing value`; `incomplete-exposure`: `Exposure observation is marked incomplete`; `non-finite-exposure`: `Exposure observation is non-finite` | fail |
| `diagnostic/structural/loss-without-exposure` | `loss-without-exposure`: `Loss source cell has no matching required exposure` | warning |
| `diagnostic/structural/exposure-without-loss` | `exposure-without-loss`: `Exposure has no matching retained loss source cell` | warning |
| `diagnostic/structural/expected-cell-coverage` | `missing-expected-cell`: `Expected source cell is absent` | fail |
| `diagnostic/structural/grouping-consistency` | `inconsistent-group-mapping`: `Grouping evidence assigns one key to multiple groups` | fail |
| `diagnostic/structural/cached-formula-provenance` | `cached-formula-provenance`: `Declared formula-derived value lacks complete formula provenance` | warning |

The 11 fixed check `description` strings are nonempty implementation-owned
human rendering, not semantic contract. They are excluded from review identity
and exact snapshots; only the table's IDs, finding codes/messages, status,
order, and applicability are normative. Documentation may improve a description
without changing the underlying reviewed fact or fingerprint.

Structural diagnostic findings use the following exact projection. Every such
`DataFinding` has a `context`; `sources` is always present as the normalized
exact-deduplicated union and may be `[]` when no row-level location was
supplied. A coordinate named below also carries `developmentAge` and `ageUnit`
when it is valid. “One per cohort” means after input permutation and source
union, never one per discovery event.

| Finding code | Cardinality / canonical cohort | Required context |
|---|---|---|
| `duplicate-loss-record-id` | one per duplicated `recordId` | `recordId`, `sources`; source cell fields only when identical across the cohort |
| `duplicate-claim-snapshot` | one per `(claimId, sourceGroup, origin, valuation)` cohort | `claimId`, source-cell coordinate, `sources` |
| `claim-identity-conflict` | one per conflicting `claimId` | `claimId`, `sources` |
| `duplicate-aggregate-snapshot` | one per duplicate source cell | source-cell coordinate, `sources` |
| `duplicate-exposure-identity`, `conflicting-exposure-identity` | one per timing-specific reconciled exposure identity and applicable code | `measureId`, `exposureKey`, `sources`; source cell fields only when coherent across observations |
| `unknown-origin-period`, `unknown-valuation-period`, `valuation-before-origin`, `unsafe-development-age` | one per invalid loss row or exposure observation and applicable code | loss `recordId`, or exposure `measureId` plus `exposureKey`; authored/normalized coordinate fields that exist; `sources` |
| `undeclared-loss-measure`, `wrong-source-loss-measure`, `undeclared-exposure-measure`, `wrong-source-exposure-measure` | one per input row and offending key | `offendingKey`, `measureId` equal to that key, row identity, `sources` |
| `incomplete-loss-record` | one per incomplete loss row | `recordId`, valid coordinate fields, `sources` |
| `missing-exposure-value`, `incomplete-exposure`, `non-finite-exposure` | one per timing-specific exposure identity and applicable code | `measureId`, `exposureKey`, coherent coordinate fields, `sources` |
| `loss-without-exposure` | one per retained loss source cell and required exposure measure | `measureId`, source-cell coordinate, all retained loss-cell `sources` |
| `exposure-without-loss` | one per valid reconciled exposure identity that attaches nowhere | `measureId`, `exposureKey`, coherent coordinate fields, exposure `sources` |
| `missing-expected-cell` | one per normalized expected source cell absent from retained loss cells | expected source-cell coordinate and expected-cell `sources` |
| `inconsistent-group-mapping` | one per grouping `key` assigned to more than one group | `groupingKey`, assignment `sources` |
| `cached-formula-provenance` | one per failing cached-formula evidence `id` | `cachedEvidenceId`, evidence `sources` |

Preparation-owned structural findings and numeric blockers have one mandatory
projection; an implementation may not decide ad hoc which partial total is
"safe." Evidence-owned findings never acquire a numeric blocker. An
**affected prepared cell** is a canonical selected source cell established by
at least one retained loss row. A selected invalid row by itself does not
fabricate an emergence cell; its finding remains top-level. When an affected
cell exists, each row/cohort finding projects at most one normalized blocker
per affected measure and cell as follows:

| Structural finding family | Exact blocker projection |
|---|---|
| loss identity, loss completeness, or loss measure-contract defect | Block every declared raw-loss and derived measure in each affected prepared cell named by a valid canonical coordinate in the invalid row/cohort. A conflict spanning several valid coordinates projects independently into every affected cell. The entire row was rejected, so even a field that happened to be present cannot contribute to a partial total. |
| exposure identity or completeness defect for a declared exposure measure | Block that one exposure measure in every affected prepared cell to which any valid-coordinate cohort member would have attached under its declared timing. For an incoherent origin-static cohort, take the union of the candidate source-group/origin attachment sets; never select one observation as authoritative. |
| `loss-without-exposure` | Block the named required exposure measure in that exact affected prepared cell. |
| loss/exposure period defect; undeclared or wrong-source exposure key; `exposure-without-loss`; `missing-expected-cell`; grouping evidence; cached-formula evidence | Top-level finding only. These cases have no unambiguous applicable measure/cell, no retained loss cell, or are review evidence rather than a numeric contributor. |

Each blocker copies the finding's exact code and constant message.
`sourceIds` is the exact-deduplicated, code-unit-sorted set of contributing loss
`recordId` values for a loss defect or missing join, and exposure `key` values
for an exposure defect; `sources` is the finding's complete normalized source
union. The same canonical blocker may be referenced under several affected
measure keys but counts once within each measure/cell. A cell-level structural
finding is projected to a metric exactly when at least one blocker for one of
that metric's evaluation-dependency measures refers to it. Findings with no
blocker projection stay only in the top-level prepared/result union. Thus a
valid claim sharing a cell with an invalid claim cannot yield a partial loss
total, and an exposure conflict cannot be washed out by a valid mapped source
group. `missing: "zero"` and a fail-allowing execution policy do not alter this
projection or turn a blocked component into a number.

If one exposure identity has several applicable invalid issues, it emits one
finding for each corresponding code but remains one reconciled invalid record.
No implicit source-group completeness finding exists: only the submitted
expected grid can emit `missing-expected-cell`. Every **preparation-owned**
structural finding is projected once into its owning fixed check and into the
core topology described in Section 14; normalization may merge only
semantically identical findings. The two evidence-owned findings
(`inconsistent-group-mapping` and `cached-formula-provenance`) are created only
by data review after preparation. They enter the complete review report,
receipt, gate, review/run identities, and compliance provenance, but never the
prepared/result finding topology or metric gate.

Finding context carries the particular identities, coordinates, and sources;
the constant message never interpolates caller strings. Core prepared findings
use the same code, message, and warning/fail severity as the owning check and
category `structural`. The compiler reserves the
`diagnostic/structural/` prefix from caller review-rule IDs.

After that fixed catalog, the report has exactly one aggregate check for each
top-level review rule in declaration order, with check ID and description equal
to the rule ID and description. Expression overflow makes the check fail;
otherwise triggered fail outranks triggered warning, which outranks any
not-evaluated evaluation, which outranks pass. This aggregate status never
replaces the complete per-cell evaluation array used by the execution gate.

Source locations travel on loss/exposure records. Ancillary evidence that is
not numeric input uses one explicit data-package shape:

```ts
export interface DiagnosticGroupingAssignment {
  key: string;
  group: string;
  source?: DiagnosticSourceLocation;
}

export interface DiagnosticCachedFormulaEvidence {
  id: string;
  source?: DiagnosticSourceLocation;
  formula?: string;
  cachedValue?: number | null;
  declaredFormulaSource: boolean;
}

export interface DiagnosticReviewEvidence {
  groupingAssignments: readonly DiagnosticGroupingAssignment[];
  cachedFormulas: readonly DiagnosticCachedFormulaEvidence[];
}

export type DiagnosticAllowedReviewStatus =
  | "pass"
  | "warning"
  | "not-evaluated"
  | "fail";

/**
 * The coordinate/scope/evaluation contracts below are owned by core and
 * imported by data; data does not reimplement numeric review semantics.
 */

export interface DiagnosticReviewCoordinate {
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation: string;
  readonly developmentAge: number;
  readonly ageUnit: string;
}

export interface DiagnosticCellReviewScope {
  readonly kind: "cell";
  readonly cell: DiagnosticReviewCoordinate;
  readonly sources: readonly DiagnosticSourceLocation[];
}

export interface DiagnosticValuationPairReviewScope {
  readonly kind: "valuation-pair";
  readonly previous: DiagnosticReviewCoordinate;
  readonly current: DiagnosticReviewCoordinate;
  readonly sources: readonly DiagnosticSourceLocation[];
}

export interface DiagnosticControlTotalReviewScope {
  readonly kind: "control-total";
  readonly projection: DiagnosticDeepReadonly<DiagnosticControlTotalProjection>;
  readonly filter: NormalizedDiagnosticReviewFilterIdentity | null;
  readonly selectedCellCount: number;
  readonly selectedContributionCount: number;
  readonly sources: readonly DiagnosticSourceLocation[];
}

export type DiagnosticReviewEvaluationScope =
  | DiagnosticCellReviewScope
  | DiagnosticValuationPairReviewScope
  | DiagnosticControlTotalReviewScope;

export interface DiagnosticReviewExpressionOverflow {
  /** RFC 6901 pointer to the exact failed leaf-accumulator or operation node. */
  readonly expressionPath: string;
  /** Concrete for cell/pair evaluation; null for every control-total site. */
  readonly coordinate: DiagnosticReviewCoordinate | null;
  readonly sources: readonly DiagnosticSourceLocation[];
}

export interface DiagnosticReviewRuleEvaluationBase {
  readonly ruleId: string;
  readonly ruleKind: DiagnosticReviewRule["kind"];
  readonly scope: DiagnosticReviewEvaluationScope;
  readonly status: "pass" | "triggered" | "not-evaluated";
  readonly triggerReason:
    | "predicate"
    | "missing-input"
    | "aggregation-overflow"
    | "expression-overflow"
    | "tolerance-overflow"
    | null;
  readonly severity: "warning" | "fail";
  readonly left: number | null;
  readonly right: number | null;
  readonly relation: "less" | "equal" | "greater" | null;
  readonly notEvaluatedReasons: readonly (
    | "missing"
    | "imputed"
    | "non-finite"
    | "structural-ambiguity"
    | "aggregation-overflow"
    | "expression-overflow"
    | "tolerance-overflow"
  )[];
  /** Complete, exact-deduplicated expression failures for this scope. */
  readonly expressionOverflows: readonly DiagnosticReviewExpressionOverflow[];
}

export type DiagnosticReviewRuleEvaluation =
  | (DiagnosticReviewRuleEvaluationBase & {
      readonly ruleKind: "compare" | "reconcile";
      readonly scope: DiagnosticCellReviewScope;
    })
  | (DiagnosticReviewRuleEvaluationBase & {
      readonly ruleKind: "monotonic";
      readonly scope: DiagnosticValuationPairReviewScope;
    })
  | (DiagnosticReviewRuleEvaluationBase & {
      readonly ruleKind: "layer-order";
      readonly scope: DiagnosticCellReviewScope;
      readonly comparability:
        | { readonly kind: "compiler-proven" }
        | {
            readonly kind: "caller-asserted";
            readonly rationaleArtifactId: string;
          };
    })
  | (DiagnosticReviewRuleEvaluationBase & {
      readonly ruleKind: "control-total";
      readonly scope: DiagnosticControlTotalReviewScope;
    });

export interface DiagnosticReviewReceipt {
  readonly definitionIntegrity: string;
  readonly preparationFingerprint: string;
  readonly evidence: DiagnosticDeepReadonly<DiagnosticReviewEvidence> | null;
  /** Contains every structured finding; only human `details` text may be capped. */
  readonly report: DiagnosticDeepReadonly<DataReviewReport>;
  readonly evaluations: readonly DiagnosticReviewRuleEvaluation[];
  /** Exact owner-normalized semantic body hashed by `reportFingerprint`. */
  readonly identityBody: DiagnosticReviewIdentityBody;
  readonly reportFingerprint: string;
}

export interface ReviewPreparedDiagnosticDataInput {
  prepared: PreparedDiagnosticData;
  /** `null` means no ancillary evidence was supplied; empty arrays mean reviewed-empty. */
  evidence: DiagnosticReviewEvidence | null;
}

export function reviewPreparedDiagnosticData(
  input: ReviewPreparedDiagnosticDataInput,
): DiagnosticReviewReceipt;
```

Cached-formula review uses this exact truth table after boundary validation.
When `declaredFormulaSource` is `false`, the record never emits the provenance
finding; optional `source`, `formula`, and `cachedValue` remain auditable. When
it is `true`, the record passes only when `source` is present, `formula` is a
valid nonempty human-text string, and `cachedValue` is an own property holding
a finite number. An absent or null cached value, absent source, or absent
formula emits exactly one `cached-formula-provenance` finding for that evidence
ID. Blank formula text and non-finite numbers fail the Zod scalar boundary,
not this review check.

These records are Zod-validated and included in the review receipt and run
identity. `reviewPreparedDiagnosticData` is itself a public boundary: after it
authenticates the prepared object, it strict-Zod-validates supplied evidence,
then defensively snapshots and deeply freezes the normalized evidence before
evaluation or hashing. Composed data runs use this same path rather than
relying on earlier validation. Their source locations participate in artifact
resolution, but the evidence is not part of the earlier preparation
fingerprint. They do not enter formula arithmetic or the reusable diagnostic
definition. An omitted declared loss measure on an otherwise valid expected
row follows that measure's `missing` policy; it is not reclassified as a
universal structural blocker. Required identity/discriminator fields and
malformed scalar shapes fail the Zod boundary instead.

The receipt fingerprint uses the Section 15 review payload over definition
identity, preparation identity, normalized evidence (including explicit null),
all ordered rule evaluations (including passes and comparability mode), and
the report's semantic identity projection, and is computed by the data package
rather than supplied by the caller. The exact deeply frozen owner-normalized
payload is exposed as `receipt.identityBody`; downstream packages consume that
value and never rebuild it from the human-facing receipt fields.
`DataReviewReport.checks` and each check's structured `findings` are complete
and deterministically ordered; human `description` and `details` rendering are
deliberately excluded from review identity. The existing 20-item cap applies
only to `details`.

The core-owned portable `DiagnosticReviewRule` union initially supports:

- `compare` two expressions in one cell;
- `reconcile` one expression to another within tolerance;
- `monotonic` an expression across valuation order;
- `layer-order` a narrower amount expression against a broader one; and
- `control-total` an expression over a declared filter against a supplied
  total.

The portable authored shape is:

```ts
interface DiagnosticReviewRuleBase {
  id: string;
  code: string;
  description: string;
  severity: "warning" | "fail";
  tolerance?: { absolute?: number; relative?: number };
  missingInput: "not-evaluated" | "finding";
}

export type DiagnosticReviewOperand =
  | DiagnosticMeasureExpression
  | { op: "constant"; value: number };

export interface DiagnosticReviewPredicate {
  left: DiagnosticReviewOperand;
  operator: "lt" | "lte" | "eq" | "neq" | "gte" | "gt";
  right: DiagnosticReviewOperand;
}

export type DiagnosticControlTotalProjection =
  | { kind: "valuation"; valuation: string }
  | { kind: "latest-valuation-per-origin" }
  | { kind: "all-cells" };

export type DiagnosticReviewFilter = Omit<
  DiagnosticsFilter,
  "outputGroups" | "instanceIds"
>;

export type DiagnosticReviewRule =
  | (DiagnosticReviewRuleBase & {
      kind: "compare";
      /** A true per-cell predicate emits a finding. */
      when: DiagnosticReviewPredicate;
    })
  | (DiagnosticReviewRuleBase & {
      kind: "reconcile";
      /** Equality within tolerance is the expected/pass condition. */
      actual: DiagnosticMeasureExpression;
      expected: DiagnosticReviewOperand;
    })
  | (DiagnosticReviewRuleBase & {
      kind: "monotonic";
      expression: DiagnosticMeasureExpression;
      direction: "nondecreasing" | "nonincreasing";
    })
  | (DiagnosticReviewRuleBase & {
      kind: "layer-order";
      narrower: DiagnosticMeasureExpression;
      broader: DiagnosticMeasureExpression;
      comparability:
        | { kind: "compiler-proven" }
        | { kind: "caller-asserted"; rationaleArtifactId: string };
    })
  | (DiagnosticReviewRuleBase & {
      kind: "control-total";
      expression: DiagnosticMeasureExpression;
      expected: number;
      filter?: DiagnosticReviewFilter;
      projection: DiagnosticControlTotalProjection;
    });

export function evaluateDiagnosticReviewRules(
  prepared: PreparedDiagnosticData,
): readonly DiagnosticDeepReadonly<DiagnosticReviewRuleEvaluation>[];
```

This is the sole portable review-rule execution seam. Core authenticates the
prepared value, uses its private dependency indexes, readiness propagation,
expression evaluator, Neumaier finalizer, period ordering, tolerance
classifier, and layer-comparability proof, then returns a deeply frozen neutral
evaluation array. Data calls it exactly once and only projects those evaluations
into `DataCheck` findings/statuses, the review receipt, and execution gate. No
data or compliance module copies core arithmetic or imports a private file.

Data-review rules are assertions except for the explicitly named `compare.when`
finding predicate. A successful assertion is a pass; a violated assertion emits
one finding. `reconcile` asserts equality using the exact tolerance band above.
Evaluation `left`/`right` values always mirror the declared comparison:
`compare` uses predicate left/right, `reconcile` uses actual/expected,
`layer-order` uses narrower/broader, and `control-total` uses the gathered
actual/declared expected value. `monotonic` uses previous/current and asserts
previous `<=` current for nondecreasing or previous `>=` current for
nonincreasing. Its `valuation-pair` scope retains both exact coordinates;
cell rules retain one `cell` scope and control totals retain their selected-cell
count rather than inventing a single coordinate. Every scope's `sources` is
the exact-deduplicated, globally sorted union from the transitive contributions
used by both operands; a missing-input scope still retains the sources that do
exist. Projected `DataFindingContext.reviewScope` carries that complete scope.
As with metric rules, every operand carries readiness from its transitive
prepared contributions and finalized stats. Any missing, imputed-zero,
non-finite, structurally ambiguous, or aggregation-overflowed dependency
follows the rule's `missingInput` path even when a numeric zero-imputed formula
value exists; it can never produce pass. A source-cell measure finalization
overflow records `aggregation-overflow`; its existing fail-severity
`diagnostic-measure-overflow` prepared finding remains attached to the cell.
Every finite-leaf expression is evaluated with Section 7's checked arithmetic.
Each non-finite intermediate records one
`DiagnosticReviewExpressionOverflow` at the exact operation node and concrete
coordinate for cell and valuation-pair rules. A control total has two distinct
global overflow sites because it is evaluated only after cell selection: (1)
finalizing a leaf's canonical contributions across the selection records the
RFC 6901 pointer to that exact `measureId` leaf; and (2) finite finalized leaves
whose `add`/`subtract` arithmetic becomes non-finite record the exact failed
operation-node pointer. Both control-total sites use `coordinate: null`, carry
the union of the inputs to that failed site, and classify readiness as
`expression-overflow`; a null coordinate never means the site is unknown. A
source-cell measure finalization that had already overflowed remains the
separate `aggregation-overflow` class and does not acquire a control-total
expression-overflow alias. The failed operand is null and
`notEvaluatedReasons` contains `expression-overflow`. Records
exact-deduplicate, then sort by `expressionPath` in code-unit order, concrete
coordinate before null, source group in code-unit order, and normalized numeric
origin/valuation coordinates. Distinct failed child nodes or evaluation cells
remain distinct, while a failed child does not create cascading ancestor
overflow records.
With `missingInput: "not-evaluated"`, the evaluation has status
`not-evaluated`, `triggerReason: null`, a null relation, and every readiness
reason; its aggregate rule check receives one finding per affected scope with
code `diagnostic-review-rule-not-evaluated` and constant message
`Diagnostic review rule was not evaluated`. With `missingInput: "finding"`,
the configured missing-data policy itself triggers: status is `triggered`,
`triggerReason` is `missing-input` for missing/imputed/non-finite/structural
readiness, `aggregation-overflow` when measure finalization overflow is the
sole classification reason, `expression-overflow` when expression overflow is
the sole classification reason, and `tolerance-overflow` when that is the sole
classification reason.
If several classes coexist, trigger-reason precedence is `missing-input`, then
`aggregation-overflow`, then `expression-overflow`, then
`tolerance-overflow`.
Relation remains null, reasons remain complete, and the projected finding uses
the rule's code and description at its declared severity. A tolerance overflow
therefore follows the configured `missingInput` policy exactly; it is never
silently downgraded or represented as a predicate comparison. An ordinary
violated predicate/assertion has
`triggerReason: "predicate"`; pass and not-evaluated outcomes use null. Thus a
missing-input finding is never falsely represented as an evaluated numeric
comparison, while its warning/fail gate effect is unambiguous. Each violated
top-level review-rule evaluation projects exactly one `DataFinding` keyed by
`(ruleId, canonical reviewScope)`; each required not-evaluated projection does
the same with its fixed not-evaluated code. `context.ruleId` and
`context.reviewScope` are mandatory. `context.sources` is the same normalized
union as `reviewScope.sources` and is present exactly when that union is
nonempty for these ordinary predicate/missing-input projections.
Independently of that configured missing-input projection, every expression
overflow record emits one `DataFinding` with code
`diagnostic-expression-overflow`, constant message
`Measure expression overflowed`, and mandatory `ruleId`, `expressionPath`,
`reviewScope`, and exact failed-site record `sources`; those context sources
may be a strict subset of the scope's complete both-operand source union and
the two arrays are never collapsed. A non-null overflow coordinate is also
copied into the ordinary coordinate context fields. Its owning aggregate
rule check is `fail`. Therefore a review check's exact status precedence is:
any expression-overflow record → fail; otherwise any triggered fail → fail;
otherwise any triggered warning → warning; otherwise any not-evaluated
evaluation → not-evaluated; otherwise pass. The standard overflow finding is
retained alongside the configured rule or fixed not-evaluated finding, so
`missingInput` cannot downgrade arithmetic overflow even though it still
controls how the unevaluated assertion itself is represented.
`monotonic` partitions by canonical source group and normalized origin. The
partition set is the union of partitions represented by retained prepared
cells and by the selected normalized expected-cell grid. Within each partition,
its coordinate set is the numeric-axis-sorted union of prepared-cell valuation
coordinates and expected-grid valuation coordinates for that exact partition.
The evaluator emits one evaluation for every adjacent coordinate pair in that
union and resolves each endpoint only at its exact coordinate. A missing
endpoint follows `missingInput`; it is never skipped and the evaluator never
bridges to a more distant observation. With no expected coordinates for a
partition, the set is simply its observed prepared-cell valuations. Zero or
one coordinate yields zero evaluations. Thus observed A/C plus expected A/B/C
evaluates A-B and B-C, never A-C; an expected-only partition is handled by the
same rule. The review receipt records when no submitted grid could establish
unobserved intermediate coordinates.
Every transitive leaf of a monotonic expression must declare either
`cumulative` or `point-in-time` development semantics; `incremental` and
`unknown` leaves are compile errors. Cumulative and point-in-time leaves may be
combined by the same pointwise expression compatibility rules, and the check
applies its authored direction literally across adjacent ordered snapshots; it
does not relabel a point-in-time status expression as cumulative.
Layer order asserts narrower `<=` broader. With
`comparability: { kind: "compiler-proven" }`, it is accepted only when compiler
metadata proves an exact partial order. Both expressions must be amounts with
the same currency and perspective and the same sorted component IDs and
treatments. `unknown` treatments or limitations, `pre-limited`, and
`application: "source-defined"` are not orderable. For every matched component,
whether limited or unlimited, the compiler must trace the narrower and broader
paths through their claim-derivation graphs to the same ultimate raw measure
leaf before any layer operation; two unrelated unlimited measures are never
comparable merely because both imply `[0, +infinity)`. Every limited component
must be SDK-derived, and at least one matched path in the comparison must
contain a compiler-authenticated `claim-layer` operation. Declared external
intervals alone are never “proof.” For each included component,
`unlimited` is the interval `[0, +infinity)`; a layer is
`[attachment, attachment + limit]`, with null limit giving `+infinity`.
Two finite/null layer intervals are comparable only when their non-source-defined
application values match. The narrower interval must be a subset of the broader
interval for every included component: its attachment is no lower and its
exhaustion is no higher. An unlimited broader component may contain a layer of
any explicit application; an unlimited narrower component can only match an
unlimited broader component. Arithmetic uses the original amount values—the
interval model is compile-time proof of comparability, not another cap.

When source-defined or pre-limited data prevents that proof, a caller may use
`caller-asserted` only if both operands are amounts in the same currency and
perspective and a non-empty rationale artifact ID is supplied. The assertion and artifact ID are
definition-integrity content, every evaluation discloses that comparability was
caller-asserted, and compliance requires the ID to resolve to a preparation
artifact. This is an explicit actuarial selection, not an SDK inference. It is
how the historical source-provided `$250K` total can be compared with a
separately source-prepared primary total without falsely claiming that their
component/layer relationship was mechanically proven.

A control total first selects cells through its filter, then uses its explicit
projection. It gathers the canonical retained contributions and blockers for
each expression leaf across all selected source cells, finalizes each leaf once
with the standard accumulator, and evaluates the add/subtract expression once
before equality comparison. It never sums already-rounded per-cell expression
values. A projection selecting zero cells is missing input—not numeric zero—and
follows the rule's `missingInput` path.
`selectedContributionCount` is exactly
`sum(c in selected unique source cells, m in exact-deduplicated syntactic
measureId leaves) c.contributions[m].length`. Preparation has already
materialized a derived measure, so its transitive raw derivation inputs are not
counted again. Repeating the same measure leaf in the AST does not count it
twice. Observed, imputed-zero, missing, and
non-finite entries all count; structural blockers do not. An origin-static
entry attached to two selected source cells counts twice because the rule did
select two calculation inputs, while suppressed equal copies do not add to the
count—the retained entry counts once and its `deduplicated` field reports the
suppression. `selectedCellCount` counts distinct selected prepared source
cells, including a cell whose selected expression is unavailable.
`valuation` selects the named normalized valuation across matching cells;
`latest-valuation-per-origin` partitions by source group and origin and selects
the observed cell with greatest valuation coordinate in each partition; and
`all-cells` selects every matching cell. The compiler rejects `all-cells` when
any transitive expression leaf is cumulative or uses `origin-static` exposure:
cumulative valuation snapshots and an origin-static exposure attached to each
valuation would otherwise be double counted. A caller must select one
valuation, use `latest-valuation-per-origin`, or provide a separately prepared
nonduplicated control artifact. It emits one evaluation per rule. Cell `compare`,
`reconcile`, and `layer-order` rules emit one evaluation per selected normalized
source cell. A completely absent expected cell is reviewable only when the
caller supplies an expected-cell grid.

```ts
export interface CasualtyMonotonicReviewBinding {
  id: string;
  expression: DiagnosticMeasureExpression;
  direction: "nondecreasing" | "nonincreasing";
  tolerance?: { absolute?: number; relative?: number };
}

export interface CasualtyLayerOrderReviewBinding {
  id: string;
  narrower: DiagnosticMeasureExpression;
  broader: DiagnosticMeasureExpression;
  comparability:
    | { kind: "compiler-proven" }
    | { kind: "caller-asserted"; rationaleArtifactId: string };
  tolerance?: { absolute?: number; relative?: number };
}

export interface CasualtyControlTotalReviewBinding {
  id: string;
  expression: DiagnosticMeasureExpression;
  expected: number;
  filter?: DiagnosticReviewFilter;
  projection: DiagnosticControlTotalProjection;
  tolerance?: { absolute?: number; relative?: number };
}

export interface CreateCasualtyDiagnosticReviewRulesInput {
  counts: CasualtyCountBindings;
  exposure: string;
  monotonicMeasures: readonly CasualtyMonotonicReviewBinding[];
  layerOrders: readonly CasualtyLayerOrderReviewBinding[];
  controlTotals: readonly CasualtyControlTotalReviewBinding[];
  severityOverrides?: Readonly<Record<string, "warning" | "fail">>;
}

export function createCasualtyDiagnosticReviewRules(
  input: CreateCasualtyDiagnosticReviewRulesInput,
): readonly DiagnosticReviewRule[];
```

The factory begins with these four rules in this exact order:

| Rule ID / code | Exact `description` | Kind and operands | Default severity |
|---|---|---|---|
| `casualty/review/count-reconciliation` | Reported count must equal open plus closed-no-pay plus closed-with-pay count | `reconcile`: reported against `add(open, closedNoPay, closedWithPay)` in that term order | fail |
| `casualty/review/closed-no-pay-bound` | Closed-no-pay count must not exceed reported count | `compare`: closedNoPay `gt` reported emits a finding | fail |
| `casualty/review/positive-exposure` | Exposure must be strictly positive | `compare`: exposure `lte` contextual zero emits a finding | fail |
| `casualty/review/closed-reopen-signal` | Closed count must be nondecreasing across valuations | `monotonic`: `add(closedNoPay, closedWithPay)` in that order, nondecreasing | warning |

For these fixed rules the code equals the rule ID's final path segment,
`missingInput` is `not-evaluated`, and the emitted tolerance object is exactly
`{ absolute: 0, relative: 0 }`. Caller monotonic, layer-order, and control
bindings follow in their input-array order and use their supplied ID as both
rule ID and default code. Their exact generated descriptions are `Expression
must be nondecreasing across valuations` or `Expression must be nonincreasing
across valuations`, `Narrower amount expression must not exceed broader amount
expression`, and `Expression must reconcile to the declared control total`.
Their default severities are warning, fail, and fail, respectively; omitted
tolerance emits `{ absolute: 0, relative: 0 }`, supplied partial tolerance fills
its omitted member with zero, and missing-input behavior is `not-evaluated`.
IDs are portable definition content, not display labels.

Each rule declares ID, code, description, severity, operands, tolerance, and
missing-input behavior. The SDK supplies `createCasualtyDiagnosticReviewRules`
for count reconciliation, CNP, explicitly positive exposure, monotonic,
reopen-signal, layer-order, and control checks. The exposure check is a
configured `compare.when exposure <= 0`; missing exposure remains
not-evaluated/structural rather than pass. Paid/incurred and negative-case
predicates live only on the relevant casualty metric instances, preventing
duplicate or drifting findings.
Caller-supplied monotonic/layer/control binding IDs must be non-empty and
globally unique with the factory's fixed count/exposure/reopen rule IDs.
Severity overrides are keyed by the resulting rule IDs; unknown keys,
duplicates, blanks, and explicit `undefined` are rejected before any rule array
is returned.
An alternate taxonomy such as
`reported = open + CNP + CWP + reopened` is configuration, not a source edit.

The data package updates its shared report contract to make diagnostic context
exact while retaining the generic source-file fields used by its other review
functions:

```ts
export type DataCheckStatus = "pass" | "warning" | "fail" | "not-evaluated";

export interface DataFindingContext {
  readonly ruleId?: string;
  readonly measureId?: string;
  readonly expressionPath?: string;
  readonly offendingKey?: string;
  readonly groupingKey?: string;
  readonly cachedEvidenceId?: string;
  readonly sourceGroup?: string;
  readonly group?: string;
  readonly origin?: string;
  readonly valuation?: string;
  readonly developmentAge?: number;
  readonly ageUnit?: string;
  readonly recordId?: string;
  readonly claimId?: string;
  readonly exposureKey?: string;
  readonly sourceFile?: string;
  readonly sourceRow?: number;
  readonly sources?: readonly DiagnosticSourceLocation[];
  readonly reviewScope?: DiagnosticDeepReadonly<DiagnosticReviewEvaluationScope>;
}

export interface DataFinding {
  readonly code: string;
  readonly message: string;
  readonly context?: DataFindingContext;
}

export interface DataCheck {
  readonly id: string;
  readonly description: string;
  readonly status: DataCheckStatus;
  /** Human rendering only; this is the sole field subject to the 20-item cap. */
  readonly details: readonly string[];
  /** Complete and deterministically ordered. */
  readonly findings: readonly DataFinding[];
}

export interface DataReviewReport {
  readonly checks: readonly DataCheck[];
  readonly summary: {
    readonly pass: number;
    readonly warning: number;
    readonly fail: number;
    readonly notEvaluated: number;
  };
}
```

`ageMonths` is removed from this contract; diagnostics use `developmentAge`
plus `ageUnit`. Non-diagnostic reviewers may continue to use the generic
source-file/source-row fields.

## 14. Results and projections

The existing reserving `DiagnosticFinding` and `DiagnosticsResult.findings`
contract used by `runDiagnostics` remains unchanged. Generalized metric
diagnostics use the distinct `DiagnosticMetricFinding` name below; the two
severity vocabularies and shapes must not be merged, aliased, or structurally
overloaded.

```ts
export interface DiagnosticMetricFinding {
  readonly code: string;
  readonly message: string;
  readonly severity: "info" | "warning" | "fail";
  readonly category: "structural" | "aggregation" | "calculation" | "rule" | "presentation";
  readonly ruleId?: string;
  readonly measureId?: string;
  readonly instanceId?: string;
  readonly expressionPath?: string;
  readonly offendingKey?: string;
  readonly sourceGroup?: string;
  readonly group?: string;
  readonly origin?: string;
  readonly valuation?: string;
  readonly developmentAge?: number;
  readonly ageUnit?: string;
  readonly recordId?: string;
  readonly claimId?: string;
  readonly exposureKey?: string;
  readonly sources: readonly DiagnosticSourceLocation[];
}

export interface DiagnosticMetricEvaluation {
  instanceId: string;
  instanceVersion: string;
  formulaId: string;
  formulaVersion: string;
  semanticReferences: {
    amountBasisIds: readonly string[];
    countPopulationIds: readonly string[];
    exposureBasisIds: readonly string[];
  };
  formulaFingerprint: string;
  calculationFingerprint: string;
  definitionIntegrity: string;
  calculation: {
    numerator: DiagnosticQuantity;
    denominator: DiagnosticQuantity;
    value: number | null;
  };
  presentation: DiagnosticMetricPresentation & {
    value: number | null;
  };
  components: Readonly<Record<string, DiagnosticMeasureStats>>;
  rules: readonly DiagnosticRuleEvaluation[];
  findings: readonly DiagnosticMetricFinding[];
}

export interface DiagnosticQuantitySemantics {
  kind: DiagnosticMeasureKind;
  unit: string;
  basisId?: string;
  countPopulationId?: string;
  exposureBasisId?: string;
}

export interface DiagnosticQuantity extends DiagnosticQuantitySemantics {
  value: number | null;
}

export interface DiagnosticClaimObservation extends DiagnosticLossRecordBase {
  rowType: "claim";
  /** Stable across valuations for the same claim. */
  claimId: string;
}

export interface DiagnosticLossSnapshot extends DiagnosticLossRecordBase {
  rowType: "aggregate";
}

export type DiagnosticLossInput =
  | DiagnosticClaimObservation
  | DiagnosticLossSnapshot;

export interface DiagnosticsFilter {
  sourceGroups?: readonly string[];
  outputGroups?: readonly string[];
  origins?: readonly string[];
  originFrom?: string;
  originThrough?: string;
  valuations?: readonly string[];
  valuationFrom?: string;
  valuationThrough?: string;
  minDevelopmentAge?: number;
  maxDevelopmentAge?: number;
  instanceIds?: readonly string[];
}

```

`semanticReferences` is the exact-deduplicated, code-unit-sorted projection of
the instance's full `evaluationDependencies`: calculation leaves and their
transitive derivations plus metric-rule-only measure operands and those
operands' transitive derivations. Each semantic ID enters only its matching
array; constants and calculation-field operands introduce none. By contrast,
the numeric calculation and calculation fingerprint use only
`calculationDependencies`. A rule-only basis therefore appears in the
evaluation and definition identity without moving the numeric calculation
identity.

`DiagnosticMetricEvaluation.components` contains exactly that instance's full
`evaluationDependencies`, keyed by code-unit-sorted measure ID. In contrast,
every `PreparedDiagnosticSourceCell.components` and every mapped
`DiagnosticEmergencePoint.components` contains exactly one entry for **every**
measure declared by the compiled definition, also keyed by code-unit-sorted
measure ID, regardless of the selected `instanceIds`. This includes unselected
calculation-only measures, rule-only measures, derived measures, and every
required exposure measure; a missing or blocked value remains an explicit
`DiagnosticMeasureStats` entry rather than disappearing. Group mapping merges
those complete component maps before selected metrics are evaluated. Thus
metric-local components explain an evaluation, while emergence components are
the complete prepared/mapped cell ledger; both memberships are deterministic
and participate in result identity.

Filter arrays are set-like: boundary validation/preparation rejects blank entries,
deduplicates exact strings, and sorts them by code-unit order before use or
identity hashing. Range endpoints retain their named inclusive meaning and are
normalized through the relevant side of the period axis. Explicit empty arrays
select nothing and remain distinct from omitted fields; `undefined` is never a
serializable value. All supplied predicates are conjunctive. Unknown period
labels/instance/group IDs and reversed period ranges are errors rather than
empty-result fallbacks. Each supplied `minDevelopmentAge` and
`maxDevelopmentAge` must be a nonnegative safe integer, and
`minDevelopmentAge > maxDevelopmentAge` is also an error.

```ts
export interface DiagnosticCompletePeriodCutoff {
  readonly sourceGroup: string;
  readonly originThrough: string | null;
  readonly valuationThrough: string | null;
}

export interface DiagnosticExpectedCell {
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation: string;
  readonly source?: DiagnosticSourceLocation;
}

export interface PrepareDiagnosticDataInput {
  definition: CompiledDiagnosticDefinition;
  losses: readonly DiagnosticLossInput[];
  exposures: readonly DiagnosticExposureObservation[];
  filter?: DiagnosticsFilter;
  completePeriodCutoffs?: readonly DiagnosticCompletePeriodCutoff[];
  expectedCells?: readonly DiagnosticExpectedCell[];
}

export interface PreparedDiagnosticSourceCell {
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation: string;
  readonly developmentAge: number;
  readonly ageUnit: string;
  /** All contributing claim/aggregate loss-row IDs; exposure IDs are retained elsewhere. */
  readonly lossRecordIds: readonly string[];
  readonly contributions: Readonly<
    Record<string, readonly DiagnosticMeasureContribution[]>
  >;
  readonly components: Readonly<Record<string, DiagnosticMeasureStats>>;
  readonly structuralBlockers: Readonly<
    Record<string, readonly DiagnosticStructuralBlocker[]>
  >;
  readonly findings: readonly DiagnosticMetricFinding[];
}

export interface DiagnosticStructuralBlocker {
  readonly code: string;
  readonly message: string;
  readonly sourceIds: readonly string[];
  readonly sources: readonly DiagnosticSourceLocation[];
  /** Exact preparation finding whose dependency this blocker represents. */
  readonly finding?: DiagnosticMetricFinding;
}

export interface DiagnosticMeasureContributionBase {
  readonly sourceId: string;
  /** Normalized source union; empty only when no row-level source was supplied. */
  readonly sources: readonly DiagnosticSourceLocation[];
  /** Redundant observations suppressed under the timing-specific equality rule. */
  readonly deduplicated: number;
}

export type DiagnosticMeasureContribution =
  | (DiagnosticMeasureContributionBase & {
      readonly status: "observed";
      /** Always finite; signed zero is normalized to zero. */
      readonly value: number;
    })
  | (DiagnosticMeasureContributionBase & {
      readonly status: "imputed-zero";
      readonly value: 0;
    })
  | (DiagnosticMeasureContributionBase & {
      readonly status: "missing";
      readonly value: null;
    })
  | (DiagnosticMeasureContributionBase & {
      readonly status: "non-finite";
      readonly value: null;
      readonly nonFiniteKind: "nan" | "positive-infinity" | "negative-infinity";
    });

export type DiagnosticAuditedNumericValue =
  | { readonly status: "observed"; readonly value: number }
  | { readonly status: "missing"; readonly value: null }
  | {
      readonly status: "non-finite";
      readonly value: null;
      readonly nonFiniteKind: "nan" | "positive-infinity" | "negative-infinity";
    };

export interface DiagnosticExposureAuditObservation {
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation?: string;
  readonly value: DiagnosticAuditedNumericValue;
  readonly complete: boolean;
  readonly source?: DiagnosticSourceLocation;
}

export type DiagnosticInputDisposition =
  | "invalid"
  | "complete-period-cutoff"
  | "filter"
  | "retained";

export interface DiagnosticLossInputAuditSnapshot {
  readonly recordId: string;
  readonly rowType: "claim" | "aggregate";
  readonly claimId: string | null;
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation: string;
  readonly complete: boolean;
  readonly measures: Readonly<Record<string, DiagnosticAuditedNumericValue>>;
  readonly source: DiagnosticSourceLocation | null;
}

export interface DiagnosticExposureInputAuditSnapshot {
  readonly key: string;
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation: string | null;
  readonly measureId: string;
  readonly value: DiagnosticAuditedNumericValue;
  readonly complete: boolean;
  readonly source: DiagnosticSourceLocation | null;
}

export interface DiagnosticExpectedCellAuditSnapshot {
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation: string;
  readonly source: DiagnosticSourceLocation | null;
}

export type DiagnosticInputAuditRecord =
  | {
      readonly kind: "loss";
      readonly disposition: DiagnosticInputDisposition;
      readonly record: DiagnosticLossInputAuditSnapshot;
    }
  | {
      readonly kind: "exposure";
      readonly disposition: DiagnosticInputDisposition;
      readonly record: DiagnosticExposureInputAuditSnapshot;
    }
  | {
      readonly kind: "expected-cell";
      readonly disposition: Exclude<DiagnosticInputDisposition, "invalid">;
      readonly record: DiagnosticExpectedCellAuditSnapshot;
    };

export type ReconciledDiagnosticExposure =
  | {
      readonly measureId: string;
      readonly key: string;
      readonly status: "valid";
      readonly sourceGroup: string;
      readonly origin: string;
      readonly valuation?: string;
      /** Always finite for a valid record. */
      readonly value: number;
      readonly deduplicated: number;
      readonly sources: readonly DiagnosticSourceLocation[];
    }
  | {
      readonly measureId: string;
      readonly key: string;
      readonly status: "invalid";
      /** Complete, nonempty, and stored in the fixed order defined below. */
      readonly issues: readonly (
        | "missing"
        | "incomplete"
        | "non-finite"
        | "duplicate"
        | "conflict"
      )[];
      readonly value: null;
      readonly observations: readonly DiagnosticExposureAuditObservation[];
    };

declare const preparedDiagnosticDataBrand: unique symbol;

export interface PreparedDiagnosticData {
  readonly [preparedDiagnosticDataBrand]: true;
  readonly definition: CompiledDiagnosticDefinition;
  readonly preparationFingerprint: string;
  readonly filter: DiagnosticDeepReadonly<DiagnosticsFilter> | null;
  readonly completePeriodCutoffs: readonly DiagnosticCompletePeriodCutoff[];
  /** One identity-bearing record for every submitted record surviving phase 0. */
  readonly inputAudit: readonly DiagnosticInputAuditRecord[];
  readonly cells: readonly PreparedDiagnosticSourceCell[];
  readonly exposures: readonly ReconciledDiagnosticExposure[];
  readonly expectedCellsProvided: boolean;
  readonly expectedCells: readonly DiagnosticExpectedCell[];
  readonly findings: readonly DiagnosticMetricFinding[];
}

export interface RunMetricDiagnosticsInput {
  prepared: PreparedDiagnosticData;
  groupMap?: Readonly<Record<string, string>>;
  groupDimensions?: Readonly<Record<string, JsonValue>>;
}

export interface DiagnosticEmergencePoint {
  group: string;
  sourceGroups: readonly string[];
  dimensions?: JsonValue;
  origin: string;
  valuation: string;
  developmentAge: number;
  ageUnit: string;
  components: Readonly<Record<string, DiagnosticMeasureStats>>;
  metrics: Readonly<Record<string, DiagnosticMetricEvaluation>>;
  findings: readonly DiagnosticMetricFinding[];
}

export interface DiagnosticMetricTriangle {
  group: string;
  instanceId: string;
  origins: readonly string[];
  developmentAges: readonly number[];
  ageUnit: string;
  calculationValues: readonly (readonly (number | null)[])[];
  presentationValues: readonly (readonly (number | null)[])[];
  cells: readonly (
    readonly (DiagnosticMetricTriangleCell | null)[]
  )[];
}

export interface DiagnosticMetricTriangleCell {
  origin: string;
  valuation: string;
  developmentAge: number;
  ageUnit: string;
  /** The exact object held by the corresponding emergence point. */
  evaluation: DiagnosticMetricEvaluation;
}

export interface MetricDiagnosticsResult {
  definitionIntegrity: string;
  preparationFingerprint: string;
  ageUnit: string;
  emergence: readonly DiagnosticEmergencePoint[];
  triangles: readonly DiagnosticMetricTriangle[];
  latestDiagonal: readonly DiagnosticEmergencePoint[];
  findings: readonly DiagnosticMetricFinding[];
}

export interface CommonMaturityResult {
  readonly developmentAge: number | null;
  readonly ageUnit: string;
  readonly points: readonly DiagnosticDeepReadonly<DiagnosticEmergencePoint>[];
}

export function runMetricDiagnostics(
  input: RunMetricDiagnosticsInput,
): DiagnosticDeepReadonly<MetricDiagnosticsResult>;

/** Validates grouping/output selection without evaluating any metric. */
export function validateDiagnosticGroupingConfiguration(
  input: RunMetricDiagnosticsInput,
): void;

export function prepareDiagnosticData(
  input: PrepareDiagnosticDataInput,
): PreparedDiagnosticData;

/** Runtime owner check; structural lookalikes and copied symbols are rejected. */
export function assertPreparedDiagnosticData(
  value: unknown,
): asserts value is PreparedDiagnosticData;

/** Core-owned integrity check; other packages never reimplement its payload. */
export function verifyPreparedDiagnosticDataIntegrity(
  prepared: PreparedDiagnosticData,
): void;

export function sameMaturity(
  result: DiagnosticDeepReadonly<MetricDiagnosticsResult>,
  developmentAge: number,
  outputGroups?: readonly string[],
): readonly DiagnosticDeepReadonly<DiagnosticEmergencePoint>[];

export function commonMaturity(
  result: DiagnosticDeepReadonly<MetricDiagnosticsResult>,
  outputGroups: readonly string[],
): DiagnosticDeepReadonly<CommonMaturityResult>;
```

Finding projection is one fixed acyclic topology. A metric evaluation contains
the mapped prepared findings for components in that instance's evaluation
dependencies plus its own calculation, presentation, and metric-rule findings.
An emergence point contains the mapped prepared-cell findings plus the findings
from every selected metric evaluation in that point. `result.findings` is the
normalized union of every emergence finding and every top-level prepared
finding that could not attach to a retained cell (for example an invalid-period
row). Exact duplicates merge under Section 15; distinct evidence does not.
Triangles, latest diagonal, and maturity helpers reference the same emergence
evaluations and do not build independent finding collections. Tests assert
both object aliasing and equality of every projected union.
Preparation-owned findings carry `sourceGroup`. When projected into a mapped
cell they retain that field and also receive `group`; findings from two mapped
source groups therefore remain separately reviewable unless every other
semantic field and source union is identical. Metric-owned runtime findings
carry `group` and do not invent a source group.

Core-generated non-structural findings use this fixed catalog. Messages are
constant; IDs and coordinates live in structured fields and are never
interpolated. One finding is emitted per affected canonical scope after exact
deduplication.

| Code | Constant message | Category | Severity |
|---|---|---|---|
| `diagnostic-measure-missing` | Measure input is missing | aggregation | warning |
| `diagnostic-measure-imputed-zero` | Missing measure input was imputed as zero | aggregation | info |
| `diagnostic-measure-non-finite` | Measure input is non-finite | aggregation | fail |
| `diagnostic-measure-overflow` | Measure aggregation overflowed | aggregation | fail |
| `diagnostic-expression-overflow` | Measure expression overflowed | aggregation | fail |
| `diagnostic-numerator-unavailable` | Calculation numerator is unavailable | calculation | warning |
| `diagnostic-denominator-unavailable` | Calculation denominator is unavailable | calculation | warning |
| `diagnostic-denominator-not-positive` | Calculation denominator is not strictly positive | calculation | warning |
| `diagnostic-calculation-overflow` | Calculation result overflowed | calculation | fail |
| `diagnostic-rule-not-evaluated` | Diagnostic metric rule was not evaluated | rule | info |
| `diagnostic-presentation-overflow` | Presentation scaling overflowed | presentation | fail |

The emission scope is also contract, not implementation choice:

| Finding family | Exact emission scope and required structured fields |
|---|---|
| missing / imputed-zero / non-finite measure | one per prepared source cell and measure when at least one matching retained contribution has that state; `measureId`, source-cell coordinate, and the union of affected contribution `sources` |
| measure overflow | one per aggregation finalization site and measure; a source-cell site carries `sourceGroup`, a mapped site carries `group`, and both carry the coordinate, `measureId`, and all contributing `sources` |
| expression overflow | one per failed expression evaluation site; a claim derivation carries `recordId`, output `measureId`, and stable `expressionPath`; a mapped metric calculation site carries `instanceId`, output coordinate, and `expressionPath`; a metric-rule operand site additionally carries `ruleId`; sources are the transitive available contribution union |
| top-level review expression overflow | one `DataFinding` per `ruleId`, canonical review scope, and failed `expressionPath`; cell/pair operation sites carry their concrete evaluation coordinate, while control-total leaf-accumulator and global expression-operation sites both carry `coordinate: null`; required context and sources are exactly those specified in Section 13, and the owning review check is fail |
| numerator unavailable / denominator unavailable / denominator not positive / calculation overflow / presentation overflow | at most one per mapped metric cell, instance, and listed code; carry `instanceId`, output coordinate, and transitive available `sources` |
| metric rule not evaluated | exactly one per not-evaluated mapped metric cell, instance, and rule; carry `instanceId`, `ruleId`, output coordinate, and operand-source union |
| triggered metric rule | exactly one per triggered mapped metric cell, instance, and rule using the authored code/message/severity; carry `instanceId`, `ruleId`, output coordinate, and operand-source union |

`expressionPath` is an RFC 6901 JSON Pointer to the exact operation node in
`normalizedDefinition`; array indexes therefore refer to normalized array
order. An overflow finding is emitted only at a node whose own finite operands
produce a non-finite result. Null propagated from a failed child does not emit
another overflow at every ancestor; two independently failing child nodes keep
their distinct paths. Source arrays are always present on generated diagnostic
findings, with `[]` only when all contributing records lacked row-level
locations. These cardinalities are applied before the Section 15 semantic
merge and global sort.

A triggered metric rule instead uses its authored code/message/severity and
category `rule`. Structural codes/messages/severities come from Section 13.
Missing/imputed/non-finite component findings coexist with the single
numerator/denominator availability finding when applicable; deterministic
normalization removes only exact duplicates, not distinct evidence.

Both view helpers return the exact frozen emergence-point objects; they never
clone or recalculate an evaluation. A requested development age must be a
nonnegative safe integer. Group arrays are set-like: blanks/unknown groups are
errors, exact duplicates are removed, and retained groups sort by code unit.
For `sameMaturity`, omission selects every produced group while an explicit
empty array returns `[]`. Points sort by group, numeric origin coordinate, then
numeric valuation coordinate.

`commonMaturity` chooses the greatest development age that occurs in every
selected group and returns all selected-group points at that age in the same
order. If the exact-deduplicated group list is empty, or no age is common to
every selected group, it returns `{ developmentAge: null, ageUnit:
result.ageUnit, points: [] }`. Unknown groups never masquerade as the no-common-
age case. The top-level `ageUnit` makes even an empty result/view unambiguous.

The data package locks the unknown-input/review/gate composition with these
public contracts:

```ts
export interface DiagnosticExecutionPolicyInput {
  readonly allowedReviewStatuses?: readonly DiagnosticAllowedReviewStatus[];
  readonly allowedMetricFindingSeverities?: readonly (
    | "info"
    | "warning"
    | "fail"
  )[];
  readonly rationaleRef?: string;
}

/** Strict authored input; configuration is JSON-safe, raw measurements are audited. */
export interface DiagnosticRunInput {
  readonly definition: DiagnosticDefinition;
  readonly losses: readonly DiagnosticLossInput[];
  readonly exposures?: readonly DiagnosticExposureObservation[];
  readonly filter?: DiagnosticsFilter;
  readonly completePeriodCutoffs?: readonly DiagnosticCompletePeriodCutoff[];
  readonly expectedCells?: readonly DiagnosticExpectedCell[];
  readonly reviewEvidence?: DiagnosticReviewEvidence | null;
  readonly runPresetId?: string;
  /** Fallback provenance for data-bearing records without row-level sources. */
  readonly datasetArtifactId?: string;
  readonly groupMap?: Readonly<Record<string, string>>;
  readonly groupDimensions?: Readonly<Record<string, JsonValue>>;
  readonly policy?: DiagnosticExecutionPolicyInput;
}

declare const validatedDiagnosticRunInputBrand: unique symbol;

export interface ValidatedDiagnosticRunInput {
  readonly [validatedDiagnosticRunInputBrand]: true;
  readonly definition: CompiledDiagnosticDefinition;
  readonly losses: readonly DiagnosticDeepReadonly<DiagnosticLossInput>[];
  readonly exposures: readonly DiagnosticDeepReadonly<DiagnosticExposureObservation>[];
  readonly filter: DiagnosticDeepReadonly<DiagnosticsFilter> | null;
  readonly completePeriodCutoffs: readonly DiagnosticCompletePeriodCutoff[];
  readonly expectedCells: readonly DiagnosticExpectedCell[] | null;
  readonly reviewEvidence: DiagnosticDeepReadonly<DiagnosticReviewEvidence> | null;
  readonly runPresetId: string | null;
  readonly datasetArtifactId: string | null;
  readonly groupMap: Readonly<Record<string, string>>;
  readonly groupDimensions: Readonly<Record<string, JsonValue>>;
  readonly policy: {
    readonly allowedReviewStatuses: readonly DiagnosticAllowedReviewStatus[];
    readonly allowedMetricFindingSeverities: readonly (
      | "info"
      | "warning"
      | "fail"
    )[];
    readonly rationaleRef: string | null;
  };
}

export interface DiagnosticExecutionGateReceipt {
  readonly allowedReviewStatuses: readonly DiagnosticAllowedReviewStatus[];
  readonly allowedMetricFindingSeverities: readonly (
    | "info"
    | "warning"
    | "fail"
  )[];
  readonly rationaleRef: string | null;
  readonly reviewGate: "passed" | "blocked";
  readonly metricGate: "not-run" | "passed" | "blocked";
}

declare const completedValidatedMetricDiagnosticsRunBrand: unique symbol;

export interface CompletedValidatedMetricDiagnosticsRun {
  readonly [completedValidatedMetricDiagnosticsRunBrand]: true;
  readonly status: "completed";
  readonly prepared: PreparedDiagnosticData;
  readonly review: DiagnosticReviewReceipt;
  readonly result: DiagnosticDeepReadonly<MetricDiagnosticsResult>;
  readonly runPresetId: string | null;
  readonly datasetArtifactId: string | null;
  readonly groupMap: Readonly<Record<string, string>>;
  readonly groupDimensions: Readonly<Record<string, JsonValue>>;
  readonly gate: DiagnosticExecutionGateReceipt & {
    readonly reviewGate: "passed";
    readonly metricGate: "passed";
  };
}

export type ValidatedMetricDiagnosticsOutcome =
  | {
      readonly status: "blocked";
      readonly stage: "review";
      readonly prepared: PreparedDiagnosticData;
      readonly review: DiagnosticReviewReceipt;
      readonly result: null;
      readonly runPresetId: string | null;
      readonly datasetArtifactId: string | null;
      readonly groupMap: Readonly<Record<string, string>>;
      readonly groupDimensions: Readonly<Record<string, JsonValue>>;
      readonly gate: DiagnosticExecutionGateReceipt & {
        readonly reviewGate: "blocked";
        readonly metricGate: "not-run";
      };
    }
  | {
      readonly status: "blocked";
      readonly stage: "metric";
      readonly prepared: PreparedDiagnosticData;
      readonly review: DiagnosticReviewReceipt;
      readonly result: DiagnosticDeepReadonly<MetricDiagnosticsResult>;
      readonly runPresetId: string | null;
      readonly datasetArtifactId: string | null;
      readonly groupMap: Readonly<Record<string, string>>;
      readonly groupDimensions: Readonly<Record<string, JsonValue>>;
      readonly gate: DiagnosticExecutionGateReceipt & {
        readonly reviewGate: "passed";
        readonly metricGate: "blocked";
      };
    }
  | CompletedValidatedMetricDiagnosticsRun;

export function validateDiagnosticRunInput(
  input: unknown,
): ValidatedDiagnosticRunInput;

export function runValidatedMetricDiagnostics(
  input: ValidatedDiagnosticRunInput,
): ValidatedMetricDiagnosticsOutcome;

/** Runtime owner check used by compliance; a structural lookalike is rejected. */
export function assertCompletedValidatedMetricDiagnosticsRun(
  value: unknown,
): asserts value is CompletedValidatedMetricDiagnosticsRun;
```

Validation parses the complete input and calls the core compiler exactly once;
the opaque validated value carries that compiled definition and a defensive,
deep-frozen clone of every row/configuration field, closing mutate-after-validate
gaps. The Zod object is strict at every nested authored boundary. `losses` is
required and may be empty. Omitted `exposures` and `completePeriodCutoffs`
normalize to frozen empty arrays; omitted `filter`, `expectedCells`, and
`reviewEvidence` normalize to `null`. An explicitly empty expected grid remains
`[]`, distinct from omission, and an explicit reviewed-empty evidence object
must contain both required empty arrays. Omitted maps normalize to safe,
prototype-free empty records.

Optional authored `runPresetId` and `datasetArtifactId` values must be nonempty
strings and normalize to `null` when omitted; both travel unchanged through
every blocked or completed outcome. The latter is the run-bound fallback input
artifact for records without row-level source locations and compliance cannot
attach it after execution. Policy arrays are set-like, reject unknown values,
deduplicate, and normalize to the fixed orders `pass`, `warning`,
`not-evaluated`, `fail` and `info`, `warning`, `fail`. An omitted policy or
omitted fields within it defaults to review statuses `pass`, `warning`, and
`not-evaluated`, metric severities `info` and `warning`, and `rationaleRef:
null`; explicit empty arrays remain empty. A supplied rationale must be a
nonempty string. Allowing `fail` in either set requires one. Explicit
`undefined`, extra keys, non-JSON dimensions/evidence, blank map keys/targets,
and all other invalid forms are rejected rather than normalized away.
Definition/configuration/evidence numbers must be finite JSON numbers. Raw loss
measure values and exposure `value` are the sole exception: programmatic callers
may supply any JavaScript number, and preparation immediately converts NaN or
infinity to the safe audited sentinel and fail-closed finding defined above.
The owner-branded `ValidatedDiagnosticRunInput` is the sole temporary in-memory
carrier of those defensively cloned raw numbers between validation and
preparation; it is not a serializable artifact or identity payload. No raw
non-finite number enters canonical JSON, a calculation, provenance, a review
receipt, or any result/outcome beyond that validated wrapper.
Execution calls
`prepareDiagnosticData` exactly once, calls core's
`validateDiagnosticGroupingConfiguration` against that exact prepared object,
then reviews that prepared object. Thus an invalid
map/dimension/output-group selection is an atomic configuration error before
review. It next applies the review gate, runs core only when permitted, and
then applies the metric-finding gate. That gate scans `result.findings` exactly once and only
categories `aggregation`, `calculation`, `rule`, and `presentation`; structural
findings were already governed by the review gate and are not recursively
counted again from nested objects. A blocked metric outcome retains the deterministic result
for review but is not an approved completed run. Allowing fail in either policy
requires a non-empty rationale reference and yields `completed` only after both
gates pass under that recorded policy.

Each outcome has a newly created frozen outer object and frozen unbranded
configuration snapshots. It preserves the exact owner-created, already-frozen
`prepared`, `review`, and (when present) `result` references; it never
structurally clones, spreads, or JSON-round-trips an object whose authenticity
or view aliasing is owner-controlled. Owner-controlled authenticity is
runtime-enforced (for example with a module-private `WeakSet` or non-enumerable
uncopyable token), not merely a public enumerable symbol property. Core's
`assertPreparedDiagnosticData` and data's
`assertCompletedValidatedMetricDiagnosticsRun` are the only cross-package
runtime seams; copied symbols, deserialized objects, structural lookalikes, and
mutation of a genuine completed run are rejected or impossible.

`prepareDiagnosticData` is the one normalization/derivation/source-aggregation
and exposure-attachment seam shared by core execution and data review. It never
applies group mapping or calculates metric instances. `lossRowGrain` and each
row's `rowType` must agree. A mismatch is an atomic
`INVALID_DIAGNOSTIC_INPUT` with issue code `invalid-input-relationship` at
`$.losses[index].rowType`; it produces no audit, prepared object, or structural
finding. Within the selected population, loss `recordId` values are unique
across all cells; a claim ID is stable across valuations but may occur at most
once in a normalized source cell. Multiple distinct claims may occupy one source cell. Aggregate snapshots must be unique by
source group/origin/valuation before group mapping. Derivations, source-cell
aggregation, exposure identity reconciliation, timing-aware exposure joins,
and component finalization all occur in preparation.

Preparation uses these phases in exact order. A phase never examines a record
that already received a terminal disposition from an earlier phase.

0. **Atomic boundary/configuration validation.** Authenticate the compiled
   definition; validate shapes, filters, cutoffs, and every expected-cell
   coordinate; and reject duplicate canonical expected-cell identities across
   the entire submitted grid. A valuation-specific exposure without
   `valuation` and a loss `rowType` different from the definition's
   `lossRowGrain` are `INVALID_DIAGNOSTIC_INPUT`. These failures produce neither
   an audit nor a prepared object. An unknown/wrong-source exposure measure
   stays reviewable because its timing cannot validly be inferred.
1. **Audit capture and raw-source selection.** Create one immutable snapshot
   for every otherwise shape-valid submitted record, preserving every semantic
   field, measure key, audited numeric sentinel, and normalized source or
   explicit null. If `filter.sourceGroups` excludes its exact source group,
   assign `filter` immediately; that explicitly excluded source cannot emit a
   period or identity finding.
2. **Period normalization.** Normalize each applicable coordinate. A selected
   record with an unknown period, valuation before origin, or unsafe/negative
   age receives `invalid`, emits every applicable period finding, and enters no
   identity cohort. Recognized aliases become canonical labels; invalid labels
   remain verbatim in the audit.
3. **Complete-period cutoff.** Apply the timing-applicable inclusive cutoff;
   an excluded record receives `complete-period-cutoff`.
4. **Remaining filters.** Apply timing-applicable origin, valuation, and age
   predicates; an excluded record receives `filter`. `outputGroups` and
   `instanceIds` never determine an input disposition.
5. **Selected-population validation/reconciliation.** Treat the remaining
   records as provisional candidates. Run row-local contract/completeness
   checks and cross-record loss/exposure identity reconciliation over this
   population only. Every member of an invalid cohort receives `invalid`;
   otherwise it receives `retained`. Null, non-finite, or incomplete exposure
   observations still enter their cohort so the reconciled invalid record can
   preserve every applicable issue and source.
6. **Arithmetic preparation.** Only final retained loss records and reconciled
   valid exposures create numeric contributions/joins. Only retained expected
   cells participate in coverage. Equal complete, finite-observed
   origin-static copies remain separate retained audit records while
   reconciliation creates one contribution with `deduplicated: N - 1`;
   equal invalid copies remain invalid audit records and create no contribution.

The following selected-condition matrix is exhaustive after atomic validation:

| Selected input condition | Final disposition / reconciliation | Arithmetic and finding effect |
|---|---|---|
| omitted or null loss field on an otherwise valid row | loss row `retained` | missing or imputed-zero contribution under that measure's policy, with its corresponding finding |
| non-finite loss field on an otherwise valid row | loss row `retained` | non-finite contribution and finding; finalization fails closed |
| incomplete loss row or row with a measure-contract violation | row `invalid`; it still joins any identity cohort whose identity fields are canonical | every applicable structural finding; no contribution |
| duplicate/conflicting loss identity | every selected cohort member `invalid` | one per-cohort finding of each applicable code; no affected contribution |
| exposure row with an undeclared or wrong-source `measureId`, after the unknown-timing selection rule | row `invalid`; it enters no exposure identity cohort and no `ReconciledDiagnosticExposure` | one measure-contract finding; no contribution, join, or blocker |
| null, non-finite, or incomplete exposure | every observation in that timing-specific cohort `invalid`; one reconciled invalid exposure retains all ordered issues | each applicable completeness/identity finding; no numeric exposure contribution |
| equal complete, finite-observed origin-static copies | every copy `retained`; one reconciled valid exposure with source union and `deduplicated: N - 1` | one contribution attaches to each matching retained loss cell |
| conflicting origin-static cohort | every member `invalid`; reconciled exposure invalid | one conflict finding for `(measureId, key)`; no attachment |
| multiple valuation-specific observations with one identity | every member `invalid`, even if all compared fields are equal; reconciled exposure invalid | always duplicate; conflict iff audited numeric state, source group, origin, or completeness differs; no attachment |
| valid exposure with no timing-compatible retained loss cell | observation(s) `retained`; reconciled exposure valid | `exposure-without-loss`; no cell is fabricated |
| retained loss cell without a required exposure | loss rows remain `retained` | `loss-without-exposure`; affected exposure component is null |
| retained expected cell without a retained loss source cell | expected cell `retained` | `missing-expected-cell`; no numeric cell is fabricated |

Filtered and cutoff records remain fingerprinted but emit no finding and take
no part in relationship, join, or coverage checks. Invalid records remain
fingerprinted and emit findings but contribute no number. The phase order,
not the later audit-array sort rank, defines precedence. Measure-map keys are
code-unit sorted. The audit preserves multiplicity and is copied into the
preparation fingerprint/run manifest, so invalid-only, cutoff-only,
filter-only, and genuinely empty submissions remain distinct. Tests permute
input order and vary only excluded content to prove deterministic sorting and
identity sensitivity.

`PreparedDiagnosticData` is likewise opaque and deeply frozen; only
`prepareDiagnosticData` can create its module-private brand. The runner rejects
an unbranded structural lookalike instead of trusting a forged typed object
literal or deserialized JSON as prepared input.
`verifyPreparedDiagnosticDataIntegrity` first performs that owner authenticity
check and then recomputes the preparation tag from core's private normalized
payload. Compliance delegates to this seam; it never copies the preparation
normalizer or treats a caller-supplied tag as proof.

Every prepared source cell therefore contains retained contributions and
finalized stats for all applicable loss, derived, and exposure measures. An
origin-static exposure is attached once to each observed valuation cell for its
source group/origin; a valuation-specific exposure is attached only to its
matching cell. A missing, incomplete, duplicate, or conflicting required
exposure produces a null component plus a structural finding in that exact
prepared cell. The separate `exposures` collection retains reconciled identity
records and source locations for audit; the runner does not join it again.
Expected-cell gaps produce findings but never manufacture numeric source cells.

Data review consumes the same immutable prepared cells, reconciled-exposure
audit records, and neutral structural findings that the runner later uses, so
review and calculation cannot normalize or join the same input differently.
Review is deliberately the conservative pre-map superset: it evaluates every
prepared source cell surviving source/period/age filters and cutoffs.
`outputGroups` is not knowable until the later runner mapping step and therefore
does not suppress a structural or semantic review finding; a failure in a
source group later excluded by `outputGroups` can block the run. Hosts wanting
a narrower reviewed population must name its exact `sourceGroups` (or run it
separately), not rely on a post-map display/calculation filter. Likewise,
`instanceIds` selects metric calculations only; every top-level review rule
still runs. These scope rules are included in review/run fingerprints and
pinned by excluded-output and unselected-instance tests.
Mapping occurs only in the runner; intentionally mapped source groups are
combined from retained sorted leaf contributions, including exposure leaves,
not by adding rounded source-group totals. Source and output group filters apply
at their named stages. A policy-period filter is intentionally absent: without
policy-aligned exposure observations it could divide filtered losses by an
unfiltered denominator. Hosts needing that selection must prepare an aligned
loss-and-exposure artifact upstream and identify that artifact in provenance.

Complete-period cutoffs are executable selections, not provenance-only prose.
At most one entry is allowed per source group. Non-null cutoff labels are
normalized on their respective origin/valuation side of the compiled axis.
After period normalization and before derivation or aggregation, preparation
excludes loss rows, exposure observations, and expected cells whose applicable
coordinate is beyond that source group's cutoff. It stores the normalized
cutoff set, and the run manifest must copy it exactly.

Expected-grid validity and uniqueness are atomic configuration concerns, not
selected-data concerns. Before source filtering or cutoffs, preparation
normalizes every submitted coordinate and rejects any duplicate canonical
`(sourceGroup, origin, valuation)` across the full grid. Thus aliases,
filtered cells, and cells beyond a cutoff cannot hide a duplicate. After that
validation, each expected cell receives the ordinary source-filter, cutoff,
remaining-filter, or retained audit disposition; the retained grid sorts by
source group, numeric origin coordinate, and numeric valuation coordinate.
Caller order cannot affect coverage findings, monotonic adjacency, or either
expected-grid/preparation identity.

Loss and exposure rows deliberately carry no arbitrary `dimensions` object.
Output metadata comes only from the runner's explicit `groupDimensions` map,
after grouping is known. This avoids first-row-wins behavior when several loss
or exposure records occupy one source cell and makes row permutation incapable
of changing result metadata or fingerprints.

Group mapping is exact: an omitted key maps that prepared source group to
itself, while each supplied key must name a source group present after source
filtering and each target must be a non-empty string. Unknown/unused keys and
empty targets are rejected. Prototype-like strings remain legal own keys and
are handled without prototype lookup. The produced output-group set is derived
from those mappings. `groupDimensions` is optional and sparse: every supplied
own key must name a produced output group, missing keys mean no dimensions for
that group, and unknown/unused keys or non-JSON values are rejected. Both maps
are code-unit-key-sorted before execution and identity hashing.

Zod rejects malformed scalar/object shapes, not valid-but-questionable dataset
relationships. Duplicate identities, `complete: false`, missing joins, and
expected-cell gaps reach structural review. The default host execution gate
refuses a review with `fail` findings; an explicit recorded policy may permit
safe partial execution, but core still nulls ambiguous components and never
converts a failed structural condition into a numeric value.

The presentation value is `calculation.value * presentation.scale` when both
are finite. Presentation overflow yields null plus a finding without erasing
the raw calculation.

Emergence is the canonical evaluated cell. Diagnostic triangles,
same-maturity views, common-maturity views, and latest diagonals contain or
reference those exact evaluation objects; they do not recalculate. Every view
includes the normalized origin/valuation, `developmentAge`, and `ageUnit`.
The complete core result is defensively created and recursively frozen before
return, so caller mutation cannot desynchronize an emergence evaluation from
its triangle/value projections or alter later identity stamping.
The result's `latestDiagonal` is selected after mapped emergence: for each
output group and origin, choose the point with greatest normalized valuation
coordinate, then order the chosen points deterministically by output group and
origin. This avoids combining source groups whose latest source valuations
differ into an impossible single coordinate. It is not a second, differently
named maturity heuristic.

## 15. Deterministic identities

All identity payloads are normalized plain JSON and serialized with
`canonicalJson`. Semantically unordered catalogs are sorted by ID before
hashing. Metric-instance order, expression term order, and each declared rule
array remain significant because they govern deterministic evaluation/output
order; reordering one moves definition integrity even if the scalar arithmetic
would otherwise match.

`normalizedDefinition` is a field-for-field projection, never a clone whose
omissions are interpreted later. No authored optional remains optional:

```ts
export interface NormalizedDiagnosticToleranceIdentity {
  readonly absolute: number;
  readonly relative: number;
}

export interface NormalizedDiagnosticReviewFilterIdentity {
  readonly sourceGroups: readonly string[] | null;
  readonly origins: readonly string[] | null;
  readonly originFrom: string | null;
  readonly originThrough: string | null;
  readonly valuations: readonly string[] | null;
  readonly valuationFrom: string | null;
  readonly valuationThrough: string | null;
  readonly minDevelopmentAge: number | null;
  readonly maxDevelopmentAge: number | null;
}

export interface NormalizedDiagnosticsFilterIdentity
  extends NormalizedDiagnosticReviewFilterIdentity {
  readonly outputGroups: readonly string[] | null;
  readonly instanceIds: readonly string[] | null;
}

export type NormalizedAmountLimitationIdentity =
  | { readonly kind: "unlimited" }
  | {
      readonly kind: "layer" | "pre-limited";
      readonly attachment: number;
      readonly limit: number | null;
      readonly application: "claim" | "occurrence" | "policy" | "source-defined";
      readonly derivation:
        | { readonly kind: "sdk" }
        | {
            readonly kind: "external";
            readonly actor: "caller" | "source";
            readonly transformationRef: string;
          };
    }
  | { readonly kind: "unknown"; readonly description: string | null };

export interface NormalizedDiagnosticDefinitionIdentity {
  readonly diagnosticDefinitionVersion: "1.0.0";
  readonly id: string;
  readonly version: string;
  readonly lossRowGrain: "claim" | "aggregate";
  readonly measures: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly description: string;
    readonly source: DiagnosticMeasureSource;
    readonly kind: DiagnosticMeasureKind;
    readonly unit: string;
    readonly developmentSemantics: DiagnosticDevelopmentSemantics;
    readonly aggregation: "sum";
    readonly missing: DiagnosticMissingPolicy;
    readonly basisId: string | null;
    readonly countPopulationId: string | null;
    readonly exposureBasisId: string | null;
    readonly exposureTiming: DiagnosticExposureTiming | null;
  }[];
  readonly countPopulations: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly subject: DiagnosticCountPopulationDefinition["subject"];
    readonly unit: string;
    readonly description: string;
    readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
  }[];
  readonly exposureBases: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly basis: DiagnosticExposureBasisDefinition["basis"];
    readonly unit: string;
    readonly description: string;
    readonly sourceDescription: string | null;
    readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
  }[];
  readonly amountBases: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly currency: string;
    readonly perspective: AmountPerspective;
    readonly components: readonly {
      readonly id: string;
      readonly treatment: "included" | "excluded" | "unknown";
      readonly limitation: NormalizedAmountLimitationIdentity;
    }[];
    readonly sourceDescription: string | null;
    readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
  }[];
  readonly derivedMeasures: readonly DiagnosticDeepReadonly<DiagnosticDerivedMeasureDefinition>[];
  readonly formulas: readonly NormalizedDiagnosticFormulaIdentity[];
  readonly instances: readonly {
    readonly id: string;
    readonly version: string;
    readonly formulaId: string;
    readonly bindings: Readonly<Record<string, DiagnosticDeepReadonly<DiagnosticMeasureExpression>>>;
    readonly presentation: DiagnosticDeepReadonly<DiagnosticMetricPresentation>;
    readonly rules: readonly {
      readonly id: string;
      readonly code: string;
      readonly message: string;
      readonly severity: "warning" | "fail";
      readonly when: {
        readonly left: DiagnosticDeepReadonly<DiagnosticRuleOperand>;
        readonly operator: DiagnosticComparisonPredicate["operator"];
        readonly right: DiagnosticDeepReadonly<DiagnosticRuleOperand>;
        readonly tolerance: NormalizedDiagnosticToleranceIdentity;
      };
    }[];
  }[];
  readonly reviewRules: readonly NormalizedDiagnosticReviewRuleIdentity[];
  readonly periodAxis: NormalizedDiagnosticPeriodAxisIdentity;
}

export type NormalizedDiagnosticReviewRuleIdentity =
  | (DiagnosticDeepReadonly<Omit<DiagnosticReviewRuleBase, "tolerance">> & {
      readonly tolerance: NormalizedDiagnosticToleranceIdentity;
      readonly kind: "compare";
      readonly when: DiagnosticDeepReadonly<DiagnosticReviewPredicate>;
    })
  | (DiagnosticDeepReadonly<Omit<DiagnosticReviewRuleBase, "tolerance">> & {
      readonly tolerance: NormalizedDiagnosticToleranceIdentity;
      readonly kind: "reconcile";
      readonly actual: DiagnosticDeepReadonly<DiagnosticMeasureExpression>;
      readonly expected: DiagnosticDeepReadonly<DiagnosticReviewOperand>;
    })
  | (DiagnosticDeepReadonly<Omit<DiagnosticReviewRuleBase, "tolerance">> & {
      readonly tolerance: NormalizedDiagnosticToleranceIdentity;
      readonly kind: "monotonic";
      readonly expression: DiagnosticDeepReadonly<DiagnosticMeasureExpression>;
      readonly direction: "nondecreasing" | "nonincreasing";
    })
  | (DiagnosticDeepReadonly<Omit<DiagnosticReviewRuleBase, "tolerance">> & {
      readonly tolerance: NormalizedDiagnosticToleranceIdentity;
      readonly kind: "layer-order";
      readonly narrower: DiagnosticDeepReadonly<DiagnosticMeasureExpression>;
      readonly broader: DiagnosticDeepReadonly<DiagnosticMeasureExpression>;
      readonly comparability: DiagnosticDeepReadonly<
        Extract<DiagnosticReviewRule, { kind: "layer-order" }>["comparability"]
      >;
    })
  | (DiagnosticDeepReadonly<Omit<DiagnosticReviewRuleBase, "tolerance">> & {
      readonly tolerance: NormalizedDiagnosticToleranceIdentity;
      readonly kind: "control-total";
      readonly expression: DiagnosticDeepReadonly<DiagnosticMeasureExpression>;
      readonly expected: number;
      readonly filter: NormalizedDiagnosticReviewFilterIdentity | null;
      readonly projection: DiagnosticDeepReadonly<DiagnosticControlTotalProjection>;
    });

export type NormalizedDiagnosticPeriodAxisIdentity =
  | DiagnosticDeepReadonly<Extract<DiagnosticPeriodAxis, { kind: "calendar" }>>
  | (Omit<DiagnosticDeepReadonly<Extract<DiagnosticPeriodAxis, { kind: "ordered" }>>, "origins" | "valuations"> & {
      readonly origins: readonly {
        readonly label: string;
        readonly aliases: readonly string[];
        readonly coordinate: number;
      }[];
      readonly valuations: readonly {
        readonly label: string;
        readonly aliases: readonly string[];
        readonly coordinate: number;
      }[];
    });
```

The exact defaults are: inapplicable measure semantic IDs/timing → `null`;
attributes → `{}`; source descriptions → `null`; unknown-limitation
description → `null`; formula-role compatibility group and development-
semantics constraint → `null`; ordered-axis aliases → `[]`; both tolerance
members → supplied value or `0`; and an absent
control-total filter → `null`. A present filter
emits every field above: omitted selectors/endpoints/bounds become `null`,
while explicit empty arrays remain `[]`. Period labels in a present filter are
canonicalized through the axis. A control-total projection with
`kind: "valuation"` likewise emits the canonical valuation label after alias
resolution; it never retains the caller's alias spelling. Union variants emit
only fields applicable to their discriminator; a layer's `limit: null` remains
explicit.

Catalog arrays `measures`, `countPopulations`, `exposureBases`, `amountBases`,
`derivedMeasures`, and `formulas` sort by ID in code-unit order. Instances,
instance rules, and top-level review rules preserve declaration order. Amount
components sort by component ID. Ordered-axis coordinate arrays sort by
numeric coordinate then label; each alias array exact-deduplicates and sorts
by code unit (collisions with a canonical label or another coordinate still
reject). Review-filter set arrays exact-deduplicate and sort by code unit. All
record/map keys sort by code unit for projection; expression `add.terms` and
left/right operands retain authored order. Every numeric `-0`, including one
inside attributes, constants, tolerances, limitations, and coordinates,
normalizes recursively to `0`. Human/display/source prose is copied exactly or
projected to its specified null—never trimmed or Unicode-normalized. Explicit
`undefined` is rejected before projection.

Two authored definitions have equal normalized definition identity if and
only if these projections are JCS-equal; no shore may infer defaults from an
omission after projection. Shared vectors exercise every default, a present
empty control filter, an explicit empty selector, compatibility groups,
formula-role development-semantics constraints, alias reordering, unknown
limitations, and separate calendar/ordered definitions.
Authored object insertion order never affects an identity.

The formula and calculation normalizers emit these exact semantic projections.
Every nullable field is present as null when inapplicable; every attributes
record is present, defaulting to `{}`. Binding object keys and role object keys
are code-unit sorted, while `add.terms` retain declared order.
Every three-shore identity corpus includes the non-BMP/BMP counterexample
`["😀", "�"]`: UTF-16 code-unit order places `😀` (`0xD83D...`) before
`�` (`0xFFFD`). Native Python code-point sorting or an R locale sort would
reverse that pair and is therefore nonconforming. The vector is exercised in a
set-like alias/selector field and in catalog IDs, not only as object keys.

```ts
export interface NormalizedDiagnosticFormulaIdentity {
  readonly id: string;
  readonly version: string;
  readonly roles: Readonly<
    Record<
      string,
      {
        readonly kind: DiagnosticMeasureKind;
        readonly compatibilityGroup: string | null;
        readonly developmentSemantics: DiagnosticDevelopmentSemantics | null;
      }
    >
  >;
  readonly numerator: DiagnosticDeepReadonly<DiagnosticRoleExpression>;
  readonly denominator: DiagnosticDeepReadonly<DiagnosticRoleExpression>;
  readonly denominatorPolicy: "positive-or-null";
}

export interface NormalizedDiagnosticCalculationScope {
  readonly formulaFingerprint: string;
  readonly instance: {
    readonly id: string;
    readonly version: string;
    readonly formulaId: string;
    readonly bindings: Readonly<
      Record<string, DiagnosticDeepReadonly<DiagnosticMeasureExpression>>
    >;
  };
  readonly lossRowGrain: "claim" | "aggregate";
  readonly measures: readonly {
    readonly id: string;
    readonly source: DiagnosticMeasureSource;
    readonly kind: DiagnosticMeasureKind;
    readonly unit: string;
    readonly developmentSemantics: DiagnosticDevelopmentSemantics;
    readonly aggregation: "sum";
    readonly missing: DiagnosticMissingPolicy;
    readonly basisId: string | null;
    readonly countPopulationId: string | null;
    readonly exposureBasisId: string | null;
    readonly exposureTiming: DiagnosticExposureTiming | null;
  }[];
  readonly countPopulations: readonly {
    readonly id: string;
    readonly subject: DiagnosticCountPopulationDefinition["subject"];
    readonly unit: string;
    readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
  }[];
  readonly exposureBases: readonly {
    readonly id: string;
    readonly basis: DiagnosticExposureBasisDefinition["basis"];
    readonly unit: string;
    readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
  }[];
  readonly amountBases: readonly {
    readonly id: string;
    readonly currency: string;
    readonly perspective: AmountPerspective;
    readonly components: readonly {
      readonly id: string;
      readonly treatment: "included" | "excluded" | "unknown";
      readonly limitation: NormalizedAmountLimitationIdentity;
    }[];
    readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
  }[];
  readonly derivedMeasures: readonly DiagnosticDeepReadonly<DiagnosticDerivedMeasureDefinition>[];
}

export interface NormalizedDiagnosticSourceLocationIdentity {
  readonly artifactId: string;
  readonly sourceFile: string | null;
  readonly sourceSheet: string | null;
  readonly sourceRow: number | null;
  readonly sourceCell: string | null;
}

/** Deep readonly identity projection that normalizes every nested source. */
export type DiagnosticIdentityProjection<T> =
  T extends DiagnosticSourceLocation
    ? NormalizedDiagnosticSourceLocationIdentity
    : T extends readonly (infer U)[]
      ? readonly DiagnosticIdentityProjection<U>[]
      : T extends object
        ? { readonly [K in keyof T]: DiagnosticIdentityProjection<T[K]> }
        : T;

export interface DiagnosticReviewIdentityBody {
  readonly definitionIntegrity: string;
  readonly preparationFingerprint: string;
  readonly evidence: DiagnosticIdentityProjection<DiagnosticReviewEvidence> | null;
  readonly checks: readonly {
    readonly id: string;
    readonly status: DataCheckStatus;
    readonly findings: readonly DiagnosticIdentityProjection<DataFinding>[];
  }[];
  readonly summary: DiagnosticDeepReadonly<DataReviewReport["summary"]>;
  readonly evaluations: readonly DiagnosticIdentityProjection<DiagnosticReviewRuleEvaluation>[];
}

export interface NormalizedDiagnosticExpectedCellIdentity {
  readonly sourceGroup: string;
  readonly origin: string;
  readonly valuation: string;
  readonly source: NormalizedDiagnosticSourceLocationIdentity | null;
}

export interface NormalizedDiagnosticPreparationIdentity {
  readonly definitionIntegrity: string;
  readonly filter: NormalizedDiagnosticsFilterIdentity | null;
  readonly completePeriodCutoffs: readonly DiagnosticIdentityProjection<DiagnosticCompletePeriodCutoff>[];
  readonly inputAudit: readonly DiagnosticIdentityProjection<DiagnosticInputAuditRecord>[];
  readonly cells: readonly DiagnosticIdentityProjection<PreparedDiagnosticSourceCell>[];
  readonly exposures: readonly DiagnosticIdentityProjection<ReconciledDiagnosticExposure>[];
  readonly expectedCellsProvided: boolean;
  readonly expectedCells: readonly NormalizedDiagnosticExpectedCellIdentity[];
  readonly findings: readonly DiagnosticIdentityProjection<DiagnosticMetricFinding>[];
}

/** Exact core-owned identity projection of a complete result. */
export type NormalizedDiagnosticResultIdentity =
  DiagnosticIdentityProjection<DiagnosticDeepReadonly<MetricDiagnosticsResult>>;

/** Authenticates `prepared` and returns its deeply frozen owner-normalized body. */
export function getPreparedDiagnosticDataIdentity(
  prepared: PreparedDiagnosticData,
): NormalizedDiagnosticPreparationIdentity;

/** Returns a deeply frozen, source-normalized projection for result hashing. */
export function getMetricDiagnosticsResultIdentity(
  result: DiagnosticDeepReadonly<MetricDiagnosticsResult>,
): NormalizedDiagnosticResultIdentity;

// In compliance-owned declarations, this name denotes:
// import type { JsonValue as CoreDiagnosticJsonValue } from "@actuarial-ts/core";

export interface NormalizedDiagnosticRunManifestIdentity {
  readonly definitionIntegrity: string;
  readonly preparationFingerprint: string;
  readonly runPresetId: string | null;
  readonly datasetArtifactId: string | null;
  readonly inputArtifacts: readonly DiagnosticIdentityProjection<DiagnosticArtifactDigest>[];
  readonly preparationArtifacts: readonly DiagnosticIdentityProjection<DiagnosticArtifactDigest>[];
  readonly preparationLineage: readonly DiagnosticIdentityProjection<DiagnosticPreparationLineage>[];
  readonly inputAudit: readonly DiagnosticIdentityProjection<DiagnosticInputAuditRecord>[];
  readonly filter: NormalizedDiagnosticsFilterIdentity | null;
  readonly groupMap: Readonly<Record<string, string>>;
  readonly groupDimensions: Readonly<Record<string, CoreDiagnosticJsonValue>>;
  readonly completePeriodCutoffs: readonly DiagnosticIdentityProjection<DiagnosticCompletePeriodCutoff>[];
  readonly expectedCellGridFingerprint: string | null;
  readonly executionPolicy: {
    readonly review: {
      readonly body: DiagnosticReviewIdentityBody;
      readonly reportFingerprint: string;
    };
    readonly gate: DiagnosticDeepReadonly<DiagnosticExecutionGateReceipt> & {
      readonly reviewGate: "passed";
      readonly metricGate: "passed";
    };
  };
  readonly engine: DiagnosticDeepReadonly<DiagnosticRunManifest["engine"]>;
}
```

The calculation arrays contain exactly the catalogs and derivations reachable
from calculation bindings, never rule-only dependencies. Each array sorts by
ID; amount components sort by component ID. Display names, descriptions,
source prose, presentation, metric rules, and top-level review rules do not
appear. Formula normalization uses the same role/expression projection shown
above, including explicit null compatibility groups and development-semantics
constraints. Therefore adding, removing, or changing a temporal role
constraint changes formula, calculation, and full-definition identity. These
projections, the six canonical templates, and several caller-defined
multi-variant definitions are frozen as shared TypeScript/Python/R JSON
vectors.

`NormalizedDiagnosticPreparationIdentity` is the exact replacement for the
shorthand `normalizedPreparedSnapshot`: the brand, compiled definition object,
and self fingerprint never enter it. `NormalizedDiagnosticRunManifestIdentity`
is likewise the exact `normalizedRunManifest`: it replaces the human-rendered
review receipt with precisely `{ body, reportFingerprint }` under
`executionPolicy.review` and retains no other receipt fields. The normalized
full filter materializes every omitted selector as null; explicit empty arrays
remain empty. All period labels are canonical, arrays/records use the total
orders below, and every `DiagnosticSourceLocation` occurrence nested in audit,
cells, exposures, findings, or review bodies is projected field-for-field to
`NormalizedDiagnosticSourceLocationIdentity`. Discriminated-union fields that
do not belong to the selected variant remain absent. The expected-cell-grid
identity uses exactly the
`NormalizedDiagnosticPreparationIdentity.expectedCells` returned by
`getPreparedDiagnosticDataIdentity`; compliance never projects the authored
`DiagnosticExpectedCell[]` itself. The result payload is the complete
`NormalizedDiagnosticResultIdentity` returned by
`getMetricDiagnosticsResultIdentity`. That projection retains every result
field while recursively normalizing every source location; no semantic field
is stripped and compliance neither defaults nor independently rebuilds it for
hashing.

The tag format is `fnv1a64-jcs-v1:<16 lowercase hex characters>`.
Every hashed payload begins with an explicit `identityVersion: 1` and a `kind`
discriminator. The exact outer payloads are:

```text
{ identityVersion: 1, kind: "diagnostic-formula", formula: normalizedFormula }
{ identityVersion: 1, kind: "diagnostic-calculation", calculation: normalizedCalculationScope }
{ identityVersion: 1, kind: "diagnostic-definition", definition: normalizedDefinition }
{ identityVersion: 1, kind: "diagnostic-preparation", preparation: NormalizedDiagnosticPreparationIdentity }
{ identityVersion: 1, kind: "diagnostic-expected-cell-grid", expectedCells: readonly NormalizedDiagnosticExpectedCellIdentity[] }
{ identityVersion: 1, kind: "diagnostic-review-report", review: normalizedDiagnosticReviewIdentityBody }
{ identityVersion: 1, kind: "diagnostic-run", manifest: NormalizedDiagnosticRunManifestIdentity }
{ identityVersion: 1, kind: "diagnostic-result", result: NormalizedDiagnosticResultIdentity }
{ identityVersion: 1, kind: "diagnostic-run-result", runFingerprint, resultFingerprint }
```

This discriminator is never inferred or omitted. Formula, calculation,
definition, and envelope identities are in the TypeScript/Python/R known
vectors. Preparation, expected-grid, review, run, result, and run-result
identities are TypeScript compliance/runtime vectors in `0.6.0`; Python/R do
not pretend to implement those package workflows.

- **Formula fingerprint** covers the formula ID/version, roles, role
  expressions, and denominator policy. It excludes bindings, bases, rules,
  labels, and display scale.
- **Calculation fingerprint** covers the formula fingerprint, instance
  ID/version, role bindings, the semantic projection of transitive measures
  (`id`, source, kind, unit, development semantics, aggregation, missingness,
  count population, amount/exposure basis, and exposure timing), semantic
  projections of referenced count-population (`id`, subject, unit, attributes),
  amount-basis (currency, perspective, components, limitations, attributes),
  and exposure-basis (`id`, basis, unit, attributes) catalogs, loss row grain,
  and every transitive claim-derivation AST needed by
  those measures. It excludes metric comparison rules, top-level review rules,
  metric presentation, catalog display names, and source prose.
- **Definition integrity** covers the complete normalized definition,
  including all catalogs, derivations, instances, presentation, both rule
  families, and period axis.
- **Preparation fingerprint** covers definition integrity, whether an expected
  grid was supplied, the normalized filter and complete-period cutoffs,
  the complete pre-exclusion input audit,
  canonical prepared cells including all contributions/stats/blockers/findings,
  reconciled exposure audit records, and expected cells. It excludes the opaque
  brand and its own fingerprint field.

Changing `DiagnosticMetricPresentation` or a catalog display name/source
description does not change the formula or calculation fingerprint; it does
change definition integrity. Changing a measure unit, amount currency or other
basis/population semantic, binding, transitive derivation, missing policy,
exposure timing, or loss row grain changes the affected calculation fingerprint
and complete definition integrity. Changing either rule family changes
definition integrity and rule outputs but not the numeric calculation
fingerprint. Only a formula change moves the formula fingerprint itself.

FNV-1a is retained because it is already the three-shore SDK equality oracle,
is synchronous and browser-safe, and serves the actual purpose here: detecting
accidental configuration drift. It is not collision-resistant, does not prove
authorship, and does not stop someone from changing content and recomputing a
tag. Hosts needing adversarial tamper evidence must sign the canonical payload
or use a governed external cryptographic digest. Documentation and names must
never claim otherwise.

Every runtime ordering below uses one total comparator unless a more specific
rank is stated. Tuple fields compare left to right. An absent optional field
sorts before explicit `null`, which sorts before a concrete value. Finite
numbers compare numerically after `-0` normalization; booleans use
`false < true`; strings and unranked enum/status values compare by UTF-16 code
unit with no locale or normalization. An explicitly stated enum rank overrides
that string rule. Already-normalized arrays compare lexicographically by this
same recursive comparator, with a proper prefix first; normalized objects used
as tie-breakers compare their `canonicalJson` strings by UTF-16 code unit.
For a discriminated numeric audit value, compare status first, then finite
value or `nonFiniteKind` as applicable. `DiagnosticSourceLocation` compares
`artifactId`, `sourceFile`, `sourceSheet`, `sourceRow`, and `sourceCell` under
these rules, so each nullable field uses null-first and rows remain numeric.
This rule also governs source/source-ID/issue arrays, source-free review scopes,
formula absence, cached-value absence/status, and every later “canonical
array/object” tie-break. No implementation may substitute native object order,
Python code-point order, an R locale collator, truthiness, or joined strings.

All source locations are sorted by artifact ID, file, sheet, row, and cell;
exact duplicates are removed. Semantically identical findings (all fields
except `sources`) are merged by unioning those normalized sources, then findings
are sorted by category, severity, code, rule ID, instance ID, measure ID,
expression path,
source/output group, origin, valuation, development age, age unit, record ID,
claim ID, exposure key, and message with absent values first. Numeric fields use numeric
order and strings use code-unit order. This applies in prepared cells,
metric evaluations, and top-level results. Discovery traversal order can
therefore never change a fingerprint.

`DataFinding` has its own normalization over fields it actually owns. Within
each `DataCheck`, exact findings are merged by `(code, message, context except
context.sources and reviewScope.sources)` while the two source arrays are
unioned and normalized **independently**. Normalization never copies one array
into the other: ordinary projected findings already carry equal arrays, while
an expression-overflow finding preserves exact failed-site sources in
`context.sources` and the full operand union in `reviewScope.sources`. They
then sort by
code, rule ID, measure ID, offending key, grouping key, cached-evidence ID,
source group, generic group, origin, valuation, development age, age unit,
record ID, claim ID, exposure key, the source-free review scope's canonical
JSON, source file, source row, message, and sources, with absent values first, numeric fields
numeric, and strings by code unit. `DataReviewReport.checks` uses the fixed
structural catalog followed by definition review-rule order from Section 13;
it is never discovery-ordered.

Contributions sort by measure ID, source ID, status, deduplicated count, and
the canonical source array;
blockers sort by measure ID, code, message, source IDs, and sources, with exact
blockers deduplicated. Reconciled exposure records sort by measure ID, key,
status, and issue array, and invalid observations sort by source group, origin coordinate,
valuation coordinate/absence, value status/value, completeness, and source.
Each prepared cell's `lossRecordIds` is exact-deduplicated and code-unit sorted.
Input-audit records sort by kind rank loss → exposure → expected-cell, then the
canonical JSON of the complete snapshot, then disposition rank invalid →
complete-period-cutoff → filter → retained; multiplicity is preserved.
Grouping evidence sorts by key, group, and source; cached-formula evidence sorts
by ID, source, formula/absence, cached-value status/value, and declared-source
flag. Evidence record multiplicity is preserved so duplicates/conflicts remain
reviewable instead of disappearing during hashing.

Metric- and review-rule evaluation arrays preserve declared rule order. Within
one rule, cell evaluations sort by source group, numeric origin coordinate, and
numeric valuation coordinate; monotonic pairs sort by source group/origin then
previous/current coordinates; the single control-total evaluation remains at
that rule's position. Readiness-reason arrays use the fixed order missing,
imputed, non-finite, structural-ambiguity, aggregation-overflow,
expression-overflow, tolerance-overflow.

Prepared cells sort by source group, numeric origin coordinate, numeric
valuation coordinate, then canonical labels as a tie-breaker. Within an
emergence point, `sourceGroups` are exact-deduplicated and code-unit sorted.
Emergence points sort by output group, numeric origin coordinate, numeric
valuation coordinate, then canonical labels. Triangles sort by output group
and selected compiled-instance order; each triangle's origins sort by numeric
origin coordinate then label, development ages sort numerically, and every
matrix uses those axes. `latestDiagonal` uses the emergence ordering after its
one-point-per-group/origin selection. These arrays are normalized before result
hashing, so caller row order or object insertion order cannot move a tag.

## 16. Run manifest and result identity

Definition identity says what may be calculated; it does not say which data,
filters, grouping, cutoffs, or reviewed execution policy produced a particular
result. Compliance therefore owns a second, normalized layer:

```ts
export interface DiagnosticArtifactDigestBase {
  readonly id: string;
  readonly value: string;
  readonly scope: "input" | "preparation";
}

export type DiagnosticArtifactDigest = DiagnosticArtifactDigestBase &
  (
    | {
        readonly assurance: "sdk-computed";
        readonly algorithm: "sha256";
        readonly byteLength: number;
      }
    | {
        readonly assurance: "caller-declared";
        readonly algorithm: string;
      }
  );

export type DiagnosticArtifactEvidence =
  | {
      readonly id: string;
      readonly scope: "input" | "preparation";
      readonly assurance: "sdk-computed";
      readonly bytes: Uint8Array;
    }
  | {
      readonly id: string;
      readonly scope: "input" | "preparation";
      readonly assurance: "caller-declared";
      readonly algorithm: string;
      readonly value: string;
    };

export interface DiagnosticPreparationLineage {
  /** Downstream artifact consumed by the run or by a later lineage edge. */
  readonly outputArtifactId: string;
  /** Upstream source artifacts from which the output was derived. */
  readonly inputArtifactIds: readonly string[];
  /** Scripts, manifests, workbooks, or other transformation artifacts used. */
  readonly transformationArtifactIds: readonly string[];
}

export interface DiagnosticRunManifest {
  readonly definitionIntegrity: string;
  readonly preparationFingerprint: string;
  readonly runPresetId: string | null;
  readonly datasetArtifactId: string | null;
  readonly inputArtifacts: readonly DiagnosticArtifactDigest[];
  readonly preparationArtifacts: readonly DiagnosticArtifactDigest[];
  readonly preparationLineage: readonly DiagnosticPreparationLineage[];
  readonly inputAudit: DiagnosticDeepReadonly<NormalizedDiagnosticPreparationIdentity["inputAudit"]>;
  readonly filter: DiagnosticDeepReadonly<NormalizedDiagnosticPreparationIdentity["filter"]>;
  readonly groupMap: Readonly<Record<string, string>>;
  readonly groupDimensions: Readonly<Record<string, CoreDiagnosticJsonValue>>;
  readonly completePeriodCutoffs: DiagnosticDeepReadonly<NormalizedDiagnosticPreparationIdentity["completePeriodCutoffs"]>;
  readonly expectedCellGridFingerprint: string | null;
  readonly executionPolicy: {
    readonly review: DiagnosticReviewReceipt;
    readonly gate: DiagnosticExecutionGateReceipt & {
      readonly reviewGate: "passed";
      readonly metricGate: "passed";
    };
  };
  readonly engine: {
    readonly packages: {
      readonly core: string;
      readonly data: string;
      readonly compliance: string;
    };
    readonly algorithmVersion: "diagnostics-1";
  };
}

export interface DiagnosticRunIdentity {
  readonly runFingerprint: string;
  readonly resultFingerprint: string;
  readonly runResultFingerprint: string;
}

export interface DiagnosticRunProvenance extends DiagnosticRunIdentity {
  /** Complete normalized definition plus formula/calculation/definition tags. */
  readonly definition: DiagnosticDeepReadonly<DiagnosticDefinitionBody>;
  readonly manifest: DiagnosticRunManifest;
  readonly review: DiagnosticReviewReceipt;
  readonly result: DiagnosticDeepReadonly<MetricDiagnosticsResult>;
}

declare const verifiedDiagnosticRunProvenanceBrand: unique symbol;

/** Owner-authenticated in-memory form accepted for new bundle authoring. */
export interface VerifiedDiagnosticRunProvenance
  extends DiagnosticRunProvenance {
  readonly [verifiedDiagnosticRunProvenanceBrand]: true;
}

export interface CreateDiagnosticRunIdentityInput {
  readonly completedRun: CompletedValidatedMetricDiagnosticsRun;
  readonly inputArtifacts: readonly DiagnosticArtifactEvidence[];
  readonly preparationArtifacts: readonly DiagnosticArtifactEvidence[];
  readonly preparationLineage: readonly DiagnosticPreparationLineage[];
}

export function createDiagnosticRunIdentity(
  input: CreateDiagnosticRunIdentityInput,
): Promise<VerifiedDiagnosticRunProvenance>;

export function verifyDiagnosticRunIdentity(
  identity: unknown,
  evidence: CreateDiagnosticRunIdentityInput,
): Promise<VerifiedDiagnosticRunProvenance>;

export function assertVerifiedDiagnosticRunProvenance(
  value: unknown,
): asserts value is VerifiedDiagnosticRunProvenance;
```

Compliance moves `COMPLIANCE_PACKAGE_VERSION` to a dependency-leaf
`version.ts` module and moves `ComplianceError` plus its registry to
`errors.ts`; both `bundle.ts` and `diagnosticRun.ts` import those leaves, so
adding bundle integration cannot create an ESM cycle. The error registry adds
`BAD_DIAGNOSTIC_RUN`, `DIAGNOSTIC_MISMATCH`, and `CRYPTO_UNAVAILABLE` while
retaining the existing codes. `ComplianceError` gains optional readonly
`path?: string`. Shape/evidence/lineage errors use `BAD_DIAGNOSTIC_RUN` with
the first exact path; verification mismatches use `DIAGNOSTIC_MISMATCH` with
the first deterministic JSONPath; absence of standards-based SHA-256 uses
`CRYPTO_UNAVAILABLE` at `$.inputArtifacts` or
`$.preparationArtifacts`. Tests pin both code and path, never just message
text.

The existing compliance `CreateBundleInput` gains
`diagnosticRuns?: readonly VerifiedDiagnosticRunProvenance[]`. Those complete native
records enter the inner canonical bundle body. In wrapped mode, `createBundle`
derives one integrity-checked `DiagnosticDefinitionDoc` per distinct definition
into `interchange.diagnosticDefinitions`; the caller cannot supply a second,
potentially inconsistent definition copy. Omission excludes the inner/wrapped
diagnostic fields; an explicit empty array is retained as an explicit reviewed-
empty collection. Derived definition documents use the bundle's caller-supplied
`createdAt` and compliance generator stamp, deduplicate by definition integrity,
and sort by that integrity tag. Duplicate run-result fingerprints are rejected.
The brand is an owner-controlled runtime authenticity check backed by private
state, not a serializable claim. A bundle stores the plain
`DiagnosticRunProvenance` JSON shape. Code that wants to put a deserialized
record into a new bundle must first call `verifyDiagnosticRunIdentity` with the
actual completed run and artifact evidence to obtain a new verified value;
structural lookalikes and copied symbols are rejected.
When the array is nonempty, every diagnostic manifest must agree on its core,
data, and compliance versions. `CreateBundleInput.sdkVersions` must contain
matching `@actuarial-ts/core`, `@actuarial-ts/data`, and
`@actuarial-ts/compliance` entries; conflicting or missing entries are rejected
rather than silently overwritten. Wrapped authoring permits `generator` only
when it exactly equals `{ name: "@actuarial-ts/compliance", version:
COMPLIANCE_PACKAGE_VERSION }`; omission produces that stamp. This intentionally
disables the historical frozen-corpus generator override for a bundle that
claims current authenticated diagnostic runs. Bundle verification enforces the
same agreement between inner SDK versions, every run manifest, and the outer
generator. Other SDK-version entries remain caller-owned.

The stored manifest retains the complete review receipt for human inspection,
but its normalized run-identity projection replaces that receipt with its
`DiagnosticReviewIdentityBody` and `reportFingerprint`; human descriptions and
the capped `details` array never affect run identity. The run fingerprint uses
that Section 15 projection. The result fingerprint uses the exact core-owned
`NormalizedDiagnosticResultIdentity`, including definition/preparation
fingerprints, finite/null stats, rule evaluations, findings, and every view.
The run-result fingerprint hashes the two tags together using
the Section 15 binding payload, preventing a valid manifest from being paired
with a valid result from another run without claiming that every policy change
altered the numeric result. None of these FNV identities claims cryptographic
security.

`createDiagnosticRunIdentity` accepts only a completed validated run plus the
actual artifact evidence; it never accepts a blocked outcome or a
caller-authored review/run/result fingerprint or run-preset ID. The preset ID
is taken only from the completed run. SDK-computed artifact evidence accepts bytes and
uses SHA-256 only, recording the byte length and lowercase hex digest.
Caller-declared evidence is provenance supplied by the caller and may name a
non-empty external algorithm/value, but is never relabeled as SDK-verified.
Both async entry points synchronously validate and snapshot all inputs before
their first `await`. In particular they copy the exact
`Uint8Array[byteOffset, byteOffset + byteLength)` view into fresh storage;
hashing never observes caller mutation or unrelated bytes in its backing
buffer. Before stamping, the helper calls core's
`verifyPreparedDiagnosticDataIntegrity` and reruns `runMetricDiagnostics` from the completed
run's branded prepared object and recorded group map/dimensions. It calls
`getMetricDiagnosticsResultIdentity` on both the rerun and completed result and
requires those two normalized projections to be byte-identical. It derives
filter, complete-period cutoffs, input audit, expected-grid presence/content,
definition identity, and preparation identity from core's public
`getPreparedDiagnosticDataIdentity` result rather than accepting independent
copies or normalizing the prepared object's authored public shapes itself.
It calls `reviewPreparedDiagnosticData` again with the completed run's exact
prepared object and frozen review evidence and requires the complete normalized
`identityBody` and `reportFingerprint` to match. It also requires all
identity-bearing receipt fields to equal the rerun, but deliberately does not
compare incoming human check descriptions or capped detail rendering. The
returned verified provenance is rebuilt with the authenticated rerun's
complete regenerated review receipt, including its descriptions and details;
uncompared prose from a serialized candidate is never copied into or blessed
by the verified value.
It also recomputes the review and metric gate predicates from the complete
report/evaluations/result and recorded allowed sets/rationale, rejects any
fabricated self-consistent review or gate receipt, and requires the
data-package-only completed-run authenticity check. Result equality and result
fingerprinting use core's `getMetricDiagnosticsResultIdentity`; compliance
never reimplements core's preparation/result payloads or normalizers.
Core, data, and compliance package versions are stamped by their owning
runtime constants (`CORE_PACKAGE_VERSION`, `DATA_PACKAGE_VERSION`, and the
existing `COMPLIANCE_PACKAGE_VERSION`) rather than accepted from caller input.
Each constant is updated with its manifest and covered by lockstep/version
tests, so an allowed dependency skew cannot be mislabeled. Unbranded artifact,
lineage, policy, and manifest fields are defensively cloned and recursively
frozen. The verified value's public `result` is the exact authentic frozen
`completedRun.result` reference, so triangle/emergence aliases remain intact.
`VerifiedDiagnosticRunProvenance` deliberately has no public `prepared` or
`completedRun` field: compliance registers each genuine verified object in a
module-private `WeakMap` whose value retains the exact authentic
`completedRun` and `completedRun.prepared` references used to create or
reverify it. `assertVerifiedDiagnosticRunProvenance` requires that registry
entry rather than trusting the public brand/shape, and bundle authoring uses
the registered evidence when it needs to recheck authenticity. Branded inner
objects are never structurally cloned.
Canonicalization is used for validation and hashing, not to JSON-round-trip
those objects. A serialized bundle promises byte-equivalent semantic content,
not JavaScript reference identity; reverification creates a new registry-backed
verified value around the authentic rerun objects and regenerated receipt.

Artifact, lineage, and cutoff arrays are normalized by ID/edge/source group,
group-map keys by code-unit order, review statuses in the fixed order pass →
warning → not-evaluated → fail, and metric severities info → warning → fail.
The two allowed-policy arrays are set-like, exact-deduplicated, and stored in
those fixed orders.
The review gate requires every check status in the complete report and every
individual rule evaluation's mapped status to be allowed: pass maps to `pass`,
not-evaluated maps to `not-evaluated`, and triggered maps to its warning/fail
severity. Thus a mixed warning plus not-evaluated rule cannot pass a policy
that omitted not-evaluated. The default allows pass, warning, and
not-evaluated and refuses fail. A second post-calculation gate scans the
canonical top-level `result.findings` once, ignores category `structural`, and
requires every aggregation/calculation/rule/presentation severity to be
allowed; its default allows info and warning and refuses fail. It never walks
nested findings recursively. Allowing `fail` through either gate requires a non-empty
`rationaleRef`; the helper never invents professional rationale.

Artifact IDs are unique across both artifact arrays. Every
`DiagnosticSourceLocation.artifactId` reachable from the complete pre-exclusion
input audit, prepared contributions/findings/exposure audits, or review
evidence must resolve to exactly one input artifact. If any input-audit or
review-evidence record lacks a row-level source artifact, the
completed run's non-null `datasetArtifactId` is required as its fallback and
must resolve to exactly one `sdk-computed` input artifact. It may also be
supplied for a fully row-sourced run, but then still resolves and participates
in identity/unused-artifact reachability. Hosts with programmatic data can use
the UTF-8 bytes of `canonicalJson({ inputAudit:
completedRun.prepared.inputAudit, reviewEvidence:
completedRun.review.evidence })` as that artifact and retain the exact authored
object separately in their records. This stays JSON-safe when a raw measurement
was non-finite because the audit uses explicit sentinels. Compliance does not pretend this proves the upstream
transformation; lineage and preparation artifacts record that claim.

A genuinely empty audited run—`inputAudit: []` and zero review-evidence
records—may use `datasetArtifactId: null` and `inputArtifacts: []`. Both
omitted/null review evidence and an explicitly present evidence object whose
two arrays are empty satisfy the zero-record condition; their different review
semantics remain captured by the review identity. Any partially unsourced
nonempty run may not omit the dataset artifact. The dataset ID is bound at run-input
validation, copied into every outcome and the manifest, and cannot be injected
during stamping. Every external amount-basis `transformationRef` and every
caller-asserted rule-rationale artifact ID, plus any fail-allowing gate
`rationaleRef`, must resolve to exactly one preparation artifact.
`preparationLineage` supplies the otherwise-missing provenance for generic
status/count/exposure normalization: each edge has one existing downstream
output in `inputArtifacts`, at least one upstream ID from `inputArtifacts` or
transformation ID from `preparationArtifacts`, unique sorted IDs, no self-edge,
at most one producing edge per output, and the directed graph must be acyclic.
Starting from artifacts referenced by prepared/review content or
definition/gate selections, verification walks lineage backward. Every supplied
artifact must be directly referenced or reachable on that ancestry; only truly
orphaned evidence is rejected as unused. This permits an original archive,
transform script/manifest, and compact derivative to remain one honest chain.
Missing and orphaned artifacts, malformed/cyclic lineage, duplicate cutoff
source groups, and cross-array ID collisions are errors. The expected-cell-grid
fingerprint is null exactly when no grid was supplied; otherwise it is the
tagged Section 15 identity of the actual normalized `expectedCells`, including
an explicitly supplied empty grid.

`DiagnosticRunProvenance` is the exact replacement for the old flattened
`createDiagnosticsProvenance` result. Its definition body contains every
catalog, derivation, formula, binding, rule, presentation, period axis, and
definition-level identity; its manifest contains reviewed run context and
artifact lineage; and its result contains the complete evaluated output. The
constructor returns a recursively frozen record and no second free-form
diagnostic provenance constructor remains.

Wrapped-bundle authoring and verification enforce semantic coherence, not just
independent valid tags: the native provenance definition integrity, nested
`DiagnosticDefinitionDoc`, run manifest, every bundled evaluation identity,
preparation/review identities, result fingerprint, and run-result fingerprint
must refer to the same definition, prepared data, run, and result. A test
independently re-stamps two internally valid but mutually inconsistent halves
and requires verification to fail at the first coherence path.

## 17. Typed interchange contract

Wire version `1.1.0` adds `kind: "diagnostic-definition"` with semantic body
key `diagnosticDefinition`. The body contains the normalized definition and
its three levels of identities. Its envelope `integrity` covers the entire
`diagnosticDefinition` semantic body under the existing JCS/FNV rule.

The non-self-referential public wire shape is:

```ts
export interface DiagnosticDefinitionIdentitySet {
  algorithm: "fnv1a64-jcs-v1";
  formulaById: Readonly<Record<string, string>>;
  calculationByInstanceId: Readonly<Record<string, string>>;
  definition: string;
}

export interface DiagnosticDefinitionBody {
  definition: NormalizedDiagnosticDefinitionIdentity;
  identities: DiagnosticDefinitionIdentitySet;
}

export interface DiagnosticDefinitionDoc {
  /** Current writers emit 1.1.0; generic readers accept supported same-major. */
  interchangeVersion: string;
  kind: "diagnostic-definition";
  generator: GeneratorStamp & { [key: string]: unknown };
  createdAt: string;
  extensions?: Readonly<Record<string, unknown>>;
  integrity: string;
  diagnosticDefinition: DiagnosticDefinitionBody;
  /** Generic same-major readers preserve unknown envelope fields. */
  [key: string]: unknown;
}

export interface DiagnosticDefinitionToDocOptions {
  readonly createdAt: string;
  readonly generator?: GeneratorStamp;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface DocToDiagnosticDefinitionResult {
  readonly definition: CompiledDiagnosticDefinition;
  readonly warnings: readonly string[];
}

export function diagnosticDefinitionToDoc(
  compiled: CompiledDiagnosticDefinition,
  options: DiagnosticDefinitionToDocOptions,
): DiagnosticDefinitionDoc;

export function docToDiagnosticDefinition(
  doc: unknown,
  options?: ParseDocumentOptions,
): DocToDiagnosticDefinitionResult;
```

Authored `DiagnosticDefinition` contains no identity fields. Each identity is
computed from its normalized payload without including itself. The wire
adapter requires exact key-set equality between formula IDs and `formulaById`,
and between instance IDs and `calculationByInstanceId`, before comparing every
recomputed value. The outer envelope integrity then covers both the definition
and supplied identity set.

`diagnosticDefinitionToDoc` first authenticates the compiled value, copies its
normalized definition and identity set, applies the existing generator/
extension envelope rules, and computes outer integrity. `docToDiagnosticDefinition`
calls the package's generic `parseDocument`, requires kind
`diagnostic-definition`, rejects unsupported semantic fields/versions, compiles
the body through core, checks every supplied identity and outer tag, and returns
that authentic compiled definition plus the generic parser's warnings. It never
returns a structural lookalike or accepts an opaque unknown-kind document.
`InterchangeDocument`, generic parse-result types, generated declarations, and
public declaration snapshots include this new kind and these exact signatures.

The change is a wire-spec minor because an existing required interpretation
surface — the set of document kinds — grows. Existing `schema/interchange/1.0`
files and fixtures remain frozen. `schema/interchange/1.1` contains a complete
current schema set, including `diagnostic-definition.schema.json`; the one
normative JCS corpus remains frozen at
`schema/interchange/1.0/jcs-vectors.json` and is not copied per minor version. Writers
emit `1.1.0`; generic readers continue to accept same-major documents and
honestly refuse unknown kinds.

The TypeScript, Python, and R shores must:

- parse and emit the new typed document;
- preserve same-major unknown envelope/document fields on the generic opaque
  parse/emit path;
- recompute its semantic-body envelope integrity;
- recompute formula, calculation, and definition identities;
- detect any supplied identity mismatch with the precise failing path; and
- evaluate the six formula templates and declarative comparison rules against
  shared frozen aggregate-cell vectors.

Semantic compilation is deliberately stricter than generic interchange
passthrough. A diagnostic semantic reader accepts only
`diagnosticDefinitionVersion: "1.0.0"` and the closed known behavioral fields,
operators, basis variants, and period variants. A newer definition version or
an unknown nested behavioral field is preserved only by the opaque generic
document path and is refused by `docToDiagnosticDefinition` as unsupported; it
is never dropped, projected away, rehashed, or executed. The generic path can
still verify the outer tag over the raw semantic body. Tests place future
fields inside a measure, rule, and period axis to prove opaque round-trip plus
semantic refusal. This reconciles wire forward compatibility with honest
actuarial interpretation.

The wire contract does not require claim-level data or a full diagnostic run
to be embedded. Run results and input references remain compliance artifacts;
the portable definition document makes the calculation reviewable and
replayable against data the receiving environment controls. A future result
document must be justified separately rather than smuggled into this release.

When a diagnostic definition is included with a compliance bundle, it belongs
inside the bundle's integrity-covered semantic body and retains its own nested
integrity. It must not be attached only after stamping as an opaque extension.

## 18. Package boundaries

### `@actuarial-ts/core`

- Owns expressions, measure/basis types, semantic compiler, aggregation,
  exposure reconciliation, period axes, formula and rule evaluation,
  claim-measure derivation, casualty templates/factory, results, and views.
- Exports `CORE_PACKAGE_VERSION`, pinned by test to its installed manifest, so
  compliance stamps the actual runtime rather than a caller assertion.
- Owns the schema-neutral `DiagnosticReviewRule` AST and validates its measure
  references, plus the only neutral numeric evaluator over authentic prepared
  data; it does not produce `DataReviewReport`.
- Remains pure, deterministic, browser-safe, and free of I/O, clock reads,
  Zod, Mastra, or application state.

### `@actuarial-ts/data`

- Zod-validates unknown datasets and definitions.
- Owns structural input review and projects core's portable neutral rule
  evaluations into `DataReviewReport`, receipts, and execution gates.
- Ships the optional casualty semantic rule factory.
- Exports `DATA_PACKAGE_VERSION` and the owner-controlled completed-run runtime
  assertion used by compliance.
- Never forks the core calculation engine.

### `@actuarial-ts/interchange`

- Owns the typed `diagnostic-definition` document, envelope, Zod wire schema,
  JSON Schema emission, and adapters between compiled core definitions and the
  wire body.
- Does not own actuarial calculation semantics; conformance calls the core
  evaluator on the TypeScript shore.

### `@actuarial-ts/compliance`

- Adds a lockstep dependency on `@actuarial-ts/data` so the review receipt and
  completed-run brand are one shared type/implementation, not a duplicated
  structural guess. The dependency graph remains acyclic.
- Creates and verifies a deep, normalized diagnostic-run provenance snapshot.
- Imports core's readonly `JsonValue` under the private declaration alias
  `CoreDiagnosticJsonValue` for diagnostic grouping fields. Its pre-existing
  public ledger `JsonValue` remains a distinct, source-compatible compliance
  export; the two types are never redeclared or merged.
- Owns `NormalizedDiagnosticRunManifestIdentity` and computes the expected-grid,
  result-content, run, and run-result tagged fingerprints while assembling a
  completed run. Core owns the reusable formula, calculation, definition, and
  preparation identity projections/tags plus the normalized expected-cell and
  result payload types and exposes them through
  `getPreparedDiagnosticDataIdentity` and
  `getMetricDiagnosticsResultIdentity`; data owns
  `DiagnosticReviewIdentityBody`, review fingerprints/receipts, and the exact
  `receipt.identityBody` because they contain data-owned findings/reports.
  Compliance hashes those owner-normalized payloads through the shared
  canonical JSON/FNV primitives without a private import or a second
  normalizer, then composes the owner-produced values without reversing either
  dependency.
- Owns `DiagnosticRunManifest`, `DiagnosticRunProvenance`, run/result
  fingerprints, and the execution-policy record. It records exact definitions
  and identities, typed artifact digests/lineage, filters, grouping, cutoffs,
  package versions, and material selections.
- Recomputes identities rather than trusting caller-supplied strings.
- Enforces coherence among native provenance, the nested definition document,
  the run manifest, and bundled results.
- Keeps metadata out of core numeric results.

### `@actuarial-ts/agents`

- Exposes one narrow factory with this public host/model boundary:

```ts
export type ToolEnvelopeFailure = {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
};

export type DefinedActuarialTool<TInput, TOutput> = Omit<
  Tool<unknown, unknown>,
  "execute"
> & {
  readonly kind: ActuarialToolKind;
  readonly execute: (
    inputData: TInput,
    context: ActuarialToolContext,
  ) => Promise<TOutput>;
};

interface DefineActuarialToolCommon<
  TShape extends z.ZodRawShape,
  TResult,
> {
  readonly id: string;
  readonly description: string;
  readonly kind: ActuarialToolKind;
  readonly inputSchema: z.ZodObject<TShape>;
  readonly outputSchema?: z.ZodType<TResult | ToolEnvelopeFailure>;
  readonly allowUninspected?: readonly string[];
}

export type DefineActuarialToolOptions<
  TShape extends z.ZodRawShape,
  TResult,
> =
  | (DefineActuarialToolCommon<TShape, TResult> & {
      readonly tenant: "required";
      readonly tenantSource?: TenantSource;
      readonly tenantKey?: string;
      readonly execute: (
        input: z.infer<z.ZodObject<TShape>>,
        tenant: string,
        context: ActuarialToolContext,
      ) => Promise<TResult>;
    })
  | (DefineActuarialToolCommon<TShape, TResult> & {
      readonly tenant: "none";
      readonly execute: (
        input: z.infer<z.ZodObject<TShape>>,
        tenant: null,
        context: ActuarialToolContext,
      ) => Promise<TResult>;
    });

export function defineActuarialTool<
  TShape extends z.ZodRawShape,
  TResult,
>(
  options: DefineActuarialToolOptions<TShape, TResult>,
): DefinedActuarialTool<
  z.input<z.ZodObject<TShape>>,
  TResult | ToolEnvelopeFailure
>;

export type DiagnosticAgentView =
  | "emergence"
  | "triangles"
  | "latest-diagonal";

/** This strict object is the complete model-visible input schema. */
export interface DiagnosticAgentToolInput {
  readonly runPresetId: string;
  readonly instanceIds: readonly string[];
  readonly view: DiagnosticAgentView;
}

export interface DiagnosticAgentPresetExecutionInput {
  readonly tenantId: string;
  readonly instanceIds: readonly string[];
}

export interface DiagnosticAgentRunPreset {
  readonly id: string;
  readonly definitionIntegrity: string;
  readonly allowedInstanceIds: readonly string[];
  readonly execute: (
    input: DiagnosticAgentPresetExecutionInput,
  ) => Promise<VerifiedDiagnosticRunProvenance>;
}

export interface CreateDiagnosticSelectionToolInput {
  readonly id?: string;
  readonly description?: string;
  readonly definition: CompiledDiagnosticDefinition;
  readonly runPresets: readonly DiagnosticAgentRunPreset[];
  /** Defaults to `projectId`; passed to defineActuarialTool as tenantKey. */
  readonly tenantContextKey?: string;
}

export interface DiagnosticAgentDisplayPoint {
  readonly group: string;
  readonly sourceGroups: readonly string[];
  readonly dimensions?: DiagnosticDeepReadonly<JsonValue>;
  readonly origin: string;
  readonly valuation: string;
  readonly developmentAge: number;
  readonly ageUnit: string;
  readonly metrics: Readonly<
    Record<string, DiagnosticDeepReadonly<DiagnosticMetricEvaluation>>
  >;
  readonly findings: readonly DiagnosticDeepReadonly<DiagnosticMetricFinding>[];
}

export type DiagnosticAgentDisplayProjection =
  | {
      readonly view: "emergence" | "latest-diagonal";
      readonly points: readonly DiagnosticAgentDisplayPoint[];
    }
  | {
      readonly view: "triangles";
      readonly triangles: readonly DiagnosticDeepReadonly<DiagnosticMetricTriangle>[];
    };

export interface DiagnosticAgentToolSuccess {
  readonly success: true;
  readonly data: {
    readonly runPresetId: string;
    readonly instanceIds: readonly string[];
    readonly formulaFingerprints: Readonly<Record<string, string>>;
    readonly calculationFingerprints: Readonly<Record<string, string>>;
    readonly definitionIntegrity: string;
    readonly runFingerprint: string;
    readonly resultFingerprint: string;
    readonly runResultFingerprint: string;
    readonly review: DiagnosticDeepReadonly<DiagnosticReviewReceipt>;
    readonly display: DiagnosticAgentDisplayProjection;
  };
}

export type DiagnosticAgentToolResult =
  | DiagnosticAgentToolSuccess
  | ToolEnvelopeFailure;

export const diagnosticAgentToolInputSchema: z.ZodType<DiagnosticAgentToolInput>;
export const diagnosticAgentToolResultSchema: z.ZodType<DiagnosticAgentToolResult>;

export type DiagnosticSelectionTool = DefinedActuarialTool<
  DiagnosticAgentToolInput,
  DiagnosticAgentToolResult
>;

export function createDiagnosticSelectionTool(
  input: CreateDiagnosticSelectionToolInput,
): DiagnosticSelectionTool;
```

The shared tool layer uses the exact generic contract above. The body callback
receives the post-parse `z.infer`/`z.output` value, while the SDK-returned
tool's public `execute` accepts the real pre-parse `z.input` value. This
distinction is observable for type-changing transforms and prevents callers
from being told to pass a transformed value that the adapter would parse a
second time as raw input. `TResult` is the tool body's return type; the
SDK-returned tool's `execute` output is always
`TResult | ToolEnvelopeFailure`. If `TResult` already includes the failure
branch the union is naturally idempotent. `ToolEnvelopeFailure` becomes deeply
readonly in this breaking release so the complete diagnostic result union is
readonly.

An optional `outputSchema` must describe the complete observable union, not a
success-only callback result. The exact construction probe is
`{ success: false, error: { code: "TOOL_OUTPUT_INVALID", message: "Tool output
failed schema validation" } }`. At factory construction the schema must parse
that value **to a deep-equal value** or definition fails with
`BAD_OUTPUT_SCHEMA`; a thrown transform/refinement maps to the same typed
definition error. At execution, the SDK adapter calls the private real input
schema's `safeParse` inside a catch boundary. Invalid input or a thrown
transform/refinement becomes code `TOOL_INPUT_INVALID` with constant message
`Tool input failed schema validation`. After tenant resolution/body exception
conversion, it likewise calls the private real output schema's `safeParse`
inside a catch boundary; invalid or thrown validation becomes code
`TOOL_OUTPUT_INVALID` with constant message `Tool output failed schema
validation`. If the pre-schema value is any `success: false` envelope, the
parsed value must deep-equal that exact envelope or it is likewise
`TOOL_OUTPUT_INVALID`; the construction sample cannot conceal a conditional
transform that rewrites another SDK error. Successful values may be transformed
normally. When no output schema exists, an actual runtime `undefined` from the
SDK body is still mapped to that same failure rather than escaping through the
exact public execute contract. This is the SDK adapter checking its body, not
Mastra adding `void`. Input parsing runs exactly once per execute call. A
supplied output schema has one documented construction-time compatibility probe
and then runs exactly once per execute call; transform-count tests must account
for or reset after that probe.

This adaptation is necessary because the lock-resolved installed Mastra core
declarations (initially verified at `1.51.0`, and lock-tested for this candidate
at `1.64.0`) type `Tool.execute` as
`TOutput | ValidationError | void`, infer `Tool<..., unknown>` when
`outputSchema` is absent, and the real `makeCoreTool`/Agent conversion validates
the attached input schema before calling `Tool.execute`. Attaching the real Zod
schema would therefore transform twice and could return Mastra's
`ValidationError` before the SDK adapter runs.

The factory retains the caller's real Zod input/output schemas privately. Via
the installed public `@mastra/core/schema` APIs it derives their provider JSON
Schema converters, then constructs SDK-internal `StandardSchemaWithJSON`
metadata bridges. Each bridge exposes the exact same input/output JSON Schema,
but its synchronous Standard Schema `validate` is an identity success with no
domain validation or transform. Those bridges—never the private Zod schemas—
are the schemas attached to the Tool. The factory calls `createTool` with ID,
description, metadata bridges, and **without** its optional `execute`, then
assigns one SDK-owned execute adapter to that actual Tool instance. The adapter
owns the only domain input/output parsing, tenant resolution, and body
exception conversion. It forwards the structural `ActuarialToolContext`
directly and uses only its request-context seam.

The metadata bridge is an intentional Mastra integration boundary, not a
caller-supplied pass-through schema or an inference trick. Tests require its
provider JSON Schema to deep-equal the real schema for every supported target,
its validator to be synchronous/identity-only, and the installed public
`makeCoreTool` path to reach the SDK adapter for malformed JSON input. The
bridge is deliberately typed `StandardSchemaWithJSON<unknown, unknown>` and
makes no false compile-time claim that it validated a domain value. For that
same reason, `DefinedActuarialTool` inherits its non-execute surface from
`Tool<unknown, unknown>`: public `inputSchema`, `outputSchema`, approval,
transform, and output-callback members remain honestly unknown rather than
pretending the metadata bridge performs domain validation. Only its required
SDK-owned `execute` member is concretely typed to `TInput` and `TOutput`; the
strict real Zod schemas are exported separately where intended. The one final
declaration-audited whole-Tool assertion is justified by the private parser
and exact adapter described below; no other cast is permitted.

The public `DefinedActuarialTool` omits and replaces Mastra's broad optional
`execute` member with the required exact adapter while remaining structurally
usable as a Mastra tool. Schema-present and schema-absent construction branches
converge at exactly one documented, declaration-audited assertion on that
final Tool. No caller, individual factory, or diagnostic module may cast around
the seam or supply a pass-through schema; only the SDK-owned metadata bridge is
allowed.

The diagnostic factory instantiates `TResult` as
`DiagnosticAgentToolSuccess` and supplies the strict
`DiagnosticAgentToolResult` schema. Legacy factories omit `outputSchema` but
use the same input/envelope/adapter path; there is no second factory or
success-only overload. Declaration tests compare the installed Mastra shape
with both SDK branches, while runtime tests prove malformed input/output and a
schema-absent body returning `undefined` never escape as Mastra
`ValidationError`, framework-added `void`, or body-added `undefined`. A
conditional output transform that preserves the construction probe but rewrites
a different failure is rejected at runtime; stateful Zod transforms prove the
input schema runs once per execute and the output schema runs once per execute
in addition to its single documented construction probe. Throwing input,
output, and construction-probe transforms/refinements are also normalized to
their exact error contracts rather than escaping into Mastra. A nested
type-changing input transform is declaration-tested and exercised through both
direct `tool.execute` and installed `makeCoreTool`: callers pass `z.input`, the
body receives `z.output`, and exactly one transformation occurs on each path.

- The default tool ID is `diagnostic-selection`; default description is
  `Select and display a host-approved actuarial diagnostic run`. A supplied
  tool ID and `tenantContextKey` must each be token strings; a supplied
  description must be a human-text string under Section 5. These are validated
  at construction and never deferred to tenant lookup. The preset
  catalog must be nonempty. Preset IDs and every preset's allowed instance IDs
  must be nonempty and unique; duplicates are rejected rather than silently
  deduplicated. Each preset definition tag must equal the authentic compiled
  definition, every allowed ID must resolve in it, and `execute` must be a
  function. Construction authenticates the definition, validates the whole
  preset catalog atomically, code-unit-sorts each already-unique allowlist,
  copies every scalar into a private deeply frozen catalog, and captures each
  execute function by value. Any catalog/authenticity failure throws
  `AgentsError` with code `BAD_DIAGNOSTIC_CATALOG` before a Tool is returned;
  it is a host construction error, never a model-visible failure envelope.
  Runtime selection never rereads the caller's outer array, preset object,
  allowlist, or mutable `execute` property.
- Model instance IDs are nonempty and set-like, resolve within the selected
  preset allowlist, and exact-deduplicate/sort by code-unit order. The host may
  execute or retrieve a cached run for that exact selection, but must return an authentic
  `VerifiedDiagnosticRunProvenance` whose definition tag, manifest preset ID,
  and explicit manifest `filter.instanceIds` equal the request. The tool calls
  both owner assertions and fails closed before projecting output.
- Successful output is the ordinary success envelope containing the normalized
  selection; selected formula/calculation tags; definition, run, result, and
  run-result tags; the full review receipt (so triggered/not-evaluated states
  survive); and a display-only projection for the chosen view. The projection
  never receives a new result fingerprint and cannot be mistaken for a new
  actuarial run. `calculationFingerprints` has exactly the normalized requested
  instance IDs as code-unit-ordered keys. `formulaFingerprints` has exactly the
  exact-deduplicated formula IDs referenced by those instances, likewise in
  code-unit order; neither record may expose unselected or stale catalog
  entries. The failure branch remains `ToolEnvelopeFailure`.
- Adds no general formula-authoring API.
- Existing tool wrappers may expose a host-owned compiled definition by
  registered instance ID and a host-approved run-preset ID. A cached superset
  is rejected rather than display-filtered into an unstamped apparent run.
  Model-visible input cannot contain arbitrary
  calculation filters, a definition AST, basis, period convention, rule,
  tenant/project ID, or raw provenance record.
- Successful output identifies the approved preset plus definition, run,
  result-content, and run-result binding fingerprints.
- A change to basis, missingness, timing, period convention, or rule is a
  material action requiring a separate host judgment gate and ledger entry.

`tenantContextKey` defaults to `projectId`, must itself be a token string, and
is passed as `tenantKey` to `defineActuarialTool` with `tenant: "required"`.
The shared wrapper resolves the trusted tenant before the diagnostic execute
callback and supplies it as that callback's `tenant` argument; the factory
does not call `tenantOf`, perform a second context read, or use
`tenant: "none"`. Missing, empty, or wrong-type context values produce
`ToolEnvelopeFailure` code
`NO_TENANT_CONTEXT`; there is no model-visible fallback. Execute-time failure
precedence is input-schema validation, trusted tenant resolution, preset
lookup, allowlist validation, host execution, verified-provenance
authenticity/coherence, display projection, then output-schema validation. The
agent error registry adds
`UNKNOWN_DIAGNOSTIC_PRESET`, `UNAPPROVED_DIAGNOSTIC_INSTANCE`, and
`DIAGNOSTIC_RUN_MISMATCH`; the shared registry also adds
`BAD_DIAGNOSTIC_CATALOG`, `BAD_OUTPUT_SCHEMA`, `TOOL_INPUT_INVALID`, and
`TOOL_OUTPUT_INVALID`, while
unexpected host exceptions retain the existing `TOOL_ERROR` envelope behavior.
Tests pin code and precedence, including a
nonlexical ID order, a cached superset, a wrong preset/filter/definition tag,
and absent tenant context.

## 19. Breaking migration

| `0.5.0` public surface | `0.6.0` replacement |
|---|---|
| `MetricDefinition` | `DiagnosticFormulaTemplate` plus `DiagnosticMetricInstance` |
| `MetricDefinition.requiredComponents` | compiler-derived dependencies |
| `MetricDefinition.evaluateWarnings` | `DiagnosticComparisonRule[]` |
| `MetricWarningRule` | `DiagnosticComparisonRule` |
| `SparseValuePolicy` / run `sparsePolicy` | `DiagnosticMeasureDefinition.missing` |
| free-text `basis` | `basisId` plus `AmountBasisDefinition` |
| `AmountLayerDefinition` / `deriveAmountLayers` | `DiagnosticDerivedMeasureDefinition` / `deriveDiagnosticClaimMeasures` |
| `aggregateMeasures` / `mergeMeasureAggregates` / `finalizeMeasureAggregate` | internal definition-driven, deterministically ordered batch aggregation |
| wide `DiagnosticExposureRow.measures` | long `DiagnosticExposureObservation.measureId` / `.value` |
| `DiagnosticLossRow` / caller-supplied `ageMonths` | `DiagnosticClaimObservation` or `DiagnosticLossSnapshot`; axis-derived `developmentAge` on results |
| ambiguous row `.group` | explicit input `.sourceGroup`; mapped results retain `.group` |
| row-level `dimensions` | explicit runner `groupDimensions` keyed by produced output group |
| one ambiguous `groups` filter | pre-map `sourceGroups` and post-map `outputGroups` |
| `policyPeriods` filter | upstream aligned loss/exposure preparation plus artifact lineage |
| quarter parsing hidden inside runner | explicit `DiagnosticPeriodAxis` |
| `createCasualtyQuarterlyMetrics` | `createCasualtyMetricInstances` |
| `CASUALTY_QUARTERLY_METRICS` | `CASUALTY_FORMULA_TEMPLATES` plus caller-created instances |
| `CASUALTY_DIAGNOSTIC_COMPONENTS` | explicit factory bindings |
| `createCasualtyAmountLayers` / `CASUALTY_AMOUNT_LAYERS` | caller-defined claim derivations and bases |
| flattened `MetricEvaluation` | nested calculation/presentation result with identities and stats |
| fixed `ReviewDiagnosticDataOptions` taxonomy | structural review plus `DiagnosticReviewRule[]` |
| optional/truncated diagnostic `DataCheck.findings` and `ageMonths` context | complete required `findings`; `developmentAge` + `ageUnit` context |
| opaque diagnostic interchange extension | typed `DiagnosticDefinitionDoc` |
| arbitrary run filters with no identity | `DiagnosticRunManifest` plus approved run presets |
| `createDiagnosticsProvenance` / flattened diagnostic provenance | completed-run-only `createDiagnosticRunIdentity` returning verified provenance; plain `DiagnosticRunProvenance` is the serialized shape |
| shared `defineActuarialTool` exposing Mastra's broad optional execute result, mutable `ToolEnvelopeFailure`, or a success-only `outputSchema` | `DefinedActuarialTool` with required exact SDK execute, deeply readonly failure envelopes, exactly-once boundary validation, and an optional schema covering the complete success/failure union |

No aliases or shims preserve these removed names. The migration guide must show
the old `$250K` and primary fixture expressed as two caller-defined bases and
six amount instances per basis reusing the same four amount-related templates,
so numerical parity is visible without preserving the old modeling mistake.

## 20. Semantic invariants

1. Aggregate leaves first and divide once. Never average row-level ratios.
2. Missing is not zero; explicit zero is observed; imputation is measure-local
   and visible.
3. Missing/non-finite/zero/negative denominator means null, never exception,
   `NaN`, or infinity. A negative numerator remains legal.
4. Non-finite input, aggregate overflow, conflicts, incomplete exposure, and a
   missing required exposure in an existing loss cell always fail closed.
   Absent source cells are asserted only by the expected grid and never
   fabricated for calculation.
5. Claim caps and layers execute claim-by-claim before aggregation.
   An SDK claim layer starts from one unlimited included component; it never
   silently stacks over an already limited source.
6. Ordinary measure/role add/subtract values share kind, unit, and their exact
   structured amount basis, count population, or exposure basis. Amount-valued
   claim addition alone permits pairwise-disjoint component bases and projects
   their exact sorted union; claim subtraction remains exact-basis. Paid and
   incurred values combined or compared by a formula share one exact basis.
   Catalog compatibility never silently implies temporal compatibility;
   formula roles declare an exact temporal constraint when one is required.
7. Exposure identity cannot double count, mix revisions, or leak later
   valuation exposure backward.
8. Period order and age are explicit, numeric, and locale-independent.
9. Every diagnostic view projects the same evaluated emergence cells.
10. Every portable behavioral definition is JSON data; no function can be
    silently omitted from provenance.
11. Formula identity is basis-independent; derivations are transitive
    calculation inputs; review rules affect definition identity, not numeric
    calculation identity.
12. Exact run and result context remains content-identifiable separately from
    the reusable definition, with caller-declared digests labeled honestly.
13. Existing reserving math and published-value validations do not change.

## 21. Acceptance evidence map

| Requirement | Required evidence |
|---|---|
| Six formulas, arbitrary bases | formula-definition tests and 10 + 6×basis casualty-factory tests |
| Old numeric behavior without old formula types | reconfigured `$250K`/primary fixture golden |
| Ratio of sums | hand counterexamples for all six families plus deterministic generated row permutations |
| Missingness/numerics | mixed `unknown`/`zero`, nullable sums, stable-order compensated summation, cancellation/subnormal/overflow tests |
| Claim derivation | finite/unlimited layers, pre-limited artifact refs, split indemnity/expense, identity mutation, claim→snapshot→runner tests |
| Exposure timing | static, valuation-specific, mixed timing, conflict, missing valuation, no-leak tests |
| Selection/group/grid semantics | normalized filter sets/ranges, timing-specific exposure selection, mapping fallback/rejection, sparse dimensions, globally unique expected grid before cutoffs |
| Period neutrality | mixed-cadence calendar, annual, quarter, month, fiscal ordered, alias, gaps, reversal, unknown-period tests |
| Declarative rules | exact three-way operator truth table, tolerance overflow/boundary, missing operand, two-cell/control scope, projection, mixed-status gate, JSON round-trip, alternate taxonomy |
| Temporal semantics | unconstrained pointwise mixed-semantics binding, constrained-role rejection, exact claim-derivation equality, cumulative and point-in-time monotonic acceptance, incremental/unknown rejection, and three-shore identity mutation |
| Calculation/presentation split | raw equality under multiple scales and presentation-overflow tests |
| Identity behavior | fixed vectors, normalization, key/catalog order, derivation/rule mutation matrix, run/result coherence, honest FNV wording |
| Submitted-input auditability | filtered/cutoff/invalid-only identity sensitivity, complete source/fallback coverage, empty-run distinction |
| Portable boundaries | exact string and expression-resource limit vectors on TypeScript/Python/R shores |
| Typed interchange | TS/Python/R parse, integrity, identity, evaluation, and schema-drift conformance |
| Data/compliance integration | unknown input → authentic frozen review/run → review+result replay → verified full provenance/lineage + dataset artifact → bundle → definition-doc round-trip |
| Agent boundary | trusted instance/run-preset selection, rejection of model-supplied definitions or calculation filters, exact SDK execute typing with honestly unknown metadata bridges, public `makeCoreTool` traversal, failure-envelope preservation, undefined-output guard, and once-only private-schema transforms |
| Real-world use | annual French motor gross/net diagnostics with committed compact derivatives |
| SDK regression | Node 22.13+ all-five build/test/packed consumers, minimum Node 20 packed-runtime consumer for core/data/interchange/compliance only, Python 3.12 primary plus minimum Python 3.10 adapter conformance, pinned R, all workspace tests/examples, real tarballs, and clean scratch installs |
| Reserving isolation | unchanged published-value validation suite |

## 22. Release posture

The implementation targets lockstep package version `0.6.0`. The package
release and wire-version changes are independent: npm packages move from
`0.5.0` to `0.6.0`, while the interchange writer moves from `1.0.0` to
`1.1.0`.

The five lockstep packages were published from release-source commit
`a7f1916697f99dbfa30ffbccadec0cc37099e769`, and the immutable `v0.6.0` tag
points to that commit. The public-registry clean-install proof passed before
the post-publication record was committed.
