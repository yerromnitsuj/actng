# Quarterly casualty golden fixture

This fixture contains two caller-defined fleet groups, two origin quarters,
Q4-to-Q1 development, a ragged latest diagonal, and exposure rows repeated
across valuation snapshots under the same stable key.

The independently calculated expectations for `fleet-a`, origin `2024Q4`, age
3 are exported beside the inputs in `quarterlyCasualty.ts`. They cover all 20
reference metrics. The source components are:

| Component | Value |
|---|---:|
| Reported / open / CNP / CWP | 40 / 18 / 8 / 14 |
| Exposure | 820,000 |
| $250K paid / incurred | 280,000 / 520,000 |
| Primary paid / incurred | 360,000 / 710,000 |

For example, reported frequency is `40 / 820,000 * 1,000,000`, incurred
severity is `520,000 / (40 - 8)`, and primary average case is
`(710,000 - 360,000) / 18`. The test asserts the full expected record exactly,
along with five emergence points, forty group/metric triangles, three ragged
latest-diagonal points, and single-count exposure despite the repeated
valuation copy.
