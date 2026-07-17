"""Error taxonomy for the actuarial-interchange Python adapter.

Mirrors the TS package's RESERVING_ERROR_CODES additions (spec 3.5 / 4.1):
``UNSUPPORTED_VERSION`` -> UnsupportedVersionError,
``INCOHERENT_SELECTION`` -> IncoherentSelectionError,
``BAD_INTERCHANGE`` -> BadInterchangeError. Every error this package raises
deliberately is an InterchangeError, so callers can catch one type.
"""

from __future__ import annotations

__all__ = [
    "InterchangeError",
    "UnsupportedVersionError",
    "IncoherentSelectionError",
    "BadInterchangeError",
    "InterchangeWarning",
]


class InterchangeError(Exception):
    """Base class for every deliberate failure raised by this package."""


class UnsupportedVersionError(InterchangeError):
    """A document's interchangeVersion has a major this adapter cannot read.

    Spec 3.5: wrong-major documents are refused; same-major unknown minors
    are accepted with unknown fields ignored (and governance/extensions
    round-tripped opaquely).
    """


class IncoherentSelectionError(InterchangeError):
    """A computable selection intent's stored value diverges from its
    recomputation on the referenced triangle beyond the spec coherence
    tolerance (spec 3.2, 1e-9 relative). Raised only under strict mode;
    non-strict importers warn instead.
    """


class BadInterchangeError(InterchangeError):
    """A document is structurally invalid: not JSON, missing required
    envelope or body fields, unknown kind, failed integrity check, or a
    payload this adapter cannot faithfully represent (e.g. an all-null
    triangle row that chainladder would silently drop).
    """


class InterchangeWarning(UserWarning):
    """Category for honesty warnings the spec requires to be explicit:
    the Mack-SE-less rule (Mack requested atop a value-only selection),
    approx-only replays, and coherence divergences in non-strict mode.
    """
