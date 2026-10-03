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
  D5  (2026-10-02) A message that is only a banned word ("seamless") is scanned, not skipped as an ID,
      and so is a message that starts with a link; text nested deeper than 7 levels is scanned, and input past the
      depth or size limit denies a send and warns on a write; a sentence that opens "As <Company>" blocks on a send and
      nudges on a write, while attribution ("As Dana said") and ordinary openers ("As of", "As soon as") stay silent.
      Review of D5 (same day): a link followed by markup or a non-whitespace blank, Hangul fillers, inline fragments
      (Slack rich_text, Docs insertText), prose keys and prose lists under plumbing keys are all scanned; a body that is
      only links goes out; more "As <Company>" openers are seen (emoji, headings, numbered items, dashes, eBay, 3M, "AS")
      and fewer non-company ones fire (more attribution verbs, roles, Title Case headings, seasons, event names).
  D6  (2026-10-02, "As <Name>" redesign) A send is denied only for company voice ("As Globex, we ...",
      whatever exemption the line would otherwise get: a heading, an attribution verb, Title Case, capitals) or a name on
      the company list (built in, plus ~/.claude/voice/company-names.txt or the file VOICE_COMPANY_NAMES names, with "!"
      lines for names that are never companies). Any other name in the opener is a nudge: the send goes out. A missing
      names file means the built-in list; an unreadable one warns and never crashes. The hook and both suites carry no
      private names, so they ship in the public edition as they are.
  D7  (2026-10-02) Inflected forms of the banned words: a form with almost no hits in real human
      writing blocks like its base ("delves", "bolstered", "holistically", "game changer"); a form people use nudges
      ("seamlessly", "utilized", "streamlined", "state of the art"). Forms of the nudge words nudge ("leveraged").
      "well positioned" blocks without "to"; "it is worth noting" nudges. The table is in the decision log (D16).
  D8  (2026-10-02) A file write is skipped under 400 characters, except a draft: a path with a folder
      named "drafts" or a file name containing "draft" (any case) is checked at 3 characters and up.
  D9  (review of D6-D8, 2026-10-02) Company voice is read more closely both ways: a possessive appositive before the
      as-clause's verb ("As Dana, our new AE, ramps up") and a list subject ("As 18F, the U.S. Digital Service and other
      agencies develop ..., we") are not company voice; an aside of any kind ("founded in 1985"), a dash pair, a colon,
      an adverb or a long name before "we" still is; a blank line ends the clause. "_As", "~As" and an emoji before
      "As" are openers. The send gate also reads the rendered view the draft gate reads. A "!" line takes a built-in
      name off the list; the names file follows CLAUDE_CONFIG_DIR; a names line past four words is skipped with a note.
      Six more forms block. Messages name no private file, and the sources pass the docs' public leak check.
  D10 (review of the hook holes, 2026-10-03) An abbreviated legal suffix with its period ("As Globex Inc., we ...",
      "As Acme Co. our team ...") is company voice and blocks; the period still ends a sentence before a capital or the
      next "As". The documented limits hold as written: Open Gaps item 11's list example is silent and its long-aside
      example a nudge, and a listed company blocks any opener unless a "!" line takes it off the list.
"""
import json
import os
import re
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


def run_hook(payload, scorer=REAL_AISCORE, normalizer=REAL_NORMALIZE, path=None, wrapper=None, raw_stdin=None, timeout=120,
             names=None, names_env=None, config_dir=None):
    """names: the per-user company-names file to put at ~/.claude/voice/company-names.txt under the temporary HOME (str
    or bytes; a dict {"dir": True} makes a directory there instead), or under config_dir when that is given (it is then
    set as CLAUDE_CONFIG_DIR, a folder of the temporary HOME). names_env: a value for VOICE_COMPANY_NAMES."""
    home, paths = make_home(scorer, normalizer)
    env = dict(os.environ, HOME=home, VOICE_AISCORE=paths["aiscore.mjs"], VOICE_NORMALIZE=paths["text-normalize.mjs"],
               VOICE_SCORER_TIMEOUT="3")
    env.pop("VOICE_COMPANY_NAMES", None)  # the caller's own setting never leaks into a case
    env.pop("CLAUDE_CONFIG_DIR", None)
    if config_dir is not None:
        env["CLAUDE_CONFIG_DIR"] = os.path.join(home, config_dir)
    if names is not None:
        vdir = os.path.join(env.get("CLAUDE_CONFIG_DIR") or os.path.join(home, ".claude"), "voice")
        os.makedirs(vdir, exist_ok=True)
        dst = os.path.join(vdir, "company-names.txt")
        if isinstance(names, dict):
            os.makedirs(dst)
        else:
            with open(dst, "wb") as f:
                f.write(names if isinstance(names, bytes) else names.encode("utf-8"))
    if names_env is not None:
        env["VOICE_COMPANY_NAMES"] = names_env
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
    "import importlib.machinery, importlib.util, sys\nsys.dont_write_bytecode = True\n"
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
    expect("a high overlay phrase the lexicon doesn't list is still a nudge", send(CLEAN_SEND),
           "context", ["per my last note"], scorer=stub([issue("voice-phrase", "high", '"per my last note"')]))
    expect("an overlay word hit is left to the word list (no message)", send(CLEAN_SEND),
           "pass", scorer=stub([issue("voice-word", "high", "marcus")]))

    print("\nD5: a lone banned word, deep nesting, and the As [Company] opener (2026-10-02)")
    # H1: a whole message that is one banned word looked like an ID (8+ word characters, no space) and was skipped.
    for lone, word in (("seamless", "seamless"), ("Seamless", "seamless"), ("SEAMLESS", "seamless"),
                       ("transformative", "transformative"), ("_seamless_", "seamless"), ("  Cornerstone  ", "cornerstone")):
        expect(f"a send that is only {lone.strip()!r} is denied", send(lone), "deny", [f'"{word}"'])
    expect('a send that is only "leverage" is a nudge', send("leverage"), "context", ["leverage"])
    expect('a lone banned word in a nested field is denied', {"hook_event_name": "PreToolUse", "tool_name": "mcp__slack__slack_send_message",
           "tool_input": {"channel_id": "C0TEST", "blocks": [{"type": "section", "text": {"type": "mrkdwn", "text": "Groundbreaking"}}]}}, "deny", ['"groundbreaking"'])
    expect("a message that starts with a link is still scanned", send("https://example.com/doc Our seamless rollout lands Thursday."), "deny", ['"seamless"'])
    for ident, how in (("a3f9c2e1b7d04e5f9a1c", "a hex id"), ("RX7k2Qp9Lm3TzW8b4N", "an 18-character record id"),
                       ("dGhpcyBpcyBhIHRva2Vu", "a base64 token"), ("seamless_rollout_flag", "a snake_case key"),
                       ("streamliner", "a longer word that isn't on the list"), ("https://example.com/seamless-rollout", "a bare URL"),
                       ("2026-10-02T09:30:00", "a timestamp")):
        expect(f"{how} on its own still goes out unscanned", send(ident), "pass")
    # H2: harvest() stopped at depth 7, so a banned word 8+ levels down was never seen.
    def nest(levels, leaf):
        for i in range(levels):
            leaf = {"blocks": [leaf]} if i % 2 else [leaf]
        return leaf
    deep_send = lambda levels, leaf: {"hook_event_name": "PreToolUse", "tool_name": "mcp__slack__slack_send_message",
                                      "tool_input": {"channel_id": "C0TEST", "blocks": nest(levels, {"text": leaf})}}
    expect("a banned word 12 levels deep is denied", deep_send(12, "Our seamless rollout lands Thursday."), "deny", ['"seamless"'])
    expect("a banned word 60 levels deep is denied", deep_send(60, "Our seamless rollout lands Thursday."), "deny", ['"seamless"'])
    expect("a clean note 20 levels deep goes out", deep_send(20, CLEAN_SEND), "pass")
    expect("a clean note 150 levels deep is denied as unscannable", deep_send(150, CLEAN_SEND), "deny", ["couldn't scan"])
    raw_deep = lambda d: ('{"hook_event_name": "PreToolUse", "tool_name": "mcp__slack__slack_send_message", "tool_input": '
                          '{"channel_id": "C0TEST", "text": ' + "[" * d + json.dumps(CLEAN_SEND) + "]" * d + "}}")
    rc, out, err, secs = run_hook(None, raw_stdin=raw_deep(10000))
    got, msg = decision(out)
    case("a 10,000-deep nested list on a send is denied, without a crash, under 5 s",
         rc == 0 and got == "deny" and "couldn't scan" in msg and "Traceback" not in err and secs < 5, f"rc={rc} got={got} {secs:.1f}s msg={msg[:120]!r} err={err[-160:]!r}")
    expect("250,000 values in one send are denied as unscannable", send([0] * 250000), "deny", ["couldn't scan"], max_secs=10)
    deep_write = {"hook_event_name": "PostToolUse", "tool_name": "Write", "tool_response": {"success": True},
                  "tool_input": {"file_path": "/tmp/voice-gate-test/note.md", "content": nest(10000, CLEAN_FILE)}}
    expect("a 10,000-deep structure as a file's content gets a warning", deep_write, "context", ["couldn't scan"])
    # H3: "As Globex, ..." is the banned opener; attribution and ordinary "As ..." openers are not. Since D6 a send is
    # denied only for company voice ("As Globex, we ...") or a name on the company list ("As AWS ..."); any other name in
    # the opener is a nudge (see D6).
    for text, noun in (("As Globex, we want every rep to close faster.", "As Globex"),
                       ("As AWS expands its regions, latency drops.", "As AWS"),
                       ("Agreed. “As Northwind Traders, we stand behind it.”", "As Northwind Traders"),
                       ("As Glo\u200bbex, we want every rep to close faster.", "As Globex"),
                       ("Done." + " " * 40 + "As Globex, we grow the queue too.", "As Globex")):
        expect(f"{text[:44]!r}... is denied", send(text), "deny", [noun, 'drop "As"'])
    for text, noun in (("We met Monday. As Acme Corp grows, the queue grows with it.", "As Acme Corp"),
                       ("As Initech Cloud matures, the joins get cheaper.", "As Initech Cloud"),
                       ("Notes for Thursday:\n- As Globex continues to grow, hiring follows.", "As Globex"),
                       ("It shipped!\nAs Globex customers, you get this at no cost.", "As Globex"),
                       ("Done." + " " * 40 + "As Globex grows, the queue grows too.", "As Globex")):
        expect(f"{text[:44]!r}... is a nudge (D6: not company voice, not on the list)", send(text), "context", [noun, "leading with the subject"])
    expect("40,000 lines of \"As X, we\" openers: a deny, under 3 s", send("As Globex, we grow.\n" * 40000), "deny", ["As Globex"], max_secs=3)
    expect("40,000 lines of \"As X grows\" openers: a nudge, under 3 s", send("As Globex grows.\n" * 40000), "context", ["As Globex"], max_secs=3)
    expect("an As [Company] opener in a written file gets a nudge", write(CLEAN_FILE + " As Globex, we care about uptime."), "context", ["As Globex"])
    for text in ("As Dana said, the gate needs a corpus.", "As Marc put it, trust comes first.",
                 "As Jane Smith noted in the review, the job is fixed.", "As Gartner reports, adoption is uneven.",
                 "As Sam and I discussed, the job moves Monday.", "As Dr. Lee pointed out, the host was retired.",
                 "As I said, the job moves Monday.", "As we discussed, the job moves Monday.", "As a team, we ship on Fridays.",
                 "As the owner, I sign off on it.", "As of October 2, the job runs nightly.", "As soon as it lands, I'll ping you.",
                 "As far as I know, nothing broke.", "As long as the host is up, it runs.", "As well, the report lands at six.",
                 "As such, we moved it.", "As expected, the run passed.", "As noted, the run passed.", "As mentioned, the run passed.",
                 "As discussed, the run passed.", "We grew as Globex grew.", "It runs as AWS Lambda functions.",
                 "As AI agents take on more work, review matters more.", "As October closes, the numbers firm up.",
                 "As CEO, she signs the plan.", "As Head of Sales, he owns the number.", "As Is and To Be maps are next."):
        expect(f"{text[:44]!r} goes out", send(text), "pass")

    print("\nD5 review: what three reviewers found in the D5 fix (2026-10-02)")
    gmail = "mcp__plugin_google-workspace_vmcp-google-workspace__send_gmail_message"
    gdoc = "mcp__plugin_google-workspace_vmcp-google-workspace__batch_update_doc"
    tin = lambda ti, tool="mcp__slack__slack_send_message": {"hook_event_name": "PreToolUse", "tool_name": tool, "tool_input": ti}
    # B1 / FC-1: a leading link no longer hides the rest when it's joined by markup or a blank that isn't whitespace.
    for body, want in (("https://example.com/doc<p>Our&nbsp;seamless&nbsp;rollout&nbsp;lands&nbsp;Thursday.</p>", '"seamless"'),
                       ("https://example.com/<p>It&#39;s&nbsp;worth&nbsp;noting&nbsp;our&nbsp;plan.</p>", "worth"),
                       ("https://example.com/<p>As&nbsp;Globex,&nbsp;we&nbsp;deliver.</p>", "As Globex")):
        expect(f"an HTML email that opens with a link is scanned ({want})", tin({"to": "sam", "body": body}, gmail), "deny", [want])
    expect("a link then <br> and &nbsp; still reaches the structure checks",
           send("https://x.co/<br>So&nbsp;" + TELL_PHRASE + ":&nbsp;nobody&nbsp;owned&nbsp;the&nbsp;job."), "deny", [TELL_PHRASE])
    for sep in ("⠀", "ㅤ", "ﾠ", "ᅟ", "᠎", "⁠", "​"):
        expect(f"a link then words joined by U+{ord(sep):04X} is scanned", send("https://example.com/doc" + sep + sep.join("Our seamless rollout lands Thursday.".split())), "deny", ['"seamless"'])
    # FC-2: Hangul fillers count as letters, so the word had no boundary even without a link.
    for sep in ("ㅤ", "ﾠ", "ᅟ", "ᅠ"):
        expect(f"words joined by Hangul filler U+{ord(sep):04X} are scanned", send(sep.join("Our seamless rollout is live on Monday.".split())), "deny", ['"seamless"'])
    expect("Korean text with a Hangul filler goes out", send("감사합니다ㅤ목요일에 뵙겠습니다."), "pass")
    # FP4: a body that is only links is plumbing again; a link next to prose is not.
    expect("a PR body that is only a list of links goes out", tin({"owner": "o", "repo": "r", "title": "Docs links",
           "body": "https://github.com/o/r/pull/12\nhttps://blog.example.com/2024/seamless-deploys-with-blue-green"}, "mcp__github__create_pull_request"), "pass")
    expect("a plain ASCII link with a query string goes out", send("https://acme.example/a/b?c=d&e=f#g"), "pass")
    expect("a non-ASCII link is scanned and goes out", send("https://例え.jp/path"), "pass")
    # B5: inline fragments the destination renders as one run.
    rich = lambda a, b: tin({"channel_id": "C0", "blocks": [{"type": "rich_text", "elements": [{"type": "rich_text_section",
                            "elements": [{"type": "text", "text": a}, {"type": "text", "text": b}]}]}]})
    expect('rich_text pieces "Our sea" + "mless ..." are read as one run', rich("Our sea", "mless rollout lands Thursday."), "deny", ['"seamless"'])
    expect('rich_text pieces "As " + "Globex, we ..." are read as one run', rich("As ", "Globex, we want every rep to close faster."), "deny", ["As Globex"])
    expect("rich_text pieces that are clean go out", rich("Thanks for the notes. ", "I moved the review to Thursday."), "pass")
    expect("Docs inserts at one index are read in the order the API applies them", tin({"document_id": "1abc", "requests": [
           {"insertText": {"location": {"index": 1}, "text": "mless rollout lands Thursday."}},
           {"insertText": {"location": {"index": 1}, "text": "Our sea"}}]}, gdoc), "deny", ['"seamless"'])
    # FC-3: prose as a dict key, and prose in a list under a plumbing key.
    expect("prose as a dict key is scanned", tin({"Our seamless rollout went out on Monday.": 1}), "deny", ['"seamless"'])
    expect("prose in a list under a plumbing key is scanned", tin({"name": ["Our seamless rollout went out on Monday."]}), "deny", ['"seamless"'])
    expect("a recipient list under a plumbing key goes out", tin({"to": ["seamless.rollout@example.com", "U0SEAMLESS1"], "text": CLEAN_SEND}, gmail), "pass")
    # B2: more ways a line or sentence starts.
    for text in ("Hi team!\n\n:wave: As Globex, we're excited to share our Q3 plan.", "\U0001F680 As Globex, we want every rep to close faster.",
                 ":rocket: As Globex, we want every rep to close faster.", "## As Globex, we want every rep to close faster.",
                 "1) As Globex, we want every rep to close faster.", "(1) As Globex, we want every rep to close faster.",
                 "a) As Globex, we want every rep to close faster.", "– As Globex, we want every rep to close faster.",
                 "◦ As Globex, we want every rep to close faster.", "‣ As Globex, we want every rep to close faster.",
                 "Big news… As Globex, we want every rep to close faster.", "Big news — As Globex, we want every rep to close faster.",
                 "Big news; As Globex, we want every rep to close faster.", "Plan: As Globex, we want every rep to close faster.",
                 "Hello.\rAs Globex, we want every rep to close faster."):
        expect(f"{text[:40]!r}... is denied", send(text), "deny", ["As Globex"])
    expect("a numbered As [Company] line in a written file gets a nudge", write(CLEAN_FILE + "\n1) As Globex, we care about uptime."), "context", ["As Globex"])
    # B3: a main clause or a new subject after "As Globex," is the opener; so is a verb with an object.
    for text in ("As Globex, our customers often tell us speed matters most.", "As Globex, a leader in cloud software, we have found that customers want speed.",
                 "As Globex, the leader in CRM, we've learned what customers need, and we share it.",
                 ):
        expect(f"{text[:44]!r}... is denied", send(text), "deny", ["As Globex"])
    for text in ("As Globex shares its roadmap, we want every rep ready.", "As Globex finds new markets, hiring follows."):
        expect(f"{text[:44]!r}... is a nudge (D6: Globex is the subject of the as-clause)", send(text), "context", ["As Globex"])
    # B4: names that start lowercase, with a digit or a non-ASCII capital; "AS"; a Slack link.
    for text, noun in (("As eBay, we want every rep to close faster.", "As eBay"), ("As 3M, we want every rep to close faster.", "As 3M"),
                       ("As 1Password, we want every rep to close faster.", "As 1Password"), ("As Ørsted, we want every rep to close faster.", "As Ørsted"),
                       ("AS GLOBEX, we want every rep to close faster.", "As GLOBEX"), ("As <https://globex.example|Globex>, we want every rep to close faster.", "As Globex")):
        expect(f"{text[:44]!r}... is denied", send(text), "deny", [noun])
    # FP1-FP3: attribution with more verbs, roles, Title Case headings, seasons, event names: none of these is a company.
    for text in ("As Dana requested, I moved the review to Thursday.", "As Dana flagged in the 1:1, the job moved.",
                 "As Priya and Sam agreed, the job moved.", "As Sam was saying on the call, the job moved.", "As Priya knows, the job moved.",
                 "As Dana, Sam and I discussed last week, the job moved.", "As Brad's email below indicates, the job moved.",
                 "As Marc has been saying for years, trust comes first.", "As Dana proposed, the job moved.", "As Frank indicated below, the job moved.",
                 "As Sue highlights below, the job moved.", "As Adam Smith reminded us, the job moved.", "As Larry can attest to, the job moved.",
                 "As Louise (Kitchen, president of the desk) said, the job moved.", "As Victor already replied, the job moved.",
                 "As Clayton (your best mate?) would say: the job moved.", "As DANA@EXAMPLE.COM (Dana Lee) pointed out, the job moved.",
                 "As Craig said don't be shy about asking.", "As Guido said <https://mail.example.org/thread/1>, the merge waits.",
                 "As Scott Ambler [notes](https://example.org/notes), the team owns it.", "As Michelle Hertzfeld, a\ndesigner in Tucson, notes: it works.",
                 "As Amber Lee, who served as the PO on a project with 18F says, keep an open mind.",
                 "As SEs, we should own demo org hygiene.", "As Solutions Engineer on the account, I'll run the workshop.",
                 "As Account Executive for the renewal, Lloyd owns the paper.", "As PMs, we write the spec first.",
                 "As User, I want to reset my password from the login page.", "As FYI, the deck is updated.",
                 "As General Counsel for the Company, I provide notice.", "As Rick's assistant, my numbers are in.",
                 "As BDFL-Delegate I'm happy with this version.", "As Sr. VP and deputy general counsel, I sign.", "As St. Augustine said, it matters.",
                 "As Seller of the options, the desk pays on delivery.",
                 "As Agents Scale, Trust Becomes the Bottleneck\n\nThe memo argues one point.", "As Prepared for Delivery\n\nGood morning, everyone.",
                 "AS INTRODUCED\n\n120th General Assembly", "AS Patterns\n^^^^^^^^^^^\n\nSurface syntax.",
                 "As Winter '27 rolls out, the new release auto-enables in the demo org.",
                 "Note: As expected, it passed.", "1) As of Monday, the job runs.", "As 2026 closes, we plan the next one.",
                 "As 5G rolls out, latency drops.", "As Jacob Harris, a developer in D.C., puts it, trust matters."):
        expect(f"{text[:44]!r} goes out", send(text), "pass")
    for text, noun in (("As Globex Partners, we hire.", "As Globex Partners"), ("As 18F, we plan to keep tinkering.", "As 18F")):
        expect(f"{text[:44]!r}... is denied (a firm name in company voice)", send(text), "deny", [noun])
    for text, noun in (("As Globex Partners grows, we hire.", "As Globex Partners"), ("As 18F grows, we plan to keep tinkering.", "As 18F")):
        expect(f"{text[:44]!r}... is a nudge (D6: a firm name, not company voice)", send(text), "context", [noun])

    print("\nD6: \"As <Name>\" blocks only company voice or a listed company; any other name is a nudge (2026-10-02)")
    LEAD = "leading with the subject"
    # Company voice: the name, then (after an optional comma, aside or appositive) a first-person main clause.
    for text, noun in (("As Globex we want every rep to close faster.", "As Globex"),
                       ("As Globex, I want every rep to close faster.", "As Globex"),
                       ("As Globex, my team ships on Fridays.", "As Globex"),
                       ("As Globex, us folks ship on Fridays.", "As Globex"),
                       ("As Globex, me and the team ship on Fridays.", "As Globex"),
                       ("As Globex, we're excited to share the plan.", "As Globex"),
                       ("As Globex (the parent company), we ship on Fridays.", "As Globex"),
                       ("As Globex, the leader in widgets, our team ships on Fridays.", "As Globex"),
                       ("As Initech Labs, we ship on Fridays.", "As Initech Labs")):
        expect(f"company voice {text[:40]!r}... is denied", send(text), "deny", [noun, 'drop "As"'])
    # The exemptions don't excuse company voice: a heading-looking line, an attribution-looking line, Title Case, capitals.
    for text, how, noun in (("As Globex, We Want Every Rep To Close Faster", "a Title Case heading line", "As Globex"),
                            ("AS GLOBEX, WE WANT EVERY REP TO CLOSE FASTER", "an all-caps line", "As GLOBEX"),
                            ("As Globex, we said last week, the plan holds.", "a reporting verb after the first person", "As Globex"),
                            ("As Globex, we noted, adoption is uneven.", "an attribution verb after the first person", "As Globex"),
                            ("## As Globex, We Are Hiring", "a markdown heading", "As Globex"),
                            ("As Globex, US sales grew.", "an all-caps US that is the country (a nudge)", None)):
        if noun is None:
            expect(f"{how}", send(text), "context", ["As Globex", "leading with the subject"])
        else:
            expect(f"company voice in {how} is denied", send(text), "deny", [noun])
    # The built-in list: large companies, with a possessive or a corporate suffix, in any case.
    for text, noun in (("As Google grows, the queue grows with it.", "As Google"),
                       ("As Microsoft's revenue grows, the queue grows.", "As Microsoft's"),
                       ("As Microsoft Corp grows, the queue grows.", "As Microsoft Corp"),
                       ("As Oracle, Inc. grows, the queue grows.", "As Oracle"),
                       ("As GOOGLE grows, the queue grows.", "As GOOGLE"),
                       ("As OpenAI ships faster, review matters more.", "As OpenAI"),
                       ("As Google reports, adoption is uneven.", "As Google")):
        expect(f"a listed company {text[:40]!r}... is denied", send(text), "deny", [noun])
    expect("a listed company in a written file is a nudge", write(CLEAN_FILE + " As Google grows, the queue grows."), "context", ["As Google"])
    expect("a company only named mid-sentence goes out", send("We moved the export to Google Cloud on Monday."), "pass")
    expect("a listed company's role phrase goes out (a role, not the company)", send("As Google's CEO, she signs the plan."), "pass")
    expect("a longer name that starts with a listed one is a nudge, not a deny", send("As Google Cloud matures, joins get cheaper."), "context", ["As Google Cloud", LEAD])
    # Any other name in the opener is a nudge on a send (it goes out) and on a write.
    for text, noun in (("As Dana rolls off the account, Sam takes the renewals.", "As Dana"),
                       ("As Globex, the queue grows with every rep.", "As Globex"),
                       ("As Initech Cloud matures, joins get cheaper.", "As Initech Cloud")):
        expect(f"{text[:44]!r} is a nudge and goes out", send(text), "context", [noun, LEAD])
    expect("a non-company opener in a written file is a nudge", write(CLEAN_FILE + " As Dana rolls off, Sam takes it."), "context", ["As Dana", LEAD])
    # The exemptions still decide nudge vs silent for other names.
    for text in ("As Dana said, the gate needs a corpus.", "As SEs, we own the demo org.", "As CEO, I sign the plan.",
                 "As Of Monday, We Ship", "As Agents Scale, Trust Becomes the Bottleneck\n\nThe memo argues one point."):
        expect(f"{text[:44]!r} goes out silently", send(text), "pass")
    # The per-user names file: ~/.claude/voice/company-names.txt, or the file VOICE_COMPANY_NAMES names.
    NAMES = "# my companies\nInitech\n\nInitech Cloud\n  Vandelay Industries  \n!Globex Summit\n"
    for text, noun in (("As Initech grows, the queue grows.", "As Initech"), ("As initech's roadmap shows, joins get cheaper.", None),
                       ("As Initech Cloud matures, joins get cheaper.", "As Initech Cloud"),
                       ("As Vandelay Industries grows, we hire.", "As Vandelay Industries"),
                       ("As INITECH, INC. grows, the queue grows.", "As INITECH")):
        if noun is None:
            expect(f"{text[:40]!r} (lowercase, not a name) goes out", send(text, ), "pass", names=NAMES)
        else:
            expect(f"a name from the per-user file {text[:36]!r}... is denied", send(text), "deny", [noun], names=NAMES)
    expect('a "!" line makes that name silent', send("As Globex Summit wraps, here's the recap."), "pass", names=NAMES)
    expect('without the "!" line the same opener is a nudge', send("As Globex Summit wraps, here's the recap."), "context", ["As Globex Summit"])
    expect('a "!" line does not excuse company voice', send("As Globex Summit, we welcome you."), "deny", ["As Globex Summit"], names=NAMES)
    alt = os.path.join(TMP, "alt-names.txt")
    with open(alt, "w") as f:
        f.write("Hooli\n")
    expect("VOICE_COMPANY_NAMES points at another file", send("As Hooli grows, the queue grows."), "deny", ["As Hooli"], names_env=alt)
    expect("VOICE_COMPANY_NAMES replaces the default file", send("As Initech grows, the queue grows."), "context", ["As Initech"], names=NAMES, names_env=alt)
    expect("no names file: the built-in list only", send("As Initech grows, the queue grows."), "context", ["As Initech", LEAD])
    expect("a names file that is missing at VOICE_COMPANY_NAMES: the built-in list only, no warning",
           send(CLEAN_SEND), "pass", names_env=os.path.join(TMP, "no-such-names.txt"))
    for bad, how in (({"dir": True}, "a directory"), (b"Initech\n\xff\xfe\xff\n", "invalid UTF-8")):
        expect(f"an unreadable names file ({how}) warns and the clean send goes out", send(CLEAN_SEND), "context", ["company-names", "couldn't read"], names=bad)
        expect(f"an unreadable names file ({how}): the built-in list still blocks", send("As Google grows, the queue grows."), "deny", ["As Google", "couldn't read"], names=bad)
        expect(f"an unreadable names file ({how}) warns on a write", write(CLEAN_FILE), "context", ["couldn't read"], names=bad)
    expect("a huge names file is read only up to its cap, fast", send("As Initech grows, the queue grows."), "deny", ["As Initech"],
           names="Initech\n" + "Filler Name\n" * 300000, max_secs=5)
    print("\nD7: inflected forms of the banned words, decided by the control corpora (2026-10-02)")
    D7_BLOCK = ("delves", "streamlines", "synergistic", "synergize", "synergizes", "synergized", "synergizing", "synergise",
                "synergised", "transformatively", "ground-breaking", "spearheads", "spearheading", "bolstered", "fortifies",
                "fortifying", "underpinned", "underpinnings", "cornerstones", "linchpins", "lynchpin", "lynchpins",
                "multi-faceted", "holistically", "game changing", "game-changer", "game-changers", "game changer",
                "game changers", "best in class", "mission critical", "low hanging fruit")
    D7_NUDGE = ("delved", "delving", "streamlined", "streamlining", "seamlessly", "utilizes", "utilized", "utilizing",
                "utilization", "utilise", "utilises", "utilised", "utilising", "utilisation", "synergies", "paradigms",
                "spearheaded", "bolsters", "bolstering", "fortified", "underpins", "tapestries", "cutting edge", "world class",
                "state of the art", "next generation", "next-gen", "table-stakes",
                "leverages", "leveraged", "leveraging", "robustly", "robustness", "landscapes", "ecosystems", "innovatively",
                "fosters", "fostered", "fostering", "unlocks", "unlocked", "unlocking", "empowers", "empowered", "empowering",
                "empowerment", "facilitates", "facilitated", "facilitating", "unpacks", "unpacked", "unpacking", "north stars",
                "deep dive", "deep dives", "deep-dives", "double-clicks", "double-clicked", "double-clicking", "circling back",
                "circled back", "circles back")
    for form in D7_BLOCK:
        expect(f'"{form}" in a send is denied', send(f"The {form} plan lands Thursday, and Sam owns it."), "deny", [f'"{form}"'])
    for form in D7_NUDGE:
        expect(f'"{form}" in a send is a nudge', send(f"The {form} plan lands Thursday, and Sam owns it."), "context", [f'"{form}"'])
    for phrase, want, how in (("We are well positioned for the review.", "deny", "well positioned"),
                              ("We are well-positioned for the review.", "deny", "well-positioned"),
                              ("We are well positioned to win the review.", "deny", "well positioned to"),
                              ("It was worth noting the dates.", "deny", "was worth noting"),
                              ("The release ushers in a new era for the team.", "deny", "ushers in a new era"),
                              ("The release ushered in a new era for the team.", "deny", "ushered in a new era"),
                              ("That fix moved the needle on churn.", "deny", "moved the needle"),
                              ("Moving the needle on churn is the goal.", "deny", "Moving the needle"),
                              ("It is worth noting the dates moved.", "context", "is worth noting")):
        expect(f"{phrase!r} is a {'deny' if want == 'deny' else 'nudge'}", send(phrase), want, [how])
    expect('a send that is only "seamlessly" is a nudge, not skipped', send("seamlessly"), "context", ['"seamlessly"'])
    expect('a send that is only "Delves" is denied, not skipped', send("Delves"), "deny", ['"delves"'])
    expect('a look-alike "deIves" spelling is still read (Cyrillic e)', send("The d\u0435lves plan lands Thursday."), "deny", ['"delves"'])
    expect("a file write with a block form gets a nudge", write(CLEAN_FILE + " The plan bolstered the review."), "context", ['"bolstered"'])
    for text in ("The utilities team fixed the meter.", "Our seamstress fixed the hem.", "The delivery lands Thursday.",
                 "The next generations of the job ran clean.", "We moved the needles to the left drawer.", "The game changed at half time."):
        expect(f"{text!r} goes out", send(text), "pass")

    print("\nD8: a draft file is checked at any length (2026-10-02)")
    SHORT_TELL = "Our seamless rollout lands Thursday."
    for path in ("/tmp/voice-gate-test/drafts/2026-10-02-sam.md", "/tmp/voice-gate-test/work/drafts/2026-10-02-sam.md",
                 "/tmp/voice-gate-test/notes/slack-draft.md", "/tmp/voice-gate-test/Drafts/reply.txt",
                 "/tmp/voice-gate-test/notes/DRAFT-email.md", "/tmp/voice-gate-test/notes/redrafted.html"):
        expect(f"a short tell in {path} gets a nudge", write(SHORT_TELL, file_path=path), "context", ['"seamless"'])
    expect("a lone banned word in a draft file gets a nudge", write("seamless", file_path="/tmp/voice-gate-test/drafts/a.md"), "context", ['"seamless"'])
    expect("an Edit to a draft file with a short tell gets a nudge", {"hook_event_name": "PostToolUse", "tool_name": "Edit",
           "tool_input": {"file_path": "/tmp/voice-gate-test/drafts/a.md", "old_string": "x", "new_string": SHORT_TELL},
           "tool_response": {"success": True}}, "context", ['"seamless"'])
    expect("a short clean draft file gets no message", write("Thanks, see you Thursday.", file_path="/tmp/voice-gate-test/drafts/a.md"), "pass")
    expect("two characters in a draft file are skipped", write("ok", file_path="/tmp/voice-gate-test/drafts/a.md"), "pass")
    for path, how in (("/tmp/voice-gate-test/notes/note.md", "an ordinary file"), ("/tmp/voice-gate-test/draftsman/note.md", "a folder that only starts with drafts"),
                      ("/tmp/voice-gate-test/drafts/run.py", "a non-prose file in drafts"), ("/tmp/voice-gate-test/notes/draft.py", "a non-prose draft file")):
        expect(f"a short tell in {how} is skipped", write(SHORT_TELL, file_path=path), "pass")

    print("\nD9: review of the redesign: company voice read more closely, both ways (2026-10-02)")
    LEAD = "leading with the subject"
    # A possessive that opens an appositive, then the as-clause's own verb, is not company voice: attribution stays silent,
    # anything else is a nudge (F1, DG-1).
    for text in ("As Sam, my manager, said last week, the date moves.", "As Priya, our PM, pointed out, the date slips.",
                 "As Sam, my friend at Amazon, says, models drift.", "As Dana, my old AE, used to say, always confirm the date.",
                 "As Dana, our CFO, said on the call, the budget is fixed for Q4, so the review moves to Thursday.",
                 "As Priya, my manager, put it, the export job is the bottleneck we keep tripping over.",
                 "As Sam, my co-founder, likes to say, ship it on Thursday."):
        expect(f"{text[:46]!r} goes out silently (attribution after a possessive appositive)", send(text), "pass")
    for text, noun in (("As Dana, our new AE, ramps up, Sam will cover the account.", "As Dana"),
                       ("As Boston, my hometown, gets colder, I bike less.", "As Boston"),
                       ("As Kubernetes, our main platform, matures, ops work shrinks.", "As Kubernetes"),
                       ("As Python, our team's language of choice, grows, packaging gets harder.", "As Python")):
        expect(f"{text[:46]!r} is a nudge, not a deny", send(text), "context", [noun, LEAD])
    for text in ("As Globex, our team is ready.", "As Globex, our team ships on Fridays, and the reviews land Monday.",
                 "As Globex, our partner, we ship on Fridays.", "As Dana, I think the pricing works."):
        expect(f"company voice {text[:46]!r} is still denied", send(text), "deny", ["As "])
    # A list of subjects with its own verb inside an ordinary as-clause is not an appositive (F2; the 18F shape is a
    # sentence from a public 18F post).
    for text, noun in (("As Dana, the AE and the SE finish the deck, we'll book the room.", "As Dana"),
                       ("As Priya, the new PM and I wrap up testing, we will send notes.", "As Priya"),
                       ("As Boston, the suburbs and the Cape get snow, we should move the offsite.", "As Boston"),
                       ("As Python, the docs team and the packaging folks converge on a format, we will update the guide.", "As Python"),
                       ("As 18F, the U.S. Digital Service and other agencies develop these resources, we'll continue to share them.", "As 18F")):
        expect(f"{text[:46]!r} is a nudge (a list subject, not company voice)", send(text), "context", [noun, LEAD])
    expect("an appositive with a coordinated object is still company voice", send("As Globex, a leader in data and AI, we can help."), "deny", ["As Globex"])
    # Company voice behind an aside that isn't a determiner appositive, a dash pair, other separators, an adverb, a long
    # name (F3).
    for text in ("As Globex, founded in 1985, we know widgets.", "As Globex, with forty years in widgets, we can help.",
                 "As Globex, having built widgets for decades, we can help.", "As Globex, based in Ohio, we can help.",
                 "As Globex, since 1985, we have built widgets.", "As Globex, after forty years, we know widgets.",
                 "As Globex, at our core, we value trust.", "As Globex, like you, we care about uptime.",
                 "As Globex, honestly, we can help.", "As Globex, frankly we can help.", "As Globex, together we can win.",
                 "As Globex, as a company, we can help.", "As Globex — a widget leader — we can help.",
                 "As Globex -- a widget leader -- we can help.", "As Globex—we can help.", "As Globex: we can help.",
                 "As Globex; we can help.", "As Globex... we can help.", "As Globex here, we can help.",
                 "As Globex Widget Holdings Group International, we will cover it.", "As Globex,\nwe can help."):
        expect(f"company voice {text[:46]!r} is denied", send(text), "deny", ["As Globex"])
    # A Title Case heading and the paragraph after it are not one clause (DG-2).
    for text in ("## As Dana Moves On\n\nWe hired Sam to take over the account starting Monday.",
                 "As Dana Moves On\n\nI wanted to say thanks for three great years."):
        expect(f"{text[:40]!r}... goes out (a heading, then a new paragraph)", send(text), "pass")
    # Slack italics and strike, and an emoji or :shortcode: that ends the sentence before "As" (F5).
    for text, noun in (("_As Globex, we can help._", "As Globex"), ("_As Google grows, prices rise._", "As Google"),
                       ("~As Globex, we can help.~", "As Globex"), ("Hey team \U0001F44B As Globex, we can help.", "As Globex"),
                       ("Thanks :tada: As Globex, we can help.", "As Globex")):
        expect(f"{text[:40]!r} is denied", send(text), "deny", [noun])
    # The send gate reads the rendered view too, as the draft gate does: backticks and a line break after "As" (DG-4).
    for text in ("As `Globex`, we want every rep to see the export before Thursday.",
                 "Team update for Thursday.\nAs\nGlobex, we want every rep to see the export before Thursday."):
        expect(f"{text[:40]!r}... is denied", send(text), "deny", ["As Globex"])
    expect("the rendered view never turns a heading line into a nudge", send("As Agents Scale, Trust Becomes the Bottleneck\n\nThe memo argues one point."), "pass")
    # A built-in name with an everyday sense: a "!" line in the names file takes it off the list (F4).
    AMAZON = "As Amazon deforestation accelerates, rainfall patterns shift."
    expect("a built-in name blocks whatever follows it (the accepted limit)", send(AMAZON), "deny", ["As Amazon"])
    expect('a "!Amazon" line makes that opener silent', send(AMAZON), "pass", names="!Amazon\n")
    expect('a "!Amazon" line does not excuse company voice', send("As Amazon, we ship on Fridays."), "deny", ["As Amazon"], names="!Amazon\n")
    # The names file follows CLAUDE_CONFIG_DIR, where getting-started puts it (installer F4).
    expect("the names file under CLAUDE_CONFIG_DIR is read", send("As Initech grows, the queue grows."), "deny", ["As Initech"],
           names="Initech\n", config_dir="cfg")
    # A names-file line longer than four words can never match; it is skipped with a note (installer F7).
    expect("a five-word names line is skipped with a note", send(CLEAN_SEND), "context", ["longer than four words"],
           names="Alpha Beta Gamma Delta Epsilon\nInitech\n")
    expect("the other names in that file still block", send("As Initech grows, the queue grows."), "deny", ["As Initech", "longer than four words"],
           names="Alpha Beta Gamma Delta Epsilon\nInitech\n")
    # Derivations the first forms pass missed (F7).
    for form in ("synergistically", "seamlessness", "lower-hanging fruit", "lowest-hanging fruit", "lower hanging fruit", "lowest hanging fruit"):
        expect(f'"{form}" in a send is denied', send(f"The {form} plan lands Thursday, and Sam owns it."), "deny", [f'"{form}"'])
    # Messages name no private file: no CLAUDE.md or rules/ path in what the user or the model sees (installer F3).
    got, msg, _ = expect("a deny names no private file", send("Our seamless rollout lands Thursday."), "deny", ['"seamless"'])
    case("the deny message has no CLAUDE.md or rules/ reference", "CLAUDE.md" not in msg and "rules/" not in msg, msg[:200])
    got, msg, _ = expect("a write nudge names no private file", write(CLEAN_FILE + " Our seamless rollout lands Thursday."), "context", ['"seamless"'])
    case("the write message has no CLAUDE.md or rules/ reference", "CLAUDE.md" not in msg and "rules/" not in msg, msg[:200])

    print("\nD10: review of the hook holes: an abbreviated legal suffix, and the documented limits (2026-10-03)")
    # N1: a suffix written with its period ("Inc.", "Corp.", "Co.") belongs to the name, so company voice after it blocks.
    for text, noun in (("As Globex Inc., we ship on Fridays.", "As Globex Inc"), ("As Globex Corp., we ship on Fridays.", "As Globex Corp"),
                       ("As Acme Co., our team ships on Fridays.", "As Acme Co"), ("As Acme Co. our team ships on Fridays.", "As Acme Co"),
                       ("As Globex Ltd., we ship on Fridays.", "As Globex Ltd"), ("As Globex LLC. we ship on Fridays.", "As Globex LLC"),
                       ("As Globex Inc. — a widget leader — we can help.", "As Globex Inc"), ("As Initech Corp., I think we can help.", "As Initech Corp")):
        expect(f"company voice {text[:40]!r} is denied", send(text), "deny", [noun])
    # The period still ends a sentence where it does: before a capital, and before the next "As".
    expect('"As Globex Inc. We ship ..." stays a nudge (the period ends the sentence)', send("As Globex Inc. We ship on Fridays."), "context", ["As Globex Inc"])
    expect('"As Globex Inc. grows, ..." stays a nudge (no first person)', send("As Globex Inc. grows, hiring follows."), "context", ["As Globex Inc"])
    expect('"As Globex Inc., the plan holds." stays a nudge', send("As Globex Inc., the plan holds."), "context", ["As Globex Inc"])
    expect('"... Acme Inc. As Globex, we ..." is still read as a new sentence', send("We bought it from Acme Inc. As Globex, we ship on Fridays."), "deny", ["As Globex"])
    expect('"... Acme Inc. As Dana said, ..." is still attribution', send("We bought it from Acme Inc. As Dana said, the plan holds."), "pass")
    expect("an Inc. suffix in a written file gets a nudge", write(CLEAN_FILE + " As Globex Inc., we care about uptime."), "context", ["As Globex Inc"])
    # N4: Open Gaps item 11 says exactly what these do. The list after "our" reads as an appositive, then "know us" as a
    # citation ("as Globex knows"), so the first is silent; the second is a nudge.
    expect('Open Gaps 11: "As Globex, our customers, partners and employees know us" is silent',
           send("As Globex, our customers, partners and employees know us."), "pass")
    expect('Open Gaps 11: "As Globex, a company of engineers and the people who support them, we ..." is a nudge',
           send("As Globex, a company of engineers and the people who support them, we can help."), "context", ["As Globex"])
    # N2: a listed company blocks any opener, not only company voice; a "!" line takes it off the list.
    expect('a listed company blocks any opener ("As Apple pushed the update, ...")', send("As Apple pushed the update, the build broke."), "deny", ["As Apple"])
    expect('a "!Apple" line makes that opener silent', send("As Apple pushed the update, the build broke."), "pass", names="!Apple\n")
    expect('a "!Apple" line does not excuse company voice', send("As Apple, we pushed the update."), "deny", ["As Apple"], names="!Apple\n")

    # The hook and its tests ship in a public edition: they must pass the docs' public leak check (edition-policy.json's
    # terms and patterns through docs/tools/lib/leak.mjs, identifier-aware), not a hand-kept list of words. Two labels
    # are allowed in the TEST files only (the edition check's labels for an overlay's pinned rule and issue ids). Addresses at the reserved example domains (RFC 2606) are fixtures, not data.
    sources = [HOOK, os.path.join(HERE, "..", "hook", "voice-draft-gate.py"), os.path.join(HERE, "voice-tell-gate.test.py"),
               os.path.join(HERE, "voice-draft-gate.test.py")]
    leak = os.path.join(HERE, "..", "docs", "tools", "lib", "leak.mjs")
    if os.path.exists(leak):
        script = ("import { readFileSync } from 'node:fs'; import { pathToFileURL } from 'node:url';"
                  "const { createChecker } = await import(pathToFileURL(process.argv[1]).href);"
                  "const c = await createChecker({ repo: process.argv[2], allowMissingPrivate: true });"
                  "const files = process.argv.slice(3).map((n) => ({ name: n, text: readFileSync(n, 'utf8') }));"
                  "console.log(JSON.stringify(c.check('public', files)));")
        p = subprocess.run(["node", "--input-type=module", "-e", script, leak, os.path.join(HERE, ".."), *sources],
                           capture_output=True, text=True, timeout=120)
        try:
            findings = json.loads(p.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            findings = None
        case("the public leak check ran on the hook and the tests", findings is not None, (p.stderr or p.stdout)[-300:])
        allowed_in_tests = ("rule C pin", "overlay issue id")
        for src in sources:
            mine = [f for f in (findings or []) if f["file"] == src]
            bad = [f["detail"] for f in mine
                   if not (src.endswith(".test.py") and any(str(f["detail"]).startswith(a) for a in allowed_in_tests))
                   and not re.match(r"email:[^@\s]+@(?:[\w-]+\.)*example\.(?:com|org|net)$", str(f["detail"]), re.I)]
            case(f"{os.path.basename(src)} passes the public leak check", not bad, f"found {bad}")
    else:  # a kit copy without the docs tools: the kit's own leak scan, with your denylist if you keep one
        scrub = os.path.join(HERE, "..", "..", "guards", "scrub.mjs")
        if os.path.exists(scrub):
            deny = os.environ.get("SCRUB_DENYLIST") or os.path.join(HERE, "..", "..", "guards", "denylist.local.json")
            script = ("import { readFileSync } from 'node:fs'; import { pathToFileURL } from 'node:url';"
                      "const s = await import(pathToFileURL(process.argv[1]).href);"
                      "const d = s.loadDenylist(process.argv[2]);"
                      "console.log(JSON.stringify(process.argv.slice(3).map((n) => [n, s.scanText(readFileSync(n, 'utf8'), { ...d, tier: 'anyone' })])));")
            p = subprocess.run(["node", "--input-type=module", "-e", script, scrub, deny, *sources],
                               capture_output=True, text=True, timeout=120)
            try:
                found = dict(json.loads(p.stdout.strip().splitlines()[-1]))
            except (ValueError, IndexError):
                found = None
            case("the kit's leak scan ran on the hook and the tests", found is not None, (p.stderr or p.stdout)[-300:])
            for src in sources:
                bad = [h for h in (found or {}).get(src, [])
                       if not re.match(r"email:[^@\s]+@(?:[\w-]+\.)*example\.(?:com|org|net)$", h, re.I)]
                case(f"{os.path.basename(src)} passes the kit's leak scan", not bad, f"found {bad}")

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
