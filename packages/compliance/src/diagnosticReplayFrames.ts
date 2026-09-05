import { ComplianceError } from "./errors.js";
import { diagnosticByteView } from "./diagnosticByteView.js";
import { consumeDiagnosticByteSource } from "./diagnosticByteSource.js";

// Transport granularity only: not a limit on total evidence or dataset size.
export const MAX_REPLAY_FRAME_BYTES = 131_072;
export const MAX_REPLAY_READ_BYTES = 131_072;
export const REPLAY_TEXT_UNITS = 16_384;
export type ReplayAtom = string | number | boolean | null;
export type ReplayFrame = readonly ReplayAtom[];
function invalid(message: string): never {
  throw new ComplianceError("BAD_DIAGNOSTIC_RUN", message, "$.replayFrames");
}
function snapshotFrame(value: unknown): ReplayFrame {
  if (!Array.isArray(value)) invalid("Replay frame must be an array");
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isInteger(length) || length < 1 || length > 16)
    invalid("Replay frame must be a nonempty flat array with at most 16 items");
  const owned: ReplayAtom[] = [];
  for (let index = 0; index < length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    if (!field || !("value" in field))
      invalid("Replay frames must contain indexed data properties");
    const item: unknown = field.value;
    if (item === null || typeof item === "boolean") {
      owned.push(item);
      continue;
    }
    if (typeof item === "number" && Number.isFinite(item)) {
      owned.push(item);
      continue;
    }
    // Enough for a base64-encoded 64 KiB artifact chunk. Higher-level protocol
    // validates each event's arity, sequencing, and narrower field limits.
    if (typeof item === "string" && item.length <= 87_384) {
      owned.push(item);
      continue;
    }
    invalid("Replay frames contain only bounded JSON primitives");
  }
  return Object.freeze(owned);
}

/** Private transport codec; construction does not grant diagnostic authority. */
export async function* encodeReplayFrames(
  frames: AsyncIterable<ReplayFrame> | Iterable<ReplayFrame>,
): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  for await (const frame of frames) {
    const owned = snapshotFrame(frame);
    const atoms: string[] = [];
    let bytes = 3;
    for (const item of owned) {
      const text = JSON.stringify(item);
      bytes += encoder.encode(text).byteLength + (atoms.length ? 1 : 0);
      if (bytes > MAX_REPLAY_FRAME_BYTES) invalid("Replay frame exceeds its byte limit");
      atoms.push(text);
    }
    yield encoder.encode(`[${atoms.join(",")}]\n`);
  }
}

/** Parse bounded flat frames, never a complete candidate audit/identity. */
export async function* decodeReplayFrames(
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): AsyncGenerator<ReplayFrame> {
  const line = new Uint8Array(MAX_REPLAY_FRAME_BYTES);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let used = 0;
  try {
    for await (const chunk of consumeDiagnosticByteSource(chunks)) {
      const view = diagnosticByteView(chunk);
      if (view.byteLength > MAX_REPLAY_READ_BYTES)
        invalid("Replay read chunk exceeds its transport limit; split input reads");
      // Snapshot before yielding any frame: reused buffers cannot alter later
      // frames in the same delivered chunk. This copy is always bounded.
      const owned = new Uint8Array(view);
      for (const byte of owned) {
        if (byte === 10) {
          if (used === 0) invalid("Empty replay frame");
          let parsed: unknown;
          try {
            parsed = JSON.parse(decoder.decode(line.subarray(0, used)));
          } catch {
            invalid("Replay frame is not valid UTF-8 JSON");
          }
          used = 0;
          yield snapshotFrame(parsed);
        } else {
          if (used >= MAX_REPLAY_FRAME_BYTES - 1) invalid("Replay frame exceeds its byte limit");
          line[used++] = byte;
        }
      }
    }
    if (used !== 0) invalid("Replay stream ended inside a frame");
  } finally {
    line.fill(0);
  }
}
