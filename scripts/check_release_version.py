#!/usr/bin/env python3
"""Validate that release-facing version files match the requested version."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_json_version(path: Path) -> str:
    with path.open() as handle:
        return json.load(handle)["version"]


def read_python_constant(path: Path, constant_name: str) -> str:
    pattern = re.compile(rf'^{constant_name}\s*=\s*"([^"]+)"$', re.MULTILINE)
    match = pattern.search(path.read_text())
    if not match:
        raise ValueError(f"Could not find {constant_name} in {path}")
    return match.group(1)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check_release_version.py <version>", file=sys.stderr)
        return 1

    expected_version = sys.argv[1]
    version_files = {
        ROOT / "extension/package.json": read_json_version(ROOT / "extension/package.json"),
        ROOT / "extension/manifest.json": read_json_version(ROOT / "extension/manifest.json"),
        ROOT / "extension/manifest.chromium.json": read_json_version(
            ROOT / "extension/manifest.chromium.json"
        ),
        ROOT / "native/tabarchive-host.py": read_python_constant(
            ROOT / "native/tabarchive-host.py",
            "APP_VERSION",
        ),
    }

    mismatches = {
        str(path.relative_to(ROOT)): version
        for path, version in version_files.items()
        if version != expected_version
    }
    if mismatches:
        print(f"Version mismatch for release {expected_version}:", file=sys.stderr)
        for path, version in mismatches.items():
            print(f"  {path}: {version}", file=sys.stderr)
        return 1

    print(f"Verified release version {expected_version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
