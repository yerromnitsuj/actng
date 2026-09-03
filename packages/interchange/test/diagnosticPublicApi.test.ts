import { describe, expectTypeOf, it } from "vitest";
import type { CompiledDiagnosticDefinition } from "@actuarial-ts/core";
import {
  diagnosticDefinitionToDoc,
  docToDiagnosticDefinition,
  type DiagnosticDefinitionDoc,
  type InterchangeDocument,
} from "../src/index.js";

describe("diagnostic-definition public API", () => {
  it("publishes the intentional converter signatures and document union", () => {
    expectTypeOf(diagnosticDefinitionToDoc).parameter(0).toEqualTypeOf<CompiledDiagnosticDefinition>();
    expectTypeOf(diagnosticDefinitionToDoc).returns.toEqualTypeOf<DiagnosticDefinitionDoc>();
    expectTypeOf(docToDiagnosticDefinition).returns.toEqualTypeOf<{
      definition: CompiledDiagnosticDefinition;
      warnings: readonly string[];
    }>();
    expectTypeOf<DiagnosticDefinitionDoc>().toMatchTypeOf<InterchangeDocument>();
  });
});
