import { describe, expect, it } from "vitest";
import { validateDiagnosticDefinition } from "../src/index.js";

describe("validateDiagnosticDefinition",()=>{
  it("delegates semantic validation to core",()=>{
    expect(()=>validateDiagnosticDefinition({diagnosticDefinitionVersion:"2.0.0"})).toThrow();
  });
});
