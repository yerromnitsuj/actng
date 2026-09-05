import { describe, expect, it, vi } from "vitest";
import { createDiagnosticEvidenceInterner } from "../src/diagnosticEvidenceIntern.js";

// Observe only IDs assigned to these test-owned children. This does not expose
// a production/debug API, or depend on the helper's inaccessible pool objects.
function observeChildIds(children: readonly object[]) {
  const targets = new Set(children);
  const spy = vi.spyOn(WeakMap.prototype, "set");
  return {
    assigned: () =>
      spy.mock.calls
        .filter(([child]) => targets.has(child))
        .map(([child, id]) => ({ child, id })),
    restore: () => spy.mockRestore(),
  };
}

describe("private evidence interner child bookkeeping budget", () => {
  it.each([{ maxEntries: 0 }, { maxSignatureCharacters: 0 }])(
    "does not assign child IDs when sharing is disabled: %j",
    (options) => {
      const pool = createDiagnosticEvidenceInterner(options);
      const children = Array.from({ length: 20 }, (_, id) =>
        Object.freeze({ id }),
      );
      const observed = observeChildIds(children);
      try {
        for (const child of children) {
          const candidate = Object.freeze({ child });
          expect(pool.internOwned(candidate, "plain")).toBe(candidate);
        }
        expect(observed.assigned()).toEqual([]);
      } finally {
        observed.restore();
      }
    },
  );

  it("keeps prior hits but assigns no new child IDs once the entry pool is full", () => {
    const pool = createDiagnosticEvidenceInterner({ maxEntries: 1 });
    const known = Object.freeze({ id: 0 });
    const declined = Array.from({ length: 20 }, (_, id) =>
      Object.freeze({ id: id + 1 }),
    );
    const observed = observeChildIds([known, ...declined]);
    try {
      const original = pool.internOwned(
        Object.freeze({ child: known }),
        "plain",
      );
      for (const child of declined) {
        const candidate = Object.freeze({ child });
        expect(pool.internOwned(candidate, "plain")).toBe(candidate);
      }
      expect(pool.internOwned(Object.freeze({ child: known }), "plain")).toBe(
        original,
      );
      expect(observed.assigned()).toEqual([{ child: known, id: 1 }]);
    } finally {
      observed.restore();
    }
  });

  it("does not commit IDs for candidates rejected by their final signature budget", () => {
    const pool = createDiagnosticEvidenceInterner({
      maxSignatureCharacters: 100,
    });
    const rejected = Object.freeze({ id: "rejected" });
    const admitted = Object.freeze({ id: "admitted" });
    const observed = observeChildIds([rejected, admitted]);
    try {
      const tooLong = Object.freeze({ child: rejected, text: "x".repeat(200) });
      expect(pool.internOwned(tooLong, "plain")).toBe(tooLong);
      const original = pool.internOwned(
        Object.freeze({ child: admitted }),
        "plain",
      );
      expect(pool.internOwned(tooLong, "plain")).toBe(tooLong);
      expect(
        pool.internOwned(Object.freeze({ child: admitted }), "plain"),
      ).toBe(original);
      expect(observed.assigned()).toEqual([{ child: admitted, id: 1 }]);
    } finally {
      observed.restore();
    }
  });

  it("discards provisional IDs after later property eligibility fails", () => {
    const pool = createDiagnosticEvidenceInterner();
    const rejected = Object.freeze({ id: "rejected" });
    const admitted = Object.freeze({ id: "admitted" });
    const observed = observeChildIds([rejected, admitted]);
    try {
      // The eligible child is visited before the later oversized string.
      const tooLong = Object.freeze({
        child: rejected,
        text: "x".repeat(4097),
      });
      expect(pool.internOwned(tooLong, "plain")).toBe(tooLong);
      const unsupported = Object.freeze({ child: rejected, value: Number.NaN });
      expect(pool.internOwned(unsupported, "plain")).toBe(unsupported);
      const original = pool.internOwned(
        Object.freeze({ child: admitted }),
        "plain",
      );
      expect(
        pool.internOwned(Object.freeze({ child: admitted }), "plain"),
      ).toBe(original);
      expect(observed.assigned()).toEqual([{ child: admitted, id: 1 }]);
    } finally {
      observed.restore();
    }
  });

  it("commits one ID per distinct child and preserves within-candidate aliases", () => {
    const pool = createDiagnosticEvidenceInterner();
    const shared = Object.freeze({ value: 1 });
    const distinct = Object.freeze({ value: 1 });
    const observed = observeChildIds([shared, distinct]);
    try {
      const aliased = pool.internOwned(
        Object.freeze({ left: shared, right: shared }),
        "plain",
      );
      expect(
        pool.internOwned(
          Object.freeze({ left: shared, right: shared }),
          "plain",
        ),
      ).toBe(aliased);
      const separate = pool.internOwned(
        Object.freeze({ left: shared, right: distinct }),
        "plain",
      );
      expect(separate).not.toBe(aliased);
      expect(separate.left).toBe(shared);
      expect(separate.right).toBe(distinct);
      expect(
        pool.internOwned(
          Object.freeze({ left: shared, right: distinct }),
          "plain",
        ),
      ).toBe(separate);
      expect(observed.assigned()).toEqual([
        { child: shared, id: 1 },
        { child: distinct, id: 2 },
      ]);
    } finally {
      observed.restore();
    }
  });
});
