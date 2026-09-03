import type { NormalizedDiagnosticDefinitionIdentity } from "@actuarial-ts/core";
import { z } from "zod";
import { envelopeShape, type GeneratorStamp } from "../envelope.js";

const token = z.string().min(1);
const finite = z.number().finite();
const nullableToken = token.nullable();
const attributes = z.record(z.union([z.string(), finite, z.boolean(), z.null()]));
const tolerance = z.object({ absolute: finite.nonnegative(), relative: finite.nonnegative() }).strict();

export const diagnosticMeasureExpressionSchema: z.ZodTypeAny = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("measure"), measureId: token }).strict(),
    z.object({ op: z.literal("add"), terms: z.array(diagnosticMeasureExpressionSchema).min(1) }).strict(),
    z.object({ op: z.literal("subtract"), left: diagnosticMeasureExpressionSchema, right: diagnosticMeasureExpressionSchema }).strict(),
  ]),
);

export const diagnosticClaimExpressionSchema: z.ZodTypeAny = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("measure"), measureId: token }).strict(),
    z.object({ op: z.literal("add"), terms: z.array(diagnosticClaimExpressionSchema).min(1) }).strict(),
    z.object({ op: z.literal("subtract"), left: diagnosticClaimExpressionSchema, right: diagnosticClaimExpressionSchema }).strict(),
    z.object({ op: z.literal("claim-layer"), measureId: token, attachment: finite.nonnegative(), limit: finite.positive().nullable() }).strict(),
  ]),
);

export const diagnosticRoleExpressionSchema: z.ZodTypeAny = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("role"), role: token }).strict(),
    z.object({ op: z.literal("add"), terms: z.array(diagnosticRoleExpressionSchema).min(1) }).strict(),
    z.object({ op: z.literal("subtract"), left: diagnosticRoleExpressionSchema, right: diagnosticRoleExpressionSchema }).strict(),
  ]),
);

const limitation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unlimited") }).strict(),
  z.object({ kind: z.literal("unknown"), description: z.string().nullable() }).strict(),
  z.object({
    kind: z.enum(["layer", "pre-limited"]),
    attachment: finite.nonnegative(),
    limit: finite.positive().nullable(),
    application: z.enum(["claim", "occurrence", "policy", "source-defined"]),
    derivation: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("sdk") }).strict(),
      z.object({ kind: z.literal("external"), actor: z.enum(["caller", "source"]), transformationRef: token }).strict(),
    ]),
  }).strict(),
]);

const ruleOperand = z.discriminatedUnion("source", [
  z.object({ source: z.literal("measure"), expression: diagnosticMeasureExpressionSchema }).strict(),
  z.object({ source: z.literal("calculation"), field: z.enum(["numerator", "denominator"]) }).strict(),
  z.object({ source: z.literal("constant"), value: finite }).strict(),
]);
const operator = z.enum(["lt", "lte", "eq", "neq", "gte", "gt"]);
const reviewOperand = z.union([
  diagnosticMeasureExpressionSchema,
  z.object({ op: z.literal("constant"), value: finite }).strict(),
]);
const reviewBase = {
  id: token,
  code: token,
  description: z.string(),
  severity: z.enum(["warning", "fail"]),
  missingInput: z.enum(["not-evaluated", "finding"]),
  tolerance,
};
const reviewFilter = z.object({
  sourceGroups: z.array(token).nullable(), origins: z.array(token).nullable(),
  originFrom: nullableToken, originThrough: nullableToken, valuations: z.array(token).nullable(),
  valuationFrom: nullableToken, valuationThrough: nullableToken,
  minDevelopmentAge: finite.nullable(), maxDevelopmentAge: finite.nullable(),
}).strict();
const reviewRule = z.discriminatedUnion("kind", [
  z.object({ ...reviewBase, kind: z.literal("compare"), when: z.object({ left: reviewOperand, operator, right: reviewOperand }).strict() }).strict(),
  z.object({ ...reviewBase, kind: z.literal("reconcile"), actual: diagnosticMeasureExpressionSchema, expected: reviewOperand }).strict(),
  z.object({ ...reviewBase, kind: z.literal("monotonic"), expression: diagnosticMeasureExpressionSchema, direction: z.enum(["nondecreasing", "nonincreasing"]) }).strict(),
  z.object({ ...reviewBase, kind: z.literal("layer-order"), narrower: diagnosticMeasureExpressionSchema, broader: diagnosticMeasureExpressionSchema, comparability: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("compiler-proven") }).strict(),
    z.object({ kind: z.literal("caller-asserted"), rationaleArtifactId: token }).strict(),
  ]) }).strict(),
  z.object({ ...reviewBase, kind: z.literal("control-total"), expression: diagnosticMeasureExpressionSchema, expected: finite, filter: reviewFilter.nullable(), projection: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("valuation"), valuation: token }).strict(),
    z.object({ kind: z.literal("latest-valuation-per-origin") }).strict(),
    z.object({ kind: z.literal("all-cells") }).strict(),
  ]) }).strict(),
]);

const periodAxis = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("calendar"), originCadence: z.enum(["month", "quarter", "year"]),
    valuationCadence: z.enum(["month", "quarter", "year"]), originAnchor: z.enum(["start", "end"]),
    valuationAnchor: z.enum(["start", "end"]), ageUnit: z.literal("month"), ageOffset: finite,
  }).strict(),
  z.object({
    kind: z.literal("ordered"), id: token, version: token, ageUnit: token, ageOffset: finite,
    origins: z.array(z.object({ label: token, aliases: z.array(token), coordinate: finite }).strict()),
    valuations: z.array(z.object({ label: token, aliases: z.array(token), coordinate: finite }).strict()),
  }).strict(),
]);

/** Closed schema for the normalized, executable diagnostic vocabulary. */
export const normalizedDiagnosticDefinitionSchema = z.object({
  diagnosticDefinitionVersion: z.literal("1.0.0"), id: token, version: token,
  lossRowGrain: z.enum(["claim", "aggregate"]),
  measures: z.array(z.object({
    id: token, displayName: z.string(), description: z.string(), source: z.enum(["loss", "exposure", "derived"]),
    kind: z.enum(["count", "amount", "exposure"]), unit: token,
    developmentSemantics: z.enum(["cumulative", "incremental", "point-in-time", "unknown"]),
    aggregation: z.literal("sum"), missing: z.enum(["unknown", "zero"]), basisId: nullableToken,
    countPopulationId: nullableToken, exposureBasisId: nullableToken,
    exposureTiming: z.enum(["origin-static", "valuation-specific"]).nullable(),
  }).strict()),
  countPopulations: z.array(z.object({ id: token, displayName: z.string(), subject: z.enum(["claim", "claimant", "policy", "occurrence", "other", "unknown"]), unit: token, description: z.string(), attributes }).strict()),
  exposureBases: z.array(z.object({ id: token, displayName: z.string(), basis: z.enum(["earned", "written", "in-force", "other", "unknown"]), unit: token, description: z.string(), sourceDescription: z.string().nullable(), attributes }).strict()),
  amountBases: z.array(z.object({ id: token, displayName: z.string(), currency: token, perspective: z.enum(["gross", "net", "ceded", "other", "unknown"]), components: z.array(z.object({ id: token, treatment: z.enum(["included", "excluded", "unknown"]), limitation }).strict()), sourceDescription: z.string().nullable(), attributes }).strict()),
  derivedMeasures: z.array(z.object({ id: token, outputMeasureId: token, expression: diagnosticClaimExpressionSchema }).strict()),
  formulas: z.array(z.object({
    id: token, version: token,
    roles: z.record(z.object({ kind: z.enum(["count", "amount", "exposure"]), compatibilityGroup: nullableToken, developmentSemantics: z.enum(["cumulative", "incremental", "point-in-time", "unknown"]).nullable() }).strict()),
    numerator: diagnosticRoleExpressionSchema, denominator: diagnosticRoleExpressionSchema,
    denominatorPolicy: z.literal("positive-or-null"),
  }).strict()),
  instances: z.array(z.object({
    id: token, version: token, formulaId: token, bindings: z.record(diagnosticMeasureExpressionSchema),
    presentation: z.object({ displayName: z.string(), description: z.string(), displayUnit: token, scale: finite.positive(), numeratorLabel: z.string(), denominatorLabel: z.string() }).strict(),
    rules: z.array(z.object({ id: token, code: token, message: z.string(), severity: z.enum(["warning", "fail"]), when: z.object({ left: ruleOperand, operator, right: ruleOperand, tolerance }).strict() }).strict()),
  }).strict()),
  reviewRules: z.array(reviewRule), periodAxis,
}).strict();

export interface DiagnosticDefinitionIdentities {
  algorithm: "fnv1a64-jcs-v1";
  formulaById: Record<string, string>;
  calculationByInstanceId: Record<string, string>;
  definition: string;
}

export interface DiagnosticDefinitionBody {
  definition: NormalizedDiagnosticDefinitionIdentity;
  identities: DiagnosticDefinitionIdentities;
}

export interface DiagnosticDefinitionDoc {
  interchangeVersion: string;
  kind: "diagnostic-definition";
  generator: GeneratorStamp & { [key: string]: unknown };
  createdAt: string;
  extensions?: Record<string, unknown>;
  integrity: string;
  diagnosticDefinition: DiagnosticDefinitionBody;
  [key: string]: unknown;
}

const identityTag = z.string().regex(/^fnv1a64-jcs-v1:[0-9a-f]{16}$/);
export const diagnosticDefinitionBodySchema: z.ZodType<DiagnosticDefinitionBody> = z.object({
  definition: normalizedDiagnosticDefinitionSchema as z.ZodType<NormalizedDiagnosticDefinitionIdentity>,
  identities: z.object({
    algorithm: z.literal("fnv1a64-jcs-v1"), formulaById: z.record(identityTag),
    calculationByInstanceId: z.record(identityTag), definition: identityTag,
  }).strict(),
}).strict();

export const diagnosticDefinitionDocSchema: z.ZodType<DiagnosticDefinitionDoc> = z.object({
  ...envelopeShape("diagnostic-definition"), diagnosticDefinition: diagnosticDefinitionBodySchema,
}).passthrough();
