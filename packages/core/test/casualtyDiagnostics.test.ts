import { describe, expect, it } from "vitest";
import { CASUALTY_FORMULA_TEMPLATES, createCasualtyMetricInstances } from "../src/index.js";

const counts = { reported: "reported", open: "open", closedNoPay: "cnp", closedWithPay: "cwp" };

describe("casualty reference instance factory", () => {
  it("creates 10 count instances and six per caller amount binding", () => {
    expect(createCasualtyMetricInstances({ counts, exposure: "exposure", amountBindings: [] })).toHaveLength(10);
    expect(createCasualtyMetricInstances({ counts, exposure: "exposure", amountBindings: [{ id: "net", paid: "paid", incurred: "incurred" }] })).toHaveLength(16);
    const two = createCasualtyMetricInstances({ counts, exposure: "exposure", amountBindings: [{ id: "gross", paid: "gross-paid", incurred: "gross-incurred" }, { id: "net", paid: "net-paid", incurred: "net-incurred" }] });
    expect(two).toHaveLength(22);
    expect(new Set(two.map((instance) => instance.id)).size).toBe(22);
    expect(CASUALTY_FORMULA_TEMPLATES).toHaveLength(6);
  });

  it("uses deterministic RFC3986 binding IDs and attaches only the two local rules", () => {
    const instances = createCasualtyMetricInstances({ counts, exposure: "exposure", amountBindings: [{ id: "gross / 日本", paid: "paid", incurred: "incurred" }] });
    expect(instances[10]!.id).toBe("casualty/amount/gross%20%2F%20%E6%97%A5%E6%9C%AC/paid-to-incurred");
    expect(instances.filter((instance) => instance.rules.length > 0).map((instance) => instance.rules[0]!.code)).toEqual(["paid-exceeds-incurred", "negative-case"]);
  });

  it("keeps presentation choices explicit and rejects unknown overrides", () => {
    const id = "casualty/count/reported-frequency";
    expect(createCasualtyMetricInstances({ counts, exposure: "exposure", amountBindings: [], presentationOverrides: { [id]: { scale: 1_000_000, displayUnit: "count per million" } } })[0]!.presentation).toMatchObject({ scale: 1_000_000, displayUnit: "count per million" });
    expect(() => createCasualtyMetricInstances({ counts, exposure: "exposure", amountBindings: [], presentationOverrides: { missing: { scale: 1 } } })).toThrow();
  });
});
