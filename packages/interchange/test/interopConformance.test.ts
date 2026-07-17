/**
 * Runs the Phase A cross-engine conformance suite as part of this
 * package's vitest run (so root `npm test` includes it). The suite and its
 * frozen fixtures live with the Python runner under interop/conformance/ —
 * see interop/conformance/README.md for the layout and the fixture freeze
 * policy.
 */
import "../../../interop/conformance/ts/conformance.test.js";
