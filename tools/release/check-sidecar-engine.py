"""Fail-closed verifier for the authenticated sidecar engine identity."""
from __future__ import annotations
import json
import sys
from importlib.metadata import version
from actuarial_interchange import GENERATOR_NAME, GENERATOR_VERSION, SPEC_VERSION
from sidecar.config import ENGINE_NAME, PROFILES
from sidecar.methods import METHODS

EXPECTED = {
    "name": ENGINE_NAME,
    "version": version("chainladder"),
    "profiles": list(PROFILES),
    "methods": [
        {"name": entry.name, "resultKind": entry.result_kind}
        for entry in METHODS.values()
    ],
    "interchange": {
        "specVersion": SPEC_VERSION,
        "generator": {"name": GENERATOR_NAME, "version": GENERATOR_VERSION},
    },
}

def verify(document: object) -> None:
    if not isinstance(document, dict):
        raise ValueError("engine response must be an object")
    if list(document) != ["name", "version", "profiles", "methods", "interchange"]:
        raise ValueError("sidecar engine response keys or ordering changed")
    if document != EXPECTED:
        raise ValueError(f"sidecar engine identity mismatch: expected {EXPECTED!r}, got {document!r}")

if __name__ == "__main__":
    try:
        verify(json.load(sys.stdin))
        print("sidecar engine identity verified")
    except Exception as error:
        print(f"sidecar-engine: {error}", file=sys.stderr)
        raise SystemExit(1)
