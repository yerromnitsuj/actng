import { describe,expect,it } from "vitest";
import { createCasualtyDiagnosticReviewRules } from "../src/index.js";

describe("casualty diagnostic review rule factory",()=>{it("emits the fixed schema-neutral rules in order",()=>{const rules=createCasualtyDiagnosticReviewRules({counts:{reported:"reported",open:"open",closedNoPay:"cnp",closedWithPay:"cwp"},exposure:"exposure",monotonicMeasures:[],layerOrders:[],controlTotals:[]});expect(rules.map((rule)=>rule.id)).toEqual(["casualty/review/count-reconciliation","casualty/review/closed-no-pay-bound","casualty/review/positive-exposure","casualty/review/closed-reopen-signal"]);expect(rules.every((rule)=>rule.tolerance?.absolute===0&&rule.tolerance.relative===0)).toBe(true);});});
