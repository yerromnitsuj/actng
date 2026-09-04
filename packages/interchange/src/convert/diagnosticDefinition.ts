import {
  ReservingError,
  assertCompiledDiagnosticDefinition,
  canonicalJson,
  compileDiagnosticDefinition,
  type CompiledDiagnosticDefinition,
} from "@actuarial-ts/core";
import {
  DEFAULT_GENERATOR,
  INTERCHANGE_SPEC_VERSION,
  stampIntegrity,
  type GeneratorStamp,
} from "../envelope.js";
import { parseDocument, type ParseDocumentOptions } from "../parse.js";
import {
  diagnosticDefinitionDocSchema,
  type DiagnosticDefinitionDoc,
} from "../schemas/diagnosticDefinition.js";

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
  const candidate = stampIntegrity<DiagnosticDefinitionDoc>({
    interchangeVersion: INTERCHANGE_SPEC_VERSION,
    kind: "diagnostic-definition",
    generator: { ...(options.generator ?? DEFAULT_GENERATOR) },
    createdAt: options.createdAt,
    ...(options.extensions === undefined
      ? {}
      : { extensions: structuredClone(options.extensions) }),
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
  const parsed = diagnosticDefinitionDocSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? ` at $.${issue.path.join(".")}` : "";
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `Invalid diagnostic-definition document${path}: ${issue?.message ?? "schema validation failed"}`,
    );
  }
  return deepFreeze(parsed.data);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>))
      deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function sameRecord(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && left[key] === right[key],
    )
  );
}

export function docToDiagnosticDefinition(
  value: unknown,
  options?: ParseDocumentOptions,
): { definition: CompiledDiagnosticDefinition; warnings: readonly string[] } {
  const parsed = parseDocument(value, options);
  if (parsed.doc.kind !== "diagnostic-definition") {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `Expected kind "diagnostic-definition"; got kind "${parsed.doc.kind}"`,
    );
  }
  const body = parsed.doc.diagnosticDefinition;
  let compiled: CompiledDiagnosticDefinition;
  try {
    compiled = compileDiagnosticDefinition(body.definition);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `Diagnostic definition contains unsupported executable vocabulary: ${message}`,
    );
  }
  if (canonicalJson(body.definition) !== canonicalJson(compiled.definition)) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      "Diagnostic definition contains unsupported executable vocabulary or is not in normalized form",
    );
  }
  const identities = body.identities;
  if (
    identities.algorithm !== "fnv1a64-jcs-v1" ||
    identities.definition !== compiled.definitionIntegrity ||
    !sameRecord(identities.formulaById, compiled.formulaFingerprints) ||
    !sameRecord(
      identities.calculationByInstanceId,
      compiled.calculationFingerprints,
    )
  ) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      "Diagnostic definition identities do not match the compiled semantic definition",
    );
  }
  return { definition: compiled, warnings: parsed.warnings };
}
