import { iterateDiagnosticIdentityJson, type DiagnosticIdentityDocument } from "@actuarial-ts/core";
import {
  runValidatedMetricDiagnosticsCompact,
  validateDiagnosticRunInputCompact,
} from "@actuarial-ts/data";
import { digestDiagnosticArtifactChunks } from "./diagnosticArtifactStream.js";
import {
  createCompactDiagnosticRunIdentity,
  type CompactDiagnosticArtifactEvidence,
} from "./diagnosticCompactRun.js";
import { diagnosticByteView } from "./diagnosticByteView.js";
import { consumeDiagnosticByteSource } from "./diagnosticByteSource.js";
import {
  decodeReplayFrames,
  MAX_REPLAY_READ_BYTES,
  REPLAY_TEXT_UNITS,
  type ReplayFrame,
} from "./diagnosticReplayFrames.js";
import { ReplayValueBuilder, type ReplayValueLimits } from "./diagnosticReplayValue.js";
import type {
  DiagnosticArtifactDigest,
  DiagnosticPreparationLineage,
  DiagnosticRunIdentity,
} from "./diagnosticRun.js";
import type { DiagnosticReplayByteSource } from "./diagnosticReplayWriter.js";
import { createSha256 } from "./sha256Stream.js";
import {
  REPLAY_FORMAT,
  REPLAY_VERSION,
  badReplay,
  mismatch,
  replayArray,
  replayCancellation,
  replayFrameBytes,
  replayLimit,
  replayRecord,
  replayToken,
  decodeArtifactChunk,
} from "./diagnosticReplayProtocol.js";

/** Host resource policy, not a representation of the SDK's tested capacity. */
export interface DiagnosticReplayReadLimits {
  readonly maximumEncodedBytes: number;
  readonly maximumArtifacts: number;
  readonly maximumRuns: number;
  readonly maximumArtifactBytes: number;
  readonly maximumInputDepth: number;
  readonly maximumInputNodes: number;
  readonly maximumInputStringUnits: number;
  readonly maximumInputTotalStringUnits: number;
}
export interface VerifyDiagnosticReplayStreamOptions {
  readonly limits: DiagnosticReplayReadLimits;
  readonly signal?: AbortSignal;
}
declare const verifiedReplayBrand: unique symbol;
export interface VerifiedDiagnosticReplayStream {
  readonly [verifiedReplayBrand]: true;
  readonly format: "diagnostic-replay";
  readonly version: 1;
  readonly artifacts: readonly DiagnosticArtifactDigest[];
  readonly runs: readonly (DiagnosticRunIdentity & { readonly id: string })[];
  /** SHA-256 of canonical numbered frames before the final trailer; not a signature. */
  readonly frameDigest: string;
}
const verifiedStreams = new WeakSet<object>();

class ReplayCursor {
  private sequence = 0;
  private readonly hash = createSha256();
  constructor(
    private readonly iterator: AsyncGenerator<ReplayFrame>,
    private readonly checkCancellation: () => void,
  ) {}
  async next(): Promise<ReplayFrame> {
    this.checkCancellation();
    const item = await this.iterator.next();
    this.checkCancellation();
    if (item.done) badReplay("Replay ended before its required trailer or section boundary");
    const frame = item.value;
    if (
      frame.length < 2 ||
      frame[0] !== this.sequence ||
      !Number.isSafeInteger(frame[0]) ||
      typeof frame[1] !== "string"
    )
      badReplay("Replay frame has an invalid sequence or event");
    this.sequence++;
    if (frame[1] !== "end") this.hash.update(replayFrameBytes(frame));
    return frame.slice(1);
  }
  digest() {
    return this.hash.digest();
  }
  async requireEof(): Promise<void> {
    this.checkCancellation();
    if (!(await this.iterator.next()).done) badReplay("Unexpected frames after the replay trailer");
    this.checkCancellation();
  }
  async close() {
    await this.iterator.return(undefined);
  }
}
function event(frame: ReplayFrame, name: string, arity: number): void {
  if (frame[0] !== name || frame.length !== arity)
    badReplay(`Expected ${name} with exact arity ${arity}`);
}
async function readValue(
  cursor: ReplayCursor,
  ending: string,
  limits: ReplayValueLimits,
): Promise<unknown> {
  const builder = new ReplayValueBuilder(limits);
  for (;;) {
    const frame = await cursor.next();
    if (frame[0] === ending) {
      event(frame, ending, 1);
      return builder.finish();
    }
    builder.push(frame);
  }
}

/** Compare complete expected canonical text with bounded candidate fragments. */
async function compareEvidence(
  cursor: ReplayCursor,
  channel: "manifest" | "result",
  document: DiagnosticIdentityDocument,
): Promise<void> {
  const expected = iterateDiagnosticIdentityJson(document);
  let chunk = "",
    index = 0,
    position = 0,
    done = false;
  function advance(): void {
    while (!done && index === chunk.length) {
      const item = expected.next();
      done = Boolean(item.done);
      chunk = item.done ? "" : item.value;
      index = 0;
    }
  }
  try {
    for (;;) {
      const frame = await cursor.next();
      if (frame[0] === `${channel}-end`) {
        event(frame, `${channel}-end`, 1);
        advance();
        if (!done) mismatch(`${channel} evidence is truncated at code-unit offset ${position}`);
        return;
      }
      event(frame, channel, 2);
      const text = frame[1];
      if (typeof text !== "string" || text.length === 0 || text.length > REPLAY_TEXT_UNITS)
        badReplay("Invalid bounded canonical evidence fragment");
      let start = 0;
      while (start < text.length) {
        advance();
        if (done) mismatch(`${channel} evidence has extra content at code-unit offset ${position}`);
        const length = Math.min(text.length - start, chunk.length - index);
        for (let offset = 0; offset < length; offset++)
          if (text.charCodeAt(start + offset) !== chunk.charCodeAt(index + offset))
            mismatch(`${channel} evidence differs at code-unit offset ${position + offset}`);
        start += length;
        index += length;
        position += length;
      }
    }
  } finally {
    expected.return(undefined);
  }
}

function artifactMetadata(value: unknown): DiagnosticArtifactDigest {
  const item = replayRecord(value, [
    "id",
    "scope",
    "assurance",
    "algorithm",
    "value",
    "byteLength",
  ]);
  const id = replayToken(item.id);
  if (item.scope !== "input" && item.scope !== "preparation") badReplay("Invalid artifact scope");
  const scope = item.scope;
  if (item.assurance === "caller-declared") {
    if (Object.hasOwn(item, "byteLength"))
      badReplay("Declared artifact cannot claim a computed byte length");
    return Object.freeze({
      id,
      scope,
      assurance: "caller-declared",
      algorithm: replayToken(item.algorithm),
      value: replayToken(item.value),
    });
  }
  if (
    item.assurance !== "sdk-computed" ||
    item.algorithm !== "sha256" ||
    typeof item.value !== "string" ||
    !/^[a-f0-9]{64}$/.test(item.value) ||
    typeof item.byteLength !== "number" ||
    !Number.isSafeInteger(item.byteLength) ||
    item.byteLength < 0
  )
    badReplay("Invalid computed artifact digest metadata");
  return Object.freeze({
    id,
    scope,
    assurance: "sdk-computed",
    algorithm: "sha256",
    value: item.value,
    byteLength: item.byteLength,
  });
}

async function readArtifact(
  cursor: ReplayCursor,
  inputLimits: ReplayValueLimits,
  maximumArtifactBytes: number,
): Promise<CompactDiagnosticArtifactEvidence> {
  const artifact = artifactMetadata(await readValue(cursor, "artifact-data", inputLimits));
  if (artifact.assurance === "caller-declared") {
    event(await cursor.next(), "artifact-end", 1);
    return artifact;
  }
  async function* bytes() {
    for (;;) {
      const frame = await cursor.next();
      if (frame[0] === "artifact-end") {
        event(frame, "artifact-end", 1);
        return;
      }
      event(frame, "bytes", 2);
      yield decodeArtifactChunk(frame[1]);
    }
  }
  const computed = await digestDiagnosticArtifactChunks(
    {
      id: artifact.id,
      scope: artifact.scope,
      expectedByteLength: artifact.byteLength,
      maximumByteLength: maximumArtifactBytes,
    },
    bytes(),
  );
  if (computed.value !== artifact.value)
    mismatch(`Artifact ${artifact.id} bytes do not match its digest`);
  return computed;
}

async function readRun(
  cursor: ReplayCursor,
  artifacts: ReadonlyMap<string, CompactDiagnosticArtifactEvidence>,
  used: Set<string>,
  limits: ReplayValueLimits,
) {
  const item = replayRecord(await readValue(cursor, "input-end", limits), [
    "id",
    "input",
    "inputArtifactIds",
    "preparationArtifactIds",
    "preparationLineage",
  ]);
  const id = replayToken(item.id);
  function resolve(value: unknown, scope: "input" | "preparation") {
    const seen = new Set<string>();
    return replayArray(value).map((key) => {
      const token = replayToken(key);
      if (seen.has(token)) badReplay("Duplicate artifact reference in replay run");
      seen.add(token);
      const artifact = artifacts.get(token);
      if (!artifact || artifact.scope !== scope)
        badReplay("Replay references an absent artifact or the wrong scope");
      used.add(token);
      return artifact;
    });
  }
  const inputArtifacts = resolve(item.inputArtifactIds, "input");
  const preparationArtifacts = resolve(item.preparationArtifactIds, "preparation");
  // Candidate raw input always crosses the complete SDK schema, ownership,
  // preparation and execution-policy boundaries. Parsing does not grant trust.
  const completedRun = runValidatedMetricDiagnosticsCompact(
    validateDiagnosticRunInputCompact(item.input),
  );
  if (completedRun.status !== "completed")
    mismatch(`Replay run ${id} is blocked at ${completedRun.stage}`);
  const provenance = createCompactDiagnosticRunIdentity({
    completedRun,
    inputArtifacts,
    preparationArtifacts,
    preparationLineage: item.preparationLineage as readonly DiagnosticPreparationLineage[],
  });
  await compareEvidence(cursor, "manifest", provenance.manifestIdentityDocument);
  await compareEvidence(cursor, "result", provenance.resultIdentityDocument);
  const end = await cursor.next();
  event(end, "run-end", 4);
  if (
    end[1] !== provenance.runFingerprint ||
    end[2] !== provenance.resultFingerprint ||
    end[3] !== provenance.runResultFingerprint
  )
    mismatch("Replayed fingerprint tags do not match the full verified evidence");
  return Object.freeze({
    id,
    runFingerprint: provenance.runFingerprint,
    resultFingerprint: provenance.resultFingerprint,
    runResultFingerprint: provenance.runResultFingerprint,
  });
}

/**
 * Verify all bytes/evidence and independently replay every run, sequentially.
 * Reads must be <=128 KiB. Required resource limits apply before retaining raw
 * inputs; results/audits are compared as text, never reconstructed from a file.
 * Only a final receipt is returned after trailer integrity AND EOF. Hosts must
 * not treat a partially consumed stream as a valid archive. Cancellation is
 * cooperative between chunks/phases; use the signal for host I/O as well.
 */
export function verifyDiagnosticReplayStream(
  chunks: DiagnosticReplayByteSource,
  supplied: VerifyDiagnosticReplayStreamOptions,
): Promise<VerifiedDiagnosticReplayStream> {
  const options = replayRecord(supplied, ["limits", "signal"]);
  const fields = [
    "maximumEncodedBytes",
    "maximumArtifacts",
    "maximumRuns",
    "maximumArtifactBytes",
    "maximumInputDepth",
    "maximumInputNodes",
    "maximumInputStringUnits",
    "maximumInputTotalStringUnits",
  ] as const;
  const raw = replayRecord(options.limits, fields);
  const limits = Object.fromEntries(
    fields.map((key) => [key, replayLimit(raw[key], key)]),
  ) as unknown as DiagnosticReplayReadLimits;
  const inputLimits: ReplayValueLimits = {
    maximumDepth: limits.maximumInputDepth,
    maximumNodes: limits.maximumInputNodes,
    maximumStringUnits: limits.maximumInputStringUnits,
    maximumTotalStringUnits: limits.maximumInputTotalStringUnits,
  };
  const checkCancellation = replayCancellation(options.signal);
  checkCancellation();
  async function* bounded() {
    let size = 0;
    for await (const chunk of consumeDiagnosticByteSource(chunks, checkCancellation)) {
      checkCancellation();
      const view = diagnosticByteView(chunk);
      if (view.length > MAX_REPLAY_READ_BYTES) badReplay("Replay reads must be at most 128 KiB");
      if (view.length > limits.maximumEncodedBytes - size)
        badReplay("Replay exceeds the encoded byte limit");
      size += view.length;
      yield new Uint8Array(view);
    }
  }
  async function verify(): Promise<VerifiedDiagnosticReplayStream> {
    const cursor = new ReplayCursor(decodeReplayFrames(bounded()), checkCancellation);
    let failed = false;
    try {
      const header = await cursor.next();
      event(header, REPLAY_FORMAT, 2);
      if (header[1] !== REPLAY_VERSION) badReplay("Unsupported diagnostic replay version");
      const artifacts = new Map<string, CompactDiagnosticArtifactEvidence>();
      let frame = await cursor.next();
      while (frame[0] === "artifact") {
        event(frame, "artifact", 1);
        if (artifacts.size >= limits.maximumArtifacts)
          badReplay("Replay exceeds its artifact count limit");
        const artifact = await readArtifact(cursor, inputLimits, limits.maximumArtifactBytes);
        if (artifacts.has(artifact.id)) badReplay("Duplicate artifact ID in replay archive");
        artifacts.set(artifact.id, artifact);
        frame = await cursor.next();
      }
      const runs: (DiagnosticRunIdentity & { readonly id: string })[] = [];
      const runIds = new Set<string>(),
        used = new Set<string>();
      while (frame[0] === "run") {
        event(frame, "run", 1);
        if (runs.length >= limits.maximumRuns) badReplay("Replay exceeds its run count limit");
        const run = await readRun(cursor, artifacts, used, inputLimits);
        if (runIds.has(run.id)) badReplay("Duplicate run ID in replay archive");
        runIds.add(run.id);
        runs.push(run);
        frame = await cursor.next();
      }
      event(frame, "end", 4);
      if (
        !runs.length ||
        frame[1] !== artifacts.size ||
        frame[2] !== runs.length ||
        used.size !== artifacts.size
      )
        badReplay("Replay trailer counts, run presence or artifact ownership are invalid");
      const frameDigest = cursor.digest();
      if (frame[3] !== frameDigest) mismatch("Replay frame integrity digest does not match");
      await cursor.requireEof();
      const receipt = Object.freeze({
        format: REPLAY_FORMAT,
        version: REPLAY_VERSION,
        artifacts: Object.freeze([...artifacts.values()]),
        runs: Object.freeze(runs),
        frameDigest,
      }) as VerifiedDiagnosticReplayStream;
      verifiedStreams.add(receipt);
      return receipt;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        await cursor.close();
      } catch (cleanupError) {
        if (!failed) throw cleanupError;
      }
    }
  }
  return verify();
}

export function assertVerifiedDiagnosticReplayStream(
  value: unknown,
): asserts value is VerifiedDiagnosticReplayStream {
  if (value === null || typeof value !== "object" || !verifiedStreams.has(value))
    badReplay("Value is not an authentic fully verified replay stream receipt");
}
