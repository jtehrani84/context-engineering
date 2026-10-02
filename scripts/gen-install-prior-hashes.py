#!/usr/bin/env python3
"""
Rebuild the two "prior version" manifests setup.sh uses to upgrade installed files safely.

  hooks/prior-kit-hashes.txt   -> every version of hooks/scripts/*.py the kit has shipped (filename sha256)
  install-prior-hashes.txt     -> every version of the files setup installs under rules/, skills/,
                                  tools/, harness-evolution/, workflows/, and scripts/ (path sha256).
                                  Keys are repo-relative, so a skill is "skills/foo.md" even though
                                  setup puts it in ~/.claude/commands/foo.md.

setup.sh replaces an installed file only when its hash is in one of these lists, which means the user
never edited it. Anything else is theirs and stays put.

Run from the repo root BEFORE you commit a change to any of those files, so the version you're
replacing (already in git history) lands in the list:
    python3 scripts/gen-install-prior-hashes.py
"""
import hashlib
import subprocess
import sys

TREES = ["rules", "skills", "tools", "harness-evolution", "workflows", "scripts/llm-call.py", "scripts/llm-review.py", "scripts/review-prompts"]


def git(*args, binary=False):
    out = subprocess.run(["git", *args], capture_output=True, check=True)
    return out.stdout if binary else out.stdout.decode()


def versions(pathspec, key):
    """Yield '<key(file)> <sha256>' for every committed version of every file under pathspec."""
    for commit in git("log", "--format=%H", "--", pathspec).split():
        for f in filter(None, git("ls-tree", "-r", "--name-only", commit, "--", pathspec).split("\n")):
            yield f"{key(f)} {hashlib.sha256(git('show', f'{commit}:{f}', binary=True)).hexdigest()}"


def write(path, header, lines):
    with open(path, "w") as fh:
        fh.write("\n".join(header + sorted(set(lines))) + "\n")
    print(f"{path}: {len(set(lines))} versions")


def main():
    hooks = list(versions("hooks/scripts", key=lambda f: f.rsplit("/", 1)[-1]))
    hooks = [h for h in hooks if h.split(" ")[0].endswith(".py")]
    write("hooks/prior-kit-hashes.txt",
          ["# sha256 of every hook version this kit has shipped (filename sha256).",
           "# setup.sh upgrades an installed hook only when it matches one of these, i.e. you never edited it.",
           "# Regenerate with: python3 scripts/gen-install-prior-hashes.py"], hooks)
    trees = [line for t in TREES for line in versions(t, key=lambda f: f)]
    write("install-prior-hashes.txt",
          ["# sha256 of every version this kit has shipped for the files setup.sh installs under rules/, skills/,",
           "# tools/, harness-evolution/, workflows/, and scripts/ (path sha256). setup.sh upgrades an installed copy",
           "# only when it matches one of these, i.e. you never edited it. Regenerate after changing any of those files:",
           "#   python3 scripts/gen-install-prior-hashes.py"], trees)


if __name__ == "__main__":
    sys.exit(main())
