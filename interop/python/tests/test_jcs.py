"""JCS conformance: reproduce every committed vector byte-for-byte.

The vector file at schema/interchange/1.0/jcs-vectors.json is the
cross-language contract shared with @actuarial-ts/core. If a vector fails
here, this adapter is wrong — never the vector.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from actuarial_interchange import canonical_json, fnv1a64

REPO_ROOT = Path(__file__).resolve().parents[3]
VECTORS_PATH = REPO_ROOT / "schema" / "interchange" / "1.0" / "jcs-vectors.json"

with VECTORS_PATH.open(encoding="utf-8") as handle:
    _VECTORS = json.load(handle)["vectors"]


@pytest.mark.parametrize("vector", _VECTORS, ids=[v["name"] for v in _VECTORS])
def test_committed_vector_reproduced_byte_for_byte(vector: dict) -> None:
    produced = canonical_json(vector["value"])
    assert produced == vector["canonical"]
    assert produced.encode("utf-8") == vector["canonical"].encode("utf-8")


class TestUtf16KeySort:
    """Python's code-point sort differs from UTF-16 code-unit order exactly
    where a supplementary-plane key meets a key in U+E000..U+FFFF."""

    def test_emoji_sorts_before_ufffd(self) -> None:
        # Code points: U+1F600 > U+FFFD, so Python's sorted() puts �
        # first. UTF-16 code units: 0xD83D < 0xFFFD, so JCS puts the emoji
        # first. This is the case the vendored sort key exists for.
        value = {"�": 1, "\U0001f600": 2}
        assert canonical_json(value) == '{"\U0001f600":2,"�":1}'

    def test_ascii_capitals_before_lowercase(self) -> None:
        assert canonical_json({"a": 1, "B": 2}) == '{"B":2,"a":1}'


class TestEcmaScriptNumbers:
    def test_integer_valued_floats_render_without_decimal(self) -> None:
        assert canonical_json(100.0) == "100"
        assert canonical_json(-42.0) == "-42"

    def test_exponent_thresholds(self) -> None:
        assert canonical_json(1e20) == "100000000000000000000"
        assert canonical_json(1e21) == "1e+21"
        assert canonical_json(1.5e-7) == "1.5e-7"
        assert canonical_json(0.000001) == "0.000001"

    def test_negative_zero_normalizes(self) -> None:
        assert canonical_json(-0.0) == "0"

    def test_extremes(self) -> None:
        assert canonical_json(5e-324) == "5e-324"
        assert canonical_json(1.7976931348623157e308) == "1.7976931348623157e+308"

    def test_int_beyond_2_53_rounds_like_a_double(self) -> None:
        # ECMAScript JSON.parse would round this to the nearest double.
        assert canonical_json(2**53 + 1) == "9007199254740992"

    def test_non_finite_raises_with_path(self) -> None:
        with pytest.raises(ValueError, match=r"\$\.x"):
            canonical_json({"x": math.nan})
        with pytest.raises(ValueError):
            canonical_json(math.inf)


class TestRejections:
    def test_non_string_key_raises(self) -> None:
        with pytest.raises(ValueError, match="non-string"):
            canonical_json({1: "a"})

    def test_unsupported_type_raises_with_path(self) -> None:
        with pytest.raises(ValueError, match=r"\$\[0\]"):
            canonical_json([object()])

    def test_circular_reference_raises(self) -> None:
        loop: list = []
        loop.append(loop)
        with pytest.raises(ValueError, match="circular"):
            canonical_json(loop)


class TestFnv1a64:
    def test_known_vectors(self) -> None:
        # Standard FNV-1a 64 test values.
        assert fnv1a64("") == "cbf29ce484222325"
        assert fnv1a64("a") == "af63dc4c8601ec8c"

    def test_hashes_utf8_bytes(self) -> None:
        assert fnv1a64("é") != fnv1a64("e")
        assert len(fnv1a64("réserve")) == 16


class TestLoneSurrogates:
    """Well-formed JSON.stringify (ES2019): unpaired surrogate code units
    escape as \\udXXX so the canonical text is always UTF-8-encodable and
    fnv1a64 can never hit UnicodeEncodeError. The committed
    lone-surrogate-escaped vector pins the cross-language bytes."""

    def test_lone_high_surrogate_escapes(self) -> None:
        assert canonical_json("\ud800") == '"\\ud800"'
        assert canonical_json({"k": "\ud800"}) == '{"k":"\\ud800"}'

    def test_lone_low_surrogate_escapes(self) -> None:
        assert canonical_json("\udc00") == '"\\udc00"'

    def test_fnv1a64_over_canonical_text_never_raises(self) -> None:
        # Before the escape, this path raised UnicodeEncodeError.
        assert len(fnv1a64(canonical_json({"k": "\ud800"}))) == 16

    def test_paired_surrogates_combine_like_a_js_string(self) -> None:
        # In JS string semantics a high+low pair IS the astral character;
        # byte parity requires emitting it literally, not as two escapes.
        # (Python keeps "\ud83d\ude00" as two adjacent surrogate code
        # points — exactly the JS pair — so the emitter must combine.)
        assert canonical_json("\ud83d\ude00") == canonical_json("\U0001f600") == '"😀"'

    def test_surrogate_keys_still_sort_by_utf16_code_units(self) -> None:
        # A lone-surrogate KEY sorts by its code unit and escapes in output.
        assert canonical_json({"�": 1, "\ud800": 2}) == '{"\\ud800":2,"�":1}'
