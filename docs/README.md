# Documentation index

Start with the [package overview and workflow chooser](../README.md#choose-a-workflow).
SDK 0.7.0 added compact evidence and replay without replacing the eager APIs or
the generalized definition model. Read the adoption guide for executable usage;
the dated implementation records below remain historical evidence.

| Where | What |
|---|---|
| [`migrations/0.7-compact-diagnostics.md`](migrations/0.7-compact-diagnostics.md) | Current compact adoption guide: executable validated runs, eager/compact distinctions, maturity selection, review/source pages, artifact evidence, and replay. |
| [`reference/diagnostic-replay-stream.md`](reference/diagnostic-replay-stream.md) | Complete `diagnostic-replay/1` host workflow and framing contract, explicit resource limits, cancellation, evidence ownership, assurance boundaries, and SDK-version requirements. Separate from interchange wire `1.1.0`. |
| [`superpowers/specs/2026-09-03-generalized-diagnostics-sdk.md`](superpowers/specs/2026-09-03-generalized-diagnostics-sdk.md) | **Shipped in `0.6.0` and corrected in `0.6.1`; retained as the base diagnostics contract alongside the additive compact guides above**: formula templates, bound instances, structured populations/bases, claim derivations, mixed-cadence periods, declarative rules, definition/run/result identities, and typed interchange. |
| [`superpowers/plans/2026-09-03-generalized-diagnostics-sdk.md`](superpowers/plans/2026-09-03-generalized-diagnostics-sdk.md) | **Completed through Task 20 and retained as a historical implementation record.** The plan records delivery and publication across all five packages, three interchange shores, the real-world example, documentation, packaging, and release gates. |
| [`superpowers/plans/2026-09-04-v0.6.1-full-sdk-hardening.md`](superpowers/plans/2026-09-04-v0.6.1-full-sdk-hardening.md) | **Implemented `0.6.1` hardening record:** adversarial boundary audit, reconciliation inventory, exact source anchors, three-shore diagnostic corpus, and attested non-bypassable release gate. |
| [`reference/diagnostic-formulas.md`](reference/diagnostic-formulas.md) | Generated six-template and casualty-instance reference; drift-checked against the public core API. |
| [`migrations/0.6-generalized-diagnostics.md`](migrations/0.6-generalized-diagnostics.md) | Breaking 0.5 → 0.6 diagnostics migration, runtime floors, provenance, interchange, and agent boundary. |
| [`spec/actuarial-interchange.md`](spec/actuarial-interchange.md) | **The normative interchange specification** (rev 2.4): document kinds, wire 1.1 diagnostics, integrity, convention profiles, and referees. |
| [`interop/convention-map.md`](interop/convention-map.md) | Practitioner's translation table across actuarial-ts / chainladder-python / R ChainLadder. Informative, not normative. |
| [`interop/reproducibility.md`](interop/reproducibility.md) | The three reproducibility classes, the measured chainladder non-determinism behind them, and the self-witnessing sidecar. |
| [`interop/mcp-notebook-recipe.md`](interop/mcp-notebook-recipe.md) | Connecting a notebook to a governed workspace over MCP. |
| [`interop/upstream/`](interop/upstream/) | Drafts for upstream contributions (chainladder-python, R ChainLadder). **Founder-reviewed before sending; nothing is auto-posted.** |
| [`research/`](research/) | Primary-source transcriptions behind the published-value test fixtures. |
| [`superpowers/`](superpowers/) | Dated specs and phase-by-phase build plans. Treat them as historical records unless the index explicitly identifies one as the implemented release-candidate design. |
| [`../VERSIONING.md`](../VERSIONING.md) | How the five packages and the wire format version. |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Setup (all three shores) and the four load-bearing rules. |
| [`../SECURITY.md`](../SECURITY.md) | Scope and private reporting. |
