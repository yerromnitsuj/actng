export const COMPLIANCE_ERROR_CODES = [
  "BAD_BUNDLE", "BAD_CDF", "MISSING_RATIONALE", "BAD_DIAGNOSTIC_RUN",
  "DIAGNOSTIC_MISMATCH", "CRYPTO_UNAVAILABLE",
] as const;
export type ComplianceErrorCode = (typeof COMPLIANCE_ERROR_CODES)[number];
export class ComplianceError extends Error {
  readonly code: ComplianceErrorCode;
  readonly path?: string;
  constructor(code: ComplianceErrorCode, message: string, path?: string) {
    super(message);this.name="ComplianceError";this.code=code;if(path!==undefined)this.path=path;
  }
}
