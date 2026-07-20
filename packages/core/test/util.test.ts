import { describe, expect, it } from "vitest";
import { assertSameShape } from "../src/util.js";
import { ReservingError } from "../src/types.js";
import type { Triangle } from "../src/types.js";

/**
 * assertSameShape is the one shared origins/ages guard used by every method
 * that pairs two triangles (Berquist-Sherman, case-outstanding, freq/sev,
 * Fisher-Lange, Munich chain ladder). Each call site owns its own message
 * text, but the shape comparison itself must behave identically everywhere.
 */

function tri(origins: string[], ages: number[]): Triangle {
  return {
    kind: "paid",
    origins,
    ages,
    values: origins.map(() => ages.map(() => null)),
  };
}

function expectShapeError(fn: () => void, message: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(ReservingError);
  expect((thrown as ReservingError).code).toBe("SHAPE");
  expect((thrown as ReservingError).message).toBe(message);
}

describe("assertSameShape", () => {
  it("does not throw when origins and ages are identical", () => {
    const a = tri(["2020", "2021"], [12, 24]);
    const b = tri(["2020", "2021"], [12, 24]);
    expect(() => assertSameShape(a, b, "should not fire")).not.toThrow();
  });

  it("throws SHAPE with the caller's exact message on mismatched origin count", () => {
    const a = tri(["2020", "2021"], [12, 24]);
    const b = tri(["2020"], [12, 24]);
    expectShapeError(() => assertSameShape(a, b, "origin count mismatch"), "origin count mismatch");
  });

  it("throws SHAPE with the caller's exact message on mismatched age count", () => {
    const a = tri(["2020", "2021"], [12, 24]);
    const b = tri(["2020", "2021"], [12, 24, 36]);
    expectShapeError(() => assertSameShape(a, b, "age count mismatch"), "age count mismatch");
  });

  it("throws SHAPE with the caller's exact message on mismatched origin labels", () => {
    const a = tri(["2020", "2021"], [12, 24]);
    const b = tri(["2020", "2022"], [12, 24]);
    expectShapeError(
      () => assertSameShape(a, b, "origin label mismatch"),
      "origin label mismatch",
    );
  });

  it("throws SHAPE with the caller's exact message on mismatched age labels", () => {
    const a = tri(["2020", "2021"], [12, 24]);
    const b = tri(["2020", "2021"], [12, 36]);
    expectShapeError(() => assertSameShape(a, b, "age label mismatch"), "age label mismatch");
  });
});
