type DiagnosticByteSource = Iterable<Uint8Array> | AsyncIterable<Uint8Array>;

function isObject(value: unknown): value is object {
  return (
    value !== null && (typeof value === "object" || typeof value === "function")
  );
}

/**
 * Own one producer iterator through completion, cancellation or read failure.
 * Unlike a bare for-await loop, a rejected next() also closes the producer.
 * A cleanup failure never replaces the error that caused cleanup. Hosts should
 * pass the same cancellation signal to pending I/O; checks cannot interrupt it.
 */
export async function* consumeDiagnosticByteSource(
  source: DiagnosticByteSource,
  checkCancellation: () => void = () => {},
): AsyncGenerator<Uint8Array> {
  if (!isObject(source))
    throw new TypeError("Diagnostic byte source must be iterable");
  const iterable = source as Partial<
    Iterable<Uint8Array> & AsyncIterable<Uint8Array>
  >;
  const asynchronous = iterable[Symbol.asyncIterator];
  const method = asynchronous ?? iterable[Symbol.iterator];
  if (typeof method !== "function")
    throw new TypeError(
      "Diagnostic byte source must provide an iterator method",
    );
  const iterator: unknown = Reflect.apply(method, source, []);
  if (!isObject(iterator))
    throw new TypeError("Diagnostic byte iterator must be an object");
  const protocol = iterator as { next?: unknown; return?: unknown };
  let completed = false;
  let failed = false;
  try {
    // Capture next once, as the iterator protocol does; never use a producer's
    // potentially overwritten Function.call property.
    const next = protocol.next;
    if (typeof next !== "function")
      throw new TypeError("Diagnostic byte iterator must provide next()");
    for (;;) {
      checkCancellation();
      const result: unknown = await Reflect.apply(next, iterator, []);
      if (!isObject(result))
        throw new TypeError(
          "Diagnostic byte read must return an iterator result",
        );
      const item = result as IteratorResult<Uint8Array>;
      completed = Boolean(item.done);
      checkCancellation();
      if (completed) return;
      // An async generator also observes a rejected value from a synchronous
      // iterator here, so that failure follows the same cleanup path.
      yield item.value;
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!completed) {
      try {
        // Read return only when closing, once, following normal iterator
        // semantics. The generator's finally executes at most once.
        const close = protocol.return;
        if (close !== undefined && close !== null) {
          if (typeof close !== "function")
            throw new TypeError(
              "Diagnostic byte iterator return must be a function",
            );
          const result: unknown = await Reflect.apply(close, iterator, []);
          if (!isObject(result))
            throw new TypeError(
              "Diagnostic byte iterator return must return an iterator result",
            );
        }
      } catch (cleanupError) {
        if (!failed) throw cleanupError;
      }
    }
  }
}
