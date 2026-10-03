#!/usr/bin/env python3
"""Tests for the draft gate, hook/voice-draft-gate.py in the tools folder (added 2026-10-02).

Run:   python3 ~/.claude/tools/hook-tests/voice-draft-gate.test.py          exit 0 = pass (tests hook/voice-draft-gate.py)
       VOICE_DRAFT_HOOK=~/.claude/hooks/scripts/voice-draft-gate.py ...     test the installed copy, or any other copy
       VOICE_TOOLS=/path/to/tools  ...                                      build the scorer from another tools folder

The draft gate is a Stop hook. When Claude's reply ends, it finds the drafts in that reply (a ```draft fence, or the
blockquote or fence after a "Written for:" line), scores only those with the send hook's analyze(), and blocks the stop
on a hard tell or shows the user a note on a soft one. Every case runs the hook the way Claude Code does (python3 <hook>,
the Stop JSON on stdin) against a synthetic transcript built in a temp dir, and reads the decision from stdout. The
scorer is the real aiscore.mjs and text-normalize.mjs of a temporary engine copy (the blank overlay with one critical
TEAM_PHRASES entry, TELL_PHRASE), or a broken stand-in. Local only, no network; every text
here is synthetic.

What it holds the hook to:
  F   a hard tell in a draft blocks the stop and the reason says what to cut and the verbatim exception; a soft tell
      allows the stop with a note for the user.
  S   only drafts are scored: a banned word quoted in prose, a clean draft, a "Written for:" line with the piece in a
      file, an example fence inside another fence, and drafts in earlier turns are all left alone.
  L   at most 2 blocks per turn; the third stop is allowed with a note that the draft is still flagged.
  X   any failure (transcript, scorer, normalizer, the send gate, the hook's own input or code) allows the stop with a
      "draft not checked" note. Never a silent pass, never a trapped session.
  M   the reply is all assistant text after the last real prompt or Stop-hook feedback, across tool calls, and the
      last_assistant_message field covers a transcript that hasn't caught up.
  P   a 200 KB reply and a 20 MB transcript finish well under 10 s.
  R1-R8  (added 2026-10-02, after the adversarial review) each case is named for the finding it holds: mid-turn user
      records, drafts as Markdown renders them, the spellings people use, one piece per "Written for:", the user's own
      words, no noise and no silent skips, a count that never goes down, and timeouts, writes and odd send gates.
  R9  (review of the redesign, 2026-10-02) the names-file warning reaches every draft-gate message, and the draft gate
      and the send gate decide the same on the backtick and line-break opener shapes.
  R10 (review of the hook holes, 2026-10-03) "As Globex Inc., we ..." and "As Acme Co. our ..." block a draft, as they
      block a send.
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
HOOK = os.path.abspath(os.path.expanduser(os.environ.get("VOICE_DRAFT_HOOK") or os.path.join(HERE, "..", "hook", "voice-draft-gate.py")))
SEND_GATE = os.path.join(TOOLS, "hook", "voice-tell-gate.py")
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
NOT_CHECKED = "draft not checked"
STILL = "still flagged"
VERBATIM = "verbatim"

TMP = tempfile.mkdtemp(prefix="draft-gate-test-")
F3 = "`" * 3

CLEAN = "Thanks for the notes. I moved the review to Thursday at ten, after the quarter-end numbers land."
SEAMLESS = "Quick update: the rollout was seamless and the new scheduler lands Thursday."
WORTH = "It's worth noting the export job now runs at six, so the finance report is ready before standup."
LEVERAGE = "We can leverage the existing export job for this and skip the new pipeline."
HONEST = "We moved the scheduler on Monday. So " + TELL_PHRASE + ": nobody owned the job."


def fence(body, info="draft"):
    return f"{F3}{info}\n{body}\n{F3}"


def quote(body):
    return "\n".join("> " + ln for ln in body.splitlines())


# ── synthetic transcript records (the shapes Claude Code 2.1.286 writes; see the hook header) ──────────────────────
_n = [0]


def _uuid():
    _n[0] += 1
    return f"00000000-0000-0000-0000-{_n[0]:012d}"


def prompt(text):
    return {"type": "user", "isSidechain": False, "promptId": "p-" + _uuid(), "uuid": _uuid(), "promptSource": "sdk",
            "message": {"role": "user", "content": text}}


def say(text):
    return {"type": "assistant", "isSidechain": False, "uuid": _uuid(),
            "message": {"role": "assistant", "content": [{"type": "text", "text": text}]}}


def think():
    return {"type": "assistant", "uuid": _uuid(), "message": {"role": "assistant", "content": [{"type": "thinking", "thinking": ""}]}}


_last_tool = ["t1"]


def tool_call(name="Bash"):
    _last_tool[0] = "t" + _uuid()
    return {"type": "assistant", "uuid": _uuid(),
            "message": {"role": "assistant", "content": [{"type": "tool_use", "id": _last_tool[0], "name": name, "input": {}}]}}


def tool_result(text="ok", tool_id=None):
    """The result of the most recent tool_call() (or of tool_id)."""
    return {"type": "user", "uuid": _uuid(), "toolUseResult": {"stdout": text},
            "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tool_id or _last_tool[0], "content": text}]}}


def injected(text, kind):
    """A user record Claude Code writes mid-turn: a background task-notification (a string) or a message the user typed
    while Claude was working (origin human, a text block)."""
    content = text if kind == "task-notification" else [{"type": "text", "text": text}]
    return {"type": "user", "uuid": _uuid(), "promptId": "p-" + _uuid(), "origin": {"kind": kind},
            "message": {"role": "user", "content": content}}


def stop_feedback(text="voice draft gate feedback"):
    return {"type": "user", "isMeta": True, "uuid": _uuid(), "message": {"role": "user", "content": "Stop hook feedback:\n" + text}}


def noise():
    return {"type": "attachment", "uuid": _uuid()}


def stop_summary():
    """The system record Claude Code writes after its Stop hooks ran (the end of a stop)."""
    return {"type": "system", "subtype": "stop_hook_summary", "uuid": _uuid()}


def transcript(records):
    fd, path = tempfile.mkstemp(dir=TMP, suffix=".jsonl")
    with os.fdopen(fd, "w") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")
    return path


def stop_input(records=None, path=None, last=None, active=False, session="s-1", prompt_id="p-1"):
    tp = path if path is not None else transcript(records or [])
    d = {"session_id": session, "transcript_path": tp, "cwd": TMP, "prompt_id": prompt_id, "permission_mode": "default",
         "hook_event_name": "Stop", "stop_hook_active": active, "background_tasks": [], "session_crons": []}
    if last is not None:
        d["last_assistant_message"] = last
    return d


def last_text(records):
    for r in reversed(records):
        if r.get("type") == "assistant":
            c = r["message"]["content"]
            t = [b.get("text", "") for b in c if b.get("type") == "text"]
            if t:
                return "\n".join(t)
    return None


def write_file(dirpath, name, src):
    p = os.path.join(dirpath, name)
    with open(p, "w") as f:
        f.write(src)
    return p


STATE = os.path.join(TMP, "state")


def run_hook(payload, scorer=REAL_AISCORE, normalizer=REAL_NORMALIZE, send_gate=SEND_GATE, state=STATE, raw_stdin=None,
             wrapper=None, timeout=120, scorer_timeout="3", hook=None, names_env=None):
    home = tempfile.mkdtemp(dir=TMP)
    sdir = tempfile.mkdtemp(dir=TMP)
    if scorer is not None and not os.path.exists(scorer):
        scorer = write_file(sdir, "aiscore.mjs", scorer)
    if normalizer is not None and not os.path.exists(normalizer):
        normalizer = write_file(sdir, "text-normalize.mjs", normalizer)
    env = dict(os.environ, HOME=home, VOICE_AISCORE=scorer or os.path.join(sdir, "missing.mjs"),
               VOICE_NORMALIZE=normalizer or os.path.join(sdir, "missing.mjs"), VOICE_SCORER_TIMEOUT=scorer_timeout or "",
               VOICE_TELL_GATE=send_gate, VOICE_DRAFT_STATE_DIR=state)
    if scorer_timeout is None:
        env.pop("VOICE_SCORER_TIMEOUT", None)
    env.pop("VOICE_COMPANY_NAMES", None)  # the caller's own names file never leaks into a case
    env.pop("CLAUDE_CONFIG_DIR", None)
    if names_env is not None:
        env["VOICE_COMPANY_NAMES"] = names_env
    hook = hook or HOOK
    argv = [sys.executable, "-c", wrapper, hook] if wrapper else [sys.executable, hook]
    data = raw_stdin if raw_stdin is not None else json.dumps(payload)
    t0 = time.time()
    try:
        p = subprocess.run(argv, input=data, capture_output=True, text=True, env=env, timeout=timeout)
    except subprocess.TimeoutExpired:
        return -9, "", f"the hook ran past the test's {timeout} s timeout", time.time() - t0
    return p.returncode, p.stdout, p.stderr, time.time() - t0


def decision(stdout):
    """('pass'|'block'|'note'|'other', reason, systemMessage) from the hook's stdout."""
    out = stdout.strip()
    if not out:
        return "pass", "", ""
    try:
        h = json.loads(out.splitlines()[-1])
    except ValueError:
        return "other", out, ""
    if not isinstance(h, dict):
        return "other", out, ""
    sm = h.get("systemMessage", "") or ""
    if h.get("decision") == "block":
        return "block", h.get("reason", ""), sm
    if sm and set(h) <= {"systemMessage", "suppressOutput"}:
        return "note", "", sm
    return "other", out, sm


RESULTS = []


def case(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(("  ok   " if ok else "  FAIL ") + name + ("" if ok else f"   [{detail}]"), flush=True)


def expect(name, payload, want, reason_has=(), note_has=(), note_lacks=(), max_secs=None, **kw):
    rc, out, err, secs = run_hook(payload, **kw)
    got, reason, note = decision(out)
    ok = (got == want and rc == 0 and all(c in reason for c in reason_has) and all(c in note for c in note_has)
          and not any(c in note for c in note_lacks) and (max_secs is None or secs < max_secs))
    detail = f"rc={rc} got={got} {secs:.2f}s reason={reason[:200]!r} note={note[:200]!r} err={err.strip()[-200:]!r}"
    case(name, ok, detail)
    return got, reason, note


def turn(*reply, before=()):
    """A transcript: optional earlier records, a real prompt, then the reply records."""
    return list(before) + [prompt("synthetic prompt"), noise()] + list(reply)


def loop(name, steps, state, session="s-loop", prompt_id="p-loop", first=None):
    """Drive one turn through several stops: stop 1 not active, then a Stop-hook feedback record and the next reply
    before each later stop. steps = the reply text for each stop. Returns the decisions and the reasons/notes."""
    recs = list(first or turn())
    got, texts = [], []
    for k, reply in enumerate(steps):
        if k:
            recs.append(stop_feedback())
        recs.append(say(reply))
        pl = stop_input(recs, last=reply, active=k > 0, session=session, prompt_id=prompt_id)
        rc, out, err, _ = run_hook(pl, state=state)
        d, reason, note = decision(out)
        got.append({"block": "B", "note": "A", "pass": "A"}.get(d, "?") if rc == 0 else f"rc{rc}")
        texts.append(reason or note)
    return "".join(got), texts


def review_cases(fresh):
    """Each case names the finding of the 2026-10-02 review it holds (F = evasion, FB = false blocks, LOOP/PERF/WRITE/
    FAIL = loop guard, speed, writes, failures)."""
    print("\nR1: user records that arrive mid-turn don't end the turn (F1)")
    notif = "<task-notification>\n<task-id>x</task-id>\n<status>completed</status>\n</task-notification>"
    recs = turn(say("Draft:\n\n" + fence(SEAMLESS)), tool_call(), injected(notif, "task-notification"), tool_result(), say("Done."))
    expect("F1 a task-notification between a tool call and its result: the draft before it still blocks",
           stop_input(recs, last="Done."), "block", reason_has=['"seamless"'], state=fresh())
    recs = turn(say("Draft:\n\n" + fence(SEAMLESS)), tool_call(), injected("also check the tests", "human"), tool_result(),
                say("Tests pass."))
    expect("F1 a message the user typed mid-tool-call: the draft before it still blocks", stop_input(recs, last="Tests pass."),
           "block", reason_has=['"seamless"'], state=fresh())
    recs = turn(say("Draft:\n\n" + fence(SEAMLESS)), tool_call(), tool_result(), injected("also check the tests", "human"),
                say("Tests pass."))
    expect("F1 a message the user typed, written after a tool result: the draft before it still blocks",
           stop_input(recs, last="Tests pass."), "block", reason_has=['"seamless"'], state=fresh())
    recs = turn(say("Draft:\n\n" + fence(SEAMLESS)), injected(notif, "task-notification"), say("The background job finished."))
    expect("F1 control: a task-notification that starts a new turn after a finished reply leaves the old draft alone",
           stop_input(recs, last="The background job finished."), "pass", state=fresh())
    recs = turn(say("Draft:\n\n" + fence(SEAMLESS)), tool_call(), tool_result("[Request interrupted by user for tool use]"),
                prompt("never mind, different question"), say("Sure."))
    expect("F1 control: the prompt after an interrupted tool call starts a new turn", stop_input(recs, last="Sure."), "pass",
           state=fresh())
    recs = turn(say("Draft:\n\n" + fence(SEAMLESS)), tool_call(), tool_result(), stop_summary(),
                injected("next question", "human"), say("Sure."))
    expect("F1 control: a turn that ended after a tool result (stop_hook_summary) is not part of the next one",
           stop_input(recs, last="Sure."), "pass", state=fresh())
    recs = turn(say("Draft:\n\n" + fence(SEAMLESS)), tool_call(), injected("also check the tests", "human"), tool_result(),
                say("Tests pass."))
    _, _, _ = expect("F1 no prompt_id in the input: the turn still starts at the real prompt (blocks once, as 1 of 2)",
                     dict(stop_input(recs, last="Tests pass."), prompt_id=None), "block", reason_has=["block 1 of 2"], state=fresh())

    print("\nR2: what Markdown renders as one piece is scored as one (F2, F4, F5, F7, F8)")
    recs = turn(say("Written for: Jane\n\n> Honestly this is\n> table\n> stakes for us.\n"))
    expect("F2 a banned phrase split across blockquote lines blocks", stop_input(recs, last=last_text(recs)), "block",
           reason_has=["table stakes"], state=fresh())
    recs = turn(say("Written for: Jane\n\n> we can move the\n> needle here.\n"))
    expect('F2 "move the / needle" across quote lines blocks', stop_input(recs, last=last_text(recs)), "block",
           reason_has=["move the needle"], state=fresh())
    recs = turn(say(fence("This is table\nstakes for us.")))
    expect("F2 a banned phrase split across lines in a draft fence blocks", stop_input(recs, last=last_text(recs)), "block",
           reason_has=["table stakes"], state=fresh())
    recs = turn(say("Written for: Jane\n\n> Hi team, the cutover was\nseamless and on time.\n"))
    expect("F4 a lazy continuation line of a blockquote is part of the quote", stop_input(recs, last=last_text(recs)), "block",
           reason_has=['"seamless"'], state=fresh())
    recs = turn(say("Written for: Jane\n\n> Hi team, the cutover was done.\n\nIt was seamless, I think.\n"))
    expect("F4 control: a line after a blank line is not part of the quote", stop_input(recs, last=last_text(recs)), "pass",
           state=fresh())
    recs = turn(say("> " + F3 + "draft\n> Hi team, the cutover was seamless and on time.\n> " + F3 + "\n"))
    expect("F5 a draft fence inside a blockquote blocks", stop_input(recs, last=last_text(recs)), "block",
           reason_has=['"seamless"'], state=fresh())
    recs = turn(say("- Options:\n  - Slack:\n      " + F3 + "draft\n      Hi team, the cutover was seamless.\n      " + F3 + "\n"))
    expect("F5 a draft fence indented 6 spaces in a nested list blocks", stop_input(recs, last=last_text(recs)), "block",
           reason_has=['"seamless"'], state=fresh())
    recs = turn(say(F3 + "markdown\n> " + F3 + "draft\n> the cutover was seamless\n> " + F3 + "\n" + F3 + "\n"))
    expect("F5 control: a quoted draft fence shown inside a markdown fence is an example", stop_input(recs, last=last_text(recs)),
           "pass", state=fresh())
    recs = turn(say(F3 + "bash\nls -la"), tool_call(), tool_result(), say(fence(SEAMLESS)))
    expect("F7 an unclosed fence in an earlier text block doesn't swallow a later draft", stop_input(recs, last=last_text(recs)),
           "block", reason_has=['"seamless"'], state=fresh())
    recs = turn(say(fence("Hi team,\u2028" + F3 + "\u2028the cutover was seamless.")))
    expect("F8 a U+2028 line separator doesn't close a draft fence", stop_input(recs, last=last_text(recs)), "block",
           reason_has=['"seamless"'], state=fresh())
    recs = turn(say(fence("Hi team,\x1c" + F3 + "\x1cthe cutover was seamless.")))
    expect("F8 a \\x1c separator doesn't close a draft fence", stop_input(recs, last=last_text(recs)), "block",
           reason_has=['"seamless"'], state=fresh())
    recs = turn(say("Written for: Jane\n\n> the cutover was sea`m`less\n"))
    expect("F9b inline code inside a word in a quote doesn't hide it", stop_input(recs, last=last_text(recs)), "block",
           reason_has=['"seamless"'], state=fresh())

    print("\nR3: the spellings people use are found (F3, F6) and look-alikes aren't (FB5)")
    for name, head in (("**Written for**:", "**Written for**: Jane, Slack DM"), ("### heading", "### Written for: Jane"),
                       ("a bullet", "- Written for: Jane (Slack)")):
        recs = turn(say(head + "\n\n" + quote(SEAMLESS) + "\n"))
        expect(f'F3 a "Written for" line as {name} is found', stop_input(recs, last=last_text(recs)), "block",
               reason_has=['"seamless"'], state=fresh())
    for info in ("draft_email", "drafts", "text draft", "draft-email", "draft:"):
        recs = turn(say(fence(SEAMLESS, info=info)))
        expect(f'F6 a ```{info} fence is a draft', stop_input(recs, last=last_text(recs)), "block", reason_has=['"seamless"'],
               state=fresh())
    for info, body in (("draft.js", "const editor = 'seamless';"), ("draft-gate.test", "case: seamless -> block")):
        recs = turn(say(fence(body, info=info)))
        expect(f"FB5 a ```{info} fence is code, not a draft", stop_input(recs, last=last_text(recs)), "pass", state=fresh())

    print("\nR4: the \"Written for:\" fallback scores one piece, never the material around it (FB1, FB2, FB3)")
    recs = turn(say("Written for: Dana (Slack reply in thread)\n\nDana asked:\n> can we make the handoff to support seamless "
                    "before Q4?\n\n" + fence("Yes, if support gets the runbook by the 15th. I'll send it Monday.", "draft slack")))
    expect("FB1 the message being replied to, quoted before a clean draft fence, is left alone",
           stop_input(recs, last=last_text(recs)), "pass", state=fresh())
    recs = turn(say("Written for: Sam (email)\n\n" + fence(CLEAN) + "\n\nWhat changed:\n\n" +
                    fence("- The migration was seamless.\n+ The migration finished in two hours.", "diff")))
    expect("FB1 a diff fence after a clean draft fence is left alone", stop_input(recs, last=last_text(recs)), "pass", state=fresh())
    recs = turn(say("Written for: Sam (Slack)\n\n" + quote(CLEAN) + "\n\n" + fence('{"cut": ["seamless", "synergy"]}', "json")))
    expect("FB1 a json fence after a clean blockquote draft is left alone", stop_input(recs, last=last_text(recs)), "pass",
           state=fresh())
    recs = turn(say("Written for: Sam (email)\n\nYour original line:\n> The rollout was seamless.\n\nRevised:\n\n" +
                    fence("The rollout finished Tuesday with zero rollbacks.", "draft email")))
    expect("FB1 the user's original line quoted before a clean draft fence is left alone",
           stop_input(recs, last=last_text(recs)), "pass", state=fresh())
    recs = turn(say("Written for: Priya (email)\n\nSaved to drafts/2026-10-02-priya.md. What changed:\n\n" +
                    fence("- The migration was seamless and best-in-class.\n+ The migration finished in two hours.", "diff")))
    expect("FB2 a diff fence after a file hand-off is left alone", stop_input(recs, last=last_text(recs)), "pass", state=fresh())
    recs = turn(say("Written for: Priya (email)\n\nThe file gate first flagged two words, which I cut:\n\n" +
                    fence('  • [hard-ban] "seamless"\n  • [hard-ban] "synergy"', "text")))
    expect("FB2 gate output in a ```text fence after a hand-off is left alone", stop_input(recs, last=last_text(recs)), "pass",
           state=fresh())
    log = "\n".join(f"line {i}: we leverage a robust retry" for i in range(12))
    recs = turn(say("Written for: Priya (email), saved to drafts/2026-10-02-priya.md.\n\nThe run log:\n\n" + fence(log, "text")))
    expect("FB2 a long log fence after a file hand-off: no note", stop_input(recs, last=last_text(recs)), "pass", state=fresh())
    recs = turn(say("Written for: VP Sales (email), saved to drafts/2026-10-02-vp.md; the file check passed.\n\n"
                    "You flagged this line last time:\n\n> We'll move the needle with a seamless handoff.\n\n"
                    "I replaced it with the actual dates."))
    expect("FB3 the user's earlier feedback quoted after a file hand-off is left alone", stop_input(recs, last=last_text(recs)),
           "pass", state=fresh())

    print("\nR5: the user's own words, relayed as-is, aren't fought over (FB4)")
    mine = "Our cutover was seamless, and the team hit every date."
    recs = [prompt(f"Post this to #eng exactly as written: {mine}"), noise(),
            say("Written for: #eng (Slack post), your words as-is:\n\n" + fence(mine, "draft slack"))]
    _, _, note = expect("FB4a a draft that repeats the user's own sentence is allowed with a note, not blocked",
                        stop_input(recs, last=last_text(recs)), "note", note_has=["seamless", "your own words"], state=fresh())
    recs = [prompt('Write a Slack note to Sam. Describe the migration as "seamless".'), noise(),
            say(fence("Hey Sam, the migration finished Monday and the cutover was seamless."))]
    expect("FB4a control: the user only naming the word doesn't make Claude's sentence theirs",
           stop_input(recs, last=last_text(recs)), "block", reason_has=['"seamless"'], state=fresh())
    st = fresh()
    same = "The gate flagged it, but here it is unchanged:\n\n" + fence(SEAMLESS)
    got, texts = loop("FB4b", ["Draft:\n\n" + fence(SEAMLESS), same, same], st, prompt_id="p-same")
    case("FB4b the same draft shown again after a block is allowed with a note, not blocked a second time", got == "BAA" and
         "same draft" in texts[1], f"got={got} texts={[t[:120] for t in texts]}")
    case("FB4c the block reason says the gate won't block an unchanged relay twice, and the user line doesn't claim a revision",
         "won't block" in texts[0], f"reason={texts[0][:400]!r}")
    _, _, note = expect("FB4c the user's line says Claude will fix it or ask", stop_input(turn(say(fence(SEAMLESS))), last=fence(SEAMLESS)),
                        "block", state=fresh())
    case("  ...the user line reads 'fix it, or ask you'", "or ask you" in note and "is revising" not in note, f"note={note!r}")

    print("\nR6: no noise when nothing was missed (FB6); visible when something might have been (FAIL-1)")
    st = fresh()
    pl = stop_input(path=os.path.join(TMP, "nope.jsonl"), last="Done. The test passes.", session="s-fb6")
    expect("FB6 an unreadable transcript with an ordinary last message: one note", pl, "note", note_has=[NOT_CHECKED], state=st)
    expect("FB6 ...and silence after that in the same session", pl, "pass", state=st)
    empty = transcript([])
    expect("FB6 an empty transcript with an ordinary last message (new session): one note",
           stop_input(path=empty, last="Done.", session="s-fb6b"), "note", note_has=[NOT_CHECKED], state=st)
    recs = turn(say("Draft:\n\n" + fence(SEAMLESS)))
    tp = transcript(recs[:-1])
    with open(tp, "a") as f:
        f.write(json.dumps(recs[-1])[:-10])
    expect("FAIL-1 a truncated draft record and no last_assistant_message: a note, not silence", stop_input(path=tp), "note",
           note_has=[NOT_CHECKED, "couldn't be read"], state=fresh())
    tp = transcript(recs[:-1])
    with open(tp, "ab") as f:
        f.write(json.dumps(recs[-1]).replace("seamless", "seamless \\u00e9").encode().replace(b"\\u00e9", b"\xff") + b"\n")
    expect("FAIL-1 a draft record with an invalid UTF-8 byte is still read and scored", stop_input(path=tp), "block",
           reason_has=['"seamless"'], state=fresh())

    print("\nR7: the loop guard never lets the count go back down in a turn (LOOP-1, LOOP-2)")
    got, _ = loop("L1", ["Draft:\n\n" + fence(SEAMLESS + f" v{i}") for i in range(7)], fresh(), prompt_id="p-l1")
    case("LOOP-1 seven stops in one turn with a flagged draft each time: block, block, then allowed every time",
         got == "BBAAAAA", f"got={got}")
    got, _ = loop("L1c", ["Draft:\n\n" + fence(SEAMLESS), "Draft:\n\n" + fence(CLEAN), "Draft:\n\n" + fence(SEAMLESS + " again"),
                          "Draft:\n\n" + fence(SEAMLESS + " once more")], fresh(), prompt_id="p-l1c")
    case("LOOP-1 a clean stop in between doesn't reset the count: 2 blocks per turn in total", got == "BABA", f"got={got}")
    got, texts = loop("L2", ["Draft:\n\n" + fence(SEAMLESS + f" v{i}") for i in range(5)], fresh(), prompt_id=None)
    nums = [t.split("block ", 1)[1][:6] if "VOICE DRAFT GATE (block" in t else "allow" for t in texts]
    case("LOOP-2 no prompt_id in the input: block 1 of 2, block 2 of 2, then allowed", got == "BBAAA" and
         nums[:2] == ["1 of 2", "2 of 2"], f"got={got} nums={nums}")

    print("\nR8: timeouts, writes and odd send gates (PERF-1, WRITE-1, WRITE-2, FAIL-2, PERF-2)")
    recs = turn(say("Draft:\n\n" + fence(SEAMLESS)))
    hang = "setTimeout(() => {}, 600000);"
    expect("PERF-1 scorer and normalizer both hang, default timeouts: allowed in under 10 s", stop_input(recs, last=last_text(recs)),
           "note", note_has=[NOT_CHECKED], scorer=hang, normalizer=hang, scorer_timeout=None, max_secs=10, state=fresh())
    cp = tempfile.mkdtemp(dir=TMP)
    shutil.copy(HOOK, os.path.join(cp, "voice-draft-gate.py"))
    shutil.copy(SEND_GATE, os.path.join(cp, "voice-tell-gate.py"))
    run_hook(stop_input(recs, last=last_text(recs)), hook=os.path.join(cp, "voice-draft-gate.py"),
             send_gate=os.path.join(cp, "voice-tell-gate.py"), state=fresh())
    case("WRITE-1 loading the send gate writes no __pycache__ next to the hooks", sorted(os.listdir(cp)) ==
         ["voice-draft-gate.py", "voice-tell-gate.py"], str(sorted(os.listdir(cp))))
    shared = tempfile.mkdtemp(dir=TMP)
    foreign = write_file(shared, "someone-elses-notes.txt", "keep me")
    stale = write_file(shared, "0" * 32 + ".json", "{}")
    old = time.time() - 8 * 86400
    os.utime(foreign, (old, old))
    os.utime(stale, (old, old))
    run_hook(stop_input(recs, last=last_text(recs), session="s-shared"), state=shared)
    case("WRITE-2 the state cleanup leaves other files in a shared dir alone", os.path.exists(foreign), str(os.listdir(shared)))
    case("WRITE-2 ...and still drops its own week-old state files", not os.path.exists(stale), str(os.listdir(shared)))
    gates = tempfile.mkdtemp(dir=TMP)
    exit_import = write_file(gates, "exit-import.py", "import sys\nsys.exit(2)\n")
    exit_analyze = write_file(gates, "exit-analyze.py", "import sys\ndef analyze(t):\n    sys.exit(2)\ndef bullets(i, cap=6):\n    return ''\n"
                              "def lexicon(t):\n    return [], []\n")
    noisy = write_file(gates, "noisy.py", 'import json, runpy, sys\nprint(json.dumps({"decision": "block", "reason": "x"}))\n'
                       f"globals().update(runpy.run_path({SEND_GATE!r}))\n")
    for name, g in (("exits at import", exit_import), ("exits inside analyze()", exit_analyze)):
        expect(f"FAIL-2 a send gate that {name}: exit 0, allowed, with a note", stop_input(recs, last=last_text(recs)), "note",
               note_has=[NOT_CHECKED], send_gate=g, state=fresh())
    rc, out, err, _ = run_hook(stop_input(recs, last=last_text(recs)), send_gate=noisy, state=fresh())
    lines = [ln for ln in out.splitlines() if ln.strip()]
    case("FAIL-2 a send gate that prints to stdout can't add a second decision to the hook's output",
         rc == 0 and len(lines) == 1 and decision(out)[0] == "block", f"rc={rc} out={out[:300]!r}")
    big = transcript(turn(tool_call(), tool_result("x" * 20_000_000), say("Draft:\n\n" + fence(SEAMLESS))))
    small_chunks = ("import importlib.machinery, importlib.util, sys\nsys.dont_write_bytecode = True\n"
                    "loader = importlib.machinery.SourceFileLoader('vdg', sys.argv[1])\n"
                    "spec = importlib.util.spec_from_loader('vdg', loader); m = importlib.util.module_from_spec(spec)\n"
                    "loader.exec_module(m)\nm.CHUNK = 16384\nm.main()\n")
    expect("PERF-2 a 20 MB single record read in 16 KB chunks stays linear (under 10 s)", stop_input(path=big), "block",
           reason_has=['"seamless"'], wrapper=small_chunks, max_secs=10, timeout=60, state=fresh())

    print("\nR9: the draft gate and the send gate agree, names-file warnings included (DG-3, DG-4)")
    names_dir = tempfile.mkdtemp(dir=TMP)
    readable = write_file(names_dir, "names.txt", "Initech\n")
    INITECH = "As Initech rolls out the new API, the export job needs a small fix before Thursday."
    recs = turn(say("Draft:\n\n" + fence(INITECH)))
    expect("DG-3 a name from a readable names file blocks the draft", stop_input(recs, last=last_text(recs)), "block",
           reason_has=["As Initech"], names_env=readable, state=fresh())
    unreadable = os.path.join(names_dir, "a-directory")
    os.makedirs(unreadable)
    expect("DG-3 an unreadable names file: the draft is allowed with the names-file warning", stop_input(recs, last=last_text(recs)),
           "note", note_has=["As Initech", "company-names file"], names_env=unreadable, state=fresh())
    recs = turn(say("Draft:\n\n" + fence(CLEAN)))
    expect("DG-3 a clean draft still shows the names-file warning", stop_input(recs, last=last_text(recs)), "note",
           note_has=["company-names file"], names_env=unreadable, state=fresh())
    expect("DG-3 a clean draft with a readable names file shows nothing", stop_input(recs, last=last_text(recs)), "pass",
           names_env=readable, state=fresh())
    recs = turn(say("Draft:\n\n" + fence("Our seamless rollout lands Thursday.")))
    got, reason, note = expect("DG-3 a block with an unreadable names file carries the warning", stop_input(recs, last=last_text(recs)),
                               "block", reason_has=['"seamless"', "company-names file"], note_has=["company-names file"],
                               names_env=unreadable, state=fresh())
    case("the block reason names no private file", "rules/" not in reason and "CLAUDE.md" not in reason, reason[:200])
    gate = load_gate()
    for text in ("As `Globex`, we want every rep to see the export before Thursday.",
                 "Team update for Thursday.\nAs\nGlobex, we want every rep to see the export before Thursday.",
                 "As Agents Scale, Trust Becomes the Bottleneck\n\nThe memo argues one point."):
        recs = turn(say("Draft:\n\n" + fence(text)))
        want = "block" if gate_blocks(gate, text) else ("note" if gate_flags(gate, text) else "pass")
        expect(f"DG-4 {text[:40]!r}: the draft gate decides as the send gate does ({want})",
               stop_input(recs, last=last_text(recs)), want, state=fresh())
        case(f"DG-4 {text[:40]!r}: the send gate's word list blocks the backtick and line-break shapes",
             gate_blocks(gate, text) == ("Agents" not in text), str(gate.lexicon(gate.flat_view(text), opener_kinds=("block",))[0]))

    print("\nR10: an abbreviated legal suffix with its period blocks a draft as it blocks a send (review of the hook holes, N1)")
    for text in ("As Globex Inc., we want every rep to see the export before Thursday.",
                 "As Acme Co. our team wants every rep to see the export before Thursday."):
        recs = turn(say("Draft:\n\n" + fence(text)))
        expect(f"N1 {text[:34]!r}... blocks the draft", stop_input(recs, last=last_text(recs)), "block",
               reason_has=["As "], state=fresh())
        case(f"N1 {text[:34]!r}...: the send gate blocks it too", gate_blocks(gate, text))


def load_gate():
    import importlib.machinery
    import importlib.util
    loader = importlib.machinery.SourceFileLoader("vtg_for_test", SEND_GATE)
    spec = importlib.util.spec_from_loader("vtg_for_test", loader)
    mod = importlib.util.module_from_spec(spec)
    os.environ.pop("VOICE_COMPANY_NAMES", None)
    loader.exec_module(mod)
    return mod


def gate_blocks(gate, text):
    return bool(gate.lexicon(text)[0] or gate.lexicon(gate.flat_view(text), opener_kinds=("block",))[0])


def gate_flags(gate, text):
    return bool(gate.lexicon(text)[1])


def main():
    print(f"hook:      {HOOK}\nsend gate: {SEND_GATE}\ntools:     {TOOLS}\n")
    fresh = lambda: os.path.join(TMP, "state-" + _uuid())

    print("F: a hard tell in a draft blocks; a soft tell is a note for the user")
    recs = turn(say("Here's the Slack update:\n\n" + fence(SEAMLESS) + "\n\nWant me to send it?"))
    _, reason, note = expect('a ```draft fence with "seamless" blocks the stop', stop_input(recs, last=last_text(recs)),
                             "block", reason_has=['"seamless"', VERBATIM, "same reply"], state=fresh())
    case("  ...and the user is told the draft was flagged", "seamless" in note, f"note={note[:160]!r}")
    recs = turn(say("Draft below.\n\n**Written for:** the platform team, Slack channel\n\n" + quote(WORTH) + "\n\nTell me if the tone is off."))
    expect('"Written for:" + a blockquote with "it\'s worth noting" blocks', stop_input(recs, last=last_text(recs)),
           "block", reason_has=["worth noting", VERBATIM], state=fresh())
    recs = turn(say("Email version:\n\n" + fence(SEAMLESS, info="draft email")))
    expect('a "draft email" fence blocks', stop_input(recs, last=last_text(recs)), "block", reason_has=['"seamless"'], state=fresh())
    recs = turn(say("Here it is:\n\n" + fence(SEAMLESS, info="DRAFT slack")))
    expect('an upper-case "DRAFT slack" info string blocks', stop_input(recs, last=last_text(recs)), "block", reason_has=['"seamless"'], state=fresh())
    recs = turn(say("Here it is:\n\n~~~draft\n" + SEAMLESS + "\n~~~"))
    expect("a ~~~draft fence blocks", stop_input(recs, last=last_text(recs)), "block", reason_has=['"seamless"'], state=fresh())
    recs = turn(say("Here it is:\n\n" + fence(HONEST)))
    expect("a critical overlay phrase (the fixture's TEAM_PHRASES entry) in a draft blocks", stop_input(recs, last=last_text(recs)),
           "block", reason_has=[TELL_PHRASE], state=fresh())
    recs = turn(say("Here it is:\n\n" + F3 + "draft\n" + SEAMLESS + "\n"))
    expect("an unclosed draft fence is scored to the end of the reply", stop_input(recs, last=last_text(recs)), "block",
           reason_has=['"seamless"'], state=fresh())
    recs = turn(say("Here it is:\n\n" + fence(LEVERAGE)))
    expect('a draft with only "leverage" is allowed with a note', stop_input(recs, last=last_text(recs)), "note",
           note_has=["leverage"], state=fresh())

    print("\nS: only drafts are scored")
    recs = turn(say('The filter caught "seamless" and "synergy" in your note, and it\'s worth noting both are on the ban list.'))
    expect('a reply that quotes "seamless" in prose is left alone', stop_input(recs, last=last_text(recs)), "pass", state=fresh())
    recs = turn(say("Here's the update:\n\n" + fence(CLEAN)))
    expect("a clean draft fence is left alone", stop_input(recs, last=last_text(recs)), "pass", state=fresh())
    recs = turn(say("**Written for:** the finance leads, email\n\nI saved the email to drafts/2026-10-02-finance-update.md. "
                    "It passed the file check. The old version said seamless; that's gone."))
    expect('a "Written for:" line with the piece in a file is left alone', stop_input(recs, last=last_text(recs)), "pass", state=fresh())
    recs = turn(say("**Written for:** the finance leads\n\nSaved to drafts/x.md.\n\nNotes:\nOne.\nTwo.\nThree.\nFour.\n\n> the old draft said seamless"))
    expect('a blockquote far below a "Written for:" line (past the lead-in limit) is left alone',
           stop_input(recs, last=last_text(recs)), "pass", state=fresh())
    recs = turn(say("The convention looks like this:\n\n" + F3 + "markdown\n" + fence(SEAMLESS) + "\n" + F3 + "\n\nThat's all."))
    expect("an example ```draft fence inside another fence is left alone", stop_input(recs, last=last_text(recs)), "pass", state=fresh())
    recs = turn(say(F3 + "draft" + F3 + " fences are how I mark drafts.\nThe old rollout note said seamless, which is banned."))
    expect("a line that starts with ```draft``` (backticks in the info string) is not a fence", stop_input(recs, last=last_text(recs)),
           "pass", state=fresh())
    recs = turn(say("Inline mention of " + F3 + "draft fences is fine, and so is the word seamless in prose."))
    expect("an inline mention of ```draft (not at a line start) is left alone", stop_input(recs, last=last_text(recs)), "pass", state=fresh())
    earlier = [prompt("first prompt"), say("Draft:\n\n" + fence(SEAMLESS))]
    recs = turn(say("Different topic, no draft here."), before=earlier)
    expect("a flagged draft in an earlier turn is left alone", stop_input(recs, last=last_text(recs)), "pass", state=fresh())
    recs = turn(say("Example:\n\n" + fence("print('seamless')", info="python")))
    expect("a plain code fence (not draft) is left alone", stop_input(recs, last=last_text(recs)), "pass", state=fresh())

    print("\nL: at most 2 blocks per turn, then the stop is allowed with a still-flagged note")
    st = fresh()
    r1 = turn(say("Draft:\n\n" + fence(SEAMLESS)))
    expect("stop 1 with a flagged draft blocks", stop_input(r1, last=last_text(r1), prompt_id="p-loop"), "block", state=st)
    r2 = r1 + [stop_feedback(), say("Revised:\n\n" + fence(SEAMLESS + " Still seamless."))]
    expect("stop 2 (stop_hook_active) still flagged blocks again", stop_input(r2, last=last_text(r2), active=True, prompt_id="p-loop"),
           "block", state=st)
    r3 = r2 + [stop_feedback(), say("Revised again:\n\n" + fence("A seamless handoff, Thursday."))]
    expect("stop 3 is allowed and the user sees the draft is still flagged",
           stop_input(r3, last=last_text(r3), active=True, prompt_id="p-loop"), "note", note_has=[STILL, "seamless"], state=st)
    r4 = r3 + [prompt("next prompt"), say("Draft:\n\n" + fence(SEAMLESS))]
    expect("the next turn starts a fresh count and blocks again", stop_input(r4, last=last_text(r4), prompt_id="p-next"),
           "block", state=st)
    st = fresh()
    r1 = turn(say("Draft:\n\n" + fence(SEAMLESS)))
    expect("(revise case) stop 1 blocks", stop_input(r1, last=last_text(r1), prompt_id="p-rev"), "block", state=st)
    r2 = r1 + [stop_feedback(), say("Revised:\n\n" + fence(CLEAN))]
    expect("a clean revision after a block is allowed (the flagged draft before the feedback isn't rescored)",
           stop_input(r2, last=last_text(r2), active=True, prompt_id="p-rev"), "pass", state=st)
    st = fresh()
    c1 = turn(say("Draft:\n\n" + fence(CLEAN)))
    c2 = c1 + [stop_feedback("another hook asked for a summary"), say("Revised:\n\n" + fence(SEAMLESS)), tool_call("Write"),
               tool_result(), say("Saved it.")]
    expect("after another hook's feedback, a flagged draft before a tool call in the continuation blocks",
           stop_input(c2, last="Saved it.", active=True, prompt_id="p-cont"), "block", reason_has=['"seamless"'], state=st)
    # the feedback record hasn't reached the file yet: the transcript ends at the flagged draft
    expect("a transcript without the feedback record yet: stop_hook_active scores only the last message",
           stop_input(r1, last="Revised:\n\n" + fence(CLEAN), active=True, prompt_id="p-rev2"), "pass", state=fresh())
    ro = tempfile.mkdtemp(dir=TMP)
    os.chmod(ro, 0o500)
    r2 = r1 + [stop_feedback(), say("Revised:\n\n" + fence(SEAMLESS))]
    expect("no usable loop-guard state while continuing: allowed with a still-flagged note",
           stop_input(r2, last=last_text(r2), active=True, prompt_id="p-ro"), "note", note_has=[STILL, "seamless"],
           state=os.path.join(ro, "sub"))
    expect("no usable loop-guard state on the first stop: still blocks once", stop_input(r1, last=last_text(r1), prompt_id="p-ro1"),
           "block", state=os.path.join(ro, "sub"))
    os.chmod(ro, 0o700)

    print("\nX: every failure allows the stop and says the draft wasn't checked")
    expect("transcript missing and no last_assistant_message", stop_input(path=os.path.join(TMP, "nope.jsonl")), "note",
           note_has=[NOT_CHECKED, "transcript"], state=fresh())
    garbage = transcript([])
    with open(garbage, "w") as f:
        f.write("this is not json\n" * 3)
    expect("transcript of garbage lines and no last_assistant_message", stop_input(path=garbage), "note", note_has=[NOT_CHECKED], state=fresh())
    _, reason, note = expect("transcript missing, but last_assistant_message holds a flagged draft: it still blocks",
                             stop_input(path=os.path.join(TMP, "nope.jsonl"), last="Draft:\n\n" + fence(SEAMLESS)), "block",
                             reason_has=['"seamless"'], state=fresh())
    case("  ...and the user is told the earlier messages weren't checked", NOT_CHECKED in note, f"note={note[:160]!r}")
    recs = turn(say("Draft:\n\n" + fence(CLEAN)))
    expect("scorer throws: allowed with a note naming aiscore", stop_input(recs, last=last_text(recs)), "note",
           note_has=[NOT_CHECKED, "aiscore"], scorer="throw new Error('scorer exploded');", state=fresh())
    expect("scorer hangs: allowed with a note, cut off by the timeout", stop_input(recs, last=last_text(recs)), "note",
           note_has=[NOT_CHECKED, "timed out"], scorer="setTimeout(() => {}, 600000);", max_secs=15, state=fresh())
    recs_s = turn(say("Draft:\n\n" + fence(SEAMLESS)))
    expect("scorer fails on a draft with a banned word: allowed, the note lists the word-list hit",
           stop_input(recs_s, last=last_text(recs_s)), "note", note_has=[NOT_CHECKED, "seamless"],
           scorer="throw new Error('scorer exploded');", state=fresh())
    expect("normalizer throws: allowed with a note", stop_input(recs, last=last_text(recs)), "note",
           note_has=[NOT_CHECKED, "text-normalize"], normalizer="throw new Error('normalizer exploded');", state=fresh())
    expect("the send gate is missing: allowed with a note", stop_input(recs, last=last_text(recs)), "note",
           note_has=[NOT_CHECKED, "send gate"], send_gate=os.path.join(TMP, "missing-gate.py"), state=fresh())
    rc, out, err, _ = run_hook(None, raw_stdin="this is not json", state=fresh())
    got, _, note = decision(out)
    case("unreadable hook input: exit 0, allowed, with a note", rc == 0 and got == "note" and NOT_CHECKED in note,
         f"rc={rc} out={out[:160]!r} err={err[:160]!r}")
    raise_in = ("import importlib.machinery, importlib.util, sys\nsys.dont_write_bytecode = True\n"
                "loader = importlib.machinery.SourceFileLoader('vdg', sys.argv[1])\n"
                "spec = importlib.util.spec_from_loader('vdg', loader); m = importlib.util.module_from_spec(spec)\n"
                "loader.exec_module(m)\n"
                "def boom(*a, **k): raise RuntimeError('injected failure inside the hook')\n"
                "m.find_drafts = boom\n"
                "m.main()\n")
    expect("an exception inside the hook: allowed with a note", stop_input(recs, last=last_text(recs)), "note",
           note_has=[NOT_CHECKED, "internal error"], wrapper=raise_in, state=fresh())
    recs = turn(say("No draft in this reply."))
    expect("a broken scorer with no draft in the reply: nothing to check, no message", stop_input(recs, last=last_text(recs)),
           "pass", scorer="throw new Error('scorer exploded');", state=fresh())

    print("\nM: the reply spans tool calls; last_assistant_message covers a lagging transcript")
    recs = turn(think(), say("Let me check the channel first."), tool_call(), tool_result(), think(), tool_call("Read"),
                tool_result("file text with the word seamless in a tool result"), say("Here's the reply:\n\n" + fence(SEAMLESS)))
    expect("a draft in the last text after several tool calls blocks", stop_input(recs, last=last_text(recs)), "block",
           reason_has=['"seamless"'], state=fresh())
    recs = turn(say("Here's the reply:\n\n" + fence(SEAMLESS)), tool_call("Write"), tool_result(), say("Saved a copy too."))
    expect("a draft earlier in this turn's reply (before a tool call) blocks", stop_input(recs, last=last_text(recs)), "block",
           reason_has=['"seamless"'], state=fresh())
    recs = turn(say("Let me check."), tool_call(), tool_result("seamless synergy in a tool result"), say("Nothing to draft."))
    expect("banned words in tool results are never scored", stop_input(recs, last=last_text(recs)), "pass", state=fresh())
    recs = turn(say("Let me check."), tool_call(), tool_result())
    expect("the final message not in the transcript yet: last_assistant_message is scored",
           stop_input(recs, last="Here's the reply:\n\n" + fence(SEAMLESS)), "block", reason_has=['"seamless"'], state=fresh())
    recs = turn(say("Here's the reply:\n\n" + fence(CLEAN)))
    expect("the transcript and last_assistant_message agree on a clean draft", stop_input(recs, last=last_text(recs)), "pass", state=fresh())
    side = say("Draft:\n\n" + fence(SEAMLESS))
    side["isSidechain"] = True
    recs = turn(side, say("Done."))
    expect("a sidechain (subagent) record is not part of the reply", stop_input(recs, last="Done."), "pass", state=fresh())

    review_cases(fresh)

    print("\nP: big replies and big transcripts are fast")
    filler = ("We moved the nightly job to the new scheduler on Monday, and the finance report now lands at six. ") * 2000
    big = filler[:100000] + "\n\n" + fence(SEAMLESS + " " + CLEAN * 20) + "\n\n" + filler[:100000]
    recs = turn(say(big))
    case("  (the reply is over 200 KB)", len(big.encode()) > 200000, str(len(big)))
    expect("a 200 KB reply with a flagged draft blocks in under 10 s", stop_input(recs, last=big), "block",
           reason_has=['"seamless"'], max_secs=10, state=fresh())
    bigdraft = "Draft:\n\n" + fence(filler[:200000] + " It was seamless.")
    recs = turn(say(bigdraft))
    expect("a 200 KB draft blocks in under 10 s", stop_input(recs, last=bigdraft), "block", reason_has=['"seamless"'],
           max_secs=10, state=fresh())
    history = []
    for i in range(400):
        history += [prompt(f"old prompt {i}"), say("Old draft:\n\n" + fence(SEAMLESS) + "\n" + filler[:50000])]
    recs = turn(say("Here's the reply:\n\n" + fence(CLEAN)), before=history)
    tp = transcript(recs)
    case("  (the transcript is over 20 MB)", os.path.getsize(tp) > 20_000_000, str(os.path.getsize(tp)))
    expect("a clean reply at the end of a 20 MB transcript is allowed in under 10 s", stop_input(path=tp, last=last_text(recs)),
           "pass", max_secs=10, state=fresh())

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
