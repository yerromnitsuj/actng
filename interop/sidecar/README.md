# chainladder-python compute sidecar

The second engine, live (interop Phase C, spec rev 2.1 section 7). Plain
HTTP + JSON — deliberately NOT MCP: **the actuarial-interchange spec is the
wire contract.** Requests carry interchange documents; responses ARE
interchange documents, authored through the `actuarial-interchange` Python
package (`interop/python`), integrity tags and all.

## Contract

### `POST /v1/run/{method}` (bearer auth)

```jsonc
{
  "triangles": { "primary": TriangleDoc, "secondary": TriangleDoc? },  // secondary: MunichAdjustment's incurred (primary = paid)
  "selection": SelectionDoc?,          // replayed per the spec 3.2 intent equivalence table
  "exposure": { "origins": ["2001", ...], "values": [10000, ...], "kind": "earnedPremium" }?,  // BF/Benktander/CapeCod apriori base
  "parameters": { ... },               // method-specific, schema'd per method (unknown keys are 422)
  "seed": 42?,                         // BootstrapODPSample only (REQUIRED there, refused elsewhere)
  "engagementRef": "ENG-2026-071"?     // opaque passthrough into the result's extensions
}
```

→ `MethodResultDoc | StochasticResultDoc` (the full envelope, integrity tag
verified-consistent by construction). Errors are schema'd:
`{ "error": { "code": "...", "message": "..." } }`.

| method | consumes | returns | notes |
|---|---|---|---|
| `Chainladder` | selection? | method-result | profile `deterministic-cl` |
| `MackChainladder` | selection? | method-result | `sigma_interpolation` ∈ {`log-linear` (engine default), `mack`}; profile `mack1993-vw` only when factors are vw-all, no exclusions, sigma `mack`; SE-less rule below |
| `BornhuetterFerguson` | selection?, **exposure** | method-result | `apriori` |
| `Benktander` | selection?, **exposure** | method-result | `apriori`, `n_iters` |
| `CapeCod` | selection?, **exposure** | method-result | `trend`, `decay` |
| `ClarkLDF` | — | method-result | `growth` ∈ {`loglogistic`, `weibull`}; fits its own pattern, selection refused |
| `BootstrapODPSample` | selection?, **seed** | stochastic-result | `n_sims` (default 1000, max 100000); profile `odp-bootstrap-distribution` |
| `MunichAdjustment` | **triangles.secondary** | method-result | refused without both slots; reports the primary (paid) projection; secondary's integrity tag disclosed in `parameters` |

Selection-consuming methods take `average`/`n_periods` parameters ONLY when
no selection is supplied (a selection IS the development intent; sending
both is a 422), plus `strictness` ∈ {`warn` (default), `strict`}:

- **warn** — replay compromises (approximate medial, geometric demotion,
  incoherent selection) run, with every `InterchangeWarning` landed in the
  result document's `warnings` array;
- **strict** — any compromise is refused with 422.

**The Mack-SE-less rule (spec 3.2):** Mack atop a value-only
(judgmental/external) selection has no sigma, so under `warn` the answer is
an SE-less plain chain-ladder document — `method: "clpy:Chainladder"`,
because that is what actually ran, with explicit warnings — and under
`strict` it is a 422 (`SE_LESS_REFUSED`). Never silently approximated.

Convention profiles are **derived from what the run actually did**, never
taken from the caller — this endpoint cannot be talked into stamping
`mack1993-vw` on a log-linear run.

### `GET /v1/engine` (bearer auth)

Engine identity: `{ name: "chainladder-python", version, profiles, methods,
interchange: { specVersion, generator } }`.

### `GET /v1/health` (unauthenticated)

`{ "status": "ok" }` — liveness only; discloses nothing.

## Auth, limits, privacy posture

- **Bearer auth** on `/v1/run/*` and `/v1/engine`: `Authorization: Bearer
  <SIDECAR_TOKEN>`; anything else is 401. `SIDECAR_TOKEN` is REQUIRED — the
  app factory refuses to boot without it.
- **Request-size limit**: 5 MB default (`SIDECAR_MAX_REQUEST_BYTES`),
  413 beyond, checked on both the declared content-length and the body.
- **Statelessness is a privacy feature** (spec 7/12): zero persistence — no
  files, no database, no request log with payloads. Each request is
  computed and forgotten.
- **No tenant identifiers in the wire contract.** Any key matching
  `/^(project|tenant)[_-]?id$/i` at ANY depth of the request is rejected
  with 422 (`TENANT_KEY_REJECTED`) — the agents-package tenant-lint spirit,
  applied to data. The opaque `engagementRef` is the only correlation
  identifier, passed through verbatim into the result's `extensions`.
- OpenAPI/docs endpoints are disabled (smallest possible surface).
- Compute runs serialized on the event loop: replay-warning capture uses
  the process-global `warnings` machinery, and the warnings that land in
  result documents must never interleave across requests.

## Running

Local (needs `.venv-interop` with `actuarial-interchange` installed
editable — see `interop/conformance/README.md`):

```bash
PYTHONPATH=interop SIDECAR_TOKEN=dev-secret .venv-interop/bin/python -m sidecar
# SIDECAR_HOST / SIDECAR_PORT (default 127.0.0.1:8091) optional
```

Container (the image pins exact versions — the image IS the version
contract the conformance suite runs against; build from the REPO ROOT):

```bash
docker build -f interop/sidecar/Dockerfile -t actuarial-sidecar .
docker run -e SIDECAR_TOKEN=... -p 8091:8091 actuarial-sidecar
```

## Tests

All in-process via fastapi's TestClient — no Docker, no network:

```bash
.venv-interop/bin/pytest interop/sidecar/tests -q
```

The golden runs POST the committed taylor-ashe fixtures
(`interop/conformance/fixtures/`) and hold the responses to the committed
`clpy-deterministic-cl.json` / `clpy-mack1993-vw.json` at the conformance
suite's 1e-9 semantic-freeze tolerance (envelope `createdAt` differs by
design; the response's integrity tag is re-verified against its own body).
