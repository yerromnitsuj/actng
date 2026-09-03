import { compileDiagnosticDefinition, type CompiledDiagnosticDefinition, type DiagnosticDefinition } from "@actuarial-ts/core";

/** Validates unknown authored definition data through core's single semantic compiler. */
export function validateDiagnosticDefinition(value: unknown): CompiledDiagnosticDefinition {
  return compileDiagnosticDefinition(value as DiagnosticDefinition);
}
