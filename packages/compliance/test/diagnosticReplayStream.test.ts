import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  runValidatedMetricDiagnosticsCompact,
  validateDiagnosticRunInputCompact,
} from "@actuarial-ts/data";
import {
  assertVerifiedDiagnosticReplayStream,
  createCompactDiagnosticRunIdentity,
  digestDiagnosticArtifactChunks,
  verifyDiagnosticReplayStream,
  writeDiagnosticReplayStream,
  type DiagnosticReplayReadLimits,
  type VerifiedCompactDiagnosticRunProvenance,
} from "../src/index.js";
import { definition } from "./fixtures/diagnosticIdentityRun.js";
import { currentEmptyGridReleaseTags } from "./diagnosticReleaseTags.js";

const limits: DiagnosticReplayReadLimits = {
  maximumEncodedBytes: 16_000_000,
  maximumArtifacts: 10,
  maximumRuns: 10,
  maximumArtifactBytes: 1_000_000,
  maximumInputDepth: 64,
  maximumInputNodes: 100_000,
  maximumInputStringUnits: 300_000,
  maximumInputTotalStringUnits: 1_000_000,
};
const sourceBytes: Readonly<Record<string, Uint8Array>> = {
  "loss-run": new Uint8Array([1]),
  exposures: new Uint8Array([2]),
};

function rawInput(overrides: Record<string, unknown> = {}) {
  return {
    definition,
    losses: [
      {
        rowType: "aggregate",
        recordId: "r1",
        sourceGroup: "fleet",
        origin: "2025",
        valuation: "2025Q1",
        complete: true,
        source: { artifactId: "loss-run", sourceRow: 2 },
        measures: { reported: 4 },
      },
    ],
    exposures: [
      {
        key: "e1",
        sourceGroup: "fleet",
        origin: "2025",
        measureId: "exposure",
        value: 20,
        complete: true,
        source: { artifactId: "exposures", sourceRow: 2 },
      },
    ],
    datasetArtifactId: "loss-run",
    runPresetId: "annual-frequency-v1",
    ...overrides,
  };
}

async function fixture(
  overrides: Record<string, unknown> = {},
  bytes = sourceBytes,
) {
  const raw = rawInput(overrides);
  const validated = validateDiagnosticRunInputCompact(raw);
  const completedRun = runValidatedMetricDiagnosticsCompact(validated);
  if (completedRun.status !== "completed")
    throw new Error("Fixture unexpectedly blocked");
  const policy = overrides.policy as { rationaleRef?: string } | undefined;
  const provenance = createCompactDiagnosticRunIdentity({
    completedRun,
    inputArtifacts: await Promise.all(
      Object.entries(bytes).map(([id, value]) =>
        digestDiagnosticArtifactChunks({ id, scope: "input" }, [value]),
      ),
    ),
    preparationArtifacts: policy?.rationaleRef
      ? [
          {
            id: policy.rationaleRef,
            scope: "preparation",
            assurance: "caller-declared",
            algorithm: "memo",
            value: "reviewed",
          },
        ]
      : [],
    preparationLineage: [],
  });
  return { raw, validated, completedRun, provenance };
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}
async function archive(
  provenance: VerifiedCompactDiagnosticRunProvenance,
  id = "analysis",
) {
  return collect(
    writeDiagnosticReplayStream({
      runs: [{ id, provenance }],
      openArtifact: (artifact) => [sourceBytes[artifact.id]!],
    }),
  );
}
function* split(chunks: readonly Uint8Array[], size: number) {
  for (const chunk of chunks)
    for (let index = 0; index < chunk.length; index += size)
      yield chunk.subarray(index, index + size);
}
type Frame = (string | number | boolean | null)[];
function frames(chunks: readonly Uint8Array[]): Frame[] {
  // Fixtures only: production reader never parses a whole archive this way.
  return Buffer.concat(chunks)
    .toString("utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as Frame);
}
function encoded(values: readonly Frame[]): Uint8Array[] {
  return values.map((value) =>
    new TextEncoder().encode(`${JSON.stringify(value)}\n`),
  );
}
function restamp(values: Frame[]): Uint8Array[] {
  for (let index = 0; index < values.length; index++) values[index]![0] = index;
  const digest = createHash("sha256");
  for (const value of values.slice(0, -1))
    digest.update(`${JSON.stringify(value)}\n`);
  values.at(-1)![4] = digest.digest("hex");
  return encoded(values);
}
const tags = (value: VerifiedCompactDiagnosticRunProvenance) => ({
  runFingerprint: value.runFingerprint,
  resultFingerprint: value.resultFingerprint,
  runResultFingerprint: value.runResultFingerprint,
});

describe("authenticated streaming diagnostic replay", () => {
  it.each([
    { name: "implicit grid", overrides: {} },
    { name: "explicit empty grid", overrides: { expectedCells: [] } },
    {
      name: "source-null expected grid",
      overrides: {
        expectedCells: [
          { sourceGroup: "fleet", origin: "2025", valuation: "2025Q1" },
        ],
      },
    },
    {
      name: "filter and review source normalization",
      overrides: {
        filter: { instanceIds: ["reported-frequency"] },
        reviewEvidence: {
          groupingAssignments: [
            {
              key: "fleet",
              group: "fleet",
              source: { artifactId: "loss-run", sourceRow: 2 },
            },
          ],
          cachedFormulas: [],
        },
        groupDimensions: {
          fleet: {
            source: { userValue: "not a source coordinate" },
            ["__proto__"]: [0, null, "Unicode 😀"],
          },
        },
      },
    },
    {
      name: "triggered rule under justified fail policy",
      overrides: {
        definition: {
          ...definition,
          reviewRules: [
            {
              id: "claims-limit",
              kind: "compare",
              code: "limit",
              description: "Review high claims",
              severity: "fail",
              missingInput: "not-evaluated",
              when: {
                left: { op: "measure", measureId: "reported" },
                operator: "gt",
                right: { op: "constant", value: 2 },
              },
            },
          ],
        },
        policy: {
          allowedReviewStatuses: ["pass", "warning", "not-evaluated", "fail"],
          rationaleRef: "review-note",
        },
      },
    },
  ])("replays all evidence and old tags: $name", async ({ overrides }) => {
    const { provenance } = await fixture(overrides);
    const chunks = await archive(provenance);
    const receipt = await verifyDiagnosticReplayStream(split(chunks, 7), {
      limits,
    });
    expect(receipt).toMatchObject({
      format: "diagnostic-replay",
      version: 1,
      runs: [{ id: "analysis", ...tags(provenance) }],
    });
    expect(receipt.artifacts).toEqual([
      ...provenance.inputArtifacts,
      ...provenance.preparationArtifacts,
    ]);
    expect(receipt.frameDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(() => assertVerifiedDiagnosticReplayStream(receipt)).not.toThrow();
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.runs[0])).toBe(true);
    expect(Object.hasOwn(receipt.runs[0]!, "result")).toBe(false);
    expect(Object.hasOwn(receipt.runs[0]!, "manifest")).toBe(false);
    for (const fake of [
      { ...receipt },
      JSON.parse(JSON.stringify(receipt)),
      {},
      null,
    ])
      expect(() => assertVerifiedDiagnosticReplayStream(fake)).toThrow(
        /authentic/,
      );
  });

  it("keeps the empty-grid numerical identity and reviewed release tags exactly", async () => {
    const { provenance } = await fixture({ expectedCells: [] });
    const receipt = await verifyDiagnosticReplayStream(
      await archive(provenance),
      { limits },
    );
    expect(receipt.runs[0]).toEqual({
      id: "analysis",
      runFingerprint: currentEmptyGridReleaseTags.run,
      resultFingerprint: currentEmptyGridReleaseTags.result,
      runResultFingerprint: currentEmptyGridReleaseTags.binding,
    });
  });

  it("writes shared artifacts once and verifies distinct runs sequentially", async () => {
    const first = await fixture();
    const second = await fixture({ expectedCells: [] });
    const openArtifact = vi.fn((artifact: { id: string }) => [
      sourceBytes[artifact.id]!,
    ]);
    const chunks = await collect(
      writeDiagnosticReplayStream({
        runs: [
          { id: "first", provenance: first.provenance },
          { id: "second", provenance: second.provenance },
        ],
        openArtifact,
      }),
    );
    expect(openArtifact).toHaveBeenCalledTimes(2);
    expect(
      frames(chunks).filter((frame) => frame[1] === "artifact"),
    ).toHaveLength(2);
    const receipt = await verifyDiagnosticReplayStream(chunks, { limits });
    expect(receipt.runs).toEqual([
      { id: "first", ...tags(first.provenance) },
      { id: "second", ...tags(second.provenance) },
    ]);
  });

  it("snapshots writer metadata immediately and never freezes caller input", async () => {
    const made = await fixture();
    const entry = { id: "original", provenance: made.provenance };
    const options = {
      runs: [entry],
      openArtifact: (artifact: { id: string }) => [sourceBytes[artifact.id]!],
    };
    const stream = writeDiagnosticReplayStream(options);
    entry.id = "changed";
    options.runs.length = 0;
    options.openArtifact = () => {
      throw new Error("later callback must not be used");
    };
    made.raw.losses[0]!.measures.reported = 999;
    const receipt = await verifyDiagnosticReplayStream(stream, { limits });
    expect(receipt.runs).toEqual([
      { id: "original", ...tags(made.provenance) },
    ]);
    expect(Object.isFrozen(options)).toBe(false);
    expect(
      Reflect.set(made.validated.losses[0]!.measures, "reported", 999),
    ).toBe(false);
  });

  it("preserves long tokens, split UTF-8 strings, raw nonfinite values and signed zero", async () => {
    const original = rawInput();
    const losses = [
      { ...original.losses[0]!, measures: { reported: -0 } },
      ...[NaN, Infinity, -Infinity].map((value, index) => ({
        ...original.losses[0]!,
        recordId: `excluded-${index}`,
        sourceGroup: "elsewhere",
        measures: { reported: value },
      })),
    ];
    const made = await fixture({
      losses,
      filter: { sourceGroups: ["fleet"] },
      groupDimensions: {
        fleet: { text: "x".repeat(16_383) + "🧮" + "z".repeat(20_000) },
      },
      policy: {
        allowedReviewStatuses: ["pass", "warning", "not-evaluated", "fail"],
        rationaleRef: "review-note",
      },
    });
    const id = "analysis-" + "λ".repeat(90_000);
    const chunks = await archive(made.provenance, id);
    const receipt = await verifyDiagnosticReplayStream(split(chunks, 127), {
      limits,
    });
    expect(receipt.runs).toEqual([{ id, ...tags(made.provenance) }]);
  });

  it("requires authentic owners and rejects duplicate/conflicting metadata before writing", async () => {
    const made = await fixture();
    const opener = vi.fn(() => [new Uint8Array([1])]);
    expect(() =>
      writeDiagnosticReplayStream({
        runs: [{ id: "a", provenance: { ...made.provenance } }],
        openArtifact: opener,
      }),
    ).toThrow(/authentic/);
    expect(() =>
      writeDiagnosticReplayStream({
        runs: [
          { id: "a", provenance: made.provenance },
          { id: "a", provenance: made.provenance },
        ],
        openArtifact: opener,
      }),
    ).toThrow(/unique/);
    const other = await fixture(
      {},
      { "loss-run": new Uint8Array([9]), exposures: sourceBytes.exposures! },
    );
    expect(() =>
      writeDiagnosticReplayStream({
        runs: [
          { id: "a", provenance: made.provenance },
          { id: "b", provenance: other.provenance },
        ],
        openArtifact: opener,
      }),
    ).toThrow(/conflicting/);
    expect(opener).not.toHaveBeenCalled();
  });

  it.each(["manifest", "result"])(
    "rejects altered full %s evidence even after rehashing the archive",
    async (channel) => {
      const made = await fixture();
      const rows = frames(await archive(made.provenance));
      const target = rows.find((frame) => frame[1] === channel)!;
      target[2] = "!" + String(target[2]).slice(1);
      await expect(
        verifyDiagnosticReplayStream(restamp(rows), { limits }),
      ).rejects.toThrow(/evidence differs/);
    },
  );

  it("reruns changed raw input rather than trusting stored tags or a fresh trailer", async () => {
    const made = await fixture();
    const rows = frames(await archive(made.provenance));
    const runStart = rows.findIndex((frame) => frame[1] === "run");
    const target = rows.find(
      (frame, index) =>
        index > runStart && frame[1] === "scalar" && frame[2] === 4,
    )!;
    target[2] = 8;
    await expect(
      verifyDiagnosticReplayStream(restamp(rows), { limits }),
    ).rejects.toThrow(/evidence differs/);
  });

  it("rehashes source bytes, not merely the final event sequence", async () => {
    const made = await fixture();
    const rows = frames(await archive(made.provenance));
    rows.find((frame) => frame[1] === "bytes")![2] = Buffer.from([9]).toString(
      "base64",
    );
    await expect(
      verifyDiagnosticReplayStream(restamp(rows), { limits }),
    ).rejects.toThrow(/bytes do not match/);
    await expect(
      collect(
        writeDiagnosticReplayStream({
          runs: [{ id: "a", provenance: made.provenance }],
          openArtifact: () => [new Uint8Array([9])],
        }),
      ),
    ).rejects.toThrow(/changed/);
  });

  it("requires the complete trailer, EOF, correct ordering and exact event arity", async () => {
    const made = await fixture();
    const chunks = await archive(made.provenance);
    const rows = frames(chunks);
    for (const broken of [
      chunks.slice(0, -1),
      [...chunks, new TextEncoder().encode('[999,"extra"]\n')],
      [chunks[0]!.subarray(0, chunks[0]!.length - 1)],
    ])
      await expect(
        verifyDiagnosticReplayStream(broken, { limits }),
      ).rejects.toThrow();
    const unknown = rows.map((row) => [...row]);
    unknown.splice(1, 0, [0, "mystery"]);
    await expect(
      verifyDiagnosticReplayStream(restamp(unknown), { limits }),
    ).rejects.toThrow();
    const wrongOrder = rows.map((row) => [...row]);
    wrongOrder.find((row) => row[1] === "manifest")![1] = "result";
    await expect(
      verifyDiagnosticReplayStream(restamp(wrongOrder), { limits }),
    ).rejects.toThrow(/Expected manifest/);
    const arity = rows.map((row) => [...row]);
    arity[0]!.push("extra");
    await expect(
      verifyDiagnosticReplayStream(restamp(arity), { limits }),
    ).rejects.toThrow(/arity/);
    const digest = rows.map((row) => [...row]);
    digest.at(-1)![4] = "0".repeat(64);
    await expect(
      verifyDiagnosticReplayStream(encoded(digest), { limits }),
    ).rejects.toThrow(/integrity digest/);
    const sequence = rows.map((row) => [...row]);
    sequence[1]![0] = 100;
    await expect(
      verifyDiagnosticReplayStream(encoded(sequence), { limits }),
    ).rejects.toThrow(/sequence/);
  });

  it("rejects duplicate artifact/run identities even with an updated trailer", async () => {
    const made = await fixture();
    const rows = frames(await archive(made.provenance));
    const artifactStart = rows.findIndex((row) => row[1] === "artifact");
    const artifactEnd = rows.findIndex((row) => row[1] === "artifact-end");
    const duplicates = rows.map((row) => [...row]);
    duplicates.splice(
      artifactEnd + 1,
      0,
      ...rows.slice(artifactStart, artifactEnd + 1).map((row) => [...row]),
    );
    duplicates.at(-1)![2] = 3;
    await expect(
      verifyDiagnosticReplayStream(restamp(duplicates), { limits }),
    ).rejects.toThrow(/Duplicate artifact/);
    const runStart = rows.findIndex((row) => row[1] === "run");
    const repeated = rows.map((row) => [...row]);
    repeated.splice(-1, 0, ...rows.slice(runStart, -1).map((row) => [...row]));
    repeated.at(-1)![3] = 2;
    await expect(
      verifyDiagnosticReplayStream(restamp(repeated), { limits }),
    ).rejects.toThrow(/Duplicate run/);
  });

  it("enforces every explicit reader resource limit", async () => {
    const made = await fixture();
    const chunks = await archive(made.provenance);
    for (const key of [
      "maximumEncodedBytes",
      "maximumArtifacts",
      "maximumInputDepth",
      "maximumInputNodes",
      "maximumInputStringUnits",
      "maximumInputTotalStringUnits",
    ] as const)
      await expect(
        verifyDiagnosticReplayStream(chunks, {
          limits: { ...limits, [key]: 1 },
        }),
      ).rejects.toThrow(/limit/);
    const multi = await collect(
      writeDiagnosticReplayStream({
        runs: [
          { id: "a", provenance: made.provenance },
          { id: "b", provenance: made.provenance },
        ],
        openArtifact: (artifact) => [sourceBytes[artifact.id]!],
      }),
    );
    await expect(
      verifyDiagnosticReplayStream(multi, {
        limits: { ...limits, maximumRuns: 1 },
      }),
    ).rejects.toThrow(/run count limit/);
    const biggerBytes = {
      "loss-run": new Uint8Array([1, 2]),
      exposures: sourceBytes.exposures!,
    };
    const bigger = await fixture({}, biggerBytes);
    const biggerArchive = await collect(
      writeDiagnosticReplayStream({
        runs: [{ id: "a", provenance: bigger.provenance }],
        openArtifact: (artifact) => [
          biggerBytes[artifact.id as keyof typeof biggerBytes],
        ],
      }),
    );
    await expect(
      verifyDiagnosticReplayStream(biggerArchive, {
        limits: { ...limits, maximumArtifactBytes: 1 },
      }),
    ).rejects.toThrow(/maximum|limit|ceiling/);
  });

  it("closes producers on early writer return, failed artifact bytes and reader errors", async () => {
    const made = await fixture();
    let closed = 0;
    async function* source() {
      try {
        yield new Uint8Array([1]);
      } finally {
        closed++;
      }
    }
    const writer = writeDiagnosticReplayStream({
      runs: [{ id: "a", provenance: made.provenance }],
      openArtifact: source,
    });
    for (;;) {
      const next = await writer.next();
      if (new TextDecoder().decode(next.value).includes('"bytes"')) break;
    }
    await writer.return(undefined);
    expect(closed).toBe(1);
    async function* tooLarge() {
      try {
        yield new Uint8Array(65_537);
      } finally {
        closed++;
      }
    }
    await expect(
      collect(
        writeDiagnosticReplayStream({
          runs: [{ id: "a", provenance: made.provenance }],
          openArtifact: tooLarge,
        }),
      ),
    ).rejects.toThrow(/64 KiB/);
    expect(closed).toBe(2);
    async function* corrupt() {
      try {
        yield new TextEncoder().encode("not-json\n");
      } finally {
        closed++;
      }
    }
    await expect(
      verifyDiagnosticReplayStream(corrupt(), { limits }),
    ).rejects.toThrow();
    expect(closed).toBe(3);
  });

  it("checks cancellation and closes an active reader source", async () => {
    const made = await fixture();
    const controller = new AbortController();
    controller.abort();
    const opener = vi.fn(() => [new Uint8Array([1])]);
    expect(() =>
      writeDiagnosticReplayStream({
        runs: [{ id: "a", provenance: made.provenance }],
        openArtifact: opener,
        signal: controller.signal,
      }),
    ).toThrow();
    expect(() =>
      verifyDiagnosticReplayStream([], { limits, signal: controller.signal }),
    ).toThrow();
    expect(opener).not.toHaveBeenCalled();
    const active = new AbortController();
    let closed = false;
    async function* chunks() {
      try {
        yield new TextEncoder().encode('[0,"diagnostic-replay",1]\n');
        active.abort();
        yield new TextEncoder().encode('[1,"end",0,0,"x"]\n');
      } finally {
        closed = true;
      }
    }
    await expect(
      verifyDiagnosticReplayStream(chunks(), { limits, signal: active.signal }),
    ).rejects.toThrow();
    expect(closed).toBe(true);
  });

  it("closes an acquired artifact without starting its first read if cancellation occurred while opening", async () => {
    const made = await fixture();
    const controller = new AbortController();
    const next = vi.fn(async () => ({
      value: new Uint8Array([1]),
      done: false as const,
    }));
    const close = vi.fn(async () => ({
      value: undefined,
      done: true as const,
    }));
    const source = { [Symbol.asyncIterator]: () => ({ next, return: close }) };
    const writer = writeDiagnosticReplayStream({
      runs: [{ id: "a", provenance: made.provenance }],
      signal: controller.signal,
      openArtifact: async () => {
        controller.abort();
        return source;
      },
    });
    await expect(collect(writer)).rejects.toThrow();
    expect(next).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate input object keys before SDK replay even with a fresh frame digest", async () => {
    const made = await fixture();
    const rows = frames(await archive(made.provenance));
    const start = rows.findIndex((row) => row[1] === "run");
    expect(rows[start + 1]?.[1]).toBe("object");
    expect(rows[start + 3]?.[2]).toBe("id");
    const firstField = rows.slice(start + 2, start + 8).map((row) => [...row]);
    rows.splice(start + 8, 0, ...firstField);
    await expect(
      verifyDiagnosticReplayStream(restamp(rows), { limits }),
    ).rejects.toThrow(/strictly increasing and unique/);
  });

  it("identifies the digest as canonical event content, not transport whitespace bytes", async () => {
    const made = await fixture();
    const rows = frames(await archive(made.provenance));
    const canonicalReceipt = await verifyDiagnosticReplayStream(encoded(rows), {
      limits,
    });
    const spaced = rows.map((row) =>
      new TextEncoder().encode(` ${JSON.stringify(row)} \n`),
    );
    const spacedReceipt = await verifyDiagnosticReplayStream(spaced, {
      limits,
    });
    expect(spacedReceipt.frameDigest).toBe(canonicalReceipt.frameDigest);
    expect(
      createHash("sha256").update(Buffer.concat(spaced)).digest("hex"),
    ).not.toBe(canonicalReceipt.frameDigest);
  });

  it("round-trips full 64 KiB artifact chunks and snapshots a reusable producer buffer", async () => {
    const block = Uint8Array.from(
      { length: 65_536 },
      (_, index) => index % 251,
    );
    const bytes = {
      "loss-run": new Uint8Array([...block, ...block]),
      exposures: sourceBytes.exposures!,
    };
    const made = await fixture({}, bytes);
    async function* lossChunks() {
      const reusable = new Uint8Array(block);
      yield reusable;
      yield reusable;
      reusable.fill(0);
    }
    const chunks = await collect(
      writeDiagnosticReplayStream({
        runs: [{ id: "a", provenance: made.provenance }],
        openArtifact: (artifact) =>
          artifact.id === "loss-run" ? lossChunks() : [bytes.exposures],
      }),
    );
    expect(chunks.every((chunk) => chunk.length <= 131_072)).toBe(true);
    const receipt = await verifyDiagnosticReplayStream(split(chunks, 11_111), {
      limits,
    });
    expect(receipt.runs[0]).toEqual({ id: "a", ...tags(made.provenance) });
    expect(
      receipt.artifacts.find((artifact) => artifact.id === "loss-run"),
    ).toMatchObject({ byteLength: 131_072 });
  });

  it("preserves the original rejected reader next error and closes once when return also rejects", async () => {
    const readError = new Error("original read failure");
    const cleanupError = new Error("secondary reader cleanup failure");
    const next = vi.fn(async () => {
      throw readError;
    });
    const close = vi.fn(async () => {
      throw cleanupError;
    });
    const source = { [Symbol.asyncIterator]: () => ({ next, return: close }) };
    await expect(verifyDiagnosticReplayStream(source, { limits })).rejects.toBe(
      readError,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("preserves malformed-frame and full-evidence mismatch errors when reader cleanup rejects", async () => {
    const made = await fixture();
    const rows = frames(await archive(made.provenance));
    rows.find((row) => row[1] === "manifest")![2] = "!";
    const cases = [
      {
        chunks: [new TextEncoder().encode("not-json\n")],
        expected: /valid UTF-8 JSON/,
      },
      { chunks: restamp(rows), expected: /manifest evidence differs/ },
    ];
    for (const { chunks, expected } of cases) {
      let index = 0;
      const next = vi.fn(
        async (): Promise<IteratorResult<Uint8Array>> =>
          index < chunks.length
            ? { done: false, value: chunks[index++]! }
            : { done: true, value: undefined },
      );
      const close = vi.fn(async () => {
        throw new Error(
          "secondary cleanup must not replace verification error",
        );
      });
      const source = {
        [Symbol.asyncIterator]: () => ({ next, return: close }),
      };
      await expect(
        verifyDiagnosticReplayStream(source, { limits }),
      ).rejects.toThrow(expected);
      expect(close).toHaveBeenCalledTimes(1);
    }
  });

  it("preserves the original rejected artifact read error when writer cleanup also rejects", async () => {
    const made = await fixture();
    const readError = new Error("original artifact read failure");
    const next = vi.fn(async () => {
      throw readError;
    });
    const close = vi.fn(async () => {
      throw new Error("secondary artifact cleanup failure");
    });
    const source = { [Symbol.asyncIterator]: () => ({ next, return: close }) };
    const writer = writeDiagnosticReplayStream({
      runs: [{ id: "a", provenance: made.provenance }],
      openArtifact: () => source,
    });
    await expect(collect(writer)).rejects.toBe(readError);
    expect(next).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
