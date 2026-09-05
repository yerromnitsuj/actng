/**
 * Private, invocation-scoped sharing of small, newly owned evidence nodes.
 * This is not a validation boundary: callers must finish normalizing/cloning
 * every child first, and must never submit caller-owned objects or SDK brands.
 */
export interface DiagnosticEvidenceInternOptions {
  readonly maxEntries?: number;
  readonly maxSignatureCharacters?: number;
  readonly maxCandidateProperties?: number;
}

type EvidenceMode = "plain" | "source" | "free";

const DEFAULT_MAX_ENTRIES = 100_000;
const DEFAULT_MAX_SIGNATURE_CHARACTERS = 16 * 1024 * 1024;
// Wide result envelopes are usually unique; focus the budget on their small
// repeated coordinates, sources, scopes, states, and short child lists.
const DEFAULT_MAX_CANDIDATE_PROPERTIES = 10;
const MAX_CANDIDATE_STRING_CHARACTERS = 4096;

function sameOwnedNode(left: object, right: object): boolean {
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right))
    return false;
  const leftKeys = Reflect.ownKeys(left);
  const rightKeys = Reflect.ownKeys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => {
    if (key !== rightKeys[index]) return false;
    const a = Object.getOwnPropertyDescriptor(left, key)!;
    const b = Object.getOwnPropertyDescriptor(right, key)!;
    return (
      "value" in a &&
      "value" in b &&
      a.enumerable === b.enumerable &&
      a.configurable === b.configurable &&
      a.writable === b.writable &&
      Object.is(a.value, b.value)
    );
  });
}

export function createDiagnosticEvidenceInterner(
  options: DiagnosticEvidenceInternOptions = {},
): {
  internOwned<T extends object>(candidate: T, mode: EvidenceMode): T;
} {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxSignatureCharacters =
    options.maxSignatureCharacters ?? DEFAULT_MAX_SIGNATURE_CHARACTERS;
  const maxCandidateProperties =
    options.maxCandidateProperties ?? DEFAULT_MAX_CANDIDATE_PROPERTIES;
  const pool = new Map<string, object>();
  const childIds = new WeakMap<object, number>();
  let nextChildId = 1;
  let signatureCharacters = 0;

  return {
    internOwned<T extends object>(candidate: T, mode: EvidenceMode): T {
      if (!Object.isFrozen(candidate)) return candidate;
      const prototype = Object.getPrototypeOf(candidate);
      const array = Array.isArray(candidate);
      if (
        array
          ? prototype !== Array.prototype
          : prototype !== null && prototype !== Object.prototype
      )
        return candidate;
      if (array && candidate.length >= maxCandidateProperties) return candidate;
      const keys = Reflect.ownKeys(candidate);
      if (keys.length > maxCandidateProperties) return candidate;
      const signatureParts: unknown[] = [
        mode,
        array ? "array" : prototype === null ? "null" : "object",
      ];
      // A declined candidate must not grow persistent bookkeeping. Stage at
      // most this small candidate's children, including repeated references,
      // and commit their IDs only if the candidate enters the bounded pool.
      let pendingChildIds: Map<object, number> | undefined;
      let stringCharacters = 0;
      for (const key of keys) {
        // Diagnostic JSON does not contain symbols. Declining unexpected
        // shapes is harmless and never invokes an accessor or caller method.
        if (typeof key !== "string") return candidate;
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key)!;
        if (!("value" in descriptor)) return candidate;
        const value: unknown = descriptor.value;
        let tokenType: string;
        let tokenValue: unknown;
        if (value === null) {
          tokenType = "null";
          tokenValue = null;
        } else if (typeof value === "object") {
          if (!Object.isFrozen(value)) return candidate;
          tokenType = "object";
          const existingId = childIds.get(value);
          if (existingId !== undefined) tokenValue = existingId;
          else {
            pendingChildIds ??= new Map();
            let pendingId = pendingChildIds.get(value);
            if (pendingId === undefined) {
              pendingId = nextChildId + pendingChildIds.size;
              pendingChildIds.set(value, pendingId);
            }
            tokenValue = pendingId;
          }
        } else if (typeof value === "number") {
          if (!Number.isFinite(value)) return candidate;
          tokenType = "number";
          tokenValue = Object.is(value, -0) ? "-0" : value;
        } else if (
          typeof value === "string" ||
          typeof value === "boolean" ||
          value === undefined
        ) {
          tokenType = typeof value;
          tokenValue = value;
          if (typeof value === "string") stringCharacters += value.length;
        } else return candidate;
        stringCharacters += key.length;
        if (stringCharacters > MAX_CANDIDATE_STRING_CHARACTERS)
          return candidate;
        // Frozen data properties are necessarily non-configurable and
        // non-writable. Keep the varying enumerability bit (including array
        // length) and a fixed four-slot typed tuple, without temporary nested
        // arrays. The independent equality check still verifies every flag.
        signatureParts.push(key, descriptor.enumerable, tokenType, tokenValue);
      }
      const signature = JSON.stringify(signatureParts);
      // An unseen child cannot occur in an existing entry: every admitted
      // entry committed all its child IDs. No equality hit is skipped here.
      const existing = pendingChildIds ? undefined : pool.get(signature);
      // Signatures encode exact children and descriptor/order information;
      // independently check equality before sharing rather than treating a
      // fingerprint as proof of equality.
      if (existing !== undefined && sameOwnedNode(existing, candidate))
        return existing as T;
      if (
        pool.size < maxEntries &&
        signatureCharacters + signature.length <= maxSignatureCharacters
      ) {
        if (pendingChildIds) {
          for (const [child, id] of pendingChildIds) childIds.set(child, id);
          nextChildId += pendingChildIds.size;
        }
        pool.set(signature, candidate);
        signatureCharacters += signature.length;
      }
      return candidate;
    },
  };
}
