#!/usr/bin/env python3
"""Create or update a GitHub release with the expected release note prefix."""

from __future__ import annotations

import argparse
import subprocess
import sys

DEVELOPER_RELEASE_NOTE_PREFIX = """Developer install only.

These artifacts are unsigned extension builds for manual loading on macOS or
Linux. Install the native host from this repository before using them."""


def run_command(*args: str, capture_output: bool = False) -> str:
    result = subprocess.run(
        args,
        check=True,
        capture_output=capture_output,
        text=True,
    )
    return result.stdout if capture_output else ""


def release_exists(tag: str) -> bool:
    result = subprocess.run(
        ("gh", "release", "view", tag),
        check=False,
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def build_release_notes(existing_body: str) -> str:
    stripped_body = existing_body.strip()
    if not stripped_body:
        return DEVELOPER_RELEASE_NOTE_PREFIX
    if DEVELOPER_RELEASE_NOTE_PREFIX in stripped_body:
        return stripped_body
    return f"{DEVELOPER_RELEASE_NOTE_PREFIX}\n\n{stripped_body}"


def update_release(tag: str, assets: list[str]) -> None:
    body = run_command(
        "gh",
        "release",
        "view",
        tag,
        "--json",
        "body",
        "--jq",
        ".body",
        capture_output=True,
    )
    updated_notes = build_release_notes(body)
    if updated_notes != body.strip():
        run_command("gh", "release", "edit", tag, "--notes", updated_notes)
    run_command("gh", "release", "upload", tag, *assets, "--clobber")


def create_release(tag: str, assets: list[str]) -> None:
    run_command(
        "gh",
        "release",
        "create",
        tag,
        *assets,
        "--title",
        tag,
        "--notes",
        DEVELOPER_RELEASE_NOTE_PREFIX,
        "--generate-notes",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create or update a GitHub release for an existing tag."
    )
    parser.add_argument("tag", help="Release tag, for example v1.0.6")
    parser.add_argument(
        "assets",
        nargs="+",
        help="Asset paths to upload to the release",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if release_exists(args.tag):
        update_release(args.tag, args.assets)
    else:
        create_release(args.tag, args.assets)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
