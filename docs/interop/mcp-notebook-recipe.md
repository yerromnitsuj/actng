# Connecting an MCP client to the workspace (notebook recipe)

How to point Claude Desktop, a notebook-side MCP client, or any
MCP-capable assistant at the ActNG reserving workspace, and drive it
through the ONE path a change is allowed to enter over MCP: read the
evidence, stage a study, advance it gate by gate. Grounded in the
interop spec rev 2.1 **section 8** (the exposure policy, which is a
SECURITY policy) and implemented in `apps/server/src/mcp/workspaceMcp.ts`.

The one-sentence model: **external AI clients read everything and mutate
nothing directly; the only way a change enters the workspace over MCP is
the same four-gate promotion path a human reviewer walks, with the
deciding actor recorded verbatim in the assumption ledger.**

---

## 1. What the server exposes

The MCP server `actng-workspace` exposes exactly these tools — a test
(`apps/server/test/workspaceMcp.test.ts`) asserts the list equals this
allowlist, so nothing else can leak in:

**Read tools (7)** — analyze and explain, never mutate:

| tool | what it returns |
|---|---|
| `get_workspace_overview` | origins, development ages, current selections and tails |
| `analyze_development_factors` | the LDF menu (volume-weighted, simple, geometric, …) per basis |
| `assess_data_quality` | triangle data-quality diagnostics |
| `get_analysis_results` | the current reserve/ultimate results |
| `get_diagnostic_detail` | one diagnostic drilled down |
| `run_sensitivity` | a what-if projection without touching the workspace |
| `crosscheck_with_python` | the independent second-engine referee report |

**Write-shaped tools (exactly 2, both gated)** — the ONLY way a change enters:

- `stage_study` — import a notebook-authored StudyDoc into the governed
  study-promotion chain and return the first gate view. Applies nothing.
- `advance_promotion` — advance a staged promotion by one governed gate.

**Agent (1)** — `ask_advisor`, the reserving advisor exposed as a
**read-only** tool (see section 6).

There is **no** `patchWorkspace`, no `set_tail_factor`, no
`apply_ldf_selections`, no `run_analysis`, no `save_note` over MCP.
Direct mutation is impossible by design; a change reaches the workspace
only through `stage_study` → `advance_promotion`.

---

## 2. Enabling the server (two env vars)

The `/mcp` endpoint is **disabled unless a bearer token is set.** Absent
`ACTNG_MCP_TOKEN`, `mountWorkspaceMcp` returns `false`, the route is
never mounted, and the server logs `MCP disabled (ACTNG_MCP_TOKEN not
set)` once at boot. To turn it on, set BOTH (in the repo-root `.env`):

```bash
# The bearer token that gates /mcp. Treat it like any other secret.
ACTNG_MCP_TOKEN=<a long random string you generate>
# The one project this token grants (v1 single-tenant: one token, one workspace).
ACTNG_MCP_PROJECT_ID=<the project id, e.g. the UUID from GET /api/projects>
```

`ACTNG_MCP_PROJECT_ID` is REQUIRED when the token is set — a bearer
token with no project to grant is a misconfiguration and the server
refuses to start rather than open a silent single-tenant hole.

When MCP is enabled, startup runs a **boot self-test**: it drives a
probe read tool through the server WITHOUT auth info and asserts it
fails closed. If the tenant seam is not wired up (a tool that would
serve an unauthenticated caller), the self-test throws and **startup
aborts** — a governed workspace never accepts unauthenticated clients.
The boot log confirms it:

```
[server] MCP enabled at /mcp (project <id>); boot self-test passed (probe get_workspace_overview failed closed without auth)
```

**Single-tenant, v1.** One token grants exactly one project. The client
never sends a project id — the token IS the project. The bearer
middleware places `{ projectId }` on `req.auth`, which the MCP SDK
surfaces to every tool as `context.mcp.extra.authInfo`, and every
exposed tool resolves its tenant from there via `requireMcpTenant` —
never from the model.

---

## 3. The client config

The transport is **streamable HTTP** at `POST /mcp`, authenticated with
`Authorization: Bearer <ACTNG_MCP_TOKEN>`. The server listens on port
`4600` by default (`PORT` in `.env`); a deployed instance uses its
public HTTPS origin.

### Native HTTP MCP clients (a notebook MCP client, Cursor, any client that speaks HTTP servers)

```json
{
  "mcpServers": {
    "actng-workspace": {
      "type": "http",
      "url": "http://localhost:4600/mcp",
      "headers": {
        "Authorization": "Bearer ${ACTNG_MCP_TOKEN}"
      }
    }
  }
}
```

Substitute your real token for `${ACTNG_MCP_TOKEN}` (or have the client
expand the env var if it supports that). For a deployed workbench swap
the URL for `https://<your-host>/mcp`.

### stdio-only clients (bridge via `mcp-remote`)

Some desktop clients (older Claude Desktop builds) speak only stdio.
Bridge to the HTTP endpoint with `mcp-remote`:

```json
{
  "mcpServers": {
    "actng-workspace": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "http://localhost:4600/mcp",
        "--header", "Authorization: Bearer ${ACTNG_MCP_TOKEN}"
      ]
    }
  }
}
```

> The token is a secret. Do NOT commit it, paste it into a shared
> notebook, or put it in a URL query string — it belongs only in the
> `Authorization` header (or your client's secret store). The token
> value shown here is a placeholder, not a real credential.

A missing or wrong bearer token gets a fail-clear `401 MCP_UNAUTHORIZED`
from `/mcp`; the endpoint never falls open.

---

## 4. The flow, end to end: read → stage_study → advance_promotion

Once connected, the client is bound to the one project the token grants.
A full promotion looks like this.

### 4a. Read the evidence

Start by understanding the workspace as it stands. None of these change
anything:

- `get_workspace_overview` — what origins and development ages exist,
  what's currently selected on the paid and incurred bases.
- `analyze_development_factors` — the candidate LDFs so the study you
  author is grounded in the same menu the workbench computes.
- `assess_data_quality`, `get_diagnostic_detail` — is the triangle clean?
- `get_analysis_results`, `run_sensitivity` — the current reserves and
  what a change would do.
- `crosscheck_with_python` — the independent second engine's read.
- `ask_advisor` — ask the read-only advisor to narrate any of the above.

### 4b. Author a StudyDoc and stage it

In the notebook, author a StudyDoc with the `@actuarial-ts/interchange`
SDK (interchange kind `"study"`): the selection vector, the intent
(`volume-weighted`, `simple`, …), the replay tolerance, and a narrative.
Then hand the WHOLE StudyDoc object to `stage_study` under `study`:

```
stage_study({ study: <the StudyDoc JSON object> })
```

This starts the four-gate promotion chain and returns the first gate
view — the `runId` you'll use for every advance, plus the study-intake
evidence and the recommendation. It **applies nothing.** If the study's
stated `replayTolerance` is looser than the host ceiling, intake fails
here with the reason (fix the study upstream; the host loosens nothing).

### 4c. Advance gate by gate

Drive `advance_promotion` once per gate, in order. Every call takes the
`runId`, the `gate`, a `decision`, and a **non-blank `rationale`**
(recorded verbatim in the assumption ledger — undocumented judgment is
exactly what the ledger exists to prevent):

1. **`study-intake`** — `decision: "accept"` (or `"abort"`). Confirms the
   study parsed, replays within tolerance, and resolves to the single
   workspace segment. → advances to `replay-verify`.
2. **`replay-verify`** — `decision: "accept"` (or `"abort"`). This is the
   **Gate-2 hard block**: if the cross-engine replay DISAGREES, the gate
   structurally refuses `accept` and the call comes back
   `DECISION_REJECTED` — you cannot accept a disagreeing replay. →
   advances to `rationale`.
3. **`rationale`** — `decision: "approve"` (or `"abort"`), and here the
   `attestation` field is **required** (who authored/reviewed the
   rationale). → advances to `apply`.
4. **`apply`** — `decision: "apply"` (or `"abort"`). On `apply`, the
   promoted selections and tail land in the workspace through the same
   service layer a human's apply uses, the full analysis reruns, and the
   assumption ledger + notes persist. → the promotion is `complete`,
   `applied: true`.

Concurrency is guarded: two clients advancing the same paused run — only
one wins; the loser gets `409 PROMOTION_BUSY` and retries once it
settles. `abort` at any gate stops the promotion cleanly without
applying.

The MCP `stage_study`/`advance_promotion` tools delegate to the exact
same `startPromotion`/`advancePromotion` functions
(`apps/server/src/mastra/promotionRuns.ts`) the web routes call — the
MCP surface is a thin, tenant-bridged front door onto the identical
persistence, so a promotion staged over MCP survives a server restart
the same way a promotion staged from the UI does (proven by
`apps/server/scripts/verify-mcp-promotion-restart-phase-{a,b}.ts`).

---

## 5. What `actor` and `attestation` mean

Two free-text fields on `advance_promotion` carry WHO is accountable;
both land **verbatim** in the assumption ledger (the ledger entry's
value AND the persisted ledger note):

- **`actor`** — who is deciding. Optional on every gate. When the caller
  omits it, it defaults to **`"external-mcp-client"`** — the honest label
  for "an MCP client decided this and did not name a person." Supply a
  real name (`"Dr. Ada Lovelace, FCAS"`) when a specific reviewer owns
  the decision, and that string is what the ledger shows.
- **`attestation`** — required at the `rationale` gate. Free text naming
  who authored and reviewed the rationale on file
  (`"Rationale authored and reviewed by <name>"`). Recorded verbatim.

The default matters: a promotion completed by an unattended client is
recorded as `external-mcp-client`, not silently attributed to a human.

---

## 6. `ask_advisor` is read-only; direct mutation is impossible over MCP

`ask_advisor` over MCP is a **dedicated read-only advisor**: it is
assembled with ONLY the read/analyze tools and **no action tools at
all**. Even a fully prompt-injected message has nothing but read tools to
reach — it cannot apply selections, set tails, run analyses, cap, or save
notes. To change anything, the client must go through
`stage_study` → `advance_promotion` exactly as a human does. Ask it to
explain factors, diagnose data quality, or interpret the referee; do not
expect it to mutate the workspace, because it structurally cannot.

Direct workspace mutation is impossible over MCP by design. There is no
direct-write tool on the surface (section 1), the read tools only read,
and the two write-shaped tools are gated promotion steps that record
their actor. **Staged-write only** is the whole policy.

---

## 7. The accountability model (read this before you automate)

State this to anyone wiring an unattended client to this server, and to
any actuary reviewing a promotion the server recorded:

> The mechanism records WHO decided — the `actor` and `attestation`
> fields land in the ledger — but it CANNOT verify humanness. An
> unattended MCP client CAN complete a promotion through all four gates,
> and the ledger will truthfully show that: the decision, the rationale,
> and the actor (`external-mcp-client` by default). The accountability
> boundary is disclosure-true, not enforcement of humanity. A ledger
> that shows an unattended client promoted a study is precisely what a
> reviewing actuary needs to be able to see.

In the spec's words (rev 2.1 section 8): "The mechanism cannot verify
that the decider is human — so it records who decided instead of
pretending." That is the deal. The gates make the reasoning explicit and
attributable; they do not, and cannot, prove a person pressed the
button. Design your automation, and your review process, around that
truth.
