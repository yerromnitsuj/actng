import { describe, expect, it, vi } from "vitest";
import { consumeDiagnosticByteSource } from "../src/diagnosticByteSource.js";

const chunk = new Uint8Array([1, 2, 3]);
const end = (): IteratorReturnResult<undefined> => ({
  done: true,
  value: undefined,
});

async function collect(source: AsyncIterable<Uint8Array>) {
  const values: Uint8Array[] = [];
  for await (const value of source) values.push(value);
  return values;
}

describe("owned diagnostic byte sources", () => {
  it("captures one async iterator and next method, preserving their receivers", async () => {
    let reads = 0;
    const close = vi.fn();
    const iterator = {
      next() {
        expect(this).toBe(iterator);
        reads++;
        return Promise.resolve(
          reads === 1 ? { done: false, value: chunk } : { done: true },
        );
      },
      return: close,
    };
    const factory = vi.fn(function (this: unknown) {
      expect(this).toBe(source);
      return iterator;
    });
    const source = {
      [Symbol.asyncIterator]: factory,
    } as AsyncIterable<Uint8Array>;
    const consumed = consumeDiagnosticByteSource(source);
    expect((await consumed.next()).value).toBe(chunk);
    iterator.next = () => {
      throw new Error("replacement next must not run");
    };
    expect((await consumed.next()).done).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(reads).toBe(2);
    expect(close).not.toHaveBeenCalled();
  });

  it("consumes synchronous sources without closing natural completion", async () => {
    let reads = 0;
    const close = vi.fn();
    const source = {
      [Symbol.iterator]() {
        return this;
      },
      next(): IteratorResult<Uint8Array> {
        return reads++ === 0
          ? { done: false, value: chunk }
          : { done: true, value: undefined };
      },
      return: close,
    };
    expect(await collect(consumeDiagnosticByteSource(source))).toEqual([chunk]);
    expect(close).not.toHaveBeenCalled();
  });

  it.each(["async", "sync"] as const)(
    "closes a %s source once when next fails",
    async (kind) => {
      const primary = new Error("read failed");
      const close = vi.fn(end);
      const iterator = {
        next() {
          throw primary;
        },
        return: close,
      };
      const source =
        kind === "async"
          ? {
              [Symbol.asyncIterator]: () => ({
                ...iterator,
                return: async () => close(),
              }),
            }
          : { [Symbol.iterator]: () => iterator };
      const consumed = consumeDiagnosticByteSource(source);
      await expect(consumed.next()).rejects.toBe(primary);
      await consumed.return(undefined);
      expect(close).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves a rejected next error when return also rejects", async () => {
    const primary = new Error("read failed");
    const close = vi.fn(async () => {
      throw new Error("cleanup failed");
    });
    const source = {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next(): Promise<IteratorResult<Uint8Array>> {
        throw primary;
      },
      return: close,
    };
    await expect(consumeDiagnosticByteSource(source).next()).rejects.toBe(
      primary,
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("preserves even an undefined primary rejection when cleanup throws", async () => {
    const close = vi.fn(() => {
      throw new Error("cleanup failed");
    });
    const source = {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next(): Promise<IteratorResult<Uint8Array>> {
        throw undefined;
      },
      return: close,
    };
    await expect(
      consumeDiagnosticByteSource(source).next(),
    ).rejects.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes once on explicit early return and keeps the close receiver", async () => {
    const close = vi.fn(function (this: unknown) {
      expect(this).toBe(source);
      return end();
    });
    const source = {
      [Symbol.iterator]() {
        return this;
      },
      next: () => ({ done: false, value: chunk }),
      return: close,
    };
    const consumed = consumeDiagnosticByteSource(source);
    await consumed.next();
    await consumed.return(undefined);
    await consumed.return(undefined);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("preserves a consumer error if closing the producer also fails", async () => {
    const primary = new Error("consumer failed");
    const close = vi.fn(() => {
      throw new Error("cleanup failed");
    });
    const source = {
      [Symbol.iterator]() {
        return this;
      },
      next: () => ({ done: false, value: chunk }),
      return: close,
    };
    await expect(
      (async () => {
        for await (const _value of consumeDiagnosticByteSource(source))
          throw primary;
      })(),
    ).rejects.toBe(primary);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("preserves an explicitly injected consumer error during cleanup", async () => {
    const primary = new Error("consumer failed");
    const close = vi.fn(() => {
      throw new Error("cleanup failed");
    });
    const source = {
      [Symbol.iterator]() {
        return this;
      },
      next: () => ({ done: false, value: chunk }),
      return: close,
    };
    const consumed = consumeDiagnosticByteSource(source);
    await consumed.next();
    await expect(consumed.throw(primary)).rejects.toBe(primary);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes an acquired source without reading when already cancelled", async () => {
    const primary = new Error("cancelled");
    const read = vi.fn(() => ({ done: false, value: chunk }));
    const close = vi.fn(end);
    const source = {
      [Symbol.iterator]() {
        return this;
      },
      next: read,
      return: close,
    };
    await expect(
      consumeDiagnosticByteSource(source, () => {
        throw primary;
      }).next(),
    ).rejects.toBe(primary);
    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("checks cancellation after an awaited read before yielding its bytes", async () => {
    const primary = new Error("cancelled");
    let cancelled = false;
    let resolveRead!: (value: IteratorResult<Uint8Array>) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const close = vi.fn(async () => end());
    const source = {
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        signalStarted();
        return new Promise<IteratorResult<Uint8Array>>((resolve) => {
          resolveRead = resolve;
        });
      },
      return: close,
    };
    const consumed = consumeDiagnosticByteSource(source, () => {
      if (cancelled) throw primary;
    });
    const pending = consumed.next();
    await started;
    cancelled = true;
    resolveRead({ done: false, value: chunk });
    await expect(pending).rejects.toBe(primary);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("checks cancellation before a subsequent producer read", async () => {
    const primary = new Error("cancelled");
    let cancelled = false;
    const read = vi.fn(() => ({ done: false, value: chunk }));
    const close = vi.fn(end);
    const source = {
      [Symbol.iterator]() {
        return this;
      },
      next: read,
      return: close,
    };
    const consumed = consumeDiagnosticByteSource(source, () => {
      if (cancelled) throw primary;
    });
    await consumed.next();
    cancelled = true;
    await expect(consumed.next()).rejects.toBe(primary);
    expect(read).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("surfaces cleanup failure when there is no primary error", async () => {
    const cleanup = new Error("cleanup failed");
    const source = {
      [Symbol.iterator]() {
        return this;
      },
      next: () => ({ done: false, value: chunk }),
      return() {
        throw cleanup;
      },
    };
    const consumed = consumeDiagnosticByteSource(source);
    await consumed.next();
    await expect(consumed.return(undefined)).rejects.toBe(cleanup);
  });

  it("closes when reading next or inspecting its result fails", async () => {
    const primary = new Error("hostile next");
    for (const iterator of [
      {
        get next() {
          throw primary;
        },
      },
      {
        next: () => ({
          get done() {
            throw primary;
          },
        }),
      },
      {
        next: () => ({
          done: false,
          get value() {
            throw primary;
          },
        }),
      },
    ]) {
      const close = vi.fn(() => ({ done: true }));
      const owned = Object.assign(iterator, { return: close });
      const source = {
        [Symbol.iterator]: () => owned,
      } as unknown as Iterable<Uint8Array>;
      await expect(consumeDiagnosticByteSource(source).next()).rejects.toBe(
        primary,
      );
      expect(close).toHaveBeenCalledTimes(1);
    }
  });

  it("refuses malformed iterator protocols and still closes acquired iterators", async () => {
    for (const invalid of [
      null,
      {},
      { [Symbol.asyncIterator]: 1 },
      { [Symbol.iterator]: () => 1 },
    ])
      await expect(
        consumeDiagnosticByteSource(
          invalid as unknown as Iterable<Uint8Array>,
        ).next(),
      ).rejects.toBeInstanceOf(TypeError);
    for (const next of [undefined, () => 1]) {
      const close = vi.fn(() => ({ done: true }));
      const source = {
        [Symbol.iterator]: () => ({ next, return: close }),
      } as unknown as Iterable<Uint8Array>;
      await expect(
        consumeDiagnosticByteSource(source).next(),
      ).rejects.toBeInstanceOf(TypeError);
      expect(close).toHaveBeenCalledTimes(1);
    }
  });

  it("closes synchronous sources whose yielded promise rejects", async () => {
    const primary = new Error("yield failed");
    const close = vi.fn(() => ({ done: true }));
    const source = {
      [Symbol.iterator]() {
        return this;
      },
      next: () => ({ done: false, value: Promise.reject(primary) }),
      return: close,
    } as unknown as Iterable<Uint8Array>;
    await expect(consumeDiagnosticByteSource(source).next()).rejects.toBe(
      primary,
    );
    expect(close).toHaveBeenCalledTimes(1);
  });
});
