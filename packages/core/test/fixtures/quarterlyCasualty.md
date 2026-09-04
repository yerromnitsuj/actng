# Quarterly casualty golden fixture

This fixture contains two caller-defined fleet groups, two origin quarters,
Q4-to-Q1 development, a ragged latest diagonal, and exposure rows repeated
across valuation snapshots under the same stable key.

The exact `quarterlyCasualty.ts` source from immutable tag `v0.5.0`
(`f236442d6a257d6057823a1c55da0b569297b036`) is retained as
`quarterlyCasualtyV05Source.ts.txt`. Its SHA-256 is
`14e5648921f48782356092244db755e9abd284a02a7e053b7667cf0388931aed`.
The migration test reads those inputs directly and explicitly maps their old
fields and metric IDs to the generalized definition.

The independently calculated expectations for `fleet-a`, origin `2024Q4`, age
3 are exported beside the frozen source inputs. They cover all 22 reference
metrics. The source components are:

| Component | Value |
|---|---:|
| Reported / open / CNP / CWP | 40 / 18 / 8 / 14 |
| Exposure | 820,000 |
| $250K paid / incurred | 280,000 / 520,000 |
| Primary paid / incurred | 360,000 / 710,000 |

For example, reported frequency is `40 / 820,000 * 1,000,000`, incurred
severity is `520,000 / (40 - 8)`, and primary average case is
`(710,000 - 360,000) / 18`. The frozen
`quarterlyCasualtyV05Golden.ts` contains all 110 v0.5 result records, including
raw numerator, denominator, displayed value, and warning codes; its SHA-256 is
`42e21e829de009e4b51183a9f477b0799881a703f3a2f179eeff526ec5a1fcf3`.
The test asserts every record exactly,
along with five emergence points, forty-four group/metric triangles, three ragged
latest-diagonal points, and single-count exposure despite the repeated
valuation copy.
