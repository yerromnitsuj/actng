import { describe, expect, it } from "vitest";
import { ReservingError, triangleFromGrid } from "@actuarial-ts/core";
import { triangleFromLongFormat } from "../src/longFormat.js";

describe("triangleFromLongFormat", () => {
  it("round-trips against a hand-built triangleFromGrid result", () => {
    const expected = triangleFromGrid(
      "paid",
      ["2020", "2021", "2022"],
      [12, 24, 36],
      [
        [100, 180, 200],
        [110, 190, null],
        [120, null, null],
      ],
    );
    // Shuffled input order: sorting is the function's job.
    const actual = triangleFromLongFormat(
      [
        { origin: "2022", age: 12, value: 120 },
        { origin: "2020", age: 36, value: 200 },
        { origin: "2021", age: 24, value: 190 },
        { origin: "2020", age: 12, value: 100 },
        { origin: "2021", age: 12, value: 110 },
        { origin: "2020", age: 24, value: 180 },
      ],
      { kind: "paid" },
    );
    expect(actual).toEqual(expected);
  });

  it("sorts origins lexicographically and ages numerically ascending", () => {
    const tri = triangleFromLongFormat(
      [
        { origin: "2021Q3", age: 9, value: 3 },
        { origin: "2021Q1", age: 3, value: 1 },
        { origin: "2021Q3", age: 3, value: 2 },
      ],
      { kind: "incurred" },
    );
    expect(tri.origins).toEqual(["2021Q1", "2021Q3"]);
    expect(tri.ages).toEqual([3, 9]);
    expect(tri.kind).toBe("incurred");
  });

  it("leaves absent (origin, age) pairs as null", () => {
    const tri = triangleFromLongFormat(
      [
        { origin: "2020", age: 12, value: 5 },
        { origin: "2021", age: 24, value: 7 },
      ],
      { kind: "paid" },
    );
    expect(tri.values).toEqual([
      [5, null],
      [null, 7],
    ]);
  });

  it("keeps explicit null values distinct from absent cells", () => {
    const tri = triangleFromLongFormat(
      [
        { origin: "2020", age: 12, value: null },
        { origin: "2020", age: 24, value: 9 },
      ],
      { kind: "paid" },
    );
    expect(tri.values).toEqual([[null, 9]]);
  });

  it("throws ReservingError SHAPE naming a duplicate (origin, age) pair", () => {
    let caught: unknown;
    try {
      triangleFromLongFormat(
        [
          { origin: "2020", age: 12, value: 1 },
          { origin: "2020", age: 12, value: 2 },
        ],
        { kind: "paid" },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ReservingError);
    const err = caught as ReservingError;
    expect(err.code).toBe("SHAPE");
    expect(err.message).toContain("2020");
    expect(err.message).toContain("12");
  });

  it("treats a duplicate pair as duplicate even when both values are null", () => {
    expect(() =>
      triangleFromLongFormat(
        [
          { origin: "2020", age: 12, value: null },
          { origin: "2020", age: 12, value: null },
        ],
        { kind: "paid" },
      ),
    ).toThrowError(ReservingError);
  });

  it("returns an empty triangle for no rows", () => {
    const tri = triangleFromLongFormat([], { kind: "paid" });
    expect(tri).toEqual({ kind: "paid", origins: [], ages: [], values: [] });
  });
});
