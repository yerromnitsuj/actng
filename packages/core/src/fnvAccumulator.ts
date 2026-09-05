/** @internal Shared exact FNV-1a state; deliberately not a package export. */
export function createFnvAccumulator() {
  let high = 0xcbf29ce4;
  let low = 0x84222325;
  return {
    update(bytes: Uint8Array) {
      for (const byte of bytes) {
        low = (low ^ byte) >>> 0;
        // FNV_PRIME = 2^40 + 435. Every intermediate stays below 2^42,
        // preserving the exact modular multiplication of the BigInt form.
        const product = low * 0x1b3;
        high = (high * 0x1b3 + Math.floor(product / 0x100000000) + (low << 8)) >>> 0;
        low = product >>> 0;
      }
    },
    digest() {
      return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
    },
  };
}
