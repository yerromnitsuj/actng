import { describe, expectTypeOf, it } from "vitest";
import type { CompletedValidatedMetricDiagnosticsRun } from "@actuarial-ts/data";
import { createDiagnosticRunIdentity, type VerifiedDiagnosticRunProvenance } from "../src/index.js";

describe("diagnostic provenance public API",()=>{it("requires a data-owned completed run",()=>{
  expectTypeOf(createDiagnosticRunIdentity).parameter(0).toMatchTypeOf<{completedRun:CompletedValidatedMetricDiagnosticsRun}>();
  expectTypeOf(createDiagnosticRunIdentity).returns.toEqualTypeOf<Promise<VerifiedDiagnosticRunProvenance>>();
});});
