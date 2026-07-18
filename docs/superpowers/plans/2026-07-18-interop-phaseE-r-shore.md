# Interop Phase E: The R Shore + Upstream + Final Ship — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The third shore (R ChainLadder) as interchange recipes with the alpha/delta and est.sigma honesty the research demands; upstream overture drafts; and the final whole-interop adversarial review + ship. Spec authority: rev 2.1 sections 4.3, 5 (R profile alignment), 11, 13 Phase E acceptance.

**R availability:** Rscript is NOT installed on this machine (verified Phase-A-era). Two honest paths, decided at execution: (a) if `brew install r` succeeds in reasonable time, install the ChainLadder package and run the recipes for real; (b) if R cannot be installed, deliver the recipes + a self-contained conformance script that is DOCUMENTED as unrun-here with the exact commands to run it where R exists, and pin the expected values from the committed conformance fixtures (the TS/clpy mack1993-vw results the R side must reproduce). STATE which path was taken in the report; do NOT fabricate R output.

## Global Constraints
(Master + spec rev 2.1. The R alpha/delta trap is NORMATIVE — 1=VW, 0=simple, 2=regression, NOT delta. est.sigma auto-fallback must be recorded as effectiveParameters. CLFMdelta foundSolution honesty. jsonlite does not emit JCS numbers — the provided serializer is real work.)

### Task E1: R interchange recipes (tools/interop/)
tools/interop/actuarialInterchange.R: a self-contained R source file (sourced, not a package yet) providing:
- `ats_canonical_json(x)` + `ats_fnv1a64(s)`: the JCS serializer + hash, reproducing EVERY committed schema/interchange/1.0/jcs-vectors.json vector byte-for-byte (jsonlite gets structure but NOT the ECMAScript number layout — implement the number formatting explicitly: shortest round-trip via format(x, digits=17) then the ES Number::toString layout rules; UTF-16 key sort; -0 -> "0"; exponent boundaries 1e21/1e-7). A test harness `ats_test_jcs()` reads the vectors JSON and asserts each.
- `ats_triangle_to_matrix(doc)` / `ats_matrix_to_triangle_doc(m, measure, originLengthMonths, origins_start, ...)`: TriangleDoc <-> R matrix with dimnames + explicit start dates; null (NA) preservation both ways; the integrity tag over the semantic body.
- `ats_selection_to_delta(triangle, selection_doc)`: CLFMdelta-based injection returning per-period delta AND the foundSolution flags; a failed injection surfaces as a documented not-comparable warning in the result, never silent.
- `ats_extract_mack_result(MackChainLadder_fit, triangle_doc, selection_doc_or_null)`: MackChainLadder components (f, sigma, Mack.S.E, Total.Mack.S.E) -> MethodResultDoc with engine stamp {name: "R ChainLadder", version}, method "rcl:MackChainLadder", appliesTo tags, and effectiveParameters recording the est.sigma the fit ACTUALLY used (MackChainLadder's log-linear->Mack auto-fallback on p>0.05 — detect and record).
- `ats_write_document(doc, path)` / `ats_read_document(path)`: envelope assembly + version acceptance.

### Task E2: R conformance script
tools/interop/conformance.R: for each committed conformance fixture (taylor-ashe, raa, mortgage), reads the committed triangle.json, runs MackChainLadder(alpha=1, est.sigma="Mack"), extracts the result doc, and compares against the committed mack1993-vw.json / expectations.json at the profile tolerances (central 1e-6, SE 0.5% relative). Prints a verdict table. If R is available: RUN IT, include the output. If not: the script is complete + documented-unrun with the run command.

### Task E3: upstream overture drafts (docs/interop/upstream/)
- chainladder-python-proposal.md: a GitHub-issue-ready draft proposing native interchange read/write (their to_json/read_json precedent + issue #474 dataframe-interchange appetite as the hook); scoped, respectful, complementary-not-competitive framing; links the spec + conformance evidence.
- r-chainladder-note.md: a shorter note for the R maintainer on the recipes + the est.sigma/CLFMdelta honesty findings.
- Neither is SENT (founder action); they are drafts committed for the founder to review/send.

### Task E4: spec 1.1 field lessons
Amend the spec to rev 2.2 (or a 1.1 spec-version note section) capturing what the A-E build actually taught: the empirical findings already folded in (geometric value-only, zero-vs-sparse hazard, crosscheck body key), plus any E-phase discoveries (R number-format gotchas, est.sigma fallback recording as a first-class MethodResultDoc field — confirm effectiveParameters covers it). Keep it a changelog-style addendum, not a rewrite.

### Task E5: THE FINAL WHOLE-INTEROP REVIEW + SHIP
A whole-body adversarial review across ALL of interop (A-E): the format contract holding across three shores, the governance flows, the sidecar, the MCP layer, the R recipes; docs completeness (every package/recipe README, the convention map, the spec, CHANGELOG); the CHANGELOG Unreleased->0.2.0 readiness; a from-scratch cold start of the ENTIRE workspace (rm node_modules + dist, npm install, npm test, npm run test:py, npm run crosscheck:ci against a booted sidecar, both CI workflows). Fix everything that survives. Then: master log final entry, CHANGELOG finalized, and the FINAL /ship of the entire interop body of work. (Publishing 0.2.0 to npm remains the founder's manual step per docs/publishing.md — note it, do not attempt.)
