#!/usr/bin/env python3
"""Tests for the smaller portable batch: graph-auto-index delete handling, curate-prep, backup-sessions.sh, transcript_to_md.py, and the plist /
manage.sh wiring. Standard library only.

Run from the repo root:   python3 -m unittest tests/test_smaller_batch.py -v
"""
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GRAPH = ROOT / "hooks/scripts/graph-auto-index.py"
CURATE = ROOT / "crons/curate-prep/curate-prep.py"
BACKUP = ROOT / "crons/backup/backup-sessions.sh"
TRANSCRIPT = ROOT / "tools/transcript-export/transcript_to_md.py"

def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def tmp_real():
    """A temp dir whose path is already resolved (macOS /var -> /private/var)."""
    d = tempfile.TemporaryDirectory()
    return d, Path(os.path.realpath(d.name))


# ---------------------------------------------------------------- graph-auto-index
class GraphAutoIndex(unittest.TestCase):
    def setUp(self):
        self._d, self.tmp = tmp_real()
        self.home = self.tmp / "home"
        self.work = self.tmp / "work"
        (self.home / ".claude/projects/p/memory").mkdir(parents=True)
        (self.work / "wiki").mkdir(parents=True)
        self.db = self.home / ".claude/projects/p/memory/graph.sqlite"

    def tearDown(self):
        self._d.cleanup()

    def fire(self, path):
        env = dict(os.environ, HOME=str(self.home))
        p = run([sys.executable, str(GRAPH)], input=json.dumps({"tool_input": {"file_path": str(path)}}),
                cwd=self.work, env=env)
        self.assertEqual(p.returncode, 0, p.stderr)

    def paths(self):
        if not self.db.exists():
            return set()
        c = sqlite3.connect(self.db)
        try:
            return {r[0] for r in c.execute("SELECT file_path FROM nodes WHERE file_path IS NOT NULL")}
        finally:
            c.close()

    def test_write_then_delete_then_edit_other_file_sweeps_the_ghost(self):
        a, b = self.work / "wiki/a.md", self.work / "wiki/b.md"
        a.write_text("# A\n"); b.write_text("# B\n")
        self.fire(a); self.fire(b)
        self.assertEqual(self.paths(), {str(a), str(b)})
        a.unlink()                      # delete outside the hook
        self.fire(b)                    # an unrelated edit must sweep a.md out
        self.assertEqual(self.paths(), {str(b)})

    def test_hook_called_with_the_deleted_path_removes_that_node(self):
        a, b = self.work / "wiki/a.md", self.work / "wiki/b.md"
        a.write_text("# A\n"); b.write_text("# B\n")
        self.fire(a); self.fire(b)
        a.unlink()
        self.fire(a)
        self.assertEqual(self.paths(), {str(b)})

    def test_rename_drops_the_old_name(self):
        a, b = self.work / "wiki/a.md", self.work / "wiki/b.md"
        a.write_text("# A\n")
        self.fire(a)
        a.rename(b)
        self.fire(b)
        self.assertEqual(self.paths(), {str(b)})

    def test_missing_tracked_root_is_not_treated_as_deleted(self):
        """A node under a folder that no longer exists at all (an unmounted drive) must survive."""
        a = self.work / "wiki/a.md"
        a.write_text("# A\n")
        self.fire(a)
        c = sqlite3.connect(self.db)
        c.execute("INSERT INTO nodes (node_type,name,canonical_name,file_path) VALUES ('wiki','ghost','ghost',?)",
                  ("/no/such/mount/wiki/ghost.md",))
        c.commit(); c.close()
        self.fire(a)
        self.assertIn("/no/such/mount/wiki/ghost.md", self.paths())

    def test_untracked_file_is_ignored(self):
        other = self.tmp / "elsewhere.md"
        other.write_text("x")
        self.fire(other)
        self.assertEqual(self.paths(), set())


# ---------------------------------------------------------------- curate-prep
def tree_fingerprint(root):
    h = hashlib.sha256()
    for p in sorted(Path(root).rglob("*")):
        if p.is_file():
            h.update(str(p.relative_to(root)).encode())
            h.update(p.read_bytes())
            h.update(str(int(p.stat().st_mtime)).encode())
    return h.hexdigest()


class CuratePrep(unittest.TestCase):
    def setUp(self):
        self._d, self.tmp = tmp_real()
        self.mem = self.tmp / "memory"
        self.wiki = self.tmp / "wiki"
        self.mem.mkdir(); self.wiki.mkdir()
        (self.mem / "MEMORY.md").write_text("- [](feedback-fresh.md) fresh\n- [](project-old.md) old\n")
        (self.mem / "feedback-fresh.md").write_text("---\ntype: feedback\nlast_verified: 2999-01-01\n---\nbody\n")
        (self.mem / "project-old.md").write_text("---\ntype: project\nlast_verified: 2020-01-01\n---\nbody\n")
        (self.mem / "orphan-note.md").write_text("---\ntype: user\n---\nnot in index\n")
        (self.wiki / "index.md").write_text("- [a](a.md)\n")
        (self.wiki / "a.md").write_text("a")
        (self.wiki / "unindexed.md").write_text("u")
        self.out = self.tmp / "out" / "CURATE-PENDING.md"

    def tearDown(self):
        self._d.cleanup()

    def go(self, *extra, env=None):
        return run([sys.executable, str(CURATE), "--memory-dir", str(self.mem), "--wiki-dir", str(self.wiki),
                    "--out", str(self.out), *extra], env=env)

    def test_report_contents(self):
        p = self.go()
        self.assertEqual(p.returncode, 0, p.stderr)
        r = self.out.read_text()
        self.assertIn("Orphaned memories (1)", r)
        self.assertIn("`orphan-note.md`", r)
        self.assertIn("Stale candidates (1)", r)
        self.assertIn("`project-old.md`", r)
        self.assertNotIn("`feedback-fresh.md` |", r)       # a fresh file is not stale
        self.assertIn("`unindexed.md`", r)                  # wiki page missing from the index
        self.assertNotIn("`a.md`", r)
        self.assertIn("2/200 lines", r)

    def test_is_read_only(self):
        before = (tree_fingerprint(self.mem), tree_fingerprint(self.wiki))
        self.assertEqual(self.go().returncode, 0)
        self.assertEqual(before, (tree_fingerprint(self.mem), tree_fingerprint(self.wiki)))

    def test_missing_memory_dir_fails_visibly(self):
        p = run([sys.executable, str(CURATE), "--memory-dir", str(self.tmp / "nope"), "--out", str(self.out)])
        self.assertEqual(p.returncode, 1)
        r = self.out.read_text()
        self.assertTrue(r.startswith("# CURATE-PENDING: FAILED"))
        self.assertIn("no memory folder found", r)

    def test_autodetect_picks_newest_memory_index(self):
        home = self.tmp / "home"
        for name, age in (("-proj-old", 1000), ("-proj-new", 0)):
            m = home / ".claude/projects" / name / "memory"
            m.mkdir(parents=True)
            idx = m / "MEMORY.md"
            idx.write_text(f"- [](note{name}.md)\n")
            (m / f"note{name}.md").write_text("---\ntype: user\n---\n")
            t = os.path.getmtime(idx) - age
            os.utime(idx, (t, t))
        # Only the OLD project has an orphan, so the report shows which folder was read.
        (home / ".claude/projects/-proj-old/memory/old-only-orphan.md").write_text("x")
        env = dict(os.environ, HOME=str(home))
        p = run([sys.executable, str(CURATE), "--out", str(self.out)], env=env)
        self.assertEqual(p.returncode, 0, p.stderr)
        r = self.out.read_text()
        self.assertIn("Orphaned (not in the index): **0**", r)      # the newest project was chosen
        self.assertNotIn("old-only-orphan", r)


# ---------------------------------------------------------------- backup-sessions.sh
class BackupSessions(unittest.TestCase):
    def setUp(self):
        self._d, self.tmp = tmp_real()
        self.src = self.tmp / "projects"
        (self.src / "proj/memory").mkdir(parents=True)
        (self.src / "proj/s1.jsonl").write_text('{"a":1}\n')
        (self.src / "proj/s2.jsonl").write_text('{"a":2}\n')
        (self.src / "proj/memory/MEMORY.md").write_text("- x\n")
        self.root = self.tmp / "backups"
        self.env = dict(os.environ, CLAUDE_PROJECTS_DIR=str(self.src), CLAUDE_BACKUP_ROOT=str(self.root),
                        CLAUDE_BACKUP_LOGS=str(self.tmp / "logs"))

    def tearDown(self):
        self._d.cleanup()

    def go(self, *args, **envextra):
        return run(["bash", str(BACKUP), *args], env=dict(self.env, **envextra))

    def test_mirror_snapshot_and_permissions(self):
        p = self.go()
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        m = self.root / "projects-mirror/proj"
        self.assertEqual((m / "s1.jsonl").read_text(), '{"a":1}\n')
        self.assertTrue((m / "memory/MEMORY.md").exists())
        snaps = list((self.root / "snapshots").glob("projects-*.tar.gz"))
        self.assertEqual(len(snaps), 1)
        self.assertEqual(oct(self.root.stat().st_mode & 0o777), "0o700")
        self.assertEqual(oct((self.root / "snapshots").stat().st_mode & 0o777), "0o700")
        tar = run(["tar", "-tzf", str(snaps[0])])
        self.assertIn("projects-mirror/proj/s1.jsonl", tar.stdout)

    def test_deleted_source_stays_in_mirror(self):
        self.go()
        (self.src / "proj/s1.jsonl").unlink()
        p = self.go()
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertTrue((self.root / "projects-mirror/proj/s1.jsonl").exists())

    def test_second_run_same_day_keeps_one_snapshot(self):
        self.go(); self.go()
        self.assertEqual(len(list((self.root / "snapshots").glob("projects-*.tar.gz"))), 1)

    def test_empty_source_aborts_and_leaves_backups_alone(self):
        self.go()
        for f in self.src.rglob("*.jsonl"):
            f.unlink()
        before = tree_fingerprint(self.root)
        p = self.go()
        self.assertEqual(p.returncode, 1)
        self.assertIn("0 session files", p.stdout)
        self.assertEqual(before, tree_fingerprint(self.root))

    def test_missing_source_aborts(self):
        p = self.go(CLAUDE_PROJECTS_DIR=str(self.tmp / "nope"))
        self.assertEqual(p.returncode, 1)
        self.assertFalse(self.root.exists())

    def test_dry_run_writes_nothing(self):
        p = self.go("--dry-run")
        self.assertEqual(p.returncode, 0)
        self.assertIn("dry run", p.stdout)
        self.assertFalse(self.root.exists())

    def test_prune_keeps_newest_n(self):
        snaps = self.root / "snapshots"
        snaps.mkdir(parents=True)
        for i, day in enumerate(("2020-01-01", "2020-01-02", "2020-01-03", "2020-01-04")):
            f = snaps / f"projects-{day}.tar.gz"
            f.write_bytes(b"x")
            os.utime(f, (1_600_000_000 + i * 86400,) * 2)
        self.go(RETAIN_SNAPSHOTS="2")
        left = sorted(p.name for p in snaps.glob("projects-*.tar.gz"))
        self.assertEqual(len(left), 2)
        self.assertNotIn("projects-2020-01-01.tar.gz", left)

    def test_default_retention_is_seven(self):
        snaps = self.root / "snapshots"
        snaps.mkdir(parents=True)
        for i in range(9):
            f = snaps / f"projects-2020-01-{i + 1:02d}.tar.gz"
            f.write_bytes(b"x")
            os.utime(f, (1_600_000_000 + i * 86400,) * 2)
        self.go()
        self.assertEqual(len(list(snaps.glob("projects-*.tar.gz"))), 7)

    def test_bad_retention_or_free_space_value_is_rejected(self):
        for bad in ("0", "abc", "-3"):
            self.assertEqual(self.go(RETAIN_SNAPSHOTS=bad).returncode, 1, bad)
        self.assertEqual(self.go(MIN_FREE_FACTOR="lots").returncode, 1)

    def test_low_disk_skips_the_snapshot_but_still_mirrors(self):
        p = self.go(MIN_FREE_FACTOR="999999999")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("skipping snapshot", p.stdout)
        self.assertTrue((self.root / "projects-mirror/proj/s1.jsonl").exists())
        self.assertEqual(list((self.root / "snapshots").glob("projects-*.tar.gz")), [])

    def test_stale_lock_is_cleared_fresh_lock_blocks(self):
        lock = self.root / ".backup.lock"
        lock.mkdir(parents=True)
        p = self.go()                                   # fresh lock: skip quietly
        self.assertEqual(p.returncode, 0)
        self.assertIn("another backup is running", p.stdout)
        self.assertFalse((self.root / "projects-mirror/proj/s1.jsonl").exists())
        old = 1_600_000_000
        os.utime(lock, (old, old))                      # stale lock: cleared, backup runs
        p = self.go()
        self.assertEqual(p.returncode, 0, p.stdout)
        self.assertTrue((self.root / "projects-mirror/proj/s1.jsonl").exists())


# ---------------------------------------------------------------- transcript_to_md.py
class TranscriptToMd(unittest.TestCase):
    def setUp(self):
        self._d, self.tmp = tmp_real()
        self.src = self.tmp / "s.jsonl"
        self.out = self.tmp / "o.md"
        rows = [
            {"type": "user", "timestamp": "2026-09-29T15:00:00Z", "message": {"role": "user", "content": "Hello there"}},
            {"type": "assistant", "timestamp": "2026-09-29T15:00:05Z", "message": {"role": "assistant", "content": [
                {"type": "thinking", "thinking": "plan the thing"},
                {"type": "text", "text": "Key is sk-abcdefghijklmnopqrstuvwxyz0123456789 ok"},
                {"type": "tool_use", "name": "Bash", "input": {"command": "echo " + "x" * 5000}}]}},
            {"type": "user", "timestamp": "2026-09-29T15:00:06Z", "message": {"role": "user", "content": [
                {"type": "tool_result", "content": "y" * 5000}]}},
            # 02:00 UTC on the 30th is 22:00 on the 29th in New York (EDT)
            {"type": "user", "timestamp": "2026-09-30T02:00:00Z", "message": {"role": "user", "content": "late night"}},
            {"type": "user", "timestamp": "2026-09-30T15:00:00Z", "message": {"role": "user", "content": [
                {"type": "text", "text": "<system-reminder>" + "z" * 3000 + "</system-reminder>"},
                {"type": "text", "text": "real question"}]}},
            {"type": "summary", "summary": "compacted"},
        ]
        self.src.write_text("\n".join(json.dumps(r) for r in rows) + "\nnot json at all\n")

    def tearDown(self):
        self._d.cleanup()

    def conv(self, *args):
        p = run([sys.executable, str(TRANSCRIPT), str(self.src), str(self.out), *args])
        self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout, self.out.read_text()

    def test_basic_conversion_truncation_and_counts(self):
        stdout, md = self.conv("--tz", "UTC")
        self.assertIn("rows_in=7 bad=1 human_turns=3", stdout)
        self.assertIn("plan the thing", md)                       # thinking kept in full
        self.assertIn("truncated 3000 chars", md)                 # tool input clipped at 2000
        self.assertIn("COMPACTION SUMMARY", md)
        self.assertIn("real question", md)
        self.assertNotIn("z" * 1000, md)                          # system reminder clipped to 800

    def test_credential_shapes_are_masked_by_default(self):
        _, md = self.conv()
        self.assertNotIn("sk-abcdefghijklmnop", md)
        self.assertIn("[REDACTED API KEY]", md)
        self.assertIn("Credential-shaped strings are masked", md)

    def test_no_redact_flag(self):
        _, md = self.conv("--no-redact")
        self.assertIn("sk-abcdefghijklmnop", md)
        self.assertIn("masking was OFF", md)

    def test_date_filter_uses_the_requested_zone(self):
        _, md = self.conv("--date", "2026-09-29", "--tz", "America/New_York")
        self.assertIn("late night", md)                           # 22:00 EDT on the 29th
        self.assertIn("Hello there", md)
        self.assertNotIn("real question", md)                     # that row is on the 30th
        self.assertNotIn("COMPACTION SUMMARY", md)                # summary rows carry no date
        _, md = self.conv("--date", "2026-09-29", "--tz", "UTC")
        self.assertNotIn("late night", md)                        # 02:00 UTC is the 30th in UTC

    def test_winter_offset_is_not_hardcoded_to_edt(self):
        self.src.write_text(json.dumps({"type": "user", "timestamp": "2026-01-15T04:30:00Z",
                                        "message": {"role": "user", "content": "winter"}}) + "\n")
        _, md = self.conv("--date", "2026-01-14", "--tz", "America/New_York")   # EST is UTC-5: Jan 14, 23:30
        self.assertIn("winter", md)

    def test_legacy_positional_arguments_still_work(self):
        p = run([sys.executable, str(TRANSCRIPT), str(self.src), str(self.out), "100", "2026-09-29"])
        self.assertEqual(p.returncode, 0, p.stderr)
        md = self.out.read_text()
        self.assertIn("tool inputs and outputs are clipped to 100 chars", md)
        self.assertIn("**Filtered to date:** 2026-09-29", md)

    def test_bad_arguments_are_rejected(self):
        base = [sys.executable, str(TRANSCRIPT), str(self.src), str(self.out)]
        self.assertNotEqual(run(base + ["--date", "yesterday"]).returncode, 0)
        self.assertNotEqual(run(base + ["--tz", "Mars/Base"]).returncode, 0)


# ---------------------------------------------------------------- wiring
class Wiring(unittest.TestCase):
    def test_manage_sh_syntax_and_plists_exist(self):
        manage = ROOT / "crons/manage.sh"
        self.assertEqual(run(["bash", "-n", str(manage)]).returncode, 0)
        text = manage.read_text()
        default = re.search(r"PLIST_FILES=\((.*?)\)", text, re.S).group(1)
        optional = re.search(r"OPTIONAL_PLIST_FILES=\((.*?)\)", text, re.S).group(1)
        self.assertIn("com.context.curate-prep.plist", default)
        self.assertNotIn("com.context.session-backup.plist", default)      # backup is opt-in
        self.assertIn("com.context.session-backup.plist", optional)
        for name in ("com.context.curate-prep.plist", "com.context.session-backup.plist"):
            self.assertTrue((ROOT / "crons/plists" / name).exists(), name)

    def test_backup_installs_only_with_the_flag(self):
        d, tmp = tmp_real()
        try:
            (tmp / "bin").mkdir()
            fake = tmp / "bin/launchctl"
            fake.write_text("#!/bin/sh\nexit 0\n")
            fake.chmod(0o755)
            env = dict(os.environ, HOME=str(tmp), PATH=f"{tmp / 'bin'}:{os.environ['PATH']}")
            agents = tmp / "Library/LaunchAgents"
            manage = str(ROOT / "crons/manage.sh")
            self.assertEqual(run(["bash", manage, "install"], env=env).returncode, 0)
            self.assertTrue((agents / "com.context.curate-prep.plist").exists())
            self.assertFalse((agents / "com.context.session-backup.plist").exists())
            st = run(["bash", manage, "status"], env=env).stdout
            self.assertNotIn("session-backup", st)                       # opt-in job not installed: silent
            self.assertEqual(run(["bash", manage, "install", "--with-backup"], env=env).returncode, 0)
            self.assertTrue((agents / "com.context.session-backup.plist").exists())
            text = (agents / "com.context.session-backup.plist").read_text()
            self.assertNotIn("__SCRIPT_DIR__", text)
            self.assertTrue(Path(re.search(r"<string>(/[^<]*backup-sessions\.sh)</string>", text).group(1)).exists())
            self.assertEqual(run(["bash", manage, "uninstall"], env=env).returncode, 0)
            self.assertFalse((agents / "com.context.session-backup.plist").exists())
            self.assertFalse((agents / "com.context.curate-prep.plist").exists())
        finally:
            d.cleanup()

    def test_plists_lint_and_reference_real_scripts(self):
        for name, script in (("com.context.curate-prep.plist", "curate-prep/curate-prep.py"),
                             ("com.context.session-backup.plist", "backup/backup-sessions.sh")):
            text = (ROOT / "crons/plists" / name).read_text()
            self.assertIn(f"<string>{name[:-6]}</string>", text)                 # Label matches filename
            self.assertIn(f"__SCRIPT_DIR__/{script}", text)
            self.assertTrue((ROOT / "crons" / script).exists())
            self.assertEqual(text.count("<key>StartCalendarInterval</key>"), 1)  # no duplicate keys
            if subprocess.run(["which", "plutil"], capture_output=True).returncode == 0:
                self.assertEqual(run(["plutil", "-lint", str(ROOT / "crons/plists" / name)]).returncode, 0)

    def test_scripts_are_executable(self):
        for p in (CURATE, BACKUP, TRANSCRIPT):
            self.assertTrue(os.access(p, os.X_OK), p)

    def test_prior_hash_manifest_knows_every_published_hook(self):
        """Every hook version a876e77 (the May release) installed must be in the manifest, so an
        unedited copy upgrades in place."""
        names = subprocess.run(["git", "ls-tree", "--name-only", "a876e77", "hooks/scripts/"], cwd=ROOT,
                               capture_output=True, text=True)
        if names.returncode != 0 or not names.stdout.strip():
            self.skipTest("base commit not available")
        manifest = (ROOT / "hooks/prior-kit-hashes.txt").read_text()
        for path in names.stdout.split():
            blob = subprocess.run(["git", "show", f"a876e77:{path}"], cwd=ROOT, capture_output=True).stdout
            self.assertIn(f"{path.rsplit('/', 1)[-1]} {hashlib.sha256(blob).hexdigest()}", manifest)

if __name__ == "__main__":
    unittest.main(verbosity=2)
