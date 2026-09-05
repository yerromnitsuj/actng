import {
  diagnosticJsonPreflight,
  isDiagnosticPlainRecord,
  isDiagnosticToken,
} from "@actuarial-ts/core";
import { ComplianceError } from "./errors.js";
import type { DiagnosticArtifactDigest } from "./diagnosticRun.js";
import { createSha256 } from "./sha256Stream.js";
import { diagnosticByteView } from "./diagnosticByteView.js";
import { consumeDiagnosticByteSource } from "./diagnosticByteSource.js";

export interface DiagnosticArtifactStreamMetadata {
  readonly id: string;
  readonly scope: "input" | "preparation";
  /** Optional completeness check; no digest handle is issued on truncation. */
  readonly expectedByteLength?: number;
  /** Caller-selected resource ceiling, at most Number.MAX_SAFE_INTEGER. */
  readonly maximumByteLength?: number;
}
declare const computedArtifactDigestBrand: unique symbol;
export type ComputedDiagnosticArtifactDigest = Extract<
  DiagnosticArtifactDigest,
  { assurance: "sdk-computed" }
> & { readonly [computedArtifactDigestBrand]: true };

const computed = new WeakSet<object>();
const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!;
const throwIfAborted = AbortSignal.prototype.throwIfAborted;
const COPY_SIZE = 65_536;

function invalid(message: string, path = "$"): never {
  throw new ComplianceError("BAD_DIAGNOSTIC_RUN", message, path);
}

function ownedMetadata(value: DiagnosticArtifactStreamMetadata) {
  // Read descriptors once. A Proxy must not pass validation with one property
  // value and supply a different value when the final digest is assembled.
  if (!isDiagnosticPlainRecord(value)) invalid("Artifact metadata must be a plain object");
  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") invalid("Artifact metadata cannot have symbol keys");
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !("value" in field) || !field.enumerable)
      invalid("Artifact metadata must contain enumerable data properties", `$.${key}`);
    snapshot[key] = field.value;
  }
  value = snapshot as unknown as DiagnosticArtifactStreamMetadata;
  const issues = diagnosticJsonPreflight(value, "input");
  if (issues.length) invalid(issues[0]!.message, issues[0]!.path);
  if (!isDiagnosticPlainRecord(value)) invalid("Artifact metadata must be a plain object");
  for (const key of Object.keys(value))
    if (!["id", "scope", "expectedByteLength", "maximumByteLength"].includes(key))
      invalid("Unknown artifact metadata key", `$.${key}`);
  if (!isDiagnosticToken(value.id)) invalid("Artifact ID must be a valid token", "$.id");
  if (value.scope !== "input" && value.scope !== "preparation")
    invalid("Artifact scope must be input or preparation", "$.scope");
  for (const key of ["expectedByteLength", "maximumByteLength"] as const)
    if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || value[key]! < 0))
      invalid("Byte length must be a nonnegative safe integer", `$.${key}`);
  const maximumByteLength = value.maximumByteLength ?? Number.MAX_SAFE_INTEGER;
  if (value.expectedByteLength !== undefined && value.expectedByteLength > maximumByteLength)
    invalid("Expected byte length exceeds the resource ceiling", "$.expectedByteLength");
  return {
    id: value.id,
    scope: value.scope,
    expectedByteLength: value.expectedByteLength,
    maximumByteLength,
  };
}

function cancellation(options: { readonly signal?: AbortSignal }): () => void {
  if (!isDiagnosticPlainRecord(options)) invalid("Artifact stream options must be a plain object");
  for (const key of Reflect.ownKeys(options))
    if (key !== "signal") invalid("Unknown artifact stream option");
  const field = Object.getOwnPropertyDescriptor(options, "signal");
  if (field && (!("value" in field) || !field.enumerable))
    invalid("Artifact signal must be supplied as a data property");
  const signal = field?.value;
  if (signal === undefined) return () => {};
  try {
    signalAborted.call(signal);
  } catch {
    invalid("Artifact signal must be an AbortSignal");
  }
  // Capture the genuine signal and intrinsic method before any producer await.
  return () => throwIfAborted.call(signal);
}

/**
 * Hash the bytes actually received, retaining only a bounded chunk copy.
 * The producer owns I/O. A completed handle means SDK-computed content digest,
 * not source authenticity, a signature, or validation of an actuarial run.
 * Shared buffers are refused; bytes are consumed before requesting the next
 * chunk. A changing producer must be checked again against this digest on replay.
 * Cancellation is cooperative between received chunks; the producer should use
 * the same signal to cancel pending I/O. One synchronous chunk is not interrupted.
 */
export async function digestDiagnosticArtifactChunks(
  metadata: DiagnosticArtifactStreamMetadata,
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ComputedDiagnosticArtifactDigest> {
  const owned = ownedMetadata(metadata);
  const checkCancellation = cancellation(options);
  checkCancellation();
  const hash = createSha256();
  const copy = new Uint8Array(COPY_SIZE);
  let byteLength = 0;
  try {
    for await (const chunk of consumeDiagnosticByteSource(chunks, checkCancellation)) {
      checkCancellation();
      const view = diagnosticByteView(chunk);
      const size = view.byteLength;
      if (!Number.isSafeInteger(byteLength + size) || byteLength + size > owned.maximumByteLength)
        invalid("Artifact byte length exceeds the resource ceiling", "$.chunks");
      if (owned.expectedByteLength !== undefined && byteLength + size > owned.expectedByteLength)
        invalid("Artifact has more bytes than declared", "$.chunks");
      for (let start = 0; start < size; start += COPY_SIZE) {
        const length = Math.min(COPY_SIZE, size - start);
        copy.set(new Uint8Array(view.buffer, view.byteOffset + start, length));
        hash.update(copy.subarray(0, length));
      }
      byteLength += size;
    }
    checkCancellation();
    if (owned.expectedByteLength !== undefined && byteLength !== owned.expectedByteLength)
      invalid("Artifact ended before its declared byte length", "$.chunks");
    const digest = Object.freeze({
      id: owned.id,
      scope: owned.scope,
      assurance: "sdk-computed" as const,
      algorithm: "sha256" as const,
      value: hash.digest(),
      byteLength,
    }) as ComputedDiagnosticArtifactDigest;
    computed.add(digest);
    return digest;
  } finally {
    copy.fill(0);
  }
}

export function assertComputedDiagnosticArtifactDigest(
  value: unknown,
): asserts value is ComputedDiagnosticArtifactDigest {
  if (value === null || typeof value !== "object" || !computed.has(value))
    invalid("Value is not an authentic SDK-computed streamed artifact digest");
}
