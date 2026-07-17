"""Vendored canonical-JSON (RFC 8785 / JCS) serializer and FNV-1a 64 hash.

This module is the Python half of the cross-language equality oracle. Its
contract is byte-for-byte agreement with @actuarial-ts/core's
``canonicalJson``/``fnv1a64`` on every vector committed under
``schema/interchange/1.0/jcs-vectors.json``. If this file and the vectors
ever disagree, this file is wrong.

Ground truth (mirrors the TS implementation):

- Object keys sort recursively in UTF-16 CODE-UNIT order — NOT Python's
  default code-point order. The two differ for supplementary-plane
  characters (an emoji's first UTF-16 unit is a surrogate in 0xD800-0xDBFF,
  which sorts BELOW BMP characters in 0xE000-0xFFFF even though its code
  point is far larger). The sort key is therefore the key's UTF-16-BE
  encoding, whose bytewise order equals code-unit order.
- Numbers serialize with ECMAScript ``Number::toString`` semantics
  (shortest round-trip digits; plain notation for decimal exponents in
  (-7, 21]; ``1e+21`` / ``1e-7`` style outside; ``-0`` renders as ``"0"``).
  Python's ``repr`` picks the same shortest digits but formats exponents
  differently, so we take repr's digits and re-apply the ECMAScript layout.
- Integers are serialized through IEEE-754 double semantics (JSON numbers
  ARE doubles in ECMAScript); ints beyond 2^53 round exactly as they would
  in a JS engine.
- Strings escape only what JSON.stringify escapes: ``"``, ``\\``, control
  characters U+0000..U+001F (named escapes for \\b \\t \\n \\f \\r,
  ``\\u00XX`` otherwise), and — per ES2019 well-formed JSON.stringify —
  UNPAIRED surrogate code units as ``\\udXXX`` (a high+low surrogate pair
  is the astral character and is emitted literally). Everything else is
  emitted literally as UTF-8.
- Anything JSON cannot faithfully represent (NaN, infinities, non-string
  keys, unsupported types, circular references) raises ``ValueError`` with
  the offending path instead of being silently coerced.
"""

from __future__ import annotations

import math
from typing import Any

__all__ = ["canonical_json", "fnv1a64"]

# ---------------------------------------------------------------------------
# Number formatting (ECMAScript Number::toString, base 10)
# ---------------------------------------------------------------------------


def _format_number(value: float, path: str) -> str:
    """Render a float exactly as ECMAScript ``String(number)`` would.

    Implementation: ``repr`` supplies the shortest round-trip digit string
    (the same digits ECMAScript selects); we then re-lay it out per the
    ECMAScript algorithm, where ``n`` is the position of the decimal point
    relative to the ``k`` significant digits (value = digits x 10^(n-k)):

    - k <= n <= 21: integer notation, digits padded with zeros
    - 0 < n <= 21:  decimal point inside the digit string
    - -6 < n <= 0:  ``0.`` plus leading zeros plus digits
    - otherwise:    exponent notation, e.g. ``1e+21``, ``1.5e-7``
    """
    if math.isnan(value) or math.isinf(value):
        raise ValueError(f"non-finite number ({value!r}) at {path}")
    if value == 0.0:
        return "0"  # covers -0.0: JCS normalizes negative zero to "0"

    sign = "-" if value < 0 else ""
    text = repr(abs(value))

    if "e" in text:
        mantissa, _, exp_text = text.partition("e")
        exponent = int(exp_text)
    else:
        mantissa, exponent = text, 0
    int_part, _, frac_part = mantissa.partition(".")

    # value = int(digits) x 10^e10, digits stripped to the significant core
    digits = (int_part + frac_part).lstrip("0")
    e10 = exponent - len(frac_part)
    stripped = digits.rstrip("0")
    e10 += len(digits) - len(stripped)
    digits = stripped

    k = len(digits)
    n = e10 + k  # decimal point sits after the first n digits

    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + digits
    e = n - 1
    exp_sign = "+" if e >= 0 else "-"
    head = digits[0] + ("." + digits[1:] if k > 1 else "")
    return sign + head + "e" + exp_sign + str(abs(e))


# ---------------------------------------------------------------------------
# String escaping (JSON.stringify minimal escaping, per JCS)
# ---------------------------------------------------------------------------

_NAMED_ESCAPES = {
    "\b": "\\b",
    "\t": "\\t",
    "\n": "\\n",
    "\f": "\\f",
    "\r": "\\r",
    '"': '\\"',
    "\\": "\\\\",
}


def _format_string(value: str) -> str:
    """JSON.stringify's minimal escaping, including its WELL-FORMED rule
    (ES2019): an UNPAIRED surrogate code unit is escaped as ``\\udXXX``
    (lowercase hex) instead of being emitted raw — raw lone surrogates are
    not UTF-8-encodable, so without this rule ``fnv1a64`` over the
    canonical text would raise ``UnicodeEncodeError``. A high surrogate
    immediately followed by a low surrogate is a valid pair (JS string
    semantics) and is emitted literally as the astral character it encodes.
    """
    parts: list[str] = ['"']
    i = 0
    length = len(value)
    while i < length:
        ch = value[i]
        code = ord(ch)
        escape = _NAMED_ESCAPES.get(ch)
        if escape is not None:
            parts.append(escape)
        elif ch < "\x20":
            parts.append(f"\\u{code:04x}")
        elif 0xD800 <= code <= 0xDBFF:
            if i + 1 < length and 0xDC00 <= ord(value[i + 1]) <= 0xDFFF:
                low = ord(value[i + 1])
                parts.append(chr(0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)))
                i += 2
                continue
            parts.append(f"\\u{code:04x}")
        elif 0xDC00 <= code <= 0xDFFF:
            parts.append(f"\\u{code:04x}")
        else:
            parts.append(ch)
        i += 1
    parts.append('"')
    return "".join(parts)


def _utf16_sort_key(key: str) -> bytes:
    """UTF-16 code-unit sort key (bytewise order of the UTF-16-BE encoding).

    ``surrogatepass`` keeps lone surrogates (representable in JSON via
    ``\\uXXXX`` escapes) sortable instead of raising.
    """
    return key.encode("utf-16-be", "surrogatepass")


# ---------------------------------------------------------------------------
# Canonicalization
# ---------------------------------------------------------------------------


def _canonicalize(value: Any, path: str, seen: set[int]) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):  # bool before int: True is an int in Python
        return "true" if value else "false"
    if isinstance(value, str):
        return _format_string(value)
    if isinstance(value, (int, float)):
        try:
            as_double = float(value)
        except OverflowError as exc:
            raise ValueError(f"integer too large for a JSON double at {path}") from exc
        return _format_number(as_double, path)
    if isinstance(value, (list, tuple)):
        marker = id(value)
        if marker in seen:
            raise ValueError(f"circular reference at {path}")
        seen.add(marker)
        parts = [_canonicalize(item, f"{path}[{i}]", seen) for i, item in enumerate(value)]
        seen.discard(marker)
        return "[" + ",".join(parts) + "]"
    if isinstance(value, dict):
        marker = id(value)
        if marker in seen:
            raise ValueError(f"circular reference at {path}")
        seen.add(marker)
        for key in value:
            if not isinstance(key, str):
                raise ValueError(f"non-string object key ({key!r}) at {path}")
        parts = [
            f"{_format_string(key)}:{_canonicalize(value[key], f'{path}.{key}', seen)}"
            for key in sorted(value, key=_utf16_sort_key)
        ]
        seen.discard(marker)
        return "{" + ",".join(parts) + "}"
    raise ValueError(
        f"unsupported type ({type(value).__name__}) at {path}; "
        "only dict, list, str, int, float, bool, and None are canonicalizable"
    )


def canonical_json(value: Any) -> str:
    """Deterministic JSON serialization per RFC 8785 (JCS).

    Sorted object keys (recursively, UTF-16 code-unit order), arrays in
    order, no whitespace, ECMAScript number formatting, -0 normalized to
    "0". Two structurally equal values always produce the same string.
    Raises ``ValueError`` — with the offending path, e.g. ``$.rows[2]`` —
    for any value JSON cannot faithfully represent.
    """
    return _canonicalize(value, "$", set())


# ---------------------------------------------------------------------------
# FNV-1a 64-bit
# ---------------------------------------------------------------------------

_FNV_OFFSET_BASIS = 0xCBF29CE484222325
_FNV_PRIME = 0x100000001B3
_MASK_64 = 0xFFFFFFFFFFFFFFFF


def fnv1a64(text: str) -> str:
    """FNV-1a 64-bit hash over the UTF-8 bytes of ``text``, as 16 hex chars.

    This is an INTEGRITY AID for detecting accidental divergence between a
    payload and a re-run. It is NOT a security control: FNV-1a is not
    collision resistant and offers no protection against deliberate
    tampering. Anyone needing tamper evidence must sign or
    cryptographically hash the payload.
    """
    hashed = _FNV_OFFSET_BASIS
    for byte in text.encode("utf-8"):
        hashed ^= byte
        hashed = (hashed * _FNV_PRIME) & _MASK_64
    return format(hashed, "016x")
