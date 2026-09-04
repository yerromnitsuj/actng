import { expectTypeOf, test } from "vitest";
import type {
  DiagnosticAgentToolInput,
  DiagnosticAgentToolResult,
  DiagnosticSelectionTool,
  DefinedActuarialTool,
  ToolEnvelopeFailure,
} from "../src/index.js";

test("diagnostic agent public execute is the exact SDK success/failure boundary", () => {
  expectTypeOf<DiagnosticAgentToolInput>().toEqualTypeOf<{
    runPresetId: string;
    instanceIds: string[];
    view: "emergence" | "triangles" | "latest-diagonal";
  }>();
  expectTypeOf<DiagnosticSelectionTool>().toMatchTypeOf<DefinedActuarialTool<DiagnosticAgentToolInput, DiagnosticAgentToolResult>>();
  expectTypeOf<Awaited<ReturnType<DiagnosticSelectionTool["execute"]>>>().toEqualTypeOf<DiagnosticAgentToolResult>();
  expectTypeOf<ToolEnvelopeFailure>().toMatchTypeOf<{ readonly success: false; readonly error: { readonly code: string; readonly message: string } }>();
});
