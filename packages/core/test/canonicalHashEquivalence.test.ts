import { describe, expect, it, vi } from "vitest";
import { canonicalJson, fnv1a64 } from "../src/canonical.js";

/** Independent, direct specification implementation; keep separate from limbs. */
function referenceFnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

describe("FNV-1a two-word arithmetic preserves exact integrity tags", () => {
  it.each([
    "", "a", "foobar", "\0", "\0\0\0\0", "\u007f\u0080\u07ff\u0800",
    "\u2028\u2029", "e\u0301", "é", "中文", "🧪𝄞𐀀", "\ud800", "\udfff",
    "\ud800\ud800", "\udfff\udfff", "\udfff\ud800", "\ud800a\udfff",
    "\ud800\udc00", "\udbff\udfff", "\ufffd", "\uffff", "\r\n\t\b\f",
  ])("matches the BigInt specification for UTF-16 input %j", (text) => {
    expect(fnv1a64(text)).toBe(referenceFnv1a64(text));
    expect(fnv1a64(text)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("matches all UTF-16 code units, including TextEncoder surrogate replacement", () => {
    const text = Array.from({ length: 0x10000 }, (_, value) => String.fromCharCode(value)).join("");
    expect(fnv1a64(text)).toBe(referenceFnv1a64(text));
    expect(fnv1a64("\ud800")).toBe(fnv1a64("\ufffd"));
    expect(fnv1a64("\udfff")).toBe(fnv1a64("\ufffd"));
  });

  it("matches seeded mixed strings across repeated low/high-word overflows", () => {
    let state = 0x3ade68b1;
    for (let sample = 0; sample < 1000; sample += 1) {
      let text = "";
      const length = sample < 200 ? sample : Math.floor(sample * 3.7);
      for (let index = 0; index < length; index += 1) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        text += String.fromCharCode(state & 0xffff);
      }
      expect(fnv1a64(text), `seeded sample ${sample}`).toBe(referenceFnv1a64(text));
    }
  });

  it("matches multi-megabyte ASCII and Unicode canonical payloads", () => {
    const payloads = [
      "0123456789abcdef".repeat(131072),
      canonicalJson({
        observations: Array.from({ length: 12000 }, (_, row) => ({
          sourceGroup: "CA",
          origin: "2024Q3",
          valuation: "2025Q2",
          recordId: `row-${row}`,
          description: "Café 🧪 claim \ud800",
          amounts: { incurred: row * 123.45, paid: row * 67.89 },
          sources: [{ artifactId: "input/losses", sourceRow: row + 2 }],
        })),
      }),
    ];
    for (const text of payloads) expect(fnv1a64(text)).toBe(referenceFnv1a64(text));
  });

  it("preserves Unicode byte boundaries across encoding chunks", () => {
    const special = ["a", "\u007f", "\u0080", "\u07ff", "\u0800", "\uffff",
      "\ud800", "\udfff", "\ud800\udc00", "🧪", "\ud800a\udfff"];
    for (const prefixLength of [0, 16381, 16382, 16383, 16384, 32767, 32768]) {
      for (const value of special) {
        const text = "x".repeat(prefixLength) + value + "y".repeat(16385);
        expect(fnv1a64(text)).toBe(referenceFnv1a64(text));
      }
    }
    for (const text of ["\uffff".repeat(49153), "🧪".repeat(32769), "\ud800".repeat(32769)])
      expect(fnv1a64(text)).toBe(referenceFnv1a64(text));
  });

  it("uses one bounded byte buffer for large strings, consuming each chunk fully", () => {
    const text = ("\uffff".repeat(16383) + "🧪").repeat(4);
    const expected = referenceFnv1a64(text);
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    const encodeInto = vi.spyOn(TextEncoder.prototype, "encodeInto");
    try {
      expect(fnv1a64(text)).toBe(expected);
      expect(encode).not.toHaveBeenCalled();
      expect(encodeInto.mock.calls.length).toBeGreaterThan(1);
      const buffers = new Set<Uint8Array>();
      let totalRead = 0;
      for (const [index, [part, buffer]] of encodeInto.mock.calls.entries()) {
        const result = encodeInto.mock.results[index]!;
        expect(part.length).toBeLessThanOrEqual(16384);
        expect(buffer.byteLength).toBe(49152);
        expect(result.type).toBe("return");
        expect(result.value.read).toBe(part.length);
        totalRead += part.length;
        buffers.add(buffer);
      }
      expect(buffers.size).toBe(1);
      expect(totalRead).toBe(text.length);
    } finally {
      encode.mockRestore();
      encodeInto.mockRestore();
    }
  });

  it("retains native TextEncoder coercion and exceptions for untyped callers", () => {
    for (const value of [undefined, null, 123, true, { toString: () => "🧪" }])
      expect(fnv1a64(value as string)).toBe(referenceFnv1a64(value as string));
    expect(() => fnv1a64(Symbol("test") as unknown as string)).toThrow(TypeError);
    const failure = new Error("coercion failed");
    expect(() => fnv1a64({ toString() { throw failure; } } as unknown as string)).toThrow(failure);
  });
});
