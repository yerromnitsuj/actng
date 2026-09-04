# @actuarial-ts/agents

Mastra tools and human-gated workflows for actuarial-ts. It is an orchestration boundary around the other four packages, not an autonomous actuary.

```bash
npm install @actuarial-ts/agents@0.6.0 @actuarial-ts/core@0.6.0 @actuarial-ts/data@0.6.0 @actuarial-ts/interchange@0.6.0 @actuarial-ts/compliance@0.6.0 @mastra/core@^1.51.0 @mastra/mcp@^1.14.0 zod@^3.25.76
```

Requires Node 22.13+. Peer ranges are `@mastra/core >=1.51.0 <2`, `@mastra/mcp >=1.14.0 <2`, and Zod `^3.25.76`.

## Trusted diagnostic selection

`createDiagnosticSelectionTool` lets a model choose only reviewed instance IDs, one host-approved run preset, and a display view. The host owns the authentic compiled definition, allowable instance catalog, cutoff/filter/grouping policy, tenant, data access, and executor.

```ts
import { createDiagnosticSelectionTool } from "@actuarial-ts/agents";

const tool = createDiagnosticSelectionTool({
  definition: compiledDefinition,
  presets: [{
    id: "annual-review-v1",
    definitionIntegrity: compiledDefinition.definitionIntegrity,
    allowedInstanceIds: ["casualty/count/reported-frequency"],
    execute: ({ tenant, instanceIds }) => runApprovedPreset({ tenant, instanceIds }),
  }],
});
```

The strict model input contains only:

```ts
type DiagnosticAgentToolInput = {
  runPresetId: string;
  instanceIds: string[];
  view: "emergence" | "triangles" | "latest-diagonal";
};
```

It cannot contain formulas, measures, count populations, amount/exposure bases, missingness, period axes, arbitrary filters, provenance, or project/tenant IDs. The executor must return owner-authenticated `VerifiedDiagnosticRunProvenance` stamped for the exact definition, preset, and sorted selection; a cached superset is rejected rather than display-filtered into an apparent run.

Success returns formula/calculation/definition identities, run/result/binding fingerprints, the full review receipt (including triggered and not-evaluated rules), and one explicitly display-only projection. There is no definition-editing path; changing a basis or rule requires a separate human-governed workflow.

## Tool boundary

`defineActuarialTool` enforces two shared rules. First, required tenant identity is resolved from trusted request context before the body runs; the model schema cannot express a project/tenant key. Second, every failure is a recursively readonly `{ success: false, error: { code, message } }` result rather than a thrown model-visible exception.

In 0.6 the public `DefinedActuarialTool<TInput, TOutput>` execute accepts raw `z.input`, parses exactly once, gives the body `z.output`, and returns only the body result or `ToolEnvelopeFailure`. Input/output schemas remain attached through identity-validation metadata bridges whose JSON Schema matches the private real Zod schema, so Mastra cannot run transforms twice. Invalid input is `TOOL_INPUT_INVALID`; malformed/undefined output is `TOOL_OUTPUT_INVALID`. A supplied output schema must accept and preserve the complete failure union or construction throws `BAD_OUTPUT_SCHEMA`. Failure envelopes cannot be rewritten by conditional transforms.

## Human judgment and remote engines

`createJudgmentChain` suspends at declared gates, requires a rationale on resume, records the authenticated actor identity, and writes the compliance assumption ledger. `createReservingAdvisor` assembles a constrained Mastra advisor. `defineRemoteMethod` calls an authenticated interchange sidecar with timeouts, abort support, client-side document validation, and the same tenant/failure seam. Promotion workflows replay and referee imported studies before any selection can enter a workspace.

The package’s offline test suite covers trusted catalog selection, direct/Mastra-shaped execution, tenant failure, once-only transforms, provenance coherence, judgment gates, remote sidecar behavior, promotion, and golden-prompt tool selection.

See the [formula catalog](https://github.com/yerromnitsuj/actng/blob/v0.6.0/docs/reference/diagnostic-formulas.md) and [migration guide](https://github.com/yerromnitsuj/actng/blob/v0.6.0/docs/migrations/0.6-generalized-diagnostics.md).

## License

Apache-2.0. See LICENSE and NOTICE.
