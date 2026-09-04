import { describe, expectTypeOf, it } from "vitest";
import type { CompiledDiagnosticDefinition } from "@actuarial-ts/core";
import {
  diagnosticDefinitionToDoc,
  docToDiagnosticDefinition,
  type DiagnosticDefinitionDoc,
  type DiagnosticDefinitionIdentitySet,
  type DocToDiagnosticDefinitionResult,
  type InterchangeDocument,
} from "../src/index.js";

describe("diagnostic-definition public API", () => {
  it("publishes the intentional converter signatures and document union", () => {
    expectTypeOf(diagnosticDefinitionToDoc)
      .parameter(0)
      .toEqualTypeOf<CompiledDiagnosticDefinition>();
    expectTypeOf(
      diagnosticDefinitionToDoc,
    ).returns.toEqualTypeOf<DiagnosticDefinitionDoc>();
    expectTypeOf(
      docToDiagnosticDefinition,
    ).returns.toEqualTypeOf<DocToDiagnosticDefinitionResult>();
    expectTypeOf<DiagnosticDefinitionIdentitySet>().toEqualTypeOf<{
      algorithm: "fnv1a64-jcs-v1";
      formulaById: Readonly<Record<string, string>>;
      calculationByInstanceId: Readonly<Record<string, string>>;
      definition: string;
    }>();
    expectTypeOf<DiagnosticDefinitionDoc>().toMatchTypeOf<InterchangeDocument>();
  });
});
