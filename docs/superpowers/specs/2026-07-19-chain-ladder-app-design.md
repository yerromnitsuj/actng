# Interactive app per chain-ladder example — design

**Date:** 2026-07-19
**Status:** Design approved in conversation; execution authorized (ship per app,
Playwright verification between apps).
**Scope:** An `app/` inside each of the three shore examples
(`examples/chain-ladder-{typescript,python,r}`). The capstone gets no app. No
changes to the five published packages.

---

## 1. Purpose

Give an actuary a working, readable answer to "how would I build a *real app*
on this framework?" — one page per engine where the eight computed averages are
on screen, selections are made by clicking (with per-column overrides and a
tail factor), ultimates recalculate live **in that example's engine**
(in-process TypeScript / chainladder-python sidecar / R subprocess), and the
reserving advisor is built into the page as a streaming chat that uses the same
tools the UI uses.

The three apps extend the trilogy discipline: near-identical code whose only
differences are the compute call and the engine banner. Diffing two `server.ts`
files teaches the same lesson the CLI spines do.

## 2. Decisions (settled in brainstorming)

- **Selection flow: direct, ledger on the side.** Clicking recomputes
  immediately (exploratory; never touches the ledger). A separate **Commit
  selection** action with a mandatory rationale records to the assumption
  ledger and regenerates the ASOP 41 disclosure. Two speeds: play freely,
  commit deliberately.
- **AI: chat panel.** `createReservingAdvisor` over the example's real tool
  registry; tool calls stream visibly as chips (`→ get_triangle`). If the model
  proposes selections, an **apply** control pushes them into the *exploratory*
  state only — committing is always a human act. Advisor-applied selections,
  when committed, carry `actor: "agent"` and the ledger visibly distinguishes
  them.
- **Placement: `app/` inside each example.** Existing shipped files stay
  untouched except a new `"app"` script in each `package.json`.
- **Zero-build frontend.** One `public/index.html` per app, vanilla JS, no
  framework, no bundler. The page is byte-identical across the three apps
  except the `<title>` and the engine banner text.
- **Zero-new-dependency server.** `node:http` + `tsx`; SSE for chat streaming.
  No express/hono/vite. The repo gains no dependencies.

## 3. Architecture

```
examples/chain-ladder-<shore>/
  app/server.ts          node:http — engine, ledger, disclosure, chat endpoints
  app/public/index.html  the page
  test/app.test.ts       server tests (joins the existing vitest suite)
  package.json           + "app": "tsx app/server.ts"
```

**All secrets live server-side**: `ANTHROPIC_API_KEY` (advisor),
`SIDECAR_TOKEN`/`SIDECAR_URL` (Python app), and the tenant. The server sets the
`RequestContext` (`projectId`, `actorIdentity`) from a demo session constant —
the browser never sends or sees identity or credentials. This is the security
lesson and is stated in a comment where the context is built.

**Server state is in-memory, per process, one demo session** — consistent with
the examples' documented in-memory posture; stated in the server docblock.

**Clock:** the server is a HOST, so it may read the clock for ledger
timestamps (`new Date().toISOString()`), with a comment noting the SDK itself
stays pure and the CLI spines stay deterministic. Interchange documents built
at boot use one boot-time constant.

**Ports:** default `8791` (ts), `8792` (py), `8793` (r); `APP_PORT` overrides.

## 4. Endpoints (identical across the three apps)

| Method/path | Behavior |
|---|---|
| `GET /` | serves `index.html` |
| `GET /api/state` | triangle (origins, ages, cumulative grid), all `DEFAULT_AVERAGES` computed factor rows, current exploratory selections, current results, committed snapshot, ledger entries, engine info `{ name, badge }`, `advisorEnabled` |
| `POST /api/compute` | `{ selected: (number\|null)[], tailFactor }` → zod-validated → **the engine** runs → per-origin `{ origin, latest, ultimate, unpaid }` + totals. Does not touch the ledger |
| `POST /api/commit` | `{ selected, tailFactor, rationale, actor? }` → rationale required (SDK-enforced via `recordAssumption`) → ledger grows (LDF entry + tail entry), disclosure regenerates → returns `{ ledger, disclosure }`. Single-flight; an overlapping commit gets `429` + `COMMIT_BUSY` envelope (same posture as `/api/chat`'s `CHAT_BUSY`) |
| `GET /api/disclosure` | current disclosure markdown |
| `POST /api/chat` | `{ message }` → SSE stream of `{ type: "text", delta }`, `{ type: "tool", name }`, `{ type: "proposal", selection }`, `{ type: "done" }` from `advisor.stream(...)` with the server's `RequestContext`. `503` + envelope when `advisorEnabled` is false |

**Proposals are tool calls, not parsed prose.** The app server registers one
extra tool for the advisor only: `propose_selection` (`kind: "read"`, tenant
`"required"`), whose input is `{ selected: (number|null)[], tailFactor,
reasoning }` and whose execute validates against the triangle's column count
and echoes it back. When the advisor calls it, the SSE forwards a typed
`proposal` event; the page's **Apply** button applies the most recent proposal
to the exploratory state. No parsing of model prose anywhere.

The compute handler's body is **the only engine-specific code**. The contract —
arbitrary per-column LDFs plus a tail — meets each engine differently:

- **TypeScript:** `runChainLadder(triangle, selections)` accepts any
  `LdfSelections` natively.
- **Python:** the sidecar replays a **value-carrying selection document** built
  from the current selections (`selectionsToDoc` with per-column value intents;
  the chainladder-python bridge explicitly supports value-only replays). The
  implementer verifies live that an overridden selection matches the TS result
  within 1e-9 before the task closes.
- **R:** `MackChainLadder` derives its own factors and cannot accept supplied
  LDFs, so the R app gains **`tools/interop/run-cl.R`** — a small CLI that
  projects ultimates from supplied factors in R (cumulative products down each
  row; trivial and honest R arithmetic) and writes a method-result document via
  the existing adapter (`ats_assemble_document`). No standard errors — the apps
  display ultimates/unpaid only, so none are needed.

## 5. The page — five regions

1. **Triangle exhibit.** The cumulative paid triangle itself: origins × ages,
   with unobserved (lower-right) cells rendered blank.
2. **Factor table.** Development columns across; one row per average key
   (`all-wtd`, `all-str`, `5-wtd`, `5-str`, `3-wtd`, `3-str`, `med-5x1`,
   `geo-all`), values to 4 decimals; clicking a row's cell selects that
   average's value for that column. A **Selected** row shows the active values
   with per-column numeric override inputs; a tail-factor input sits at the
   row's end. Any change fires `/api/compute` (debounced) and updates region 3.
3. **Results.** Per-origin latest / ultimate / unpaid + totals, engine badge
   with compute timing, delta vs the last committed totals.
4. **Commit + governance.** Rationale textarea, actor display, **Commit
   selection** button. Below: the ledger (seq, actor tag — `actuary` vs
   `agent` styled differently — field, value, rationale) and a collapsible
   disclosure preview (`<pre>` of the markdown; Section 5 visibly grows per
   commit).
5. **Advisor chat.** Message list, input box, streamed replies; tool-call chips
   inline as they happen. "Apply suggestion" (when the reply carries applicable
   selections) writes the exploratory state only. Key absent → panel disabled
   showing the exact `export ANTHROPIC_API_KEY=…` + restart instruction;
   regions 1–4 fully functional regardless.

No horizontal page scroll; the factor table scrolls inside its own container.
Numbers right-aligned, tabular-nums. Restraint over flash: this is teaching
code an actuary will read.

## 6. Error handling

- Engine failure (sidecar down, Rscript missing): compute returns the same
  fail-closed envelope style the tools use (`{ success: false, error: { code,
  message } }`) and the page shows the message **plus the boot command**.
- Invalid input: server-side zod validation, envelope back, field highlighted.
- Chat stream error/stall: SSE `error` event, panel shows it, input re-enabled.
- Nothing silent, anywhere — the CLIs' posture.

## 7. Testing and verification

- **Server tests** per example (`test/app.test.ts`, joins the existing suite
  and its CI legs): spawn the server on an ephemeral port; assert `/api/state`
  shape; `/api/compute` with all-wtd + tail 1.0 reproduces ultimate
  `53_038_946` / unpaid `18_680_856`; commit without rationale → envelope;
  commit with rationale grows the ledger and Section 5; chat endpoint tested
  only for the disabled path (503) — the live model is never in tests. Python/R
  app tests obey the same skip-rules as their existing suites.
- **Playwright between apps (controller-run):** after each app's task review,
  the controller boots the app and drives the real page — load, click an
  average, watch ultimates change, override a cell, commit with rationale,
  observe the ledger row and disclosure growth, confirm the advisor panel's
  enabled/disabled state — before shipping. A failed drive is a failed task.
- **Ship cadence:** commit + push after each app passes review + Playwright.

## 8. Out of scope

Multi-triangle upload, persistence, real auth, the judgment-chain
suspend/resume UI (stays in the CLI spine), markdown rendering, frameworks,
bundlers, the capstone.
