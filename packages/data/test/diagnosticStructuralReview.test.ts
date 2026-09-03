import { describe,expect,it } from "vitest";
import { CASUALTY_FORMULA_TEMPLATES,compileDiagnosticDefinition,prepareDiagnosticData,type DiagnosticDefinition } from "@actuarial-ts/core";
import { reviewPreparedDiagnosticData } from "../src/index.js";

const definition:DiagnosticDefinition={diagnosticDefinitionVersion:"1.0.0",id:"r",version:"1",lossRowGrain:"aggregate",measures:[],countPopulations:[],exposureBases:[],amountBases:[],derivedMeasures:[],formulas:[...CASUALTY_FORMULA_TEMPLATES],instances:[],reviewRules:[],periodAxis:{kind:"calendar",originCadence:"year",valuationCadence:"year",originAnchor:"start",valuationAnchor:"end",ageUnit:"month",ageOffset:0}};
describe("prepared structural review",()=>{it("always emits the fixed catalog and an identity-bearing receipt",()=>{const prepared=prepareDiagnosticData({definition:compileDiagnosticDefinition(definition),losses:[],exposures:[]});const receipt=reviewPreparedDiagnosticData({prepared,evidence:null});expect(receipt.report.checks).toHaveLength(11);expect(receipt.report.checks.slice(-2).every((check)=>check.status==="not-evaluated")).toBe(true);expect(receipt.reportFingerprint).toMatch(/^fnv1a64-jcs-v1:/);});});
