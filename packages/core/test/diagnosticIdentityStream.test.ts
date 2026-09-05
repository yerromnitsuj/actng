import { describe, expect, it, vi } from "vitest";
import { canonicalJson, fnv1a64 } from "../src/canonical.js";
import { projectDiagnosticIdentity } from "../src/diagnosticIdentity.js";
import {
  compareDiagnosticIdentityDocuments,
  compareDiagnosticIdentityJsonChunks,
  createDiagnosticIdentityArray,
  createDiagnosticIdentityObject,
  createDiagnosticIdentityValue,
  fingerprintDiagnosticIdentity,
  iterateDiagnosticIdentityJson,
  type DiagnosticIdentityDocument,
} from "../src/diagnosticIdentityStream.js";
import { assertCompactPreparedDiagnosticData } from "../src/diagnosticPreparation.js";
import { DiagnosticValidationError } from "../src/types.js";

const text = (document: DiagnosticIdentityDocument) =>
  [...iterateDiagnosticIdentityJson(document)].join("");
const expected = (value: unknown) => canonicalJson(projectDiagnosticIdentity(value));
const value = createDiagnosticIdentityValue;

describe("structural identity document projection", () => {
  it("matches legacy projection for 500 seeded mixed values and nested aliases", () => {
    let state = 0x69fe0123;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
    const make = (depth: number): unknown => {
      if (!depth || random() % 3 === 0)
        return [null, true, false, -0, random() / 71, "é🧪\n\t\u0001"][random() % 6];
      if (random() % 2 === 0) return [make(depth - 1), make(depth - 1)];
      const record = Object.create(random() % 2 ? null : Object.prototype) as Record<
        string,
        unknown
      >;
      for (let index = 0; index < 3; index++) record[`key.${random()}[x]`] = make(depth - 1);
      return record;
    };
    for (let index = 0; index < 500; index++) {
      const raw = make(3);
      expect(text(value(raw))).toBe(expected(raw));
    }
    const shared = { artifactId: "loss", sourceRow: -0 };
    const raw = {
      source: shared,
      sources: [shared, shared],
      dimensions: { source: shared },
      groupDimensions: { sources: [shared] },
    };
    expect(text(value(raw))).toBe(expected(raw));
    expect(Object.is(shared.sourceRow, -0)).toBe(true);
  });

  it("inherits source/free-JSON context through composed objects and lazy arrays", () => {
    const source = { artifactId: "file", sourceRow: -0 };
    const sourceDocument = createDiagnosticIdentityObject({
      artifactId: value("file"),
      sourceRow: value(-0),
    });
    const document = createDiagnosticIdentityObject({
      source: sourceDocument,
      sources: createDiagnosticIdentityArray(2, () => sourceDocument),
      dimensions: createDiagnosticIdentityObject({
        source: sourceDocument,
        arbitrary: value({ source: { artifactId: "not-a-source", extra: true } }),
      }),
    });
    expect(text(document)).toBe(
      expected({
        source,
        sources: [source, source],
        dimensions: { source, arbitrary: { source: { artifactId: "not-a-source", extra: true } } },
      }),
    );
    expect(text(document)).toContain('"sourceCell":null');
  });

  it("uses the existing source schema and preserves its error path", () => {
    const document = createDiagnosticIdentityObject({
      rows: createDiagnosticIdentityArray(1, () =>
        createDiagnosticIdentityObject({ source: value({ artifactId: "file", sourceRow: -1 }) }),
      ),
    });
    try {
      text(document);
      expect.fail("should reject the source row");
    } catch (error) {
      expect(error).toBeInstanceOf(DiagnosticValidationError);
      expect((error as DiagnosticValidationError).issues[0]).toMatchObject({
        code: "invalid-number",
        path: "$.rows[0].source.sourceRow",
      });
    }
    expect(() => text(value({ source: { artifactId: "file", extra: 2 } }))).toThrow(
      DiagnosticValidationError,
    );
    const free = { dimensions: { source: { artifactId: "file", extra: 2 } } };
    expect(text(value(free))).toBe(expected(free));
  });

  it("reproduces legacy envelope tags without changing root source context", () => {
    const raw = { artifactId: "not-a-source-at-root", source: { artifactId: "file" }, n: -0 };
    for (const property of ["preparation", "result", "review", "source", "dimensions"]) {
      const envelope = { kind: "diagnostic-test", property };
      expect(fingerprintDiagnosticIdentity(value(raw), envelope)).toBe(
        `fnv1a64-jcs-v1:${fnv1a64(canonicalJson({ identityVersion: 1, kind: envelope.kind, [property]: projectDiagnosticIdentity(raw) }))}`,
      );
    }
    expect(() =>
      fingerprintDiagnosticIdentity(value(raw), { kind: "test", property: "kind" }),
    ).toThrow(DiagnosticValidationError);
  });

  it("does not freeze/snapshot live values or confer prepared-data authenticity", () => {
    const raw = { n: 1 };
    const document = value(raw);
    expect(Object.isFrozen(raw)).toBe(false);
    expect(() => assertCompactPreparedDiagnosticData(document)).toThrow(DiagnosticValidationError);
    const first = fingerprintDiagnosticIdentity(document, { kind: "test", property: "body" });
    raw.n = 2;
    expect(text(document)).toBe('{"n":2}');
    expect(fingerprintDiagnosticIdentity(document, { kind: "test", property: "body" })).not.toBe(
      first,
    );
    const fields = { n: value(1) };
    const copiedFields = createDiagnosticIdentityObject(fields);
    fields.n = value(2);
    expect(text(copiedFields)).toBe('{"n":1}');
    expect(() => text({} as DiagnosticIdentityDocument)).toThrow(DiagnosticValidationError);
  });

  it("expands lazy sequence items only as demanded, and can restart after cancellation", () => {
    let calls = 0;
    const document = createDiagnosticIdentityArray(100000, (index) => {
      calls++;
      return value({ index, detail: "x".repeat(200) });
    });
    expect(calls).toBe(0);
    const iterator = iterateDiagnosticIdentityJson(document);
    const first = iterator.next();
    expect(first.done).toBe(false);
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThan(1000);
    iterator.return(undefined);
    const observedCalls = calls;
    const restarted = iterateDiagnosticIdentityJson(document);
    expect(restarted.next()).toEqual(first);
    restarted.return(undefined);
    expect(calls).toBe(observedCalls * 2);
  });

  it("snapshots object siblings before traversing children but keeps nested values live", () => {
    const raw = { a: "x".repeat(20000), b: 1, c: { value: 1 } };
    const document = value(raw);
    const iterator = iterateDiagnosticIdentityJson(document);
    const first = iterator.next().value!;
    raw.b = 2;
    raw.c.value = 2;
    expect(first + [...iterator].join("")).toBe(expected({ ...raw, b: 1 }));
    // Only the current traversal's sibling slots were captured. A later
    // iteration must not reuse them or a previous normalized representation.
    expect(text(document)).toBe(expected(raw));
  });

  it("reads array items and their current length as traversal reaches them", () => {
    const raw: unknown[] = ["x".repeat(20000), 1, { value: 1 }];
    const iterator = iterateDiagnosticIdentityJson(value(raw));
    const first = iterator.next().value!;
    raw[1] = 2;
    (raw[2] as { value: number }).value = 2;
    raw.push(3);
    expect(first + [...iterator].join("")).toBe(expected(raw));
  });

  it("preserves raw-array and lazy-sequence read order at the comma chunk boundary", () => {
    // The comma fills the first 16,383-unit chunk. A raw index descriptor is
    // captured BEFORE that comma, whereas a lazy callback runs AFTER it.
    const initial = "x".repeat(16379);
    const raw = [initial, 1];
    const rawIterator = iterateDiagnosticIdentityJson(value(raw));
    const rawFirst = rawIterator.next().value!;
    expect(rawFirst.length).toBe(16383);
    expect(rawFirst.endsWith(",")).toBe(true);
    raw[1] = 2;
    expect(rawFirst + [...rawIterator].join("")).toBe(expected([initial, 1]));

    const reads: number[] = [];
    const items = [initial, 1];
    const document = createDiagnosticIdentityArray(items.length, (index) => {
      reads.push(index);
      return value(items[index]);
    });
    const lazyIterator = iterateDiagnosticIdentityJson(document);
    const lazyFirst = lazyIterator.next().value!;
    expect(lazyFirst).toBe(rawFirst);
    expect(reads).toEqual([0]);
    items[1] = 2;
    expect(lazyFirst + [...lazyIterator].join("")).toBe(expected(items));
    expect(reads).toEqual([0, 1]);
  });

  it("validates every sibling descriptor before entering even an invalid earlier child", () => {
    const visits: string[] = [];
    const child = new Proxy(
      { value: NaN },
      {
        ownKeys(target) {
          visits.push("child keys");
          return Reflect.ownKeys(target);
        },
      },
    );
    const getter = vi.fn(() => 1);
    const raw = Object.defineProperty({ a: child }, "b", { enumerable: true, get: getter });
    try {
      text(value(raw));
      expect.fail("should reject the sibling accessor first");
    } catch (error) {
      expect((error as DiagnosticValidationError).issues[0]).toMatchObject({
        path: "$.b",
        message: "JSON objects may contain only data properties",
      });
    }
    expect(visits).toEqual([]);
    expect(getter).not.toHaveBeenCalled();
  });

  it("captures object data descriptors in sorted order without using their get traps", () => {
    const reads: string[] = [];
    const raw = new Proxy(
      { z: 2, a: 1 },
      {
        getOwnPropertyDescriptor(target, key) {
          reads.push(String(key));
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
        get() {
          throw new Error("property value must come from its own data descriptor");
        },
      },
    );
    expect(text(value(raw))).toBe('{"a":1,"z":2}');
    // Object.keys first checks enumerability in insertion order; the actual
    // snapshots are then obtained in canonical order.
    expect(reads).toEqual(["z", "a", "a", "z"]);
  });

  it("re-normalizes source slots for each live read while leaving free JSON opaque", () => {
    const source: Record<string, unknown> = { artifactId: "loss", sourceRow: -0 };
    const document = createDiagnosticIdentityArray(2, (index) => {
      if (index) {
        source.sourceRow = 12;
        source.sourceSheet = "next";
      }
      return value({ source, groupDimensions: { source } });
    });
    const before = { artifactId: "loss", sourceRow: -0 };
    const after = { artifactId: "loss", sourceRow: 12, sourceSheet: "next" };
    expect(text(document)).toBe(
      expected([
        { source: before, groupDimensions: { source: before } },
        { source: after, groupDimensions: { source: after } },
      ]),
    );
  });

  it("retains source-helper validation and full remapped issue order", () => {
    const source = { artifactId: "loss", sourceRow: -1, sourceSheet: "", unusual: 1 };
    let issues: DiagnosticValidationError["issues"] = [];
    try {
      projectDiagnosticIdentity({ source });
    } catch (error) {
      issues = (error as DiagnosticValidationError).issues;
    }
    expect(issues.length).toBeGreaterThan(1);
    // The streaming projection snapshots source siblings in sorted order
    // before calling the same source helper.
    let sortedIssues: DiagnosticValidationError["issues"] = [];
    try {
      projectDiagnosticIdentity({ source: Object.fromEntries(Object.entries(source).sort()) });
    } catch (error) {
      sortedIssues = (error as DiagnosticValidationError).issues;
    }
    try {
      text(value({ rows: [{ source }] }));
      expect.fail("should reject invalid source fields");
    } catch (error) {
      expect((error as DiagnosticValidationError).issues).toEqual(
        sortedIssues.map((issue) => ({
          ...issue,
          path: issue.path.replace(/^\$\.source/, "$.rows[0].source"),
        })),
      );
    }
    // A non-scalar composed source field is not a source token. It must not
    // escape the authoritative validation by being a genuine descriptor.
    const composed = createDiagnosticIdentityObject({
      source: createDiagnosticIdentityObject({
        artifactId: value("loss"),
        sourceRow: createDiagnosticIdentityArray(0, () => value(null)),
      }),
    });
    expect(() => text(composed)).toThrow(DiagnosticValidationError);
  });

  it("checks descriptor authenticity before its depth and raw depth before its children", () => {
    let document = {} as DiagnosticIdentityDocument;
    for (let index = 0; index < 256; index++) {
      const child = document;
      document = createDiagnosticIdentityArray(1, () => child);
    }
    try {
      text(document);
      expect.fail("should reject the forged child");
    } catch (error) {
      expect((error as DiagnosticValidationError).issues[0]?.code).toBe("invalid-type");
    }
    const getter = vi.fn(() => 1);
    let raw: unknown = Object.defineProperty({}, "invalid", { enumerable: true, get: getter });
    for (let index = 0; index < 256; index++) raw = [raw];
    try {
      text(value(raw));
      expect.fail("should reject the depth before the accessor");
    } catch (error) {
      expect((error as DiagnosticValidationError).issues[0]?.code).toBe("expression-limit");
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it("detects raw and composed cycles while permitting shared acyclic children", () => {
    const raw: { self?: unknown } = {};
    raw.self = raw;
    expect(() => text(value(raw))).toThrow(DiagnosticValidationError);
    let recursive!: DiagnosticIdentityDocument;
    recursive = createDiagnosticIdentityArray(1, () => recursive);
    expect(() => text(recursive)).toThrow(DiagnosticValidationError);
    let indirect!: DiagnosticIdentityDocument;
    indirect = createDiagnosticIdentityArray(1, () =>
      createDiagnosticIdentityObject({ back: indirect }),
    );
    expect(() => text(indirect)).toThrow(DiagnosticValidationError);
    const shared = value({ n: 1 });
    expect(text(createDiagnosticIdentityArray(2, () => shared))).toBe('[{"n":1},{"n":1}]');
  });

  it("rejects accessors without invoking them, plus invalid array/prototype/JSON shapes", () => {
    const getter = vi.fn(() => 1);
    const raw = Object.defineProperty({}, "x", { enumerable: true, get: getter });
    expect(() => text(value(raw))).toThrow(DiagnosticValidationError);
    expect(() =>
      createDiagnosticIdentityObject(raw as Record<string, DiagnosticIdentityDocument>),
    ).toThrow(DiagnosticValidationError);
    const array = [1];
    Object.defineProperty(array, "0", { get: getter });
    const extra = [1];
    Object.assign(extra, { extra: true });
    for (const invalid of [
      array,
      extra,
      Array(1),
      new Date(0),
      new Map(),
      undefined,
      1n,
      NaN,
      Infinity,
      "\ud800",
      "\0",
      Object.create({ inherited: true }),
    ])
      expect(() => text(value(invalid))).toThrow(DiagnosticValidationError);
    expect(getter).not.toHaveBeenCalled();
    const hidden = Object.defineProperty({ n: 1 }, "hidden", { get: getter });
    Object.assign(hidden, { [Symbol("ignored")]: NaN });
    expect(text(value(hidden))).toBe(expected(hidden));
    expect(getter).not.toHaveBeenCalled();
  });

  it("preserves the 256-level diagnostic boundary, without charging envelope depth", () => {
    let raw: unknown = 1;
    for (let index = 1; index < 256; index++) raw = { child: raw };
    const document = value(raw);
    expect(text(document)).toBe(expected(raw));
    expect(fingerprintDiagnosticIdentity(document, { kind: "test", property: "body" })).toBe(
      `fnv1a64-jcs-v1:${fnv1a64(canonicalJson({ identityVersion: 1, kind: "test", body: projectDiagnosticIdentity(raw) }))}`,
    );
    expect(() => text(value({ child: raw }))).toThrow(DiagnosticValidationError);
  });

  it("bounds escaping/chunks for large atoms and preserves Unicode across boundaries", () => {
    for (const prefix of [4095, 16381, 16382, 16383, 16384]) {
      const raw = { ["k".repeat(prefix) + "🧪"]: "x".repeat(prefix) + "🧪\u0001é".repeat(12000) };
      const chunks = [...iterateDiagnosticIdentityJson(value(raw))];
      expect(chunks.every((chunk) => chunk.length <= 16384)).toBe(true);
      expect(chunks.join("")).toBe(expected(raw));
      for (const chunk of chunks) {
        const last = chunk.charCodeAt(chunk.length - 1);
        expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
      }
    }
  });

  it("compares exact bytes, detects early/late/length changes, and never relies on a tag", () => {
    const left = { n: 1, text: "x".repeat(40000) + "🧪" };
    const same = createDiagnosticIdentityObject({ text: value(left.text), n: value(1) });
    expect(compareDiagnosticIdentityDocuments(value(left), same)).toEqual({ equal: true });
    for (const right of [
      { ...left, n: 2 },
      { ...left, text: `${left.text}x` },
      { n: 1 },
      { ...left, text: `${left.text.slice(0, -2)}é` },
    ]) {
      const a = expected(left),
        b = expected(right);
      let offset = 0;
      while (offset < a.length && offset < b.length && a[offset] === b[offset]) offset++;
      expect(compareDiagnosticIdentityDocuments(value(left), value(right))).toEqual({
        equal: false,
        codeUnitOffset: offset,
      });
    }
  });

  it("compares arbitrary chunk boundaries, empty chunks, and split surrogate pairs", () => {
    const original = "not necessarily JSON 🧪 and é \\u0000 " + "x".repeat(40000);
    const chunks = (text: string, size: number) =>
      Array.from({ length: Math.ceil(text.length / size) }, (_, index) =>
        text.slice(index * size, (index + 1) * size),
      );
    for (const leftSize of [1, 2, 17, 16383, 16384]) {
      for (const rightSize of [1, 13, 4096, 16381]) {
        expect(
          compareDiagnosticIdentityJsonChunks(
            ["", ...chunks(original, leftSize), ""],
            chunks(original, rightSize),
          ),
        ).toEqual({ equal: true });
        const changed = `${original.slice(0, 20000)}!${original.slice(20001)}`;
        expect(
          compareDiagnosticIdentityJsonChunks(
            chunks(original, leftSize),
            chunks(changed, rightSize),
          ),
        ).toEqual({ equal: false, codeUnitOffset: 20000 });
      }
    }
    expect(compareDiagnosticIdentityJsonChunks(["\ud83e", "\uddea"], ["🧪"])).toEqual({
      equal: true,
    });
    expect(compareDiagnosticIdentityJsonChunks([], [""])).toEqual({ equal: true });
    expect(compareDiagnosticIdentityJsonChunks(["a"], ["a", "b"])).toEqual({
      equal: false,
      codeUnitOffset: 1,
    });
    expect(() =>
      compareDiagnosticIdentityJsonChunks([1] as unknown as Iterable<string>, ["1"]),
    ).toThrow(DiagnosticValidationError);
  });

  it("closes both caller iterators on mismatch or an exception", () => {
    const closed: string[] = [];
    function* source(name: string, chunk: string, throwing = false) {
      try {
        if (throwing) throw new Error("stream failure");
        yield chunk;
        yield "later";
      } finally {
        closed.push(name);
      }
    }
    expect(compareDiagnosticIdentityJsonChunks(source("a", "x"), source("b", "y"))).toEqual({
      equal: false,
      codeUnitOffset: 0,
    });
    expect(closed.sort()).toEqual(["a", "b"]);
    closed.length = 0;
    expect(() =>
      compareDiagnosticIdentityJsonChunks(source("a", "x"), source("b", "", true)),
    ).toThrow("stream failure");
    expect(closed.sort()).toEqual(["a", "b"]);
  });
});
