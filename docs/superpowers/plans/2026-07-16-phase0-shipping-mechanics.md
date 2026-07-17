# Phase 0: SDK Shipping Mechanics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `@actng/core` into publishable `@actuarial-ts/core@0.1.0` (real dist, license, typed public surface, zero dead code, CI) without changing any computed number.

**Architecture:** Rename-in-place inside the npm workspace; tsc emits ESM + d.ts to `dist/` via `tsconfig.build.json`; a `prepare` script keeps dist fresh on `npm install` (dist is gitignored, never committed — the YesChef shared-types committed-dist pain is the anti-pattern). Consumers (server via tsx, web via vite, both moduleResolution bundler) resolve the package `exports` → dist.

**Tech Stack:** tsc NodeNext emit, npm workspaces, vitest, GitHub Actions.

## Global Constraints

(Everything in the master plan's Global Constraints, plus:)
- Zero behavior change to computed numbers: `packages/core/test/validation.test.ts` and the full suite must pass unmodified except where a task explicitly adds tests.
- Core keeps zero runtime dependencies.

---

### Task 1: Apache-2.0 licensing

**Files:**
- Create: `LICENSE` (repo root, full Apache-2.0 text, "Copyright 2026 Justin Morrey")
- Create: `packages/core/LICENSE` (copy)
- Modify: `packages/core/package.json` (add `"license": "Apache-2.0"`)

- [ ] Write LICENSE files (canonical apache.org text), add license field
- [ ] Commit: `chore: Apache-2.0 license for the SDK`

### Task 2: Rename @actng/core → @actuarial-ts/core

**Files:**
- Modify: `packages/core/package.json` (name `@actuarial-ts/core`, version `0.1.0`, description, repository/homepage/keywords/engines)
- Modify: `apps/server/package.json`, `apps/web/package.json` (dependency key)
- Modify: the 10 source imports found by `grep -rn 'from "@actng/core' apps packages --include='*.ts' --include='*.tsx'` (web: ResultsPanel.tsx, TriangleGrid.tsx, api/types.ts; server: index.ts, seed/synthetic.ts, mastra/tools.ts, services/importService.ts, db/repo.ts, services/workspaceService.ts — re-grep, count must reach 0)

**Interfaces:**
- Produces: package name `@actuarial-ts/core` used by every later phase.

- [ ] Rename + update all imports (`grep -rl 'from "@actng/core' | xargs sed -i '' 's|@actng/core|@actuarial-ts/core|g'` then verify grep count 0)
- [ ] `PATH=... npm install` (relinks workspace, updates package-lock.json)
- [ ] `PATH=... npm test && PATH=... npm run typecheck` — all green
- [ ] Commit: `feat(sdk)!: rename @actng/core to @actuarial-ts/core@0.1.0`

### Task 3: Real build output (dist + exports map)

**Files:**
- Create: `packages/core/tsconfig.build.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": false,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```
- Modify: `packages/core/package.json`:
```json
{
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist", "README.md", "LICENSE"],
  "sideEffects": false,
  "scripts": { "build": "tsc -p tsconfig.build.json", "prepare": "tsc -p tsconfig.build.json" }
}
```
- Modify: `.gitignore` (add `packages/*/dist/`)
- Modify: root `package.json` scripts if dev/test need an explicit core build step (prepare covers install; `npm run build` already builds core first).

**Interfaces:**
- Produces: `dist/index.js` + `dist/index.d.ts`; the exports map every later package copies.

- [ ] Add build config, run build, inspect dist (index.js + index.d.ts present, .js relative imports resolve)
- [ ] Verify consumers: `npm run typecheck` (server+web resolve d.ts), `npm test`, boot `npm run dev` briefly (server on 4600 answers /api/health)
- [ ] `npm pack --dry-run -w @actuarial-ts/core` — tarball contains dist/README/LICENSE only
- [ ] Commit: `feat(sdk): build @actuarial-ts/core to dist (ESM + d.ts, exports map, prepare)`

### Task 4: Error-code registry + typed average keys

**Files:**
- Modify: `packages/core/src/types.ts` (RESERVING_ERROR_CODES const + ReservingErrorCode union; ReservingError.code typed as ReservingErrorCode)
- Modify: `packages/core/src/factors.ts` (AVERAGE_KEYS const + AverageKey union; AverageSpec.key: AverageKey)
- Test: `packages/core/test/engine.test.ts` (registry completeness test: grep-derived list equals export; every DEFAULT_AVERAGES key in AVERAGE_KEYS)

Collect codes from ALL `new ReservingError(` sites including multiline (the quick grep found: BAD_CAP, BAD_DATE, BAD_ELR, BAD_LIMIT, BAD_LOSSES, BAD_ORIGIN, BAD_PREMIUM, BAD_TABLE, BAD_TAIL, BAD_TREND, NO_CLAIMS, NO_DATA, SHAPE, TOO_SMALL — re-scan for stragglers before writing the const). Average keys: all-str, all-wtd, 5-str, 5-wtd, 3-str, 3-wtd, med-5x1, geo-all.

- [ ] Write failing tests (import RESERVING_ERROR_CODES / AVERAGE_KEYS, assert shape)
- [ ] Implement; type `ReservingError` constructor `code: ReservingErrorCode`
- [ ] Full suite + typecheck green (server/web `.find(a => a.spec.key === "all-wtd")` still compiles)
- [ ] Commit: `feat(core): typed error-code registry and average-key union`

### Task 5: Dead code removal + OLS consolidation

**Files:**
- Modify: `packages/core/src/util.ts` (delete `sumDefined`, `round` — re-verify zero callers first)
- Modify: `packages/core/src/ilf.ts` (delete unreachable `return rows[rows.length - 1]!.factor;` ~line 530)
- Modify: `packages/core/src/trend.ts` (fitWindow's inline OLS → `util.ols`; MUST keep identical numeric behavior — trend tests pin fitted rates/R²; if the R² conventions differ in degenerate cases, keep fitWindow's convention by post-adjusting, or leave the refactor out with a comment stating why)
- Modify: `packages/core/src/mack.ts` (~line 76: warn when non-positive selected factor coerced to 1.0, message mirroring chainladder.ts)
- Test: extend `packages/core/test/trend.test.ts` degenerate-window case if uncovered; mack warning test in `packages/core/test/validation.test.ts` or engine.test.ts

- [ ] Verify zero callers (`grep -rn "sumDefined\|util.round\|round(" ...` carefully), delete
- [ ] trend.ts consolidation with before/after numeric identity check (run trend tests)
- [ ] mack warning + test
- [ ] Full suite green
- [ ] Commit: `refactor(core): prune dead exports, consolidate OLS, Mack selection-warning parity`

### Task 6: SSE disconnect aborts the advisor stream

**Files:**
- Modify: `apps/server/src/routes/chat.ts` (create AbortController; `req.on("close")` → abort; pass `abortSignal` into `advisorAgent.stream(...)` — verify option name against installed @mastra/core d.ts before writing; on abort, persist the partial transcript with the existing interruption marker)

- [ ] Verify stream options in `node_modules/@mastra/core/dist/**` (agent.stream accepts abortSignal)
- [ ] Implement; typecheck; existing server tests green
- [ ] Manual verify: start dev server, open SSE chat request, kill client, server log shows abort (no continued generation)
- [ ] Commit: `fix(server): abort advisor stream when the SSE client disconnects`

### Task 7: Core README + docs refresh

**Files:**
- Create: `packages/core/README.md` (method inventory table w/ literature, the null contract, warnings-vs-throws philosophy, quickstart example: triangle → factors → select → CL + Mack, validation statement citing Mack 1993/1999 fixtures, ASOP positioning sentence — the sanctioned phrase, Apache-2.0)
- Modify: `CLAUDE.md`, `AGENTS.md` (package name; remove stale "No git remote is configured"; note the dist build + prepare step)

- [ ] Write README; refresh CLAUDE.md/AGENTS.md
- [ ] Commit: `docs(core): README for @actuarial-ts/core; refresh repo docs`

### Task 8: CI

**Files:**
- Create: `.github/workflows/ci.yml` (push/PR to main; Node 22; `npm install`; `npm run build`; `npm run typecheck`; `npm test`)

- [ ] Write workflow; validate YAML locally (`npx yaml-lint` or python -c yaml.safe_load)
- [ ] Commit + push; confirm the Actions run goes green on GitHub (`gh run watch` or `gh run list`)

### Task 9: Phase regression gate + /ship

- [ ] Cold-start proof: `rm -rf node_modules packages/*/dist && npm install && npm test && npm run typecheck` (prepare must rebuild dist)
- [ ] Boot `npm run dev`, hit `/api/health`, load web app briefly (workbench alive)
- [ ] Update master plan Progress Log; mark Phase 0 done
- [ ] /ship (commit + push; verify remote state)
