import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { canonicalFnv1a64, canonicalJson, fnv1a64 } from "../src/canonical.js";
import { canonicalFnv1a64 as publicCanonicalFnv1a64 } from "../src/index.js";
import { ReservingError } from "../src/types.js";

/** Frozen pre-streaming traversal: deliberately independent of the shared sink. */
function referenceCanonical(value: unknown, path = "$", seen = new Set<object>()): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isFinite(value))
        throw new ReservingError(
          "UNSUPPORTED_VALUE",
          `non-finite number (${String(value)}) at ${path}`,
        );
      return Object.is(value, -0) ? "0" : String(value);
    }
    case "undefined":
      throw new ReservingError("UNSUPPORTED_VALUE", `undefined at ${path}`);
    case "function":
      throw new ReservingError("UNSUPPORTED_VALUE", `function at ${path}`);
    case "bigint":
    case "symbol":
      throw new ReservingError("UNSUPPORTED_VALUE", `${typeof value} at ${path}`);
    case "object":
      break;
  }
  const obj = value as object;
  if (seen.has(obj)) throw new ReservingError("UNSUPPORTED_VALUE", `circular reference at ${path}`);
  seen.add(obj);
  let out: string;
  if (Array.isArray(obj)) {
    const parts: string[] = [];
    for (let i = 0; i < obj.length; i++)
      parts.push(referenceCanonical(obj[i], `${path}[${i}]`, seen));
    out = `[${parts.join(",")}]`;
  } else {
    const proto: unknown = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      const name = (obj.constructor as { name?: string } | undefined)?.name ?? "unknown";
      throw new ReservingError(
        "UNSUPPORTED_VALUE",
        `non-plain object (${name}) at ${path}; only plain objects, arrays, and JSON primitives are canonicalizable`,
      );
    }
    const parts: string[] = [];
    for (const key of Object.keys(obj).sort()) {
      parts.push(
        `${JSON.stringify(key)}:${referenceCanonical((obj as Record<string, unknown>)[key], `${path}.${key}`, seen)}`,
      );
    }
    out = `{${parts.join(",")}}`;
  }
  seen.delete(obj);
  return out;
}

function errorResult(action: () => unknown) {
  try {
    return { result: action() };
  } catch (error) {
    const failure = error as Error & { code?: string };
    return {
      constructor: failure.constructor,
      name: failure.name,
      code: failure.code,
      message: failure.message,
    };
  }
}

function assertEquivalent(value: unknown) {
  const text = referenceCanonical(value);
  expect(canonicalJson(value)).toBe(text);
  expect(canonicalFnv1a64(value)).toBe(fnv1a64(text));
}

describe("canonicalFnv1a64 streaming integrity tag", () => {
  it("is additive on the public core index and reproduces all committed JCS vectors", () => {
    expect(publicCanonicalFnv1a64).toBe(canonicalFnv1a64);
    const { vectors } = JSON.parse(
      readFileSync(
        new URL("../../../schema/interchange/1.0/jcs-vectors.json", import.meta.url),
        "utf8",
      ),
    ) as {
      vectors: { value: unknown; canonical: string }[];
    };
    for (const { value, canonical } of vectors) {
      expect(canonicalJson(value)).toBe(canonical);
      expect(canonicalFnv1a64(value)).toBe(fnv1a64(canonical));
    }
  });

  it("matches every UTF-16 code unit and escape/surrogate boundaries in strings and keys", () => {
    assertEquivalent(
      Array.from({ length: 0x10000 }, (_, code) => String.fromCharCode(code)).join(""),
    );
    for (const boundary of [0, 4093, 4094, 4095, 4096, 8191, 16381, 16382, 16383, 16384, 32767]) {
      for (const special of [
        "🧪",
        "\ud800",
        "\udfff",
        "\ud800a\udfff",
        "\udbff\udfff",
        '\u0000\n\t\\"',
        "é",
        "\u2028\u2029",
      ]) {
        assertEquivalent({
          ["k".repeat(boundary) + special]: "x".repeat(boundary) + special + "y".repeat(4097),
        });
      }
    }
  });

  it("matches 1,000 seeded nested values with aliases, null prototypes and unusual keys", () => {
    let state = 0x31ac74;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
    const make = (depth: number): unknown => {
      if (depth === 0 || random() % 3 === 0) {
        return [
          null,
          true,
          false,
          -0,
          random() / 10,
          String.fromCharCode(random() & 0xffff),
          "\u0000",
          "🧪",
        ][random() % 8];
      }
      if (random() % 2 === 0) return [make(depth - 1), make(depth - 1)];
      const record = Object.create(random() % 2 ? null : Object.prototype) as Record<
        string,
        unknown
      >;
      for (let index = 0; index < 3; index++)
        Object.defineProperty(record, String(random()) + String.fromCharCode(random() & 0xffff), {
          value: make(depth - 1),
          enumerable: true,
        });
      return record;
    };
    for (let index = 0; index < 1000; index++) assertEquivalent(make(3));
    const shared = { source: { artifactId: "file", sourceRow: 1 }, value: 42 };
    assertEquivalent([shared, shared, { inner: shared }]);
    assertEquivalent(
      Object.assign(Object.create(null), { __proto__: 3, constructor: 2, toJSON: 1 }),
    );
  });

  it.each([
    undefined,
    () => {},
    1n,
    Symbol("x"),
    Number.NaN,
    Infinity,
    -Infinity,
    new Date(0),
    new Map(),
    new Set(),
    /x/,
    new Number(1),
    Object.create({ custom: true }),
  ])("preserves unsupported-value error class, code, text and path for %s", (invalid) => {
    const value = { rows: [{ "a.b[2]": invalid }] };
    const expected = errorResult(() => referenceCanonical(value));
    expect(errorResult(() => canonicalJson(value))).toEqual(expected);
    expect(errorResult(() => canonicalFnv1a64(value))).toEqual(expected);
  });

  it("preserves cycle, hole and first-invalid-field errors", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const value of [cycle, [cycle], Array(2), { z: undefined, a: Number.NaN }]) {
      const expected = errorResult(() => referenceCanonical(value));
      expect(errorResult(() => canonicalJson(value))).toEqual(expected);
      expect(errorResult(() => canonicalFnv1a64(value))).toEqual(expected);
    }
  });

  it("preserves getter/proxy access order, inherited array values and original exceptions", () => {
    const factories: Array<(calls: string[]) => unknown> = [
      (calls) => ({
        get b() {
          calls.push("b");
          return 2;
        },
        get a() {
          calls.push("a");
          return 1;
        },
      }),
      (calls) => ({
        get b() {
          calls.push("b");
          throw new TypeError("getter failed");
        },
        get a() {
          calls.push("a");
          return 1;
        },
      }),
      (calls) => {
        const value = { visible: 1, [Symbol("ignored")]: Number.NaN };
        Object.defineProperty(value, "hidden", {
          get() {
            calls.push("hidden");
            throw new Error("hidden getter");
          },
        });
        return value;
      },
      (calls) => {
        const value = Array(2);
        value[1] = 2;
        Object.setPrototypeOf(
          value,
          Object.create(Array.prototype, {
            0: {
              get() {
                calls.push("inherited-index");
                return 1;
              },
            },
          }),
        );
        return value;
      },
      (calls) =>
        new Proxy(
          { b: 2, a: 1 },
          {
            getPrototypeOf(target) {
              calls.push("prototype");
              return Reflect.getPrototypeOf(target);
            },
            ownKeys(target) {
              calls.push("keys");
              return Reflect.ownKeys(target);
            },
            getOwnPropertyDescriptor(target, key) {
              calls.push(`descriptor:${String(key)}`);
              return Reflect.getOwnPropertyDescriptor(target, key);
            },
            get(target, key) {
              calls.push(`get:${String(key)}`);
              return Reflect.get(target, key);
            },
          },
        ),
      (calls) =>
        new Proxy([1, 2], {
          get(target, key) {
            calls.push(String(key));
            return Reflect.get(target, key);
          },
        }),
      (calls) => {
        const value: { b?: number } = { b: 2 };
        Object.defineProperty(value, "a", {
          enumerable: true,
          get() {
            calls.push("delete-b");
            delete value.b;
            return 1;
          },
        });
        return value;
      },
      (calls) =>
        Object.create({
          get constructor() {
            calls.push("constructor");
            throw new RangeError("constructor failed");
          },
        }),
      () => {
        const { proxy, revoke } = Proxy.revocable({}, {});
        revoke();
        return proxy;
      },
    ];
    const trace = (factory: (typeof factories)[number], method: (value: unknown) => string) => {
      const calls: string[] = [];
      return { result: errorResult(() => method(factory(calls))), calls };
    };
    for (const factory of factories) {
      const expected = trace(factory, (value) => fnv1a64(referenceCanonical(value)));
      expect(trace(factory, (value) => fnv1a64(canonicalJson(value)))).toEqual(expected);
      expect(trace(factory, canonicalFnv1a64)).toEqual(expected);
    }
  });

  it("isolates nested/repeated invocations without mutating caller data", () => {
    const child = Object.freeze({ x: -0, y: "🧪" });
    const expectedChild = fnv1a64(referenceCanonical(child));
    const value = Object.freeze({
      get nested() {
        return canonicalFnv1a64(child);
      },
      child,
    });
    expect(canonicalFnv1a64(value)).toBe(
      fnv1a64(referenceCanonical({ nested: expectedChild, child })),
    );
    expect(canonicalFnv1a64(child)).toBe(expectedChild);
    expect(Object.is(child.x, -0)).toBe(true);
  });

  it("matches the independent oracle for multi-megabyte escaped string atoms", () => {
    const value = { ["key🧪\ud800".repeat(20000)]: '\u0000é🧪\\"\n\ud800'.repeat(100000) };
    assertEquivalent(value);
  });

  it("never hands native escaping/encoding an unbounded string or byte buffer", () => {
    const nativeQuote = JSON.stringify;
    const nativeEncodeInto = TextEncoder.prototype.encodeInto;
    let largestQuoted = 0;
    let largestEncoded = 0;
    let encodedCalls = 0;
    const buffers = new Set<Uint8Array>();
    const quote = vi.spyOn(JSON, "stringify").mockImplementation(((value: unknown) => {
      if (typeof value === "string") largestQuoted = Math.max(largestQuoted, value.length);
      return nativeQuote(value);
    }) as typeof JSON.stringify);
    const encodeInto = vi.spyOn(TextEncoder.prototype, "encodeInto").mockImplementation(function (
      this: InstanceType<typeof TextEncoder>,
      text,
      bytes,
    ) {
      largestEncoded = Math.max(largestEncoded, text.length);
      encodedCalls++;
      buffers.add(bytes);
      const result = nativeEncodeInto.call(this, text, bytes);
      if (result.read !== text.length) throw new Error("UTF-8 chunk was not fully consumed");
      return result;
    });
    try {
      canonicalFnv1a64({ ["key🧪".repeat(10000)]: "\u0000\ud800🧪".repeat(100000) });
    } finally {
      quote.mockRestore();
      encodeInto.mockRestore();
    }
    expect(largestQuoted).toBeLessThanOrEqual(4096);
    expect(largestEncoded).toBeLessThanOrEqual(16384);
    expect(encodedCalls).toBeGreaterThan(10);
    expect(buffers.size).toBe(1);
    expect([...buffers][0]!.byteLength).toBe(49152);
  });
});
