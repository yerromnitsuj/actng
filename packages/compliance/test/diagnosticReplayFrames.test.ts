import { describe, expect, it } from "vitest";
import {
  decodeReplayFrames,
  encodeReplayFrames,
  MAX_REPLAY_FRAME_BYTES,
  MAX_REPLAY_READ_BYTES,
  type ReplayFrame,
} from "../src/diagnosticReplayFrames.js";
import {
  replayValueFrames,
  ReplayValueBuilder,
  type ReplayValueLimits,
} from "../src/diagnosticReplayValue.js";

const encode = (value: string) => new TextEncoder().encode(value);
async function collect<T>(values: AsyncIterable<T>) {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}
function* split(bytes: Uint8Array, size: number) {
  for (let index = 0; index < bytes.length; index += size)
    yield bytes.subarray(index, index + size);
}
const limits: ReplayValueLimits = {
  maximumDepth: 30,
  maximumNodes: 100_000,
  maximumStringUnits: 200_000,
  maximumTotalStringUnits: 400_000,
};
function rebuild(frames: Iterable<ReplayFrame>, custom: ReplayValueLimits = limits) {
  const builder = new ReplayValueBuilder(custom);
  for (const frame of frames) builder.push(frame);
  return builder.finish();
}

describe("bounded replay transport frames", () => {
  it("preserves arbitrary read boundaries and split UTF-8 characters", async () => {
    const frames: ReplayFrame[] = [
      [0, "header", "diagnostic-replay/1"],
      [1, "text", '🧮λ漢字\n\\"'],
    ];
    const bytes = Buffer.concat(await collect(encodeReplayFrames(frames)));
    for (const size of [1, 2, 3, 7, 64, 65536])
      expect(await collect(decodeReplayFrames(split(bytes, size)))).toEqual(frames);
  });

  it("snapshots each delivered chunk before yielding a frame", async () => {
    const bytes = encode('[1,"first"]\n[2,"second"]\n');
    const reader = decodeReplayFrames([bytes]);
    expect((await reader.next()).value).toEqual([1, "first"]);
    bytes.fill(0);
    expect((await reader.next()).value).toEqual([2, "second"]);
    expect((await reader.next()).done).toBe(true);
  });

  it.each([
    "",
    "\n",
    '["unterminated"]',
    '{"a":1,"a":2}\n',
    '[1,{"a":1}]\n',
    "[1,[2]]\n",
    "[]\n",
    "[1e10000]\n",
    "[true]\n\n",
    "[undefined]\n",
  ])("handles invalid or empty transport text %j", async (text) => {
    if (text === "")
      expect(await collect(decodeReplayFrames([]))).toEqual([]); // higher-level reader requires header/trailer
    else await expect(collect(decodeReplayFrames([encode(text)]))).rejects.toThrow();
  });

  it("rejects invalid UTF-8 and oversized frames/read chunks before unbounded parse", async () => {
    await expect(
      collect(decodeReplayFrames([new Uint8Array([91, 34, 0xff, 34, 93, 10])])),
    ).rejects.toThrow(/UTF-8/);
    await expect(
      collect(decodeReplayFrames([new Uint8Array(MAX_REPLAY_READ_BYTES + 1)])),
    ).rejects.toThrow(/read chunk/);
    await expect(
      collect(
        decodeReplayFrames(split(encode(`["${"x".repeat(MAX_REPLAY_FRAME_BYTES)}"]\n`), 65536)),
      ),
    ).rejects.toThrow(/byte limit/);
    await expect(collect(encodeReplayFrames([["😀".repeat(40_000)]]))).rejects.toThrow(
      /byte limit/,
    );
    await expect(collect(encodeReplayFrames([["x".repeat(87_385)]]))).rejects.toThrow(/bounded/);
  });

  it("does not invoke accessor-valued frame atoms", async () => {
    const frame = ["safe"];
    Object.defineProperty(frame, "0", {
      get() {
        throw new Error("invoked");
      },
    });
    await expect(collect(encodeReplayFrames([frame]))).rejects.toThrow(/data properties/);
  });

  it("closes the source on decode failure and explicit early return", async () => {
    let closed = false;
    async function* chunks() {
      try {
        yield encode("[1]\n[2]\n");
      } finally {
        closed = true;
      }
    }
    const reader = decodeReplayFrames(chunks());
    await reader.next();
    await reader.return(undefined);
    expect(closed).toBe(true);
    closed = false;
    async function* broken() {
      try {
        yield encode("not JSON\n");
      } finally {
        closed = true;
      }
    }
    await expect(collect(decodeReplayFrames(broken()))).rejects.toThrow();
    expect(closed).toBe(true);
  });
});

describe("incremental replay input values", () => {
  it("round-trips prototype-like keys, nulls, non-finite audit values and long text", async () => {
    const value = {
      ["__proto__"]: { constructor: [NaN, Infinity, -Infinity, -0, 0, null, false, true] },
      text: "x".repeat(16383) + "🧮" + "z".repeat(50_000),
      empty: "",
      nested: [{ "": "empty key" }],
    };
    const frames = await collect(decodeReplayFrames(encodeReplayFrames(replayValueFrames(value))));
    const rebuilt = rebuild(frames) as typeof value;
    expect(rebuilt).toEqual(value);
    expect(Object.is(rebuilt.__proto__.constructor[3], -0)).toBe(true);
    expect(Object.getPrototypeOf(rebuilt)).toBe(null);
    expect(Object.hasOwn(rebuilt, "__proto__")).toBe(true);
  });

  it("enforces exact event arity and strict unique object key order", () => {
    for (const keys of [
      ["a", "a"],
      ["b", "a"],
    ]) {
      const frames: ReplayFrame[] = [["object"]];
      for (const key of keys)
        frames.push(["string-start", "key"], ["text", key], ["string-end"], ["scalar", 1]);
      frames.push(["end-object"]);
      expect(() => rebuild(frames)).toThrow(/strictly increasing/);
    }
    expect(() => rebuild([["scalar", 1, 2]])).toThrow(/arity/);
    expect(() => rebuild([["unknown"]])).toThrow(/Unknown/);
    expect(() => rebuild([["scalar", Infinity]])).toThrow(/scalar/);
    expect(() => rebuild([["special-number", "oops"]])).toThrow(/special/);
  });

  it.each(
    (
      [
        [],
        [["object"]],
        [
          ["string-start", "value"],
          ["text", "partial"],
        ],
        [["array"], ["end-object"]],
        [["string-start", "key"]],
        [
          ["scalar", 1],
          ["scalar", 2],
        ],
        [["object"], ["string-start", "key"], ["text", "a"], ["string-end"], ["end-object"]],
      ] satisfies ReplayFrame[][]
    ).map((frames) => ({ frames })),
  )("rejects incomplete or malformed input event sequence %#", ({ frames }) => {
    expect(() => rebuild(frames)).toThrow();
  });

  it("enforces host resource limits and permanently closes failed builders", () => {
    expect(() => rebuild(replayValueFrames([1, 2]), { ...limits, maximumNodes: 2 })).toThrow(
      /node limit/,
    );
    expect(() => rebuild(replayValueFrames([[1]]), { ...limits, maximumDepth: 1 })).toThrow(
      /depth limit/,
    );
    expect(() => rebuild(replayValueFrames("abcd"), { ...limits, maximumStringUnits: 3 })).toThrow(
      /string limit/,
    );
    const builder = new ReplayValueBuilder(limits);
    expect(() => builder.push(["invalid"])).toThrow();
    expect(() => builder.push(["scalar", 1])).toThrow(/finalized/);
    expect(() => builder.finish()).toThrow(/finalized/);
    const complete = new ReplayValueBuilder(limits);
    complete.push(["scalar", null]);
    expect(complete.finish()).toBe(null);
    expect(() => complete.finish()).toThrow(/finalized/);
  });

  it("bounds total text across separate keys and values as well as each string", () => {
    const value = { ab: "cd", ef: "gh" };
    expect(
      rebuild(replayValueFrames(value), {
        ...limits,
        maximumStringUnits: 2,
        maximumTotalStringUnits: 8,
      }),
    ).toEqual(value);
    expect(() =>
      rebuild(replayValueFrames(value), {
        ...limits,
        maximumStringUnits: 2,
        maximumTotalStringUnits: 7,
      }),
    ).toThrow(/total string limit/);
    expect(() =>
      rebuild(replayValueFrames(["ab", "cd"]), {
        ...limits,
        maximumStringUnits: 2,
        maximumTotalStringUnits: 3,
      }),
    ).toThrow(/total string limit/);
    // UTF-16 units, including split surrogate pairs, are counted exactly once.
    expect(
      rebuild(replayValueFrames("🧮"), {
        ...limits,
        maximumTotalStringUnits: 2,
      }),
    ).toBe("🧮");
    expect(() =>
      rebuild(replayValueFrames("🧮"), {
        ...limits,
        maximumTotalStringUnits: 1,
      }),
    ).toThrow(/total string limit/);
  });

  it("snapshots limit values once and refuses dynamic or malformed options", () => {
    const supplied = { ...limits, maximumTotalStringUnits: 3 };
    const builder = new ReplayValueBuilder(supplied);
    supplied.maximumTotalStringUnits = 100;
    expect(() => {
      for (const frame of replayValueFrames(["ab", "cd"])) builder.push(frame);
    }).toThrow(/total string limit/);
    expect(() => builder.finish()).toThrow(/finalized/);

    let calls = 0;
    const dynamic = { ...limits };
    Object.defineProperty(dynamic, "maximumTotalStringUnits", {
      get() {
        calls++;
        return calls === 1 ? 3 : 100;
      },
    });
    expect(() => new ReplayValueBuilder(dynamic)).toThrow(/data properties/);
    expect(calls).toBe(0);
    const missing = {
      maximumDepth: limits.maximumDepth,
      maximumNodes: limits.maximumNodes,
      maximumStringUnits: limits.maximumStringUnits,
    };
    const hidden = { ...limits };
    Object.defineProperty(hidden, "maximumNodes", { enumerable: false });
    for (const malformed of [
      missing,
      hidden,
      { ...limits, unexpected: true },
      { ...limits, [Symbol("limit")]: 1 },
      Object.create(limits),
      null,
      [],
    ])
      expect(() => new ReplayValueBuilder(malformed as ReplayValueLimits)).toThrow();
    for (const field of Object.keys(limits))
      for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "2"])
        expect(() => new ReplayValueBuilder({ ...limits, [field]: value })).toThrow();
    expect(() => new ReplayValueBuilder(Object.assign(Object.create(null), limits))).not.toThrow();
  });

  it("refuses cycles, sparse arrays, extra array fields and getters without executing them", () => {
    const cycle: unknown[] = [];
    cycle.push(cycle);
    const extra = [1] as number[] & { extra?: string };
    extra.extra = "lost";
    const getter = {
      get value(): never {
        throw new Error("invoked");
      },
    };
    for (const value of [cycle, new Array(1), extra, getter, undefined, new Date()])
      expect(() => [...replayValueFrames(value)]).toThrow();
  });
});
