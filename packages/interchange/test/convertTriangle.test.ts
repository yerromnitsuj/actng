import { describe, expect, it } from "vitest";
import { triangleFromGrid } from "@actuarial-ts/core";
import {
  CREATED_AT,
  annualPaidTriangle,
  quarterlyIncurredTriangle,
} from "./helpers.js";
import { computeIntegrity, docToTriangle, triangleToDoc } from "../src/index.js";

describe("triangleToDoc / docToTriangle round-trips on real core triangles", () => {
  it("annual paid: doc → triangle → doc preserves the semantic body and tag", () => {
    const tri = annualPaidTriangle();
    const doc = triangleToDoc(tri, { createdAt: CREATED_AT, valuationDate: "2025-12-31" });
    expect(doc.triangle.originLengthMonths).toBe(12);
    expect(doc.triangle.origins[0]).toEqual({ label: "2021", start: "2021-01-01" });
    expect(doc.triangle.measure).toBe("paid");

    const { triangle: back, warnings } = docToTriangle(doc);
    expect(warnings).toEqual([]);
    expect(back).toEqual(tri);

    const doc2 = triangleToDoc(back, { createdAt: "2030-01-01T00:00:00Z", valuationDate: "2025-12-31" });
    expect(doc2.triangle).toEqual(doc.triangle);
    expect(doc2.integrity).toBe(doc.integrity); // envelope changed, tag did not
  });

  it("quarterly incurred: cadence 3 derives from YYYYQn labels", () => {
    const tri = quarterlyIncurredTriangle();
    const doc = triangleToDoc(tri, { createdAt: CREATED_AT, valuationDate: "2024-12-31" });
    expect(doc.triangle.originLengthMonths).toBe(3);
    expect(doc.triangle.origins.map((o) => o.start)).toEqual([
      "2024-01-01",
      "2024-04-01",
      "2024-07-01",
      "2024-10-01",
    ]);
    const { triangle: back, warnings } = docToTriangle(doc);
    expect(warnings).toEqual([]);
    expect(back).toEqual(tri);
  });

  it("nulls survive both directions (never NaN→0 or 0→missing)", () => {
    const tri = annualPaidTriangle();
    const doc = triangleToDoc(tri, { createdAt: CREATED_AT, valuationDate: "2025-12-31" });
    expect(doc.triangle.values![4]).toEqual([1725, null, null, null, null]);
    const { triangle: back } = docToTriangle(doc);
    expect(back.values[1]![4]).toBeNull();
    const withZero = triangleFromGrid(
      "paid",
      ["2024", "2025"],
      [12, 24],
      [
        [0, 10],
        [5, null],
      ],
    );
    const zeroDoc = triangleToDoc(withZero, { createdAt: CREATED_AT, valuationDate: "2025-12-31" });
    expect(zeroDoc.triangle.values![0]![0]).toBe(0); // a real zero stays a zero
    expect(docToTriangle(zeroDoc).triangle.values[0]![0]).toBe(0);
  });

  it("labels that are neither annual nor quarterly need explicit starts", () => {
    const tri = triangleFromGrid("paid", ["FY21-H1", "FY21-H2"], [6, 12], [
      [10, 20],
      [12, null],
    ]);
    expect(() =>
      triangleToDoc(tri, { createdAt: CREATED_AT, valuationDate: "2021-12-31" }),
    ).toThrowError(expect.objectContaining({ code: "BAD_INTERCHANGE" }));
    const doc = triangleToDoc(tri, {
      createdAt: CREATED_AT,
      valuationDate: "2021-12-31",
      originLengthMonths: 6,
      originStarts: ["2021-01-01", "2021-07-01"],
    });
    expect(doc.triangle.originLengthMonths).toBe(6);
    const { warnings } = docToTriangle(doc);
    expect(warnings.some((w) => w.includes("computation support is limited"))).toBe(true);
  });

  it("incremental docs cumulate through core with a loud warning", () => {
    const cumulative = triangleFromGrid("paid", ["2024", "2025"], [12, 24], [
      [100, 160],
      [110, null],
    ]);
    const incremental = triangleToDoc(
      triangleFromGrid("paid", ["2024", "2025"], [12, 24], [
        [100, 60],
        [110, null],
      ]),
      { createdAt: CREATED_AT, valuationDate: "2025-12-31", cumulative: false },
    );
    const { triangle, warnings } = docToTriangle(incremental);
    expect(triangle).toEqual(cumulative);
    expect(warnings.some((w) => w.includes("cumulated"))).toBe(true);
  });

  it("premium/custom measures refuse core conversion with a clear error", () => {
    const tri = annualPaidTriangle();
    const doc = triangleToDoc(tri, {
      createdAt: CREATED_AT,
      valuationDate: "2025-12-31",
      measure: "earnedPremium",
    });
    expect(() => docToTriangle(doc)).toThrowError(
      expect.objectContaining({ code: "BAD_INTERCHANGE" }),
    );
  });

  it("bulk-lane-only triangles refuse Phase A conversion", () => {
    const doc = triangleToDoc(annualPaidTriangle(), {
      createdAt: CREATED_AT,
      valuationDate: "2025-12-31",
    });
    const bulk = {
      ...doc,
      triangle: {
        ...doc.triangle,
        values: undefined,
        valuesRef: { format: "arrow", path: "values.arrow", sha256: "deadbeef" },
      },
    };
    delete (bulk.triangle as Record<string, unknown>)["values"];
    const stamped = { ...bulk, integrity: computeIntegrity(bulk) };
    expect(() => docToTriangle(stamped)).toThrowError(
      expect.objectContaining({ code: "BAD_INTERCHANGE" }),
    );
  });
});
