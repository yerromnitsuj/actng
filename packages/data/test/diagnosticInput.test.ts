import { describe, expect, it } from "vitest";
import { CASUALTY_FORMULA_TEMPLATES, type DiagnosticDefinition } from "@actuarial-ts/core";
import { runValidatedMetricDiagnostics, validateDiagnosticRunInput } from "../src/index.js";

const definition: DiagnosticDefinition = {
  diagnosticDefinitionVersion:"1.0.0",id:"data-test",version:"1",lossRowGrain:"aggregate",
  measures:[{id:"claims",displayName:"Claims",description:"Reported",source:"loss",kind:"count",unit:"claim",developmentSemantics:"cumulative",aggregation:"sum",missing:"unknown",countPopulationId:"claims"}],
  countPopulations:[{id:"claims",displayName:"Claims",subject:"claim",unit:"claim",description:"Claims"}],exposureBases:[],amountBases:[],derivedMeasures:[],formulas:[CASUALTY_FORMULA_TEMPLATES[1]],
  instances:[{id:"identity",version:"1",formulaId:"share",bindings:{part:{op:"measure",measureId:"claims"},whole:{op:"measure",measureId:"claims"}},presentation:{displayName:"Identity",description:"Identity ratio",displayUnit:"ratio",scale:1,numeratorLabel:"claims",denominatorLabel:"claims"},rules:[]}],reviewRules:[],
  periodAxis:{kind:"calendar",originCadence:"year",valuationCadence:"year",originAnchor:"start",valuationAnchor:"end",ageUnit:"month",ageOffset:0},
};

describe("diagnostic run input boundary",()=>{
  it("validates, brands, and executes the complete run",()=>{
    const validated=validateDiagnosticRunInput({definition,losses:[{rowType:"aggregate",recordId:"r1",sourceGroup:"all",origin:"2024",valuation:"2024",complete:true,measures:{claims:2}}]});
    const outcome=runValidatedMetricDiagnostics(validated);
    expect(outcome.status).toBe("completed");
    if(outcome.status!=="completed")throw new Error("expected completed run");
    expect(outcome.result.emergence[0]!.metrics.identity!.calculation.value).toBe(1);
  });
  it("rejects stale fields and row-grain mismatches atomically",()=>{
    expect(()=>validateDiagnosticRunInput({definition,losses:[{rowType:"aggregate",recordId:"r1",sourceGroup:"all",origin:"2024",valuation:"2024",ageMonths:12,complete:true,measures:{claims:2}}]})).toThrow();
    expect(()=>validateDiagnosticRunInput({definition,losses:[{rowType:"claim",claimId:"c1",recordId:"r1",sourceGroup:"all",origin:"2024",valuation:"2024",complete:true,measures:{claims:2}}]})).toThrow();
  });
  it("requires rationale when policy allows a fail outcome",()=>{
    expect(()=>validateDiagnosticRunInput({definition,losses:[],policy:{allowedMetricFindingSeverities:["fail"]}})).toThrow(/rationale/i);
  });
});
