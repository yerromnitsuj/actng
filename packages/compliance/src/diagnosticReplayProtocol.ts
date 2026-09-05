import { isDiagnosticPlainRecord, isDiagnosticToken } from "@actuarial-ts/core";
import { ComplianceError } from "./errors.js";
import { MAX_REPLAY_FRAME_BYTES, type ReplayFrame } from "./diagnosticReplayFrames.js";

export const REPLAY_FORMAT = "diagnostic-replay";
export const REPLAY_VERSION = 1;
export const ARTIFACT_CHUNK_BYTES = 65_536;

export function badReplay(message: string): never {
  throw new ComplianceError("BAD_DIAGNOSTIC_RUN", message, "$.replay");
}
export function mismatch(message: string): never {
  throw new ComplianceError("DIAGNOSTIC_MISMATCH", message, "$.replay");
}

/** Snapshot host metadata once, without invoking accessors or caller methods. */
export function replayRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isDiagnosticPlainRecord(value)) badReplay("Expected a plain replay metadata object");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !keys.includes(key)) badReplay("Unknown replay metadata field");
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !("value" in field) || !field.enumerable)
      badReplay("Replay metadata must contain enumerable data properties");
    result[key] = field.value;
  }
  return result;
}
export function replayArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    badReplay("Expected a plain replay metadata array");
  const length: unknown = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0)
    badReplay("Invalid replay metadata array length");
  for (const key of Reflect.ownKeys(value))
    if (
      key !== "length" &&
      (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)
    )
      badReplay("Unexpected replay array property");
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    if (!field || !("value" in field) || !field.enumerable)
      badReplay("Replay array has a hole or accessor");
    result.push(field.value);
  }
  return result;
}
export function replayToken(value: unknown): string {
  if (!isDiagnosticToken(value)) badReplay("Expected a nonempty replay token with valid Unicode");
  return value;
}
export function replayLimit(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    badReplay(`${label} must be a positive safe integer`);
  return value;
}

const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!;
const throwIfAborted = AbortSignal.prototype.throwIfAborted;
export function replayCancellation(signal: unknown): () => void {
  if (signal === undefined) return () => {};
  try {
    signalAborted.call(signal);
  } catch {
    badReplay("Replay signal must be an AbortSignal");
  }
  return () => throwIfAborted.call(signal);
}

/** Exactly the writer's bounded canonical flat-frame bytes, including newline. */
export function replayFrameBytes(frame: ReplayFrame): Uint8Array {
  const bytes = new TextEncoder().encode(`${JSON.stringify(frame)}\n`);
  if (bytes.byteLength > MAX_REPLAY_FRAME_BYTES) badReplay("Replay frame exceeds its byte limit");
  return bytes;
}

export function encodeArtifactChunk(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export function decodeArtifactChunk(value: unknown): Uint8Array {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 87_384 ||
    value.length % 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    badReplay("Invalid bounded artifact base64 chunk");
  const binary = atob(value);
  if (binary.length > ARTIFACT_CHUNK_BYTES || btoa(binary) !== value)
    badReplay("Artifact base64 must use canonical padding bits and bounded chunks");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
