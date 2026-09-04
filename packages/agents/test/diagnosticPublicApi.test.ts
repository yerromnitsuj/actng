import { expectTypeOf, test } from "vitest";
import type {
  DiagnosticAgentToolInput,
  DiagnosticAgentToolResult,
  DiagnosticAgentView,
  DiagnosticAgentPresetExecutionInput,
  DiagnosticSelectionTool,
  DefinedActuarialTool,
  ToolEnvelopeFailure,
} from "../src/index.js";

test("diagnostic agent public execute is the exact SDK success/failure boundary", () => {
  expectTypeOf<DiagnosticAgentToolInput>().toEqualTypeOf<{
    readonly runPresetId: string;
    readonly instanceIds: readonly string[];
    readonly view: DiagnosticAgentView;
  }>();
  expectTypeOf<DiagnosticAgentPresetExecutionInput>().toEqualTypeOf<{
    readonly tenantId: string;
    readonly instanceIds: readonly string[];
  }>();
  expectTypeOf<DiagnosticSelectionTool>().toMatchTypeOf<
    DefinedActuarialTool<DiagnosticAgentToolInput, DiagnosticAgentToolResult>
  >();
  expectTypeOf<
    Awaited<ReturnType<DiagnosticSelectionTool["execute"]>>
  >().toEqualTypeOf<DiagnosticAgentToolResult>();
  expectTypeOf<ToolEnvelopeFailure>().toMatchTypeOf<{
    readonly success: false;
    readonly error: { readonly code: string; readonly message: string };
  }>();
});
