# Interop Phase A: The Spine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The interchange format made real: spec section 3 as code on both shores, with the referee and the conformance proof. The AUTHORITY for every shape and rule is `docs/superpowers/specs/2026-07-17-actuarial-interchange-design.md` (rev 2) sections 3, 4.1, 4.2, 5, 10, and 13's Phase A acceptance criteria — this plan sequences, it does not restate.

**Architecture:** Readability-first organization (founder mandate): one module per document kind on the TS side (`schemas/`, `convert/`, `referee/` folders, no god-files); the Python package mirrors that layout (`documents.py`, `jcs.py`, `bridge_triangle.py`, `bridge_selection.py`, `bridge_result.py`) so a human can hold each file in one read. Python dev env: `.venv-interop/` (Python 3.12, chainladder 0.9.2 pinned — gitignored; CI uses the same pins).

**Tech stack additions:** zod (interchange runtime dep), zod-to-json-schema (devDep, emission only), Python 3.12 venv with chainladder==0.9.2, pandas, pytest.

## Global Constraints

(Master plan Global Constraints apply, plus:)
- Spec rev 2 is normative. Where code and spec disagree, STOP and reconcile the spec first (a one-line spec PR beats a silent divergence).
- Relocation must be behavior-identical: compliance's golden disclosure snapshot and ALL bundle tests must pass unchanged, plus a new fixture proving a v0.1.0-era bundle still verifies.
- Interchange TS package: no dependency other than @actuarial-ts/core + zod.
- Python package: stdlib + vendored JCS only in core; chainladder/pandas only behind the [chainladder] extra.

---

### Task 1 (inline): canonicalJson/fnv1a64 relocation + JCS vectors
Move both functions to `packages/core/src/canonical.ts` (new module, exported from the barrel); compliance re-exports from core (its `bundle.ts` imports core's). JCS vector suite: `schema/interchange/1.0/jcs-vectors.json` (committed; covers integers, negative zero, decimals, exponent forms, unicode keys, nested sorting) + a core test asserting canonicalJson reproduces every vector byte-for-byte. Bundle-compat fixture: a checked-in v0.1.0-produced bundle payload + test that verifyBundle still passes post-relocation. Gate: full workspace suite green.

### Task 2 (agent): @actuarial-ts/interchange package
Per spec 3.x + 4.1 + 5 exactly. Layout: `src/envelope.ts`, `src/schemas/{triangle,selection,result,study,bundle,crosscheck}.ts`, `src/convert/{triangle,selection,result}.ts`, `src/referee/{profiles,crosscheck}.ts`, `src/errors.ts` (registry additions go in core types), `src/index.ts`. Coherence rule enforced in `convert/selection` both directions. `scripts/emit-schema.ts` writes `schema/interchange/1.0/*.json`; a vitest asserts emitted-vs-committed equality (the CI drift check). Tests: schema round-trips, coherence accept/warn/refuse, referee agree/disagree/not-comparable/verified-by-value on hand-built docs, integrity-tag envelope-exclusion, version handling.

### Task 3 (agent): actuarial-interchange Python package
`interop/python/actuarial_interchange/` per spec 4.2 exactly, mirrored module layout, vendored `_jcs.py` (must pass the committed vector suite — a pytest reads the same JSON file), dataclass documents, chainladder bridges (to_frame-based, never to_json; native Development replay for computable intents; DevelopmentConstant for value-only; SE-less rule), `pyproject.toml` with the [chainladder] extra. pytest suite incl. null-preservation and version-rejection.

### Task 4 (agents + me): conformance + convention map
`interop/conformance/`: fixture JSONs for Taylor/Ashe, RAA, Mack mortgage (generated FROM core's test fixtures via a script, not re-transcribed); TS runner (vitest) asserting both profiles' expectations; Python runner (pytest) doing the same through chainladder; a cross-hop integrity test (TS export → Python round-trip → TS re-import, tag identical, nulls preserved). `docs/interop/convention-map.md` — the equivalence table + R parameterization note rendered as the standalone practitioner doc. Geometric intent: conformance-prove or demote (spec acceptance 5).

### Task 5: review + gate + /ship
3-lens adversarial review (spec-compliance, math/convention grounding, code quality/readability), fix, cold start (all suites incl. pytest), CI green, master log, /ship.
