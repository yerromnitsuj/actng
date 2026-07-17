# ActNG - Codex Rules

AI-native P&C actuarial reserving workbench. npm-workspaces monorepo:
`packages/core` = `@actuarial-ts/core` (pure math, published to npm;
builds to dist/ via a `prepare` script — dist is gitignored, regenerated on
`npm install`), `apps/server` (Express 5 + SQLite + Mastra
advisor), `apps/web` (Vite + React 19 + Tailwind v4).

## Commands

- Node 22 via nvm (`.nvmrc`); the shell default may be v18 - prefix
  `PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH"` for every command.
- `npm run dev` - seed (idempotent, `--if-empty`) + API on :4600 + web on :5175
- `npm test` - core suite (incl. Mack 1993/1999 published-value validation) + server suite
- `npm run typecheck` - all three workspaces
- `npm run seed --workspace @actng/server` - regenerate demo data (deterministic seed)

## Non-negotiable domain rules

- Triangles: rows = origin periods, columns = development ages, unobservable
  cells are null. Never divide by a missing/zero/negative denominator - the
  result is null ("no factor"), never an exception or NaN.
- Volume-weighted averages are sum/sum over rows where both cells exist, NOT
  the mean of ratios. CDFs multiply right to left, tail last.
- The published-value validation tests (`packages/core/test/validation.test.ts`)
  are the contract: reserving math changes are wrong until they pass.
- All reserving math lives in `packages/core` - pure, framework-free, no I/O.
  Server and advisor tools call it through `workspaceService`; never fork the
  math into a route or tool.

## Mastra / Anthropic rules

- **Verify Mastra APIs against the installed types** in
  `node_modules/@mastra/core/dist/**/*.d.ts` before writing agent code. The
  mastra docs MCP server can lag releases; trust order: installed types >
  npm dist-tags > docs server > training data.
- Current (1.49) shapes used here: `createTool({ execute: async (input, context) })`
  with direct args; `RequestContext` from `@mastra/core/request-context`;
  `agent.stream(messages, { memory: { thread, resource }, requestContext, maxSteps })`;
  fullStream chunks are `{ type: "text-delta", delta }` and
  tool-call/tool-result with `payload`.
- **Security boundary:** the project id reaches advisor tools ONLY via the
  server-set `requestContext`. No tool may declare a project id in its input
  schema. Tools never throw into the model - they return
  `{ success: false, error: { code, message } }`.
- **ANTHROPIC_BASE_URL gotcha:** ambient env may set it WITHOUT `/v1`
  (official-SDK convention) but `@ai-sdk/anthropic` needs it WITH `/v1`.
  `apps/server/src/env.ts` normalizes; any new `@ai-sdk/anthropic` usage must
  go through `env.anthropicBaseUrl`.

## Engineering conventions

- Zod-validate every boundary (imports, API bodies, tool I/O). Loss-run
  imports REPLACE claim data atomically (one transaction) - never append.
- `patchWorkspace` validates the whole patch before persisting anything.
- Web store: project switches go through `openProject` (full project-scoped
  reset); every async load carries a staleness guard against the current
  `workspaceProjectId`.
- Remote: origin = https://github.com/yerromnitsuj/actng.git (main is pushed).
- The SDK spec and phased plans live in `docs/superpowers/specs/` and
  `docs/superpowers/plans/` (actuarial-ts SDK: @actuarial-ts scope,
  Apache-2.0, P&C only; never claim "ASOP-approved" — the sanctioned phrase
  is "designed to support the actuary's compliance with the ASOPs").
