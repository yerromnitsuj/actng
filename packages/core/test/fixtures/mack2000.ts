/** Mack (2000), Section 4, all amounts relative to premium = 100.
 * This is the original numerical source transcription formerly embedded in
 * benktander.test.ts. It is not generated from an SDK result.
 */
export const mack2000Inputs = {
  premium: 100,
  priorUltimate: 90,
  paidToDate: 55,
  percentDeveloped: 0.5,
  chainLadderUltimate: 110,
  bornhuetterFergusonReserve: 45,
} as const;
export const mack2000Published = {
  ultimate: 105,
  reserve: 50,
  credibility: 0.5,
} as const;
