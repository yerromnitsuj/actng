import {
  createDiagnosticIdentityArray,
  createDiagnosticIdentityObject,
  createDiagnosticIdentityValue,
  DiagnosticValidationError,
  type DiagnosticIdentityDocument,
} from "@actuarial-ts/core";

/** Private column-backed snapshots for SDK-constructed finding records. No I/O. */
const CHUNK = 4096;

/** Internal capacity guard, exported only from this private module for tests. */
export function assertCompactFindingCapacity(
  count: number,
  addition = 1,
): void {
  if (
    !Number.isSafeInteger(count) ||
    !Number.isSafeInteger(addition) ||
    count < 0 ||
    addition < 0 ||
    count + addition > 0xffff_ffff
  )
    throw new DiagnosticValidationError([
      {
        domain: "input",
        code: "expression-limit",
        path: "$",
        message: "Compact finding index capacity exceeded",
      },
    ]);
}

interface Nodes {
  kind: Uint8Array;
  start: Uint32Array;
  length: Uint32Array;
  number: Float64Array;
}
export class CompactDiagnosticJson {
  private nodes: Nodes[] = [];
  private edges: Uint32Array[] = [];
  private strings: string[] = [];
  private stringIds = new Map<string, number>();
  private primitiveIds = new Map<string | number, number>();
  private smallNodes = new Map<string, number>();
  private nodeCount = 0;
  private edgeCount = 0;
  private sealed = false;
  private stringId(value: string): number {
    let id = this.stringIds.get(value);
    if (id === undefined) {
      assertCompactFindingCapacity(this.strings.length);
      id = this.strings.length;
      this.strings.push(value);
      this.stringIds.set(value, id);
    }
    return id;
  }
  add(value: unknown): number {
    if (this.sealed) throw new Error("Finding snapshot table is sealed");
    let kind: number;
    let numeric = 0;
    let primitive: string | number | undefined;
    const edges: number[] = [];
    if (value === null) {
      kind = 0;
      primitive = "null";
    } else if (typeof value === "boolean") {
      kind = 1;
      numeric = value ? 1 : 0;
      primitive = `bool/${numeric}`;
    } else if (typeof value === "number") {
      kind = 2;
      numeric = value;
      primitive = Object.is(value, -0) ? "-0" : value;
    } else if (typeof value === "string") {
      kind = 3;
      numeric = this.stringId(value);
      primitive = `string/${numeric}`;
    } else if (value === undefined) {
      kind = 7;
      primitive = "undefined";
    } else if (Array.isArray(value)) {
      kind = 4;
      for (const child of value) edges.push(this.add(child));
    } else if (typeof value === "object") {
      kind = Object.getPrototypeOf(value) === null ? 6 : 5;
      for (const key of Object.keys(value))
        edges.push(
          this.stringId(key),
          this.add((value as Record<string, unknown>)[key]),
        );
    } else throw new Error("Unsupported SDK finding snapshot value");
    const signature =
      primitive === undefined && edges.length <= 32
        ? `${kind}/${edges.join(",")}`
        : undefined;
    const previous =
      primitive === undefined
        ? signature === undefined
          ? undefined
          : this.smallNodes.get(signature)
        : this.primitiveIds.get(primitive);
    if (previous !== undefined) return previous;
    assertCompactFindingCapacity(this.nodeCount);
    assertCompactFindingCapacity(this.edgeCount, edges.length);
    const id = this.nodeCount++;
    const row = id % CHUNK;
    if (row === 0)
      this.nodes.push({
        kind: new Uint8Array(CHUNK),
        start: new Uint32Array(CHUNK),
        length: new Uint32Array(CHUNK),
        number: new Float64Array(CHUNK),
      });
    const block = this.nodes[Math.floor(id / CHUNK)]!;
    block.kind[row] = kind;
    block.start[row] = this.edgeCount;
    block.length[row] = edges.length;
    block.number[row] = numeric;
    for (const child of edges) {
      if (this.edgeCount % CHUNK === 0) this.edges.push(new Uint32Array(CHUNK));
      this.edges[Math.floor(this.edgeCount / CHUNK)]![this.edgeCount % CHUNK] =
        child;
      this.edgeCount++;
    }
    if (primitive !== undefined) this.primitiveIds.set(primitive, id);
    else if (signature !== undefined && this.smallNodes.size < 100_000)
      this.smallNodes.set(signature, id);
    return id;
  }
  seal(): void {
    this.sealed = true;
    this.stringIds.clear();
    this.primitiveIds.clear();
    this.smallNodes.clear();
  }
  private edge(index: number): number {
    return this.edges[Math.floor(index / CHUNK)]![index % CHUNK]!;
  }
  length(id: number): number {
    return this.nodes[Math.floor(id / CHUNK)]!.length[id % CHUNK]!;
  }
  property(id: number | undefined, key: string): number | undefined {
    if (id === undefined) return undefined;
    const block = this.nodes[Math.floor(id / CHUNK)]!;
    const row = id % CHUNK;
    for (let offset = 0; offset < block.length[row]!; offset += 2) {
      const edge = block.start[row]! + offset;
      if (this.strings[this.edge(edge)] === key) return this.edge(edge + 1);
    }
    return undefined;
  }
  arrayItem(id: number, index: number): number {
    const block = this.nodes[Math.floor(id / CHUNK)]!;
    return this.edge(block.start[id % CHUNK]! + index);
  }
  identityDocument(id: number): DiagnosticIdentityDocument {
    if (!this.sealed) throw new Error("Finding snapshot table is not sealed");
    const block = this.nodes[Math.floor(id / CHUNK)]!;
    const row = id % CHUNK;
    const kind = block.kind[row]!;
    const start = block.start[row]!;
    const length = block.length[row]!;
    if (kind === 4)
      return createDiagnosticIdentityArray(length, (index) =>
        this.identityDocument(this.edge(start + index)),
      );
    if (kind === 5 || kind === 6) {
      const fields: Record<string, DiagnosticIdentityDocument> =
        Object.create(null);
      for (let offset = 0; offset < length; offset += 2)
        fields[this.strings[this.edge(start + offset)]!] =
          this.identityDocument(this.edge(start + offset + 1));
      return createDiagnosticIdentityObject(fields);
    }
    return createDiagnosticIdentityValue(this.read(id));
  }
  read(id: number, sourceCountsOnly = false): unknown {
    const block = this.nodes[Math.floor(id / CHUNK)]!;
    const row = id % CHUNK;
    const kind = block.kind[row]!;
    const start = block.start[row]!;
    const length = block.length[row]!;
    if (kind === 0) return null;
    if (kind === 1) return block.number[row] === 1;
    if (kind === 2) return block.number[row];
    if (kind === 3) return this.strings[block.number[row]!];
    if (kind === 7) return undefined;
    if (kind === 4)
      return Object.freeze(
        Array.from({ length }, (_, index) =>
          this.read(this.edge(start + index), sourceCountsOnly),
        ),
      );
    const result: Record<string, unknown> =
      kind === 6 ? Object.create(null) : {};
    for (let offset = 0; offset < length; offset += 2) {
      const key = this.strings[this.edge(start + offset)]!;
      const child = this.edge(start + offset + 1);
      Object.defineProperty(
        result,
        sourceCountsOnly && key === "sources" ? "sourceCount" : key,
        {
          value:
            sourceCountsOnly && key === "sources"
              ? this.length(child)
              : this.read(child, sourceCountsOnly),
          enumerable: true,
        },
      );
    }
    return Object.freeze(result);
  }
}
