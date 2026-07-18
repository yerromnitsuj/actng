"""Wire layer: spec-7 run requests in, interchange documents out.

Parsing consumes the actuarial-interchange package (``parse_document``
verifies every embedded document's integrity tag); responses are the
documents' own ``to_dict()`` envelopes. The wire is STRICT: unknown
top-level keys are refused, and any key matching the tenant-id pattern —
anywhere in the request, at any depth — is rejected with 422, mirroring
the agents-package tenant-lint (``/^(project|tenant)[_-]?id$/i``).
Statelessness is a privacy feature; a tenant id has no business even
arriving here.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from actuarial_interchange import Document, parse_document
from actuarial_interchange.errors import InterchangeError

__all__ = [
    "Exposure",
    "RunRequest",
    "SidecarError",
    "created_at_now",
    "error_body",
    "lint_tenant_keys",
    "parse_run_request",
]

#: Mirror of the agents package's TENANT_KEY_PATTERN (packages/agents/src/tools.ts):
#: casing- and separator-tolerant so projectId / project_id / TenantID / tenant-id
#: are all refused.
TENANT_KEY_PATTERN = re.compile(r"^(project|tenant)[_-]?id$", re.IGNORECASE)

_ALLOWED_TOP_LEVEL = frozenset(
    {"triangles", "selection", "exposure", "parameters", "seed", "engagementRef"}
)
_ALLOWED_TRIANGLE_SLOTS = frozenset({"primary", "secondary"})
_ALLOWED_EXPOSURE_KEYS = frozenset({"origins", "values", "kind"})


class SidecarError(Exception):
    """A schema'd request refusal: HTTP status + machine code + message."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def error_body(code: str, message: str) -> dict:
    """The one error envelope every non-2xx response uses."""
    return {"error": {"code": code, "message": message}}


def created_at_now() -> str:
    """UTC authoring timestamp for result documents (the package itself
    never reads a clock; the service supplies it)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def lint_tenant_keys(value: Any, path: str = "request") -> None:
    """Refuse tenant-identifier keys at ANY depth of the request.

    The wire contract has no tenant fields (spec 7 / 12); a request that
    carries one is malformed by definition and gets a 422 naming the
    offending path — the same posture as the agents package's schema lint,
    enforced here on data instead of schemas.
    """
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(key, str) and TENANT_KEY_PATTERN.fullmatch(key):
                raise SidecarError(
                    422,
                    "TENANT_KEY_REJECTED",
                    f"'{path}.{key}': tenant identifiers are forbidden anywhere "
                    "in the sidecar wire contract (statelessness is a privacy "
                    "feature; use the opaque engagementRef for correlation)",
                )
            lint_tenant_keys(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            lint_tenant_keys(item, f"{path}[{index}]")


@dataclass(frozen=True)
class Exposure:
    """BF/Benktander/CapeCod apriori base: one value per origin label."""

    origins: list[str]
    values: list[float]
    kind: str


@dataclass(frozen=True)
class RunRequest:
    """One parsed POST /v1/run/{method} body (spec 7 wire shape)."""

    primary: Document
    secondary: Optional[Document] = None
    selection: Optional[Document] = None
    exposure: Optional[Exposure] = None
    parameters: dict = field(default_factory=dict)
    seed: Optional[int] = None
    engagement_ref: Optional[str] = None


def _parse_embedded_document(raw: Any, slot: str, expected_kind: str) -> Document:
    if not isinstance(raw, dict):
        raise SidecarError(422, "INVALID_DOCUMENT", f"'{slot}' must be a JSON object")
    try:
        document = parse_document(raw)
    except InterchangeError as exc:
        raise SidecarError(422, "INVALID_DOCUMENT", f"'{slot}': {exc}") from exc
    if document.kind != expected_kind:
        raise SidecarError(
            422,
            "WRONG_DOCUMENT_KIND",
            f"'{slot}' must be a {expected_kind} document, got kind '{document.kind}'",
        )
    return document


def _parse_exposure(raw: Any) -> Exposure:
    if not isinstance(raw, dict):
        raise SidecarError(422, "INVALID_EXPOSURE", "'exposure' must be a JSON object")
    unknown = set(raw) - _ALLOWED_EXPOSURE_KEYS
    if unknown:
        raise SidecarError(
            422,
            "INVALID_EXPOSURE",
            f"'exposure' has unknown key(s) {sorted(unknown)}; expected "
            "{ origins, values, kind }",
        )
    missing = _ALLOWED_EXPOSURE_KEYS - set(raw)
    if missing:
        raise SidecarError(
            422,
            "INVALID_EXPOSURE",
            f"'exposure' is missing required key(s) {sorted(missing)}",
        )
    origins, values, kind = raw["origins"], raw["values"], raw["kind"]
    if (
        not isinstance(origins, list)
        or not origins
        or not all(isinstance(o, str) and o for o in origins)
    ):
        raise SidecarError(
            422, "INVALID_EXPOSURE", "'exposure.origins' must be a non-empty list of strings"
        )
    if (
        not isinstance(values, list)
        or len(values) != len(origins)
        or not all(
            isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
            for v in values
        )
    ):
        raise SidecarError(
            422,
            "INVALID_EXPOSURE",
            "'exposure.values' must be finite numbers, one per exposure origin",
        )
    if not isinstance(kind, str) or not kind.strip():
        raise SidecarError(
            422, "INVALID_EXPOSURE", "'exposure.kind' must be a non-empty string"
        )
    return Exposure(origins=list(origins), values=[float(v) for v in values], kind=kind)


def parse_run_request(raw: bytes, max_request_bytes: int) -> RunRequest:
    """Bytes off the wire -> a validated RunRequest (or a SidecarError)."""
    if len(raw) > max_request_bytes:
        raise SidecarError(
            413,
            "REQUEST_TOO_LARGE",
            f"request body is {len(raw)} bytes; the limit is {max_request_bytes}",
        )
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SidecarError(422, "INVALID_JSON", f"request body is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise SidecarError(422, "INVALID_REQUEST", "request body must be a JSON object")

    unknown = set(data) - _ALLOWED_TOP_LEVEL
    if unknown:
        raise SidecarError(
            422,
            "UNKNOWN_FIELD",
            f"unknown top-level key(s) {sorted(unknown)}; the wire shape is "
            "{ triangles, selection?, exposure?, parameters?, seed?, engagementRef? }",
        )

    # The privacy lint runs over the ENTIRE request before anything else is
    # interpreted: no tenant key gets to hide inside parameters, documents,
    # or extensions.
    lint_tenant_keys(data)

    triangles = data.get("triangles")
    if not isinstance(triangles, dict):
        raise SidecarError(
            422, "INVALID_REQUEST", "'triangles' is required and must be a JSON object"
        )
    unknown_slots = set(triangles) - _ALLOWED_TRIANGLE_SLOTS
    if unknown_slots:
        raise SidecarError(
            422,
            "INVALID_REQUEST",
            f"'triangles' has unknown slot(s) {sorted(unknown_slots)}; "
            "expected { primary, secondary? }",
        )
    if "primary" not in triangles:
        raise SidecarError(422, "INVALID_REQUEST", "'triangles.primary' is required")
    primary = _parse_embedded_document(triangles["primary"], "triangles.primary", "triangle")
    secondary = (
        _parse_embedded_document(triangles["secondary"], "triangles.secondary", "triangle")
        if "secondary" in triangles
        else None
    )

    selection = (
        _parse_embedded_document(data["selection"], "selection", "selection")
        if "selection" in data
        else None
    )

    exposure = _parse_exposure(data["exposure"]) if "exposure" in data else None

    parameters = data.get("parameters", {})
    if not isinstance(parameters, dict):
        raise SidecarError(422, "INVALID_REQUEST", "'parameters' must be a JSON object")

    seed = data.get("seed")
    if seed is not None and (not isinstance(seed, int) or isinstance(seed, bool)):
        raise SidecarError(422, "INVALID_REQUEST", "'seed' must be an integer")

    engagement_ref = data.get("engagementRef")
    if engagement_ref is not None and (
        not isinstance(engagement_ref, str) or not engagement_ref.strip()
    ):
        raise SidecarError(
            422, "INVALID_REQUEST", "'engagementRef' must be a non-empty string (opaque)"
        )

    return RunRequest(
        primary=primary,
        secondary=secondary,
        selection=selection,
        exposure=exposure,
        parameters=dict(parameters),
        seed=seed,
        engagement_ref=engagement_ref,
    )
