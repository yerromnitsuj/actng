import { describe, expect, it } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { createSha256 } from "../src/sha256Stream.js";
import {
  assertComputedDiagnosticArtifactDigest,
  digestDiagnosticArtifactChunks,
  type DiagnosticArtifactStreamMetadata,
} from "../src/diagnosticArtifactStream.js";

const encode = (value: string) => new TextEncoder().encode(value);
const oracle = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const metadata: DiagnosticArtifactStreamMetadata = { id: "input/losses", scope: "input" };
function* split(bytes: Uint8Array, size: number) {
  for (let index = 0; index < bytes.length; index += size)
    yield bytes.subarray(index, index + size);
}

describe("incremental SHA-256", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
  ])("matches fixed SHA-256 vector %j", (text, expected) => {
    const hash = createSha256();
    for (const byte of encode(text)) hash.update(new Uint8Array([byte]));
    expect(hash.digest()).toBe(expected);
  });

  it("matches the million-a vector without retaining the message", () => {
    const hash = createSha256();
    const bytes = new Uint8Array(1000).fill(97);
    for (let index = 0; index < 1000; index++) hash.update(bytes);
    expect(hash.digest()).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });

  it("matches independent Node/WebCrypto implementations across padding and chunk boundaries", async () => {
    for (const length of [
      0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 4095, 4096, 4097, 65535, 65536, 65537,
    ]) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 71 + length) % 256);
      const expected = oracle(bytes);
      expect(Buffer.from(await webcrypto.subtle.digest("SHA-256", bytes)).toString("hex")).toBe(
        expected,
      );
      for (const size of [1, 7, 55, 64, 127, 4096, 65536]) {
        const hash = createSha256();
        for (const chunk of split(bytes, size)) hash.update(chunk);
        expect(hash.digest(), `${length} bytes / ${size} chunk`).toBe(expected);
      }
    }
  });

  it("refuses reuse of finalized state", () => {
    const hash = createSha256();
    hash.digest();
    expect(() => hash.digest()).toThrow(/finalized/);
    expect(() => hash.update(encode("late"))).toThrow(/finalized/);
  });
});

describe("owned streamed artifact digests", () => {
  it("issues an immutable authentic handle only after consuming all bytes", async () => {
    const bytes = encode("normalized source data 🧮");
    const digest = await digestDiagnosticArtifactChunks(
      { ...metadata, expectedByteLength: bytes.length },
      split(bytes, 3),
    );
    expect(digest).toEqual({
      ...metadata,
      assurance: "sdk-computed",
      algorithm: "sha256",
      value: oracle(bytes),
      byteLength: bytes.length,
    });
    expect(() => assertComputedDiagnosticArtifactDigest(digest)).not.toThrow();
    expect(Object.isFrozen(digest)).toBe(true);
    for (const forged of [null, { ...digest }, JSON.parse(JSON.stringify(digest))])
      expect(() => assertComputedDiagnosticArtifactDigest(forged)).toThrow(/authentic/);
  });

  it("snapshots metadata before awaiting and consumes reused chunk buffers synchronously", async () => {
    const input = { id: "original", scope: "input" as const };
    const reused = new Uint8Array([1, 2, 3]);
    async function* chunks() {
      input.id = "changed";
      yield reused;
      reused.fill(4);
      yield reused;
      reused.fill(0);
    }
    const digest = await digestDiagnosticArtifactChunks(input, chunks());
    expect(digest.id).toBe("original");
    expect(digest.value).toBe(oracle(new Uint8Array([1, 2, 3, 4, 4, 4])));
  });

  it("supports nonzero-offset and large chunks without using overridable accessors", async () => {
    class HostileChunk extends Uint8Array {
      override get byteLength(): number {
        throw new Error("overridden byteLength");
      }
      override get byteOffset(): number {
        throw new Error("overridden byteOffset");
      }
      override get buffer(): ArrayBuffer {
        throw new Error("overridden buffer");
      }
      override subarray(): never {
        throw new Error("overridden subarray");
      }
    }
    const bytes = Uint8Array.from({ length: 200_010 }, (_, index) => index % 256);
    const chunk = new HostileChunk(bytes.buffer, 7, 200_000);
    const digest = await digestDiagnosticArtifactChunks(metadata, [chunk]);
    expect(digest.byteLength).toBe(200_000);
    expect(digest.value).toBe(oracle(bytes.subarray(7, 200_007)));
  });

  it.each([
    { expectedByteLength: 4 },
    { expectedByteLength: 2 },
    { maximumByteLength: 2 },
    { maximumByteLength: -1 },
    { expectedByteLength: 1.5 },
    { expectedByteLength: Number.MAX_SAFE_INTEGER + 1 },
    { expectedByteLength: 5, maximumByteLength: 4 },
    { expectedByteLength: undefined },
    { id: "" },
    { scope: "untrusted" },
    { extra: true },
  ])("rejects invalid, truncated or oversized evidence %#", async (change) => {
    await expect(
      digestDiagnosticArtifactChunks(
        { ...metadata, ...change } as DiagnosticArtifactStreamMetadata,
        [new Uint8Array([1, 2, 3])],
      ),
    ).rejects.toThrow();
  });

  it("rejects shared, detached, proxied, and non-byte chunks", async () => {
    const detached = new Uint8Array(3);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    for (const chunk of [
      new Uint8Array(new SharedArrayBuffer(8)),
      detached,
      new Proxy(new Uint8Array(3), {}),
      new Uint16Array(3),
      "abc",
    ])
      await expect(
        digestDiagnosticArtifactChunks(metadata, [chunk] as Uint8Array[]),
      ).rejects.toThrow();
  });

  it("rejects in-bounds and out-of-bounds resizable buffers", async () => {
    const buffer = Reflect.construct(ArrayBuffer, [8, { maxByteLength: 16 }]) as ArrayBuffer & {
      resize(length: number): void;
    };
    const chunk = new Uint8Array(buffer, 4, 4);
    await expect(digestDiagnosticArtifactChunks(metadata, [chunk])).rejects.toThrow(/Resizable/);
    buffer.resize(2);
    await expect(digestDiagnosticArtifactChunks(metadata, [chunk])).rejects.toThrow(/Resizable/);
  });

  it("validates and uses the same descriptor snapshot for hostile metadata", async () => {
    let reads = 0;
    const changing = new Proxy(metadata, {
      get(target, key, receiver) {
        if (key === "scope") return reads++ === 0 ? "input" : "invalid-scope";
        return Reflect.get(target, key, receiver);
      },
    });
    const digest = await digestDiagnosticArtifactChunks(changing, []);
    expect(digest.scope).toBe("input");
    expect(reads).toBe(0);
    await expect(
      digestDiagnosticArtifactChunks(
        {
          ...metadata,
          get scope(): never {
            throw new Error("accessed");
          },
        },
        [],
      ),
    ).rejects.toThrow(/data properties/);
  });

  it("captures the genuine cancellation signal instead of trusting replaceable methods/options", async () => {
    const controller = new AbortController();
    const options: { signal?: AbortSignal } = { signal: controller.signal };
    Object.defineProperty(controller.signal, "throwIfAborted", { value: () => {} });
    async function* chunks() {
      yield new Uint8Array(2);
      controller.abort(new Error("genuine abort"));
      delete options.signal;
      yield new Uint8Array(2);
    }
    await expect(digestDiagnosticArtifactChunks(metadata, chunks(), options)).rejects.toThrow(
      "genuine abort",
    );
    await expect(
      digestDiagnosticArtifactChunks(metadata, [], {
        signal: { throwIfAborted() {} } as unknown as AbortSignal,
      }),
    ).rejects.toThrow(/AbortSignal/);
  });

  it("propagates producer errors and closes the producer on limits and cancellation", async () => {
    const abort = new AbortController();
    let closed = false;
    async function* chunks() {
      try {
        yield new Uint8Array(4);
        abort.abort(new Error("cancelled"));
        yield new Uint8Array(4);
      } finally {
        closed = true;
      }
    }
    await expect(
      digestDiagnosticArtifactChunks(metadata, chunks(), { signal: abort.signal }),
    ).rejects.toThrow("cancelled");
    expect(closed).toBe(true);
    closed = false;
    await expect(
      digestDiagnosticArtifactChunks({ ...metadata, maximumByteLength: 0 }, chunks()),
    ).rejects.toThrow(/ceiling/);
    expect(closed).toBe(true);
    async function* broken() {
      yield new Uint8Array(4);
      throw new Error("source failed");
    }
    await expect(digestDiagnosticArtifactChunks(metadata, broken())).rejects.toThrow(
      "source failed",
    );
  });
});
