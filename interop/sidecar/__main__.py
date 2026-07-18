"""Uvicorn entry point: ``python -m sidecar`` (with ``interop/`` on the path).

Reads SIDECAR_TOKEN (required), SIDECAR_PORT and SIDECAR_HOST (optional),
and boots the app factory. A missing token fails here, loudly, before a
socket ever opens.
"""

from __future__ import annotations

import os

import uvicorn

from .config import DEFAULT_PORT, config_from_env


def main() -> None:
    config_from_env()  # fail fast on missing/invalid configuration
    uvicorn.run(
        "sidecar.app:create_app",
        factory=True,
        host=os.environ.get("SIDECAR_HOST", "127.0.0.1"),
        port=int(os.environ.get("SIDECAR_PORT", str(DEFAULT_PORT))),
    )


if __name__ == "__main__":
    main()
