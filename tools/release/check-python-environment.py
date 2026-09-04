"""Verify the release sidecar's actual requirement entries and installed pins."""

from importlib.metadata import version
from pathlib import Path
import re


EXPECTED = {
    "chainladder": "0.9.2",
    "pandas": "2.3.3",
    "numpy": "2.4.6",
    "fastapi": "0.139.2",
    "uvicorn": "0.51.0",
    "httpx": "0.28.1",
}


def verify_requirement_pins(sources: dict[str, str]) -> None:
    found: dict[str, str] = {}
    for path, source in sources.items():
        for line in source.splitlines():
            entry = line.split("#", 1)[0].strip()
            if not entry or entry.startswith("-r "):
                continue
            match = re.match(r"([A-Za-z0-9_.-]+)", entry)
            name = re.sub(r"[-_.]+", "-", match[1]).lower() if match else ""
            if name not in EXPECTED:
                continue
            if entry.lower() != f"{name}=={EXPECTED[name]}":
                raise ValueError(f"requirement pin drift: {path}: {entry}")
            if name in found:
                raise ValueError(f"duplicate release requirement: {name}")
            found[name] = EXPECTED[name]
    if set(found) != set(EXPECTED):
        raise ValueError(f"missing release requirement pins: {sorted(set(EXPECTED) - set(found))}")


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[2]
    paths = ("interop/sidecar/requirements.txt", "interop/sidecar/requirements-dev.txt")
    verify_requirement_pins({path: (root / path).read_text(encoding="utf-8") for path in paths})
    for name, wanted in EXPECTED.items():
        actual = version(name)
        if actual != wanted:
            raise SystemExit(f"sidecar dependency mismatch: {name} expected {wanted}, got {actual}")
    print("Python runtime and actual requirement entries match the release pins")
