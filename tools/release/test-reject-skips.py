"""Exercise the release skip guard against a real pytest subprocess."""
import os
from pathlib import Path
import subprocess
import sys


def test_release_plugin_fails_skips_but_preserves_passing_tests(tmp_path):
    test_file = tmp_path / "test_release_fixture.py"
    environment = {**os.environ, "PYTHONPATH": str(Path(__file__).parent)}
    command = [sys.executable, "-m", "pytest", "-p", "reject_skips", str(test_file), "-q"]
    test_file.write_text("import pytest\ndef test_anchor():\n    pytest.skip('unavailable')\n", encoding="utf-8")
    skipped = subprocess.run(command, env=environment, capture_output=True, text=True)
    assert skipped.returncode == 1, skipped.stdout + skipped.stderr
    assert "release tests may not skip applicable cases" in skipped.stdout
    test_file.write_text("def test_anchor():\n    assert 1 + 1 == 2\n", encoding="utf-8")
    passed = subprocess.run(command, env=environment, capture_output=True, text=True)
    assert passed.returncode == 0, passed.stdout + passed.stderr
