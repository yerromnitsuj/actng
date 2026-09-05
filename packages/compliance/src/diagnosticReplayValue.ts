import { ComplianceError } from "./errors.js";
import { REPLAY_TEXT_UNITS, type ReplayFrame } from "./diagnosticReplayFrames.js";

export interface ReplayValueLimits {
  readonly maximumDepth: number;
  readonly maximumNodes: number;
  /** Maximum UTF-16 code units in one key or string value. */
  readonly maximumStringUnits: number;
  /** Maximum UTF-16 code units across every key and string value in this input. */
  readonly maximumTotalStringUnits: number;
}
function invalid(message: string): never {
  throw new ComplianceError("BAD_DIAGNOSTIC_RUN", message, "$.replayInput");
}

function snapshotLimits(limits: ReplayValueLimits): ReplayValueLimits {
  if (
    limits === null ||
    typeof limits !== "object" ||
    (Object.getPrototypeOf(limits) !== Object.prototype && Object.getPrototypeOf(limits) !== null)
  )
    invalid("Replay value limits must be a plain data object");
  const fields = [
    "maximumDepth",
    "maximumNodes",
    "maximumStringUnits",
    "maximumTotalStringUnits",
  ] as const;
  const descriptors = Object.getOwnPropertyDescriptors(limits);
  for (const key of Reflect.ownKeys(descriptors))
    if (typeof key !== "string" || !fields.some((field) => field === key))
      invalid("Unknown replay value limit");
  const owned = Object.create(null) as Record<(typeof fields)[number], number>;
  for (const key of fields) {
    const field = descriptors[key];
    if (!field || !field.enumerable || !("value" in field))
      invalid("Replay value limits require own enumerable data properties");
    const value: unknown = field.value;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
      invalid("Replay value limits must be positive safe integers");
    owned[key] = value;
  }
  return Object.freeze(owned);
}
type Container =
  | { kind: "array"; value: unknown[] }
  | { kind: "object"; value: Record<string, unknown>; lastKey: string | null; key: string | null };

/**
 * Reconstruct input only, within explicit host resource bounds. Reconstructed
 * values still require full SDK validation. Never use this for candidate
 * result/audit identity channels: those must be compared as text streams.
 */
export class ReplayValueBuilder {
  private readonly limits: ReplayValueLimits;
  private readonly stack: Container[] = [];
  private nodes = 0;
  private assigned = false;
  private root: unknown;
  private stringParts: string[] | null = null;
  private stringUnits = 0;
  private totalStringUnits = 0;
  private stringKind: "key" | "value" | null = null;
  private sealed = false;

  constructor(limits: ReplayValueLimits) {
    this.limits = snapshotLimits(limits);
  }
  private attach(value: unknown) {
    if (++this.nodes > this.limits.maximumNodes) invalid("Replay input exceeds its node limit");
    const parent = this.stack.at(-1);
    if (!parent) {
      if (this.assigned) invalid("Multiple roots in replay input");
      this.root = value;
      this.assigned = true;
    } else if (parent.kind === "array") parent.value.push(value);
    else {
      if (parent.key === null) invalid("Object value is missing its key");
      Object.defineProperty(parent.value, parent.key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      parent.key = null;
    }
  }
  push(frame: ReplayFrame): void {
    if (this.sealed) invalid("Replay input builder is finalized");
    try {
      this.consume(frame);
    } catch (error) {
      this.sealed = true;
      throw error;
    }
  }
  private consume(frame: ReplayFrame): void {
    if (!Array.isArray(frame)) invalid("Replay value event must be an array");
    const [event, payload] = frame;
    const arity = (expected: number) => {
      if (frame.length !== expected) invalid("Invalid replay value event arity");
    };
    if (this.stringParts !== null) {
      if (event === "text") {
        arity(2);
        if (
          typeof payload !== "string" ||
          payload.length === 0 ||
          payload.length > REPLAY_TEXT_UNITS
        )
          invalid("Invalid replay text fragment");
        if (payload.length > this.limits.maximumStringUnits - this.stringUnits)
          invalid("Replay input exceeds its string limit");
        if (payload.length > this.limits.maximumTotalStringUnits - this.totalStringUnits)
          invalid("Replay input exceeds its total string limit");
        // Check both budgets before retaining this fragment. Key text counts,
        // and starting another string never resets the whole-input budget.
        this.stringUnits += payload.length;
        this.totalStringUnits += payload.length;
        this.stringParts.push(payload);
        return;
      }
      if (event !== "string-end") invalid("Replay string was not terminated");
      arity(1);
      const text = this.stringParts.join("");
      const kind = this.stringKind;
      this.stringParts = null;
      this.stringKind = null;
      if (kind === "value") this.attach(text);
      else {
        const parent = this.stack.at(-1);
        if (!parent || parent.kind !== "object" || parent.key !== null)
          invalid("Unexpected replay object key");
        if (parent.lastKey !== null && text <= parent.lastKey)
          invalid("Replay object keys must be strictly increasing and unique");
        parent.lastKey = text;
        parent.key = text;
      }
      return;
    }
    if (event === "string-start") {
      arity(2);
      if (payload !== "key" && payload !== "value") invalid("Invalid replay string role");
      const parent = this.stack.at(-1);
      if (payload === "key" && (!parent || parent.kind !== "object" || parent.key !== null))
        invalid("Unexpected replay object key");
      this.stringParts = [];
      this.stringKind = payload;
      this.stringUnits = 0;
    } else if (event === "object" || event === "array") {
      arity(1);
      if (this.stack.length >= this.limits.maximumDepth)
        invalid("Replay input exceeds its depth limit");
      const container: Container =
        event === "array"
          ? { kind: "array", value: [] }
          : { kind: "object", value: Object.create(null), lastKey: null, key: null };
      this.attach(container.value);
      this.stack.push(container);
    } else if (event === "end-object" || event === "end-array") {
      arity(1);
      const parent = this.stack.at(-1);
      if (
        !parent ||
        event !== `end-${parent.kind}` ||
        (parent.kind === "object" && parent.key !== null)
      )
        invalid("Mismatched or incomplete replay container");
      this.stack.pop();
    } else if (event === "scalar") {
      arity(2);
      if (
        payload !== null &&
        typeof payload !== "boolean" &&
        !(typeof payload === "number" && Number.isFinite(payload))
      )
        invalid("Invalid replay scalar");
      this.attach(payload);
    } else if (event === "special-number") {
      arity(2);
      // Preserve raw non-finite observations for SDK audit/blocking, not null.
      if (payload === "NaN") this.attach(NaN);
      else if (payload === "+Infinity") this.attach(Infinity);
      else if (payload === "-Infinity") this.attach(-Infinity);
      else if (payload === "-0") this.attach(-0);
      else invalid("Invalid special replay number");
    } else invalid("Unknown replay value event");
  }
  finish(): unknown {
    if (this.sealed) invalid("Replay input builder is finalized");
    this.sealed = true;
    if (!this.assigned || this.stack.length || this.stringParts !== null)
      invalid("Incomplete replay input value");
    return this.root;
  }
}

/** Live read-only input events. The enclosing genuine run owns its snapshots. */
export function* replayValueFrames(value: unknown): Generator<ReplayFrame> {
  const active = new Set<object>();
  function* string(text: string, role: "key" | "value"): Generator<ReplayFrame> {
    yield ["string-start", role];
    for (let index = 0; index < text.length; index += REPLAY_TEXT_UNITS)
      yield ["text", text.slice(index, index + REPLAY_TEXT_UNITS)];
    yield ["string-end"];
  }
  function* visit(value: unknown): Generator<ReplayFrame> {
    if (typeof value === "string") {
      yield* string(value, "value");
      return;
    }
    if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) {
      yield [
        "special-number",
        Number.isNaN(value)
          ? "NaN"
          : value === Infinity
            ? "+Infinity"
            : value === -Infinity
              ? "-Infinity"
              : "-0",
      ];
      return;
    }
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      yield ["scalar", value];
      return;
    }
    if (typeof value !== "object") invalid("Unsupported replay input value");
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (
      array ? prototype !== Array.prototype : prototype !== null && prototype !== Object.prototype
    )
      invalid("Replay input must contain plain data");
    if (active.has(value)) invalid("Replay input contains a cycle");
    active.add(value);
    try {
      yield [array ? "array" : "object"];
      if (array) {
        for (const key of Reflect.ownKeys(value))
          if (
            key !== "length" &&
            (typeof key !== "string" ||
              !/^(0|[1-9][0-9]*)$/.test(key) ||
              Number(key) >= value.length)
          )
            invalid("Replay input arrays must contain indexed data only");
        for (let index = 0; index < value.length; index++) {
          const field = Object.getOwnPropertyDescriptor(value, String(index));
          if (!field || !("value" in field))
            invalid("Replay input arrays must contain indexed data");
          yield* visit(field.value);
        }
      } else
        for (const key of Object.keys(value).sort()) {
          const field = Object.getOwnPropertyDescriptor(value, key);
          if (!field || !("value" in field))
            invalid("Replay input objects must contain data properties");
          yield* string(key, "key");
          yield* visit(field.value);
        }
      yield [array ? "end-array" : "end-object"];
    } finally {
      active.delete(value);
    }
  }
  yield* visit(value);
}
