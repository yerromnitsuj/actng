import { describe, expect, it } from "vitest";
import { CASUALTY_FORMULA_TEMPLATES, compileDiagnosticDefinition, evaluateDiagnosticReviewRules, prepareDiagnosticData, type DiagnosticDefinition } from "../src/index.js";

const definition:DiagnosticDefinition={diagnosticDefinitionVersion:"1.0.0",id:"review",version:"1",lossRowGrain:"aggregate",measures:[{id:"reported",displayName:"Reported",description:"Reported",source:"loss",kind:"count",unit:"claim",developmentSemantics:"cumulative",aggregation:"sum",missing:"unknown",countPopulationId:"claims"},{id:"open",displayName:"Open",description:"Open",source:"loss",kind:"count",unit:"claim",developmentSemantics:"point-in-time",aggregation:"sum",missing:"unknown",countPopulationId:"claims"}],countPopulations:[{id:"claims",displayName:"Claims",subject:"claim",unit:"claim",description:"Claims"}],exposureBases:[],amountBases:[],derivedMeasures:[],formulas:[CASUALTY_FORMULA_TEMPLATES[1]],instances:[],reviewRules:[{kind:"compare",id:"open-le-reported",code:"open-exceeds-reported",description:"Open does not exceed reported",severity:"fail",missingInput:"not-evaluated",when:{left:{op:"measure",measureId:"open"},operator:"gt",right:{op:"measure",measureId:"reported"}}}],periodAxis:{kind:"calendar",originCadence:"year",valuationCadence:"year",originAnchor:"start",valuationAnchor:"end",ageUnit:"month",ageOffset:0}};

describe("declarative diagnostic review",()=>{
  it("evaluates generic rules from the compiled definition",()=>{
    const compiled=compileDiagnosticDefinition(definition);const prepared=prepareDiagnosticData({definition:compiled,losses:[{rowType:"aggregate",recordId:"r",sourceGroup:"all",origin:"2024",valuation:"2024",complete:true,measures:{reported:5,open:6}}],exposures:[]});
    expect(evaluateDiagnosticReviewRules(prepared)[0]).toMatchObject({ruleId:"open-le-reported",status:"triggered",triggerReason:"predicate",left:6,right:5});
  });
});
