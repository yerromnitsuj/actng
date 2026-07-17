"""actuarial-interchange: Python adapter for the actuarial-interchange spec v1.

The core (this module's exports) is pure stdlib: the vendored JCS
canonicalizer, the FNV-1a integrity hash, the document dataclasses, and
parse/serialize with spec 3.5 version handling.

The chainladder bridges are NOT imported here — they require the
``[chainladder]`` extra (``pip install actuarial-interchange[chainladder]``)
and are imported explicitly::

    from actuarial_interchange import bridge_triangle, bridge_selection, bridge_result
"""

from ._jcs import canonical_json, fnv1a64
from .documents import (
    COMPUTABLE_INTENT_KINDS,
    CROSSCHECK_VERDICTS,
    GENERATOR_NAME,
    GENERATOR_VERSION,
    SPEC_VERSION,
    SUPPORTED_MAJOR,
    VALUE_ONLY_INTENT_KINDS,
    CrosscheckReportPayload,
    DevelopmentIntent,
    DevelopmentSelection,
    Document,
    EngineStamp,
    Exclusion,
    Generator,
    MethodResultPayload,
    Origin,
    ResultAppliesTo,
    ResultRow,
    ResultTotals,
    SelectionAppliesTo,
    SelectionPayload,
    StochasticResultPayload,
    StudyPayload,
    TailIntent,
    TailSelection,
    TrianglePayload,
    parse_document,
    serialize_document,
)
from .errors import (
    BadInterchangeError,
    IncoherentSelectionError,
    InterchangeError,
    InterchangeWarning,
    UnsupportedVersionError,
)

__version__ = GENERATOR_VERSION

__all__ = [
    "__version__",
    # canonicalization
    "canonical_json",
    "fnv1a64",
    # constants
    "SPEC_VERSION",
    "SUPPORTED_MAJOR",
    "GENERATOR_NAME",
    "GENERATOR_VERSION",
    "COMPUTABLE_INTENT_KINDS",
    "VALUE_ONLY_INTENT_KINDS",
    "CROSSCHECK_VERDICTS",
    # documents
    "Document",
    "Generator",
    "Origin",
    "TrianglePayload",
    "Exclusion",
    "DevelopmentIntent",
    "DevelopmentSelection",
    "TailIntent",
    "TailSelection",
    "SelectionAppliesTo",
    "SelectionPayload",
    "ResultAppliesTo",
    "EngineStamp",
    "ResultRow",
    "ResultTotals",
    "MethodResultPayload",
    "StochasticResultPayload",
    "StudyPayload",
    "CrosscheckReportPayload",
    "parse_document",
    "serialize_document",
    # errors
    "InterchangeError",
    "UnsupportedVersionError",
    "IncoherentSelectionError",
    "BadInterchangeError",
    "InterchangeWarning",
]
