#!/usr/bin/env python3
"""Tests for the voice send/write gate, hook/voice-tell-gate.py in the tools folder (added 2026-10-02).

Run:   python3 ~/.claude/tools/hook-tests/voice-tell-gate.test.py          exit 0 = pass (tests hook/voice-tell-gate.py)
       VOICE_HOOK=~/.claude/hooks/scripts/voice-tell-gate.py python3 ...   test the installed copy, or any other copy
       VOICE_TOOLS=/path/to/tools  ...                                     build the scorer from another tools folder

The hook's source is hook/voice-tell-gate.py in the tools folder; Claude Code runs the installed copy in
~/.claude/hooks/scripts. Its tests live here so they're versioned with the scorer it calls. The real scorer runs from a
temporary engine copy whose overlay is the blank template with one TEAM_PHRASES entry (TELL_PHRASE), so the tests don't
depend on anyone's personal overlay. Every case runs the hook the way Claude Code does (python3 <hook>, the hook JSON on stdin) and reads the
decision from stdout. The scorer is either that engine copy's real aiscore.mjs and text-normalize.mjs or a broken stand-in. The
stand-ins are put where any copy of the hook looks: VOICE_AISCORE / VOICE_NORMALIZE, and ~/.claude/tools under a
temporary HOME (the 2026-10-02 hook reads the env vars; older copies only read ~/.claude/tools). Local only, no network;
every text here is synthetic.

What it holds the hook to (2026-10-02 fix):
  D1  If the scorer or the normalizer fails in any way (throws, bad output, missing fields, non-zero exit, hang past the
      timeout, node missing) or the hook itself raises, a send is DENIED and a file write gets a visible warning that the
      structure checks didn't run. A broken scorer used to drop every structure check and let the send through.
  D2  A page with 40,000 unclosed <script> (or <strong) tags gets the same decision as its plain text, fast. Super-linear
      HTML reduction used to take seconds, enough to push the scorer past its timeout and into D1.
  D3  Look-alike letters, zero-width and other invisible characters can't hide a hard-ban word from the word list.
  D4  Every configured send tool is gated (a read marker counts only as a whole word of the tool's own name, so
      manage_spreadsheet_comment is a send), and overlay structures and phrases are read under any issue prefix.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.abspath(os.environ.get("VOICE_TOOLS") or os.path.join(HERE, ".."))
HOOK = os.path.abspath(os.path.expanduser(os.environ.get("VOICE_HOOK") or os.path.join(HERE, "..", "hook", "voice-tell-gate.py")))
REAL_SRC = TOOLS
TELL_PHRASE = "here is the short version"   # the fixture overlay's one TEAM_PHRASES entry (critical, so a send blocks)


def fixture_engine():
    """A temporary copy of the engine in TOOLS whose overlay is the blank template with TELL_PHRASE in TEAM_PHRASES.
    Built by onboarding/lib/engine.mjs, which copies the engine's own modules and links the detector."""
    d = tempfile.mkdtemp(prefix="voice-gate-engine-")
    onb = os.path.join(REAL_SRC, "onboarding", "lib")
    code = (
        "import { renderOverlay } from " + json.dumps("file://" + os.path.join(onb, "render.mjs")) + ";\n"
        "import { buildEngineWithOverlay } from " + json.dumps("file://" + os.path.join(onb, "engine.mjs")) + ";\n"
        "import { writeFileSync } from 'node:fs';\n"
        "const o = " + json.dumps(os.path.join(d, "voice-overlay.mjs")) + ";\n"
        "writeFileSync(o, renderOverlay({ REVIEWED: true, TEAM_PHRASES: [" + json.dumps(TELL_PHRASE) + "] }));\n"
        "buildEngineWithOverlay(" + json.dumps(REAL_SRC) + ", o, { into: " + json.dumps(d) + " });\n"
    )
    p = subprocess.run(["node", "--input-type=module", "-e", code], capture_output=True, text=True, timeout=60)
    if p.returncode != 0:
        sys.exit(f"could not build the fixture engine: {p.stderr.strip()[-300:]}")
    return d


ENGINE = fixture_engine()
REAL_AISCORE = os.path.join(ENGINE, "aiscore.mjs")
REAL_NORMALIZE = os.path.join(ENGINE, "text-normalize.mjs")
FAIL_MSG = "couldn't run its scorer"          # in every fail-closed deny and warning
NOT_RUN = "structure checks did not run"      # in the write warning when aiscore failed

CLEAN_SEND = "Thanks for the notes. I moved the review to Thursday at ten, after the quarter-end numbers land."
TELL_SEND = "We moved the scheduler on Monday. So " + TELL_PHRASE + ": nobody owned the job."
CLEAN_FILE = (
    "We moved the nightly reconciliation job to the new scheduler on Monday. The old one kept skipping runs when the "
    "host rebooted, and nobody noticed for a week because the report still showed the last good totals. I read the "
    "configs, found two jobs pointed at a retired host, and fixed those first. The finance report now lands at six and "
    "the sales one at seven. I wrote a one-page runbook that says who owns each job, how to change the schedule, and "
    "what to check when a run fails. On-call slept through the weekend, which is the real test."
)
TELL_FILE = CLEAN_FILE + " So " + TELL_PHRASE + ": nobody owned the job until it broke."
BIG_SCRIPT_PAGE = lambda body: "<!doctype html><p>" + body + "</p>" + "<script>" * 40000
BIG_STRONG = lambda body: body + " " + "<strong " * 40000

# Broken stand-ins for aiscore.mjs (each is the whole file). D1 says every one of these must fail closed.
OK_JSON = 'JSON.stringify({score: 0, voice: {issues: []}})'
BROKEN_SCORERS = {
    "throws": "throw new Error('scorer exploded');",
    "syntax error": "this is not javascript (;",
    "non-JSON output": "console.log('score: 12, looks fine');",
    "empty output": "",
    "{}": "console.log('{}');",
    "no voice block": "console.log(JSON.stringify({score: 0}));",
    "no issues list": "console.log(JSON.stringify({score: 0, voice: {}}));",
    "no score": "console.log(JSON.stringify({voice: {issues: []}}));",
    "string score": "console.log(JSON.stringify({score: 'low', voice: {issues: []}}));",
    "issue not an object": "console.log(JSON.stringify({score: 0, voice: {issues: [42]}}));",
    "JSON array": "console.log('[]');",
    "truncated JSON": "process.stdout.write('{\"score\": 0, \"voi');",
    "exit 1 after valid JSON": f"console.log({OK_JSON}); process.exit(1);",
    "exit 3, no output": "process.exit(3);",
    "hangs past the timeout": "setTimeout(() => {}, 600000);",
    "file missing": None,
}
BROKEN_NORMALIZERS = {
    "throws": "throw new Error('normalizer exploded');",
    "non-JSON output": "process.stdout.write('seamless');",
    "wrong code-point count": "let s=''; process.stdin.on('data', d => s += d).on('end', () => console.log(JSON.stringify({canonical: s, inputCodePoints: 1})));",
    "no canonical field": "process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({inputCodePoints: 0})));",
    "hangs past the timeout": "setTimeout(() => {}, 600000);",
    "no rendered field": "let s=''; process.stdin.on('data', d => s += d).on('end', () => console.log(JSON.stringify({canonical: s, inputCodePoints: [...s].length})));",
    "rendered not a string": "let s=''; process.stdin.on('data', d => s += d).on('end', () => console.log(JSON.stringify({canonical: s, rendered: 7, inputCodePoints: [...s].length})));",
}

TMP = tempfile.mkdtemp(prefix="voice-gate-test-")


def make_home(scorer=REAL_AISCORE, normalizer=REAL_NORMALIZE):
    """A temporary HOME whose ~/.claude/tools holds the given scorer and normalizer (a real path is symlinked, a string
    of JS is written as the file, None leaves the file missing)."""
    home = tempfile.mkdtemp(dir=TMP)
    tools = os.path.join(home, ".claude", "tools")
    os.makedirs(tools)
    paths = {}
    for name, src in (("aiscore.mjs", scorer), ("text-normalize.mjs", normalizer)):
        dst = os.path.join(tools, name)
        if src is not None and os.path.isabs(src) and os.path.exists(src):
            os.symlink(src, dst)
        elif src is not None:
            with open(dst, "w") as f:
                f.write(src)
        paths[name] = dst
    return home, paths


def run_hook(payload, scorer=REAL_AISCORE, normalizer=REAL_NORMALIZE, path=None, wrapper=None, raw_stdin=None, timeout=120):
    home, paths = make_home(scorer, normalizer)
    env = dict(os.environ, HOME=home, VOICE_AISCORE=paths["aiscore.mjs"], VOICE_NORMALIZE=paths["text-normalize.mjs"],
               VOICE_SCORER_TIMEOUT="3")
    if path is not None:
        env["PATH"] = path
    argv = [sys.executable, "-c", wrapper, HOOK] if wrapper else [sys.executable, HOOK]
    data = raw_stdin if raw_stdin is not None else json.dumps(payload)
    t0 = time.time()
    p = subprocess.run(argv, input=data, capture_output=True, text=True, env=env, timeout=timeout)
    return p.returncode, p.stdout, p.stderr, time.time() - t0


def decision(stdout):
    """('pass'|'deny'|'context'|'other', message) from the hook's stdout."""
    out = stdout.strip()
    if not out:
        return "pass", ""
    try:
        h = json.loads(out.splitlines()[-1]).get("hookSpecificOutput", {})
    except (ValueError, AttributeError):
        return "other", out
    if h.get("permissionDecision") == "deny":
        return "deny", h.get("permissionDecisionReason", "")
    if "additionalContext" in h:
        return "context", h["additionalContext"]
    return "other", out


def send(text, tool="mcp__slack__slack_send_message"):
    return {"hook_event_name": "PreToolUse", "tool_name": tool, "tool_input": {"channel_id": "C0TEST", "text": text}}


def write(text, file_path="/tmp/voice-gate-test/note.md"):
    return {"hook_event_name": "PostToolUse", "tool_name": "Write",
            "tool_input": {"file_path": file_path, "content": text}, "tool_response": {"success": True}}


RESULTS = []


def case(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(("  ok   " if ok else "  FAIL ") + name + ("" if ok else f"   [{detail}]"), flush=True)


def expect(name, payload, want, contains=(), max_secs=None, **kw):
    rc, out, err, secs = run_hook(payload, **kw)
    got, msg = decision(out)
    ok = got == want and rc == 0 and all(c in msg for c in contains) and (max_secs is None or secs < max_secs)
    detail = f"rc={rc} got={got} {secs:.1f}s msg={msg[:160]!r} err={err.strip()[-160:]!r}"
    case(name, ok, detail)
    return got, msg, secs


# The hook's own exception path: load the hook as a module, make analyze() raise, run main() on the real stdin.
RAISE_IN_ANALYZE = (
    "import importlib.machinery, importlib.util, sys\n"
    "loader = importlib.machinery.SourceFileLoader('vtg', sys.argv[1])  # any file name, .py or not\n"
    "spec = importlib.util.spec_from_loader('vtg', loader); m = importlib.util.module_from_spec(spec)\n"
    "loader.exec_module(m)\n"
    "def boom(*a, **k): raise RuntimeError('injected failure inside the hook')\n"
    "m.analyze = boom\n"
    "m.main()\n"
)


def main():
    print(f"hook:  {HOOK}\ntools: {TOOLS}\n")
    print("sanity (the gate's normal decisions)")
    expect("a clean send goes out", send(CLEAN_SEND), "pass")
    expect('a send with "seamless" is denied', send("Our seamless rollout lands Thursday."), "deny", ['"seamless"'])
    expect('a send with the fixture overlay phrase is denied', send(TELL_SEND), "deny", [TELL_PHRASE])
    expect('a send with dual-use "leverage" is a nudge, not a deny', send("We can leverage the existing export job for this."), "context", ["leverage"])
    expect("a non-send tool on PreToolUse is left alone", send(TELL_SEND, tool="mcp__slack__slack_read_channel"), "pass")
    expect("a clean prose file write gets no message", write(CLEAN_FILE), "pass")
    expect("a prose file write with the tell gets a nudge", write(TELL_FILE), "context", [TELL_PHRASE])
    expect("a short file write is skipped", write("Short note."), "pass")
    expect("a non-prose file write is skipped", write(TELL_FILE, file_path="/tmp/voice-gate-test/x.py"), "pass")

    print("\nD1: a broken scorer fails closed (deny on a send, a warning on a write)")
    for name, src in BROKEN_SCORERS.items():
        expect(f"scorer {name}: the send is denied", send(TELL_SEND), "deny", [FAIL_MSG], scorer=src)
        expect(f"scorer {name}: the write gets a warning", write(CLEAN_FILE), "context", [FAIL_MSG, NOT_RUN], scorer=src)
    empty_bin = tempfile.mkdtemp(dir=TMP)
    expect("node not on PATH: the send is denied", send(TELL_SEND), "deny", [FAIL_MSG], path=empty_bin)
    expect("node not on PATH: the write gets a warning", write(CLEAN_FILE), "context", [FAIL_MSG, NOT_RUN], path=empty_bin)
    for name, src in BROKEN_NORMALIZERS.items():
        expect(f"normalizer {name}: the send is denied", send(CLEAN_SEND), "deny", [FAIL_MSG], normalizer=src)
        expect(f"normalizer {name}: the write gets a warning", write(CLEAN_FILE), "context", [FAIL_MSG], normalizer=src)
    # the hang cases must be cut off by the timeout (3 s under test), not left to Claude Code's hook timeout
    expect("a hung scorer is cut off near the timeout", send(CLEAN_SEND), "deny", [FAIL_MSG], scorer=BROKEN_SCORERS["hangs past the timeout"], max_secs=15)

    print("\nD1: the hook's own exceptions fail closed")
    expect("an exception inside the hook denies the send", send(TELL_SEND), "deny", ["blocked"], wrapper=RAISE_IN_ANALYZE)
    expect("an exception inside the hook warns on a write", write(CLEAN_FILE), "context", ["did not run"], wrapper=RAISE_IN_ANALYZE)
    expect("a PreToolUse call with a malformed tool_name is denied", {"hook_event_name": "PreToolUse", "tool_name": None, "tool_input": {"text": CLEAN_SEND}}, "deny", ["blocked"])
    rc, out, err, _ = run_hook(None, raw_stdin="this is not json")
    case("unreadable hook input blocks with exit 2 and a message (the tier can't be told)", rc == 2 and "Voice gate" in err and not out.strip(), f"rc={rc} out={out[:80]!r} err={err[:160]!r}")

    print("\nD3: look-alike letters and invisible characters can't hide a hard-ban word")
    hidden = [
        ("se\u0430mless", "seamless", "Cyrillic a"),
        ("sea\u200bmless", "seamless", "zero-width space"),
        ("synerg\u0443", "synergy", "Cyrillic u"),
        ("syn\u200dergy", "synergy", "zero-width joiner"),
        ("ut\u03b9lize", "utilize", "Greek iota"),
        ("util\u2060ize", "utilize", "word joiner"),
        ("c\u03bfrnerstone", "cornerstone", "Greek omicron"),
        ("corner\u00adstone", "cornerstone", "soft hyphen"),
        ("\uff53\uff59\uff4e\uff45\uff52\uff47\uff59", "synergy", "fullwidth letters"),
        ("seam\U000e0078less", "seamless", "an inserted tag character"),
    ]
    for spelled, word, how in hidden:
        expect(f'"{word}" with {how} is denied', send(f"Our {spelled} rollout lands Thursday."), "deny", [f'"{word}"'])
    expect("look-alike leverage (Cyrillic e) is still a nudge", send("We can l\u0435verage the existing export job."), "context", ["leverage"])
    expect("ordinary Cyrillic and Greek text goes out", send("Спасибо, увидимся в четверг. Καλημέρα."), "pass")
    expect('"seam less" with a real space goes out', send("The seam less visible now after the fix."), "pass")
    # 2026-10-02 verify: these read as the banned word once rendered (entities decoded, inline tags and comments removed,
    # combining marks dropped, small capitals and confusables folded). The canonical text alone missed every one.
    rendered_only = [
        ("seam&#108;ess", "seamless", "a decimal HTML entity"),
        ("seam&#x6c;ess", "seamless", "a hex HTML entity"),
        ("corner&shy;stone", "cornerstone", "an &shy; entity"),
        ("seam<span>less</span>", "seamless", "an inline <span>"),
        ("seam<!-- x -->less", "seamless", "an HTML comment"),
        ("seam<wbr>less", "seamless", "a <wbr>"),
        ("uti\u0307lize", "utilize", "a combining dot above the i"),
        ("\ua731\u028f\u0274\u1d07\u0280\u0262\u028f", "synergy", "small capitals"),
        ("seaml\u03b5ss", "seamless", "a Greek epsilon"),
        ("\ua4e2eamless", "seamless", "a Lisu letter"),
        ("\u13daynergy", "synergy", "a Cherokee letter"),
        ("cornerst\u0585ne", "cornerstone", "an Armenian oh"),
    ]
    for spelled, word, how in rendered_only:
        expect(f'"{word}" with {how} is denied', send(f"Our {spelled} rollout lands Thursday."), "deny", [f'"{word}"'])
    for spelled, phrase, how in [("table\u0085stakes", "table stakes", "NEL"), ("table\u2800stakes", "table stakes", "a Braille blank"),
                                 ("table&nbsp;stakes", "table stakes", "an &nbsp; entity"), ("It&#8217;s worth noting", "s worth noting", "an entity apostrophe")]:
        expect(f'"{phrase}" with {how} is denied', send(f"{spelled} for the Thursday review."), "deny", [phrase])
    expect("HTML that renders separate words goes out", send("<p>Our <b>seam</b> <i>less</i> visible fix.</p><table><tr><td>seam</td><td>less</td></tr></table>"), "pass")
    expect("accented and non-Latin text goes out", send("Café résumé naïve. Привет, это работа. Γεια σου, Καλημέρα. 東京で会いましょう。"), "pass")
    expect("a look-alike banned word in a written file gets a nudge", write(CLEAN_FILE + " The se\u0430mless part is the runbook."), "context", ['"seamless"'])

    print("\nD2: a page of unclosed tags gets the plain text's decision, fast")
    plain_deny, _, _ = expect("plain tell (reference)", send(TELL_SEND), "deny")
    expect("40,000 unclosed <script> tags around the tell: same deny, under 2 s", send(BIG_SCRIPT_PAGE(TELL_SEND)), plain_deny, [TELL_PHRASE], max_secs=2)
    expect("40,000 unclosed <script> tags around a clean note: same pass, under 2 s", send(BIG_SCRIPT_PAGE(CLEAN_SEND)), "pass", max_secs=2)
    expect("40,000 unclosed <script> tags in a written page: same nudge, under 2 s", write(BIG_SCRIPT_PAGE(TELL_FILE)), "context", [TELL_PHRASE], max_secs=2)
    expect('40,000 unclosed "<strong " after the tell: same deny, under 2 s', send(BIG_STRONG(TELL_SEND)), "deny", [TELL_PHRASE], max_secs=2)

    print("\nD4: every configured send tool is gated, and the hook reads any overlay's issue prefix")
    for tool in ("mcp__google__manage_spreadsheet_comment",
                 "mcp__plugin_google-workspace_vmcp-google-workspace__manage_spreadsheet_comment",
                 "mcp__slack__slack_send_message_draft", "mcp__research__create_doc"):
        expect(f"{tool}: a send with \"seamless\" is denied", send("Our seamless rollout lands Thursday.", tool=tool), "deny", ['"seamless"'])
    for tool in ("mcp__google__read_sheet_values", "mcp__slack__slack_read_thread", "mcp__google__list_spreadsheet_comments",
                 "mcp__github__get_pull_request", "mcp__git__update_pull_request_branch", "mcp__github__search_issues"):
        expect(f"{tool}: a read is left alone", send(TELL_SEND, tool=tool), "pass")
    stub = lambda issues: "console.log(JSON.stringify(" + json.dumps({"score": 0, "voice": {"issues": issues}}) + "));"
    issue = lambda typ, sev, text: {"type": typ, "severity": sev, "text": text, "fix": "test"}
    expect("a critical structure from a voice- overlay denies the send", send(CLEAN_SEND),
           "deny", ["custom-shape"], scorer=stub([issue("voice-struct-custom-shape", "critical", "the shape")]))
    expect("a critical structure under a two-part prefix denies the send", send(CLEAN_SEND),
           "deny", ["custom-shape"], scorer=stub([issue("jane-doe-struct-custom-shape", "critical", "the shape")]))
    expect("a high structure from a voice- overlay is a nudge", send(CLEAN_SEND),
           "context", ["custom-shape"], scorer=stub([issue("voice-struct-custom-shape", "high", "the shape")]))
    expect("a critical TEAM_PHRASES hit (voice-phrase) denies the send", send(CLEAN_SEND),
           "deny", ["per my last note"], scorer=stub([issue("voice-phrase", "critical", "per my last note")]))
    expect("a high phrase hit under a two-part prefix the lexicon doesn't list is still a nudge", send(CLEAN_SEND),
           "context", ["per my last note"], scorer=stub([issue("jane-doe-phrase", "high", '"per my last note"')]))
    expect("an overlay word hit is left to the word list (no message)", send(CLEAN_SEND),
           "pass", scorer=stub([issue("voice-word", "high", "marcus")]))

    shutil.rmtree(TMP, ignore_errors=True)
    shutil.rmtree(ENGINE, ignore_errors=True)
    failed = [r for r in RESULTS if not r[1]]
    if failed:
        print(f"\nFAIL: {len(failed)} of {len(RESULTS)} cases failed ({len(RESULTS) - len(failed)} passed)")
    else:
        print(f"\nPASS: {len(RESULTS)}/{len(RESULTS)} cases")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
