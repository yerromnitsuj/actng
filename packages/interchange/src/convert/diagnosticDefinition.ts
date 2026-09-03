import {
  ReservingError,
  assertCompiledDiagnosticDefinition,
  compileDiagnosticDefinition,
  type CompiledDiagnosticDefinition,
} from "@actuarial-ts/core";
import { DEFAULT_GENERATOR, INTERCHANGE_SPEC_VERSION, stampIntegrity, type GeneratorStamp } from "../envelope.js";
import { parseDocument, type ParseDocumentOptions } from "../parse.js";
import type { DiagnosticDefinitionDoc } from "../schemas/diagnosticDefinition.js";

export interface DiagnosticDefinitionToDocOptions {
  createdAt: string;
  generator?: GeneratorStamp;
  extensions?: Record<string, unknown>;
}

export function diagnosticDefinitionToDoc(
  compiled: CompiledDiagnosticDefinition,
  options: DiagnosticDefinitionToDocOptions,
): DiagnosticDefinitionDoc {
  assertCompiledDiagnosticDefinition(compiled);
  return stampIntegrity<DiagnosticDefinitionDoc>({
    interchangeVersion: INTERCHANGE_SPEC_VERSION,
    kind: "diagnostic-definition",
    generator: options.generator ?? DEFAULT_GENERATOR,
    createdAt: options.createdAt,
    ...(options.extensions === undefined ? {} : { extensions: options.extensions }),
    diagnosticDefinition: {
      definition: compiled.definition,
      identities: {
        algorithm: "fnv1a64-jcs-v1",
        formulaById: { ...compiled.formulaFingerprints },
        calculationByInstanceId: { ...compiled.calculationFingerprints },
        definition: compiled.definitionIntegrity,
      },
    },
  });
}

function sameRecord(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
    key === rightKeys[index] && left[key] === right[key],
  );
}

export function docToDiagnosticDefinition(
  value: unknown,
  options?: ParseDocumentOptions,
): { definition: CompiledDiagnosticDefinition; warnings: readonly string[] } {
  const parsed = parseDocument(value, options);
  if (parsed.doc.kind !== "diagnostic-definition") {
    throw new ReservingError("BAD_INTERCHANGE", `Expected kind "diagnostic-definition"; got kind "${parsed.doc.kind}"`);
  }
  const body = parsed.doc.diagnosticDefinition;
  const compiled = compileDiagnosticDefinition(body.definition);
  const identities = body.identities;
  if (
    identities.algorithm !== "fnv1a64-jcs-v1" ||
    identities.definition !== compiled.definitionIntegrity ||
    !sameRecord(identities.formulaById, compiled.formulaFingerprints) ||
    !sameRecord(identities.calculationByInstanceId, compiled.calculationFingerprints)
  ) {
    throw new ReservingError("BAD_INTERCHANGE", "Diagnostic definition identities do not match the compiled semantic definition");
  }
  return { definition: compiled, warnings: parsed.warnings };
}
