import {
  ReservingError,
  reconcileDiagnosticExposureKeys,
  runMetricDiagnostics,
  type DiagnosticExposureRow,
  type DiagnosticLossRow,
  type MetricDiagnosticsResult,
  type ReconciledDiagnosticExposures,
  type RunMetricDiagnosticsInput,
} from "@actuarial-ts/core";
import { z } from "zod";

const measuresSchema = z.record(z.number().nullable());

const diagnosticLossRowSchema = z.object({
  id: z.string().min(1),
  group: z.string().min(1),
  origin: z.string().min(1),
  valuation: z.string().min(1),
  ageMonths: z.number(),
  policyPeriod: z.string().min(1).optional(),
  dimensions: z.unknown().optional(),
  measures: measuresSchema,
}).strict();

const diagnosticExposureRowSchema = z.object({
  key: z.string().min(1),
  group: z.string().min(1),
  origin: z.string().min(1),
  valuation: z.string().min(1).optional(),
  measures: measuresSchema,
  complete: z.boolean().optional(),
  dimensions: z.unknown().optional(),
}).strict();

const diagnosticDatasetSchema = z.object({
  losses: z.array(diagnosticLossRowSchema),
  exposures: z.array(diagnosticExposureRowSchema).optional(),
}).strict();

export interface ValidatedDiagnosticDataset {
  losses: DiagnosticLossRow[];
  exposures: DiagnosticExposureRow[];
}

/** Zod-validates unknown diagnostic rows at the data package boundary. */
export function validateDiagnosticDataset(value: unknown): ValidatedDiagnosticDataset {
  const parsed = diagnosticDatasetSchema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "$"}: ${issue.message}`)
      .join("; ");
    throw new ReservingError("SHAPE", `Invalid diagnostic dataset: ${details}`);
  }
  return { losses: parsed.data.losses, exposures: parsed.data.exposures ?? [] };
}

/** Validates unknown exposure rows, then applies core's stable-key reconciliation. */
export function validateAndReconcileDiagnosticExposures(
  value: unknown,
): ReconciledDiagnosticExposures {
  const validated = validateDiagnosticDataset({ losses: [], exposures: value });
  return reconcileDiagnosticExposureKeys(validated.exposures);
}

export type ValidatedMetricDiagnosticsOptions = Omit<RunMetricDiagnosticsInput, "losses" | "exposures">;

/** Convenience boundary: validate unknown rows, then run the dependency-free core engine. */
export function runValidatedMetricDiagnostics(
  dataset: unknown,
  options: ValidatedMetricDiagnosticsOptions,
): MetricDiagnosticsResult {
  const validated = validateDiagnosticDataset(dataset);
  return runMetricDiagnostics({ ...options, ...validated });
}
