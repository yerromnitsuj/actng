"""Shared fixtures for the sidecar test suite.

Everything runs in-process via fastapi's TestClient — no Docker, no
network. The committed conformance fixtures under
``interop/conformance/fixtures/`` are the golden inputs and expectations.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# interop/ on the path so `import sidecar` resolves (the package is not
# installed; it is a service directory, not a library).
INTEROP_DIR = Path(__file__).resolve().parents[2]
if str(INTEROP_DIR) not in sys.path:
    sys.path.insert(0, str(INTEROP_DIR))

from fastapi.testclient import TestClient  # noqa: E402

from sidecar.app import create_app  # noqa: E402
from sidecar.config import SidecarConfig  # noqa: E402

TOKEN = "test-token"
FIXTURES_DIR = INTEROP_DIR / "conformance" / "fixtures"

#: Same semantic-freeze tolerance as the committed conformance suite:
#: numpy/BLAS builds may differ in last ulps across machines.
TOLERANCE = 1e-9


def load_fixture(name: str, file: str) -> dict:
    return json.loads((FIXTURES_DIR / name / file).read_text())


@pytest.fixture(scope="session")
def client() -> TestClient:
    return TestClient(create_app(SidecarConfig(token=TOKEN)))


@pytest.fixture(scope="session")
def auth() -> dict:
    return {"Authorization": f"Bearer {TOKEN}"}


def relative_deviation(a: float, b: float) -> float:
    """The cross-shore definition: |a-b| / max(|a|,|b|), 0 at 0/0."""
    scale = max(abs(a), abs(b))
    return 0.0 if scale == 0 else abs(a - b) / scale


def assert_semantically_equal(actual, expected, path: str = "result") -> None:
    """Structural equality with numbers held to TOLERANCE — the task's
    'same rows/totals to 1e-9' rule, applied to the whole semantic body."""
    if isinstance(expected, dict):
        assert isinstance(actual, dict), f"{path}: expected object, got {type(actual).__name__}"
        assert set(actual) == set(expected), (
            f"{path}: key sets differ; actual {sorted(actual)} vs expected {sorted(expected)}"
        )
        for key in expected:
            assert_semantically_equal(actual[key], expected[key], f"{path}.{key}")
    elif isinstance(expected, list):
        assert isinstance(actual, list), f"{path}: expected array"
        assert len(actual) == len(expected), f"{path}: length {len(actual)} vs {len(expected)}"
        for index, (a, e) in enumerate(zip(actual, expected)):
            assert_semantically_equal(a, e, f"{path}[{index}]")
    elif isinstance(expected, bool) or expected is None or isinstance(expected, str):
        assert actual == expected, f"{path}: {actual!r} != {expected!r}"
    elif isinstance(expected, (int, float)):
        assert isinstance(actual, (int, float)) and not isinstance(actual, bool), (
            f"{path}: expected number, got {actual!r}"
        )
        assert relative_deviation(float(actual), float(expected)) <= TOLERANCE, (
            f"{path}: {actual!r} deviates from {expected!r} beyond {TOLERANCE}"
        )
    else:  # pragma: no cover - fixture types are JSON only
        raise AssertionError(f"{path}: unhandled expected type {type(expected).__name__}")
