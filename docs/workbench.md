# ActNG — the AI-native actuarial reserving workbench

> The reference application of the actuarial-ts SDK (see the repo root
> README). Everything below documents the workbench itself.

A web application for P&C actuaries to estimate unpaid claim liabilities: import
claim-level loss runs, build development triangles, select loss development
factors interactively, run Chain Ladder / Bornhuetter-Ferguson /
Berquist-Sherman with Mack standard errors and assumption diagnostics, and work
alongside an embedded AI actuarial advisor that analyzes the data and can change
the workspace itself.

## Quick start

Requirements: Node.js 20+ (22 recommended; see `.nvmrc`) and an Anthropic API
key for the advisor.

```bash
# 1. Configure the advisor (one line)
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env

# 2. One command: install, seed demo data, start API + web app
npm install && npm run dev
```

Open http://localhost:5175. The seed creates a demo project ("Demo: GL
Occurrence (synthetic)") and writes matching CSVs to `apps/server/data/demo/`
so the import flow can be exercised by hand. Without an API key everything
works except the advisor chat, which returns a clear 503.

Optional `.env` settings: `ADVISOR_MODEL` (default `claude-opus-4-8`), `PORT`
(API, default 4600), `ACTNG_DATA_DIR` (SQLite location),
`ACTNG_PROMOTION_TOLERANCE_CEILING` (study-promotion replay-tolerance
ceiling, default 0.005; a study stating a looser tolerance fails intake).

```bash
npm test          # every @actuarial-ts package suite + the server suite
npm run typecheck # every workspace
```

## The demo walkthrough

1. `npm run dev` brings everything up seeded.
2. Create a project, import `apps/server/data/demo/demo-loss-run.csv` and
   `demo-exposures.csv` - triangles build immediately.
3. Click factors in the averages menu (or "use row"), pick a tail (both bases
   start on their best fitted tail from import; override per basis), press
   Run analysis - Chain Ladder, BF, and Berquist-Sherman render with ultimates,
   IBNR, and unpaid by origin year, plus Mack standard errors (computed on
   your selected LDFs and tail, per Mack 1999) and diagnostics.
   The Selection of ultimates exhibit then shows every method (12, including Benktander and frequency-severity at default weight 0) side by side per
   origin period with credibility weights BY PERIOD AND METHOD: each cell shows
   the indicated ultimate with its weight directly beside it, and weights
   renormalize within the period. Typed per-period overrides hand-pick the
   final selected ultimates, IBNR, and unpaid. The advisor can read and set
   the same weights and overrides through its tools (including all-periods
   weighting, which the API keeps even though the grid edits per period).
4. Ask the advisor: "Review this triangle and recommend LDF selections, then
   apply them and rerun." It reads the data through its tools, explains its
   selections against the actual factors, applies them, reruns, and the
   workspace updates.

The synthetic data deliberately contains a settlement speedup and a
case-reserve strengthening from calendar year 2022, so the diagnostics fire and
the two Berquist-Sherman adjustments visibly pull the distorted projections
back toward each other.

## Import Study (governed promotion)

The Import Study panel takes a notebook-authored actuarial-interchange
`StudyDoc` (JSON; Python: `save_study` from `interop/python`) and walks it
through the four-gate promotion chain from `@actuarial-ts/agents`
(interchange spec rev 2.2, section 6). The route surface, mounted at
`/api/projects/:id/studies`:

The same governed promotion path is exposable over the Model Context
Protocol for external AI clients (read tools + the staged-write
`stage_study`/`advance_promotion` gates only — no direct mutation). Set
`ACTNG_MCP_TOKEN` and `ACTNG_MCP_PROJECT_ID` to enable it; see
[docs/interop/mcp-notebook-recipe.md](interop/mcp-notebook-recipe.md).

- `POST /` - the StudyDoc JSON body starts the promotion (plain JSON, 2 MB
  limit); it pauses at the first gate or answers 422 with a named error
  (`BAD_INTERCHANGE`, `TOLERANCE_CEILING_EXCEEDED`, `WORKSPACE_NOT_READY`,
  `SELECTION_SHAPE`, `UNSUPPORTED_MEASURE`, ...).
- `GET /` and `GET /:runId` - the persisted gate/outcome views.
- `POST /:runId/advance` - one gate decision per call (zod-validated per
  gate), with a mandatory verbatim rationale.

Gate semantics, in one paragraph: **study-intake** shows schema/integrity
validation, the ASOP 23 data review, selection coherence, segment
resolution, and the replay tolerance (effective = min(study, host ceiling))
prominently; **replay-verify** independently replays table-exact selections
and referees any supporting results cross-engine - a `disagree` verdict
hard-blocks the gate structurally (only abort is accepted, and the block
survives restarts because intake is recomputed deterministically);
**rationale** drafts a rationale from the study narrative for the actuary
to edit and requires an attestation; **apply** is the only gate that
mutates the workspace - it applies the selections through the same service
layer as the UI, reruns the analysis, and persists the trail and the
assumption ledger (rationale and attestation verbatim) to Notes. Every
gate records a verbatim rationale; nothing changes before the final gate.
One decision is in flight at a time per run: a concurrent advance answers
409 `PROMOTION_BUSY` (a status compare-and-swap in the studies table).
The intake evidence also states the verification scope explicitly: the
gates verify the study against its own embedded triangle, and whether that
triangle is this workspace's book remains the reviewing actuary's
judgment.

Python interop: `save_study` exports a governed StudyDoc from a notebook
and `load_bundle` opens wrapped reproducibility bundles for notebook
analysis - both live in `interop/python` (see its README).

## Workbench layout

| Path | What it is |
|---|---|
| `packages/*` | The @actuarial-ts SDK packages (core, data, compliance, agents, interchange) - see the repo-root README for the full inventory. The workbench consumes them all. |
| `apps/server` | Express 5 API, SQLite persistence, CSV/Excel import with row-level validation, deterministic synthetic loss-run generator, Mastra advisor agent with SSE chat. |
| `apps/web` | Vite + React 19 + Tailwind v4 workspace UI. |

## Validation against published results

The build treats the reserving math as the product. The test suite reproduces,
from the primary sources:

- Mack (1993), ASTIN 23(2), Table 1 (Taylor/Ashe data): development factors,
  chain ladder reserves by accident year and in total (18,681k), sigma-squared
  estimates including the extrapolated final column, and Mack standard errors
  as percentages of reserves (80/26/19/... overall 13%).
- Mack (1993) Table 4 (mortgage guarantee data): factors, reserves (14,547k),
  sigma-squared, and standard-error percentages (overall 26%).
- Mack (1999), ASTIN 29(2), Tables 1-2: ultimates under the published 1.05
  tail factor (total 48,906k).

One transcription note: the 1993 scan prints the extrapolated Taylor/Ashe
sigma-squared as 0.477k, but Mack's own formula gives 0.447k and the R
ChainLadder package agrees (sigma = 21.1); the tests pin the formula value.

In the product, Mack runs on the selected basis - the same LDF selections and
tail as the chain ladder (Mack 1999) - so its central reserve ties to the
headline reserve. Sigma-squared stays estimated from the data around the
volume-weighted factors, and the tail step extrapolates sigma-squared once
more by Mack's rule (an approximation, flagged in the run warnings). The
published-value tests pin the volume-weighted, no-tail case exactly as
printed. Imports fit a default tail for each basis (the better of the two
curve fits on the volume-weighted factors), so the incurred side never
silently carries a flat 1.000 next to a fitted paid tail.

## Design decisions and tradeoffs

**TypeScript everywhere, one repo.** The engine, API, agent tools, and UI share
one type system; triangle and result types flow from `packages/core` to the
browser without re-declaration. The alternative (Python for the math) buys
numpy but costs a serialization boundary exactly where the brief demands typed
end-to-end validation. The math here is loops over small matrices; a general
numerics library adds nothing, and implementing the methods directly was part
of the assignment.

**Pure core with nulls as first-class citizens.** Every engine function takes
plain data and returns plain data; no I/O, no framework, unit-testable in
milliseconds. Unobservable cells are `null` and every computation is null-safe
by construction - a missing/zero/negative denominator yields "no factor",
never an exception or NaN. The published-value tests run against this layer
directly.

**SQLite via better-sqlite3, schema bootstrapped in code.** A reserving
workbench is a single-analyst, local-first tool; an embedded database gives
durable persistence with zero setup, and synchronous better-sqlite3 avoids
async ceremony on a single connection. The schema is created idempotently at
boot instead of via a migration runner - with one file per install and
additive-safe DDL, a migration framework would be machinery without a payoff at
this stage; the tradeoff (schema changes need care once real installs exist) is
documented rather than hidden. Analyses persist their full inputs and results
as JSON snapshots, which is the natural shape for point-in-time actuarial runs.

**Advisor: Mastra agent over Claude (`claude-opus-4-8`).** The agent is built
with Mastra 1.x (`@mastra/core` + `@mastra/memory` with LibSQL-backed threads)
and @ai-sdk/anthropic. Three properties are load-bearing:

1. Tools are the only path to numbers. Read tools (workspace overview, factor
   analysis, tail fits, data quality, diagnostic grids, analysis results)
   return compact, rounded, schema-validated payloads; the instructions forbid
   citing figures that did not come from a tool result.
2. Action tools go through the exact same service layer as the UI - the agent
   cannot do anything a user clicking the workspace could not, and the project
   id comes only from the server-side request context, never from the model
   (no tool declares a project id in its input schema).
3. Failures are visible. Tools never throw into the model; they return
   `{ success: false, error }` so the agent retries with fixed parameters or
   tells the user plainly. The SSE route persists partial turns with an
   explicit interruption marker rather than pretending a clean finish.

**Chat transcripts are stored twice, on purpose.** Mastra memory holds the
model-facing history per thread; a small `chat_messages` table holds the
UI-facing transcript with tool events. This keeps rendering decoupled from the
agent framework's storage format at the cost of a duplicate write per turn.

**UI conventions follow the exhibits actuaries already read.** Origins down,
ages across, the latest diagonal highlighted (gold), factor selection as an
averages menu with click-to-select plus an editable selected row, tails as
fitted curves with R-squared and validity warnings next to a judgmental entry.
Tabular monospace numerals everywhere numbers appear.

**Berquist-Sherman mechanics.** Case adequacy restates average case reserves by
de-trending the latest diagonal at an annual severity trend (fitted from the
data by default, overridable); adjusted incurred = paid + restated average case
x open counts. Settlement rate computes disposal rates against selected
ultimate counts (chain ladder on reported counts), restates closed counts at
the latest diagonal's pattern, and interpolates paid at the restated counts
within each origin row - exponential through the bracketing points per
Friedland, with a linear fallback where a zero paid value makes the exponential
undefined, and loud warnings when extrapolation leaves the observed range.
Both adjusted triangles are re-developed with fresh volume-weighted factors,
since user selections describe the unadjusted data.

**What was deliberately not built.** Authentication (single-analyst local tool),
Docker (the brief allows containers but the machine this ships on has none;
`npm run dev` is the one command), Excel export, and quarterly-cadence UI
polish beyond the working toggle. Mack standard errors made the original cut because reserve variability is validated against published values; the ODP bootstrap now ships in @actuarial-ts/core (seeded, England-2002-pinned) but is not yet surfaced in the workbench UI.

## Loss-run format

One row per claim per evaluation snapshot (CSV or first-worksheet Excel):

```
claim_id, accident_date, report_date, evaluation_date, paid_to_date, case_reserve, status
```

Dates are ISO (yyyy-mm-dd); `status` is `open` or `closed`. Exposures:
`origin, earned_premium`. Imports validate every row (with row numbers in
errors) and replace the project's prior data - a loss run is a point-in-time
extract, so re-imports stay idempotent.

## Workflow-run persistence proof

Paused advisor derivations survive server restarts (Mastra snapshots persist
to `workflow-runs.db`). The two-process proof is scripted:

```bash
SCRATCH=$(mktemp -d)
ACTNG_DATA_DIR=$SCRATCH npx tsx apps/server/scripts/verify-restart-resume-phase-a.ts   # prints runId + projectId
ACTNG_DATA_DIR=$SCRATCH npx tsx apps/server/scripts/verify-restart-resume-phase-b.ts <runId> <projectId>
```

Phase B runs in a fresh process and must print "CROSS-RESTART RESUME: PROVEN".

Paused study promotions survive restarts the same way (study document in
the `studies` table -> deterministic chain reconstruction; Mastra snapshot
-> run rehydration by runId). The promotion pair:

```bash
SCRATCH=$(mktemp -d)
ACTNG_DATA_DIR=$SCRATCH npx tsx apps/server/scripts/verify-promotion-restart-phase-a.ts  # prints runId + projectId
ACTNG_DATA_DIR=$SCRATCH npx tsx apps/server/scripts/verify-promotion-restart-phase-b.ts <runId> <projectId>
```

Phase B resumes the paused promotion through all four gates in a fresh
process and must print "CROSS-RESTART PROMOTION RESUME: PROVEN".
