# Security Policy

## Supported versions

The actuarial-ts packages are pre-1.0 and version in lockstep. Only the latest
minor receives fixes.

| Version | Supported |
|---------|-----------|
| 0.2.x   | Yes |
| 0.1.x   | No — upgrade to 0.2.x |

## Reporting a vulnerability

**Please do not open a public issue.**

Report privately through GitHub:
[**Report a vulnerability**](https://github.com/yerromnitsuj/actng/security/advisories/new)
(Security → Advisories → Report a vulnerability). That channel is private to
the maintainers and lets us coordinate a fix and an advisory with you.

This is a small project, not a vendor with an on-call rota — expect a
best-effort response within about a week. There is no bug bounty.

Useful things to include: what an attacker gains, the affected package and
version, and a minimal reproduction.

## What is in scope

The published packages and the code in this repository:

- **`@actuarial-ts/agents`** — the highest-value surface. The tenant seam is a
  security boundary: the tenant/project id is always read from the server-set
  request context and is rejected at definition time if a tool's input schema
  declares one, so a model cannot supply it. A way to smuggle a tenant id past
  that lint, or to reach another tenant's data, is a vulnerability.
- **The MCP seam** (`packages/agents/src/mcp.ts`) — `requireMcpTenant` and
  `assertFailClosed`. A host exposing a workspace over MCP restricts itself to
  an allowlist (read tools plus staged writes, no directly resolvable mutation
  tool), but that allowlist is only as strong as this seam: it must fail closed
  when no tenant is present. A way to authenticate without a tenant, or to make
  the seam fail open, is a vulnerability here even though the MCP server itself
  lives in the consuming application.
- **The compute sidecar** (`interop/sidecar/`) — bearer auth, request size and
  depth limits, no persistence. Auth bypass or resource exhaustion is in scope.
- **Integrity and provenance** — a way to make a document with a *valid*
  integrity tag misrepresent what produced it, to forge a referee verdict, or
  to bypass a promotion gate, is a vulnerability. The audit trail is a security
  property of this project, not just a feature.
- **Untrusted input handling** — parsing an interchange document, triangle or
  loss run should never execute code or escape its sandbox.

## What is not in scope

- **Numerical or actuarial disagreement.** A method returning a number you
  believe is wrong is a correctness bug — please open a normal issue, ideally
  citing the primary source. Important, but not a security report.
- **The ActNG reserving workbench**, which now lives in its own repository.
  Report issues there.
- Vulnerabilities in dependencies with no exploitable path here — report those
  upstream.

## A note on scope of trust

This software is designed to support the actuary's compliance with the
applicable ASOPs. It does not constitute, certify, or guarantee compliance, and
it is not a substitute for the actuary's own review. Nothing in this policy
implies a warranty; see [LICENSE](LICENSE).
