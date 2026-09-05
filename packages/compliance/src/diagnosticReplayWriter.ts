import { iterateDiagnosticIdentityJson } from "@actuarial-ts/core";
import { getCompletedCompactDiagnosticRunInput } from "@actuarial-ts/data";
import {
  assertVerifiedCompactDiagnosticRunProvenance,
  getCompactDiagnosticRunOwner,
  type VerifiedCompactDiagnosticRunProvenance,
} from "./diagnosticCompactRun.js";
import type { DiagnosticArtifactDigest } from "./diagnosticRun.js";
import { diagnosticByteView } from "./diagnosticByteView.js";
import { consumeDiagnosticByteSource } from "./diagnosticByteSource.js";
import {
  encodeReplayFrames,
  REPLAY_TEXT_UNITS,
  type ReplayFrame,
} from "./diagnosticReplayFrames.js";
import { replayValueFrames } from "./diagnosticReplayValue.js";
import { createSha256 } from "./sha256Stream.js";
import {
  ARTIFACT_CHUNK_BYTES,
  REPLAY_FORMAT,
  REPLAY_VERSION,
  badReplay,
  mismatch,
  replayArray,
  replayCancellation,
  replayFrameBytes,
  replayRecord,
  replayToken,
  encodeArtifactChunk,
} from "./diagnosticReplayProtocol.js";

export interface DiagnosticReplayStreamRun {
  readonly id: string;
  readonly provenance: VerifiedCompactDiagnosticRunProvenance;
}
export type DiagnosticReplayByteSource = Iterable<Uint8Array> | AsyncIterable<Uint8Array>;
export interface WriteDiagnosticReplayStreamInput {
  readonly runs: readonly DiagnosticReplayStreamRun[];
  /** Fresh stream of at most 64 KiB per chunk, for each unique computed artifact. */
  readonly openArtifact: (
    artifact: Extract<DiagnosticArtifactDigest, { assurance: "sdk-computed" }>,
  ) => DiagnosticReplayByteSource | Promise<DiagnosticReplayByteSource>;
  readonly signal?: AbortSignal;
}

function replayInput(provenance: VerifiedCompactDiagnosticRunProvenance) {
  const input = getCompletedCompactDiagnosticRunInput(getCompactDiagnosticRunOwner(provenance));
  // Only a small envelope is new. All dataset/evidence arrays are the immutable
  // originals owned by the validated gateway, including filtered-out inputs.
  // Definition uses the normalized wire shape accepted by the core compiler,
  // not a falsely typed authored definition with its optional-null defaults.
  return {
    definition: input.definition.definition,
    losses: input.losses,
    exposures: input.exposures,
    ...(input.filter === null ? {} : { filter: input.filter }),
    completePeriodCutoffs: input.completePeriodCutoffs,
    ...(input.expectedCells === null ? {} : { expectedCells: input.expectedCells }),
    reviewEvidence: input.reviewEvidence,
    ...(input.runPresetId === null ? {} : { runPresetId: input.runPresetId }),
    ...(input.datasetArtifactId === null ? {} : { datasetArtifactId: input.datasetArtifactId }),
    groupMap: input.groupMap,
    groupDimensions: input.groupDimensions,
    policy: {
      allowedReviewStatuses: input.policy.allowedReviewStatuses,
      allowedMetricFindingSeverities: input.policy.allowedMetricFindingSeverities,
      ...(input.policy.rationaleRef === null ? {} : { rationaleRef: input.policy.rationaleRef }),
    },
  };
}

/**
 * Versioned large-data replay, NOT an interchange BundleDoc or the old JSON
 * provenance DTO. Writes only from genuine immutable provenance owners. The
 * host owns I/O and must publish a file only after the generator completes.
 * All artifact bytes are rechecked against their authenticated digests while
 * writing. Consumer cancellation closes producers; pending host I/O should use
 * the same signal. No full candidate identity or whole archive string exists.
 */
export function writeDiagnosticReplayStream(
  input: WriteDiagnosticReplayStreamInput,
): AsyncGenerator<Uint8Array> {
  // Snapshot at call time, before the first await/yield (not at first next()).
  const options = replayRecord(input, ["runs", "openArtifact", "signal"]);
  const runs = replayArray(options.runs).map((value) => {
    const item = replayRecord(value, ["id", "provenance"]);
    const id = replayToken(item.id);
    assertVerifiedCompactDiagnosticRunProvenance(item.provenance);
    return Object.freeze({ id, provenance: item.provenance });
  });
  if (!runs.length || new Set(runs.map((run) => run.id)).size !== runs.length)
    badReplay("Replay must have at least one run and unique run IDs");
  if (typeof options.openArtifact !== "function")
    badReplay("Replay openArtifact must be a function");
  const openArtifact = options.openArtifact as WriteDiagnosticReplayStreamInput["openArtifact"];
  const checkCancellation = replayCancellation(options.signal);
  checkCancellation();
  const artifacts = new Map<string, DiagnosticArtifactDigest>();
  for (const { provenance } of runs)
    for (const artifact of [...provenance.inputArtifacts, ...provenance.preparationArtifacts]) {
      const prior = artifacts.get(artifact.id);
      if (
        prior &&
        (prior.scope !== artifact.scope ||
          prior.assurance !== artifact.assurance ||
          prior.algorithm !== artifact.algorithm ||
          prior.value !== artifact.value ||
          (prior.assurance === "sdk-computed" &&
            artifact.assurance === "sdk-computed" &&
            prior.byteLength !== artifact.byteLength))
      )
        badReplay("Shared replay artifact IDs have conflicting evidence");
      artifacts.set(artifact.id, artifact);
    }

  async function* body(): AsyncGenerator<ReplayFrame> {
    yield [REPLAY_FORMAT, REPLAY_VERSION];
    for (const artifact of artifacts.values()) {
      checkCancellation();
      yield ["artifact"];
      yield* replayValueFrames(artifact);
      yield ["artifact-data"];
      if (artifact.assurance === "sdk-computed") {
        const hash = createSha256();
        let length = 0;
        for await (const raw of consumeDiagnosticByteSource(
          await openArtifact(artifact),
          checkCancellation,
        )) {
          checkCancellation();
          const view = diagnosticByteView(raw);
          if (view.byteLength > ARTIFACT_CHUNK_BYTES)
            badReplay("Artifact read chunks must be at most 64 KiB");
          // Snapshot the entire bounded delivered chunk before yielding.
          const owned = new Uint8Array(view);
          length += owned.length;
          if (!Number.isSafeInteger(length) || length > artifact.byteLength)
            mismatch("Artifact grew after its verified digest");
          hash.update(owned);
          if (owned.length) yield ["bytes", encodeArtifactChunk(owned)];
        }
        checkCancellation();
        if (length !== artifact.byteLength || hash.digest() !== artifact.value)
          mismatch("Artifact bytes changed after their verified digest");
      }
      yield ["artifact-end"];
    }
    for (const { id, provenance } of runs) {
      checkCancellation();
      yield ["run"];
      yield* replayValueFrames({
        id,
        input: replayInput(provenance),
        inputArtifactIds: provenance.inputArtifacts.map((item) => item.id),
        preparationArtifactIds: provenance.preparationArtifacts.map((item) => item.id),
        preparationLineage: provenance.preparationLineage,
      });
      yield ["input-end"];
      for (const [channel, document] of [
        ["manifest", provenance.manifestIdentityDocument],
        ["result", provenance.resultIdentityDocument],
      ] as const) {
        for (const text of iterateDiagnosticIdentityJson(document))
          for (let start = 0; start < text.length; start += REPLAY_TEXT_UNITS)
            yield [channel, text.slice(start, start + REPLAY_TEXT_UNITS)];
        yield [`${channel}-end`];
      }
      yield [
        "run-end",
        provenance.runFingerprint,
        provenance.resultFingerprint,
        provenance.runResultFingerprint,
      ];
    }
  }
  async function* sequenced(): AsyncGenerator<ReplayFrame> {
    let sequence = 0;
    const hash = createSha256();
    for await (const event of body()) {
      checkCancellation();
      if (!Number.isSafeInteger(sequence + 1)) badReplay("Replay sequence exceeded safe integers");
      const frame = [sequence++, ...event];
      hash.update(replayFrameBytes(frame));
      yield frame;
    }
    checkCancellation();
    yield [sequence, "end", artifacts.size, runs.length, hash.digest()];
  }
  return encodeReplayFrames(sequenced());
}
