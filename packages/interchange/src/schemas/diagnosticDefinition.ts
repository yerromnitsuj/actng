import type { NormalizedDiagnosticDefinitionIdentity } from "@actuarial-ts/core";
import { z } from "zod";
import { envelopeShape, type GeneratorStamp } from "../envelope.js";
import { recordSchema } from "./record.js";

const token = z.string().min(1);
const finite = z.number().finite();
const nullableToken = token.nullable();
const attributes = recordSchema(z.union([z.string(), finite, z.boolean(), z.null()]));
const tolerance = z.object({ absolute: finite.nonnegative(), relative: finite.nonnegative() }).passthrough();

export const diagnosticMeasureExpressionSchema: z.ZodTypeAny = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("measure"), measureId: token }).passthrough(),
    z.object({ op: z.literal("add"), terms: z.array(diagnosticMeasureExpressionSchema).min(1) }).passthrough(),
    z.object({ op: z.literal("subtract"), left: diagnosticMeasureExpressionSchema, right: diagnosticMeasureExpressionSchema }).passthrough(),
  ]),
);

export const diagnosticClaimExpressionSchema: z.ZodTypeAny = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("measure"), measureId: token }).passthrough(),
    z.object({ op: z.literal("add"), terms: z.array(diagnosticClaimExpressionSchema).min(1) }).passthrough(),
    z.object({ op: z.literal("subtract"), left: diagnosticClaimExpressionSchema, right: diagnosticClaimExpressionSchema }).passthrough(),
    z.object({ op: z.literal("claim-layer"), measureId: token, attachment: finite.nonnegative(), limit: finite.positive().nullable() }).passthrough(),
  ]),
);

export const diagnosticRoleExpressionSchema: z.ZodTypeAny = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("role"), role: token }).passthrough(),
    z.object({ op: z.literal("add"), terms: z.array(diagnosticRoleExpressionSchema).min(1) }).passthrough(),
    z.object({ op: z.literal("subtract"), left: diagnosticRoleExpressionSchema, right: diagnosticRoleExpressionSchema }).passthrough(),
  ]),
);

const limitation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unlimited") }).passthrough(),
  z.object({ kind: z.literal("unknown"), description: z.string().nullable() }).passthrough(),
  z.object({
    kind: z.enum(["layer", "pre-limited"]),
    attachment: finite.nonnegative(),
    limit: finite.positive().nullable(),
    application: z.enum(["claim", "occurrence", "policy", "source-defined"]),
    derivation: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("sdk") }).passthrough(),
      z.object({ kind: z.literal("external"), actor: z.enum(["caller", "source"]), transformationRef: token }).passthrough(),
    ]),
  }).passthrough(),
]);

const ruleOperand = z.discriminatedUnion("source", [
  z.object({ source: z.literal("measure"), expression: diagnosticMeasureExpressionSchema }).passthrough(),
  z.object({ source: z.literal("calculation"), field: z.enum(["numerator", "denominator"]) }).passthrough(),
  z.object({ source: z.literal("constant"), value: finite }).passthrough(),
]);
const operator = z.enum(["lt", "lte", "eq", "neq", "gte", "gt"]);
const reviewOperand = z.union([
  diagnosticMeasureExpressionSchema,
  z.object({ op: z.literal("constant"), value: finite }).passthrough(),
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
}).passthrough();
const reviewRule = z.discriminatedUnion("kind", [
  z.object({ ...reviewBase, kind: z.literal("compare"), when: z.object({ left: reviewOperand, operator, right: reviewOperand }).passthrough() }).passthrough(),
  z.object({ ...reviewBase, kind: z.literal("reconcile"), actual: diagnosticMeasureExpressionSchema, expected: reviewOperand }).passthrough(),
  z.object({ ...reviewBase, kind: z.literal("monotonic"), expression: diagnosticMeasureExpressionSchema, direction: z.enum(["nondecreasing", "nonincreasing"]) }).passthrough(),
  z.object({ ...reviewBase, kind: z.literal("layer-order"), narrower: diagnosticMeasureExpressionSchema, broader: diagnosticMeasureExpressionSchema, comparability: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("compiler-proven") }).passthrough(),
    z.object({ kind: z.literal("caller-asserted"), rationaleArtifactId: token }).passthrough(),
  ]) }).passthrough(),
  z.object({ ...reviewBase, kind: z.literal("control-total"), expression: diagnosticMeasureExpressionSchema, expected: finite, filter: reviewFilter.nullable(), projection: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("valuation"), valuation: token }).passthrough(),
    z.object({ kind: z.literal("latest-valuation-per-origin") }).passthrough(),
    z.object({ kind: z.literal("all-cells") }).passthrough(),
  ]) }).passthrough(),
]);

const periodAxis = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("calendar"), originCadence: z.enum(["month", "quarter", "year"]),
    valuationCadence: z.enum(["month", "quarter", "year"]), originAnchor: z.enum(["start", "end"]),
    valuationAnchor: z.enum(["start", "end"]), ageUnit: z.literal("month"), ageOffset: finite,
  }).passthrough(),
  z.object({
    kind: z.literal("ordered"), id: token, version: token, ageUnit: token, ageOffset: finite,
    origins: z.array(z.object({ label: token, aliases: z.array(token), coordinate: finite }).passthrough()),
    valuations: z.array(z.object({ label: token, aliases: z.array(token), coordinate: finite }).passthrough()),
  }).passthrough(),
]);

/**
 * Generic wire schema for the normalized diagnostic vocabulary. Known fields
 * are validated and same-major additions are preserved recursively; the
 * executable converter applies core's closed semantic compiler afterward.
 */
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
  }).passthrough()),
  countPopulations: z.array(z.object({ id: token, displayName: z.string(), subject: z.enum(["claim", "claimant", "policy", "occurrence", "other", "unknown"]), unit: token, description: z.string(), attributes }).passthrough()),
  exposureBases: z.array(z.object({ id: token, displayName: z.string(), basis: z.enum(["earned", "written", "in-force", "other", "unknown"]), unit: token, description: z.string(), sourceDescription: z.string().nullable(), attributes }).passthrough()),
  amountBases: z.array(z.object({ id: token, displayName: z.string(), currency: token, perspective: z.enum(["gross", "net", "ceded", "other", "unknown"]), components: z.array(z.object({ id: token, treatment: z.enum(["included", "excluded", "unknown"]), limitation }).passthrough()), sourceDescription: z.string().nullable(), attributes }).passthrough()),
  derivedMeasures: z.array(z.object({ id: token, outputMeasureId: token, expression: diagnosticClaimExpressionSchema }).passthrough()),
  formulas: z.array(z.object({
    id: token, version: token,
    roles: recordSchema(z.object({ kind: z.enum(["count", "amount", "exposure"]), compatibilityGroup: nullableToken, developmentSemantics: z.enum(["cumulative", "incremental", "point-in-time", "unknown"]).nullable() }).passthrough()),
    numerator: diagnosticRoleExpressionSchema, denominator: diagnosticRoleExpressionSchema,
    denominatorPolicy: z.literal("positive-or-null"),
  }).passthrough()),
  instances: z.array(z.object({
    id: token, version: token, formulaId: token, bindings: recordSchema(diagnosticMeasureExpressionSchema),
    presentation: z.object({ displayName: z.string(), description: z.string(), displayUnit: token, scale: finite.positive(), numeratorLabel: z.string(), denominatorLabel: z.string() }).passthrough(),
    rules: z.array(z.object({ id: token, code: token, message: z.string(), severity: z.enum(["warning", "fail"]), when: z.object({ left: ruleOperand, operator, right: ruleOperand, tolerance }).passthrough() }).passthrough()),
  }).passthrough()),
  reviewRules: z.array(reviewRule), periodAxis,
}).passthrough();

export interface DiagnosticDefinitionIdentitySet {
  algorithm: "fnv1a64-jcs-v1";
  formulaById: Readonly<Record<string, string>>;
  calculationByInstanceId: Readonly<Record<string, string>>;
  definition: string;
}

export interface DiagnosticDefinitionBody {
  definition: NormalizedDiagnosticDefinitionIdentity;
  identities: DiagnosticDefinitionIdentitySet;
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
    algorithm: z.literal("fnv1a64-jcs-v1"), formulaById: recordSchema(identityTag),
    calculationByInstanceId: recordSchema(identityTag), definition: identityTag,
  }).passthrough(),
}).passthrough();

export const diagnosticDefinitionDocSchema: z.ZodType<DiagnosticDefinitionDoc> = z.object({
  ...envelopeShape("diagnostic-definition"), diagnosticDefinition: diagnosticDefinitionBodySchema,
}).passthrough();
