import importlib.util
from pathlib import Path

import pytest


spec = importlib.util.spec_from_file_location(
    "python_environment", Path(__file__).with_name("check-python-environment.py")
)
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


def requirements():
    return {
        "runtime.txt": "\n".join(
            f"{name}=={value}" for name, value in checker.EXPECTED.items() if name != "httpx"
        ),
        "dev.txt": "# fastapi's TestClient uses httpx; runtime uses uvicorn.\n-r runtime.txt\nhttpx==0.28.1 # exact test pin\npytest>=8.0\n",
    }


def test_comment_mentions_are_not_dependency_declarations():
    checker.verify_requirement_pins(requirements())


@pytest.mark.parametrize("entry", ["fastapi>=0.139.2", "fastapi==0.1", "fastapi"])
def test_wrong_or_unbounded_pin_is_rejected(entry):
    sources = requirements()
    sources["runtime.txt"] = sources["runtime.txt"].replace("fastapi==0.139.2", entry)
    with pytest.raises(ValueError, match="requirement pin drift"):
        checker.verify_requirement_pins(sources)


def test_comments_cannot_supply_missing_pins():
    sources = requirements()
    sources["runtime.txt"] = sources["runtime.txt"].replace("fastapi==0.139.2", "# fastapi==0.139.2")
    with pytest.raises(ValueError, match="missing release requirement pins"):
        checker.verify_requirement_pins(sources)


def test_duplicate_entries_are_not_silently_merged():
    sources = requirements()
    sources["dev.txt"] += "fastapi==0.139.2\n"
    with pytest.raises(ValueError, match="duplicate release requirement"):
        checker.verify_requirement_pins(sources)
