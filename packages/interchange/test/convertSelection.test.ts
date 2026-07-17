import { describe, expect, it } from "vitest";
import { ReservingError, computeDevelopmentFactors, fitTail } from "@actuarial-ts/core";
import {
  CREATED_AT,
  allWtdSelections,
  annualPaidDoc,
  annualPaidTriangle,
} from "./helpers.js";
import {
  COHERENCE_TOLERANCE,
  type SelectionDoc,
  averageKeyForIntent,
  checkSelectionCoherence,
  computeIntegrity,
  docToSelections,
  intentFromAverageKey,
  selectionsToDoc,
} from "../src/index.js";

const tri = annualPaidTriangle();
const triangleDoc = annualPaidDoc();

function authorCoherentDoc(): SelectionDoc {
  return selectionsToDoc(allWtdSelections(tri), {
    triangleDoc,
    createdAt: CREATED_AT,
    intents: ["all-wtd", "all-wtd", "all-wtd", "all-wtd"],
  }).doc;
}

function perturb(doc: SelectionDoc, delta = 0.01): SelectionDoc {
  const tampered = {
    ...doc,
    selection: {
      ...doc.selection,
      development: doc.selection.development.map((d, i) =>
        i === 0 ? { ...d, value: d.value + delta } : d,
      ),
    },
  };
  return { ...tampered, integrity: computeIntegrity(tampered) };
}

describe("coherence rule (spec 3.2): accept / warn / refuse", () => {
  it("accepts a document whose values match the intent recomputation", () => {
    const doc = authorCoherentDoc();
    const { coherence, selections } = docToSelections(doc, { triangleDoc });
    expect(coherence.coherent).toBe(true);
    expect(coherence.findings.every((f) => f.coherent === true)).toBe(true);
    expect(coherence.findings.every((f) => f.capability === "exact")).toBe(true);
    expect(selections.selected).toEqual(allWtdSelections(tri).selected);
    expect(selections.tailFactor).toBe(1);
  });

  it("warn mode: a perturbed value yields a warning, not a throw", () => {
    const doc = perturb(authorCoherentDoc());
    const { coherence, warnings } = docToSelections(doc, { triangleDoc, strictness: "warn" });
    expect(coherence.coherent).toBe(false);
    expect(warnings.some((w) => w.includes("INCOHERENT at 12→24"))).toBe(true);
  });

  it("refuse mode: a perturbed value throws INCOHERENT_SELECTION", () => {
    const doc = perturb(authorCoherentDoc());
    let thrown: unknown;
    try {
      docToSelections(doc, { triangleDoc, strictness: "refuse" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ReservingError);
    expect((thrown as ReservingError).code).toBe("INCOHERENT_SELECTION");
  });

  it("a deviation inside 1e-9 relative is coherent; just outside is not", () => {
    const doc = authorCoherentDoc();
    const inside = perturb(doc, doc.selection.development[0]!.value * COHERENCE_TOLERANCE * 0.4);
    expect(docToSelections(inside, { triangleDoc, strictness: "refuse" }).coherence.coherent).toBe(
      true,
    );
    const outside = perturb(doc, doc.selection.development[0]!.value * COHERENCE_TOLERANCE * 5);
    expect(() => docToSelections(outside, { triangleDoc, strictness: "refuse" })).toThrowError(
      expect.objectContaining({ code: "INCOHERENT_SELECTION" }),
    );
  });

  it("authoring-side default is refuse: selectionsToDoc will not author incoherence", () => {
    const wrong = allWtdSelections(tri);
    wrong.selected[0] = wrong.selected[0]! + 0.05;
    expect(() =>
      selectionsToDoc(wrong, {
        triangleDoc,
        createdAt: CREATED_AT,
        intents: ["all-wtd", "all-wtd", "all-wtd", "all-wtd"],
      }),
    ).toThrowError(expect.objectContaining({ code: "INCOHERENT_SELECTION" }));
  });

  it("judgmental values are authoritative: never recomputed, rationale carried", () => {
    const sel = allWtdSelections(tri);
    sel.selected[1] = 1.35; // hand-picked, off-menu
    const { doc, coherence } = selectionsToDoc(sel, {
      triangleDoc,
      createdAt: CREATED_AT,
      intents: [
        "all-wtd",
        { kind: "judgmental", rationale: "smoothed for the 2021 large loss" },
        "all-wtd",
        "all-wtd",
      ],
    });
    expect(coherence.coherent).toBe(true);
    const finding = coherence.findings.find(
      (f) => f.target !== "tail" && f.target.fromAgeMonths === 24,
    )!;
    expect(finding.authoritative).toBe("value");
    expect(finding.coherent).toBeNull();
    expect(doc.selection.development[1]!.intent.rationale).toContain("2021");
  });

  it("value-only capability cells (regression / off-table windows) accept with a warning", () => {
    const dev = computeDevelopmentFactors(tri);
    const allWtd = dev.averages.find((a) => a.spec.key === "all-wtd")!.values;
    const body = {
      appliesTo: { measure: "paid" as const, triangleIntegrity: triangleDoc.integrity },
      development: [
        {
          fromAgeMonths: 12,
          toAgeMonths: 24,
          value: 1.912345,
          intent: { kind: "regression" as const },
        },
        {
          fromAgeMonths: 24,
          toAgeMonths: 36,
          value: allWtd[1]!,
          intent: { kind: "volume-weighted" as const, windowOriginPeriods: 4 },
        },
      ],
    };
    const check = checkSelectionCoherence(body, triangleDoc, { strictness: "refuse" });
    expect(check.coherent).toBe(true); // nothing recomputable diverged
    expect(check.findings.every((f) => f.capability === "value-only")).toBe(true);
    expect(check.warnings.length).toBe(2);
    expect(check.warnings[0]).toContain("regression");
  });

  it("intents with origin exclusions are value-only on this shore (warned, never silent)", () => {
    const body = {
      appliesTo: { measure: "paid" as const, triangleIntegrity: triangleDoc.integrity },
      development: [
        {
          fromAgeMonths: 12,
          toAgeMonths: 24,
          value: 1.9,
          intent: {
            kind: "volume-weighted" as const,
            exclusions: [{ origin: "2021", reason: "one-off large loss" }],
          },
        },
      ],
    };
    const check = checkSelectionCoherence(body, triangleDoc, { strictness: "refuse" });
    expect(check.findings[0]!.capability).toBe("value-only");
    expect(check.warnings[0]).toContain("exclusions");
  });

  it("fitted tail: coherent when the value matches core's refit, incoherent when edited", () => {
    const sel = allWtdSelections(tri);
    const fit = fitTail({ method: "exponentialDecay", selectedLdfs: sel.selected });
    expect(fit.valid).toBe(true);
    const withTail = { selected: sel.selected, tailFactor: fit.tailFactor };
    const { doc, coherence } = selectionsToDoc(withTail, {
      triangleDoc,
      createdAt: CREATED_AT,
      intents: ["all-wtd", "all-wtd", "all-wtd", "all-wtd"],
      tailIntent: {
        kind: "fitted",
        family: "exponential-decay",
        params: { intercept: fit.intercept, slope: fit.slope },
      },
    });
    expect(coherence.findings.find((f) => f.target === "tail")!.coherent).toBe(true);

    const edited = {
      ...doc,
      selection: {
        ...doc.selection,
        tail: { ...doc.selection.tail!, value: doc.selection.tail!.value + 0.01 },
      },
    };
    const stamped = { ...edited, integrity: computeIntegrity(edited) };
    expect(() => docToSelections(stamped, { triangleDoc, strictness: "refuse" })).toThrowError(
      expect.objectContaining({ code: "INCOHERENT_SELECTION" }),
    );
  });

  it("a non-1 tail without an intent cannot be authored", () => {
    const sel = allWtdSelections(tri);
    expect(() =>
      selectionsToDoc(
        { selected: sel.selected, tailFactor: 1.05 },
        {
          triangleDoc,
          createdAt: CREATED_AT,
          intents: ["all-wtd", "all-wtd", "all-wtd", "all-wtd"],
        },
      ),
    ).toThrowError(expect.objectContaining({ code: "BAD_INTERCHANGE" }));
  });

  it("appliesTo mismatches are BAD_INTERCHANGE, not incoherence", () => {
    const doc = authorCoherentDoc();
    const wrongTag = {
      ...doc,
      selection: {
        ...doc.selection,
        appliesTo: { ...doc.selection.appliesTo, triangleIntegrity: "0123456789abcdef" },
      },
    };
    const stamped = { ...wrongTag, integrity: computeIntegrity(wrongTag) };
    expect(() => docToSelections(stamped, { triangleDoc })).toThrowError(
      expect.objectContaining({ code: "BAD_INTERCHANGE" }),
    );
  });
});

describe("intent ↔ standard-menu mapping (DEFAULT_AVERAGES target)", () => {
  it("maps every menu key to an intent and back on annual cadence", () => {
    for (const key of [
      "all-wtd",
      "all-str",
      "5-wtd",
      "5-str",
      "3-wtd",
      "3-str",
      "med-5x1",
      "geo-all",
    ] as const) {
      expect(averageKeyForIntent(intentFromAverageKey(key), 12)).toBe(key);
    }
  });

  it("windowed menu keys are exact only on 12-month cadence (spec table)", () => {
    expect(averageKeyForIntent(intentFromAverageKey("5-wtd"), 3)).toBeNull();
    expect(averageKeyForIntent(intentFromAverageKey("all-wtd"), 3)).toBe("all-wtd");
    expect(averageKeyForIntent(intentFromAverageKey("geo-all"), 3)).toBe("geo-all");
  });

  it("docToSelections surfaces the menu mapping per column", () => {
    const doc = authorCoherentDoc();
    const { averageKeys } = docToSelections(doc, { triangleDoc });
    expect(averageKeys).toEqual(["all-wtd", "all-wtd", "all-wtd", "all-wtd"]);
  });
});
