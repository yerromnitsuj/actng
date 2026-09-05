/**
 * Private incremental SHA-256, following FIPS 180-4 sections 4.1.2, 4.2.2,
 * 5.1.1, 5.3.3 and 6.2.2. No I/O, dependencies or whole-message buffering.
 * https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf
 * This implementation is not a NIST/FIPS-validated cryptographic module.
 */
const ROUND = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotate = (value: number, count: number) => (value >>> count) | (value << (32 - count));

/** Internal state never escapes; update consumes bytes synchronously. */
export function createSha256() {
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const block = new Uint8Array(64);
  const words = new Uint32Array(64);
  let buffered = 0;
  let byteLength = 0;
  let finalized = false;

  function compress() {
    const view = new DataView(block.buffer);
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(index * 4, false);
    for (let index = 16; index < 64; index++) {
      const a = words[index - 15]!;
      const b = words[index - 2]!;
      const small0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3);
      const small1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10);
      words[index] = (words[index - 16]! + small0 + words[index - 7]! + small1) >>> 0;
    }
    let a = state[0]!,
      b = state[1]!,
      c = state[2]!,
      d = state[3]!;
    let e = state[4]!,
      f = state[5]!,
      g = state[6]!,
      h = state[7]!;
    for (let index = 0; index < 64; index++) {
      const large1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choose = (e & f) ^ (~e & g);
      const t1 = (h + large1 + choose + ROUND[index]! + words[index]!) >>> 0;
      const large0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (large0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const completed = [a, b, c, d, e, f, g, h];
    for (let index = 0; index < 8; index++)
      state[index] = (state[index]! + completed[index]!) >>> 0;
  }

  return {
    update(bytes: Uint8Array): void {
      if (finalized) throw new Error("SHA-256 state is finalized");
      if (!Number.isSafeInteger(byteLength + bytes.byteLength))
        throw new RangeError("SHA-256 byte length exceeds the safe integer range");
      byteLength += bytes.byteLength;
      let offset = 0;
      while (offset < bytes.byteLength) {
        const count = Math.min(64 - buffered, bytes.byteLength - offset);
        block.set(bytes.subarray(offset, offset + count), buffered);
        buffered += count;
        offset += count;
        if (buffered === 64) {
          compress();
          buffered = 0;
        }
      }
    },
    digest(): string {
      if (finalized) throw new Error("SHA-256 state is finalized");
      finalized = true;
      block[buffered++] = 0x80;
      block.fill(0, buffered);
      if (buffered > 56) {
        compress();
        block.fill(0);
      }
      const view = new DataView(block.buffer);
      // Split the bit length before multiplying: exact for every safe byte length.
      view.setUint32(56, Math.floor(byteLength / 0x20000000), false);
      view.setUint32(60, (byteLength % 0x20000000) * 8, false);
      compress();
      const hex = Array.from(state, (word) => word.toString(16).padStart(8, "0")).join("");
      block.fill(0);
      words.fill(0);
      state.fill(0);
      return hex;
    },
  };
}
