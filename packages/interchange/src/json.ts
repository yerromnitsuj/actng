import { ReservingError, canonicalJson } from "@actuarial-ts/core";

/** Own the complete JSON document without dropping forward-compatible keys.
 * Use the generic interchange JSON contract, not the stricter diagnostic
 * identifier profile: opaque JSON strings may contain escaped control codes. */
export function snapshotInterchangeJson<T>(value: T): T {
  try {
    return JSON.parse(canonicalJson(value)) as T;
  } catch (error) {
    throw new ReservingError(
      "BAD_INTERCHANGE",
      `An interchange document must contain only JSON values: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
