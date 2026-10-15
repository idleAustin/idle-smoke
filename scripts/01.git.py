#!/usr/bin/env python3
"""
git.py — Interactive git workflow with Conventional Commits & Automated Versioning.
See: 11.Setup/15.Automated-Versioning-and-Releases.md
Usage: python3 git.py  OR  ./git.py
"""
from pathlib import Path
import re
import subprocess
import sys

CONVENTIONAL_PATTERN = re.compile(
    r"^(feat|fix|perf|chore|ci|docs|test|refactor|style|build)(\([a-zA-Z0-9._-]+\))?(!)?:\s+.+"
)

COMMIT_TYPES = {
    "feat":     "Minor bump (0.1.0 -> 0.2.0) · Release Notes: ### Features",
    "fix":      "Patch bump (0.1.0 -> 0.1.1) · Release Notes: ### Fixes",
    "perf":     "Patch bump (0.1.0 -> 0.1.1) · Release Notes: ### Fixes",
    "feat!":    "Major bump (0.1.0 -> 1.0.0) · Release Notes: ### Breaking changes",
    "docs":     "No release bump             · Documentation changes",
    "chore":    "No release bump             · Maintenance / config / deps",
    "ci":       "No release bump             · CI/CD workflow changes",
    "test":     "No release bump             · Test additions or updates",
    "refactor": "No release bump             · Code restructuring",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def run(cmd: list[str], capture: bool = True) -> str:
    result = subprocess.run(cmd, capture_output=capture, text=True, check=True)
    return result.stdout.strip() if capture else ""


def ask(prompt: str, options: list[str] | None = None) -> str:
    while True:
        response = input(f"\n{prompt} ").strip().lower()
        if options is None or response in options:
            return response
        print(f"  Enter one of: {', '.join(options)}")


def divider() -> None:
    print("\n" + "─" * 60)


def preview_version() -> None:
    """If scripts/version.mjs exists, display calculated version & release notes."""
    root_dir = Path(__file__).parent
    version_script = root_dir / "scripts" / "version.mjs"
    if not version_script.exists():
        version_script = root_dir / "version.mjs"
        root_dir = root_dir.parent
    if not version_script.exists():
        return

    preview_file = root_dir / "preview-notes.md"
    try:
        next_ver = run(["node", str(version_script), "--notes", "preview-notes.md"])
        divider()
        print(f"  Next Release Version: v{next_ver}")
        if preview_file.exists():
            notes = preview_file.read_text(encoding="utf-8").strip()
            if notes:
                print("\n  Generated Release Notes Preview:")
                for line in notes.splitlines():
                    print(f"    {line}")
            else:
                print("  (No version bump — chore/ci/docs/test commits keep current release)")
        divider()
    except Exception as exc:
        print(f"  (Could not preview version via scripts/version.mjs: {exc})")
    finally:
        if preview_file.exists():
            preview_file.unlink()


# ── Step functions ─────────────────────────────────────────────────────────────

def verify_repo() -> None:
    """Step 1: Identify and confirm the repo."""
    try:
        repo_url = run(["git", "remote", "get-url", "origin"])
    except subprocess.CalledProcessError:
        print("\nERROR: Not a git repo or no remote 'origin' configured.")
        sys.exit(1)

    divider()
    print(f"  Repo:  {repo_url}")
    divider()

    answer = ask("Is this the correct repo? (yes / no)", ["yes", "no"])
    if answer == "no":
        print("\nNavigate to the correct project directory and try again.")
        sys.exit(0)


def verify_branch() -> str:
    """Step 2: Confirm the working branch. Returns the final branch name."""
    current = run(["git", "rev-parse", "--abbrev-ref", "HEAD"])

    divider()
    print(f"  Branch: {current}")
    divider()

    answer = ask("Is this the correct branch? (yes / no)", ["yes", "no"])
    if answer == "yes":
        return current

    action = ask("Create a new branch or switch to existing? (new / existing)", ["new", "existing"])

    if action == "new":
        name = input("\n  Enter new branch name: ").strip()
        if not name:
            print("  Branch name cannot be empty.")
            sys.exit(1)
        run(["git", "checkout", "-b", name], capture=False)
        print(f"  Created and switched to: {name}")
        return name

    raw = run(["git", "branch", "-a"])
    branches = []
    for line in raw.splitlines():
        b = line.strip().lstrip("* ").strip()
        if "->" not in b and b != current:
            branches.append(b)

    if not branches:
        print("  No other branches available.")
        sys.exit(0)

    print("\n  Available branches:")
    for i, b in enumerate(branches, 1):
        print(f"    {i}. {b}")

    choice = input("\n  Enter branch name to switch to: ").strip()
    if not choice:
        print("  No branch selected.")
        sys.exit(0)

    run(["git", "checkout", choice], capture=False)
    print(f"  Switched to: {choice}")
    return choice


def build_conventional_message() -> str:
    """Prompt for a Conventional Commit message so scripts/version.mjs can infer semver & release notes."""
    print("\n  Conventional Commit Types (determines automated version bump):")
    for prefix, desc in COMMIT_TYPES.items():
        print(f"    {prefix:<10} {desc}")

    commit_type = ask(
        "Select commit type (feat / fix / perf / feat! / docs / chore / ci / test / refactor):",
        list(COMMIT_TYPES.keys()),
    )
    scope = input("\n  Optional scope (e.g. setup, ui, security — press Enter to skip): ").strip()
    description = input("\n  Commit description (imperative, e.g. 'add live telemetry sparklines'): ").strip()
    if not description:
        print("  Commit description cannot be empty.")
        sys.exit(1)

    # If the user already typed a full conventional prefix in description, use it as-is
    if CONVENTIONAL_PATTERN.match(description):
        return description

    bang = "!" if commit_type.endswith("!") else ""
    base_type = commit_type.rstrip("!")
    scope_part = f"({scope})" if scope else ""
    return f"{base_type}{scope_part}{bang}: {description}"


def commit() -> bool:
    """Step 3: Stage and commit using Conventional Commits. Returns True if committed."""
    divider()
    answer = ask("Do you want to commit? (yes / no)", ["yes", "no"])
    if answer == "no":
        print("\n  No commit made.")
        return False

    message = build_conventional_message()

    run(["git", "add", "-A"], capture=False)

    try:
        run(["git", "commit", "-m", message], capture=False)
        print(f'\n  Committed: "{message}"')
        preview_version()
        return True
    except subprocess.CalledProcessError:
        print("\n  Nothing to commit (working tree clean).")
        return False


def push(branch: str) -> None:
    """Step 4: Push to remote."""
    divider()
    answer = ask("Push to remote? (yes / no)", ["yes", "no"])
    if answer == "no":
        print("\n  Commit saved locally. Not pushed.")
        return

    try:
        run(["git", "push"], capture=False)
    except subprocess.CalledProcessError:
        run(["git", "push", "--set-upstream", "origin", branch], capture=False)

    print(f"\n  Pushed to origin/{branch}.")


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    print("\n" + "═" * 60)
    print("  Git Workflow · Conventional Commits & Automated Versioning")
    print("═" * 60)

    verify_repo()
    branch = verify_branch()

    committed = commit()

    if committed:
        push(branch)

    divider()
    print("  Done.")
    print("─" * 60 + "\n")


if __name__ == "__main__":
    main()
