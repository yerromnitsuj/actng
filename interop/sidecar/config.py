"""Sidecar configuration and engine metadata.

One frozen dataclass, filled from the environment. ``SIDECAR_TOKEN`` is
REQUIRED: the app factory refuses to build an app without it, so a
misconfigured deployment fails loudly at boot instead of serving the
compute surface unauthenticated.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping

__all__ = [
    "DEFAULT_MAX_REQUEST_BYTES",
    "DEFAULT_PORT",
    "ENGINE_NAME",
    "PROFILES",
    "SidecarConfig",
    "config_from_env",
]

#: Spec 7: request-size limit (5 MB default, overridable via env).
DEFAULT_MAX_REQUEST_BYTES = 5 * 1024 * 1024

DEFAULT_PORT = 8091

#: Engine identity stamped into every result document's engine block
#: (matches actuarial_interchange.bridge_result.ENGINE_NAME).
ENGINE_NAME = "chainladder-python"

#: Convention profiles this engine can satisfy (spec 5); GET /v1/engine
#: advertises them and the method runners stamp them only when the run's
#: effective parameters actually meet the profile's alignment requirements.
PROFILES = ("deterministic-cl", "mack1993-vw", "odp-bootstrap-distribution")


@dataclass(frozen=True)
class SidecarConfig:
    """Runtime configuration for one sidecar process."""

    token: str
    max_request_bytes: int = DEFAULT_MAX_REQUEST_BYTES

    def __post_init__(self) -> None:
        if not isinstance(self.token, str) or not self.token.strip():
            raise ValueError(
                "SIDECAR_TOKEN is required: the sidecar never serves "
                "/v1/run/* or /v1/engine unauthenticated"
            )
        if not isinstance(self.max_request_bytes, int) or self.max_request_bytes <= 0:
            raise ValueError("max_request_bytes must be a positive integer")


def config_from_env(environ: Mapping[str, str] = os.environ) -> SidecarConfig:
    """Build the config from the environment (fails fast on a missing token)."""
    token = environ.get("SIDECAR_TOKEN", "")
    raw_limit = environ.get("SIDECAR_MAX_REQUEST_BYTES")
    if raw_limit is None:
        return SidecarConfig(token=token)
    try:
        limit = int(raw_limit)
    except ValueError as exc:
        raise ValueError(
            f"SIDECAR_MAX_REQUEST_BYTES must be an integer, got {raw_limit!r}"
        ) from exc
    return SidecarConfig(token=token, max_request_bytes=limit)
