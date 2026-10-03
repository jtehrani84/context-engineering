#!/usr/bin/env python3
"""hook-lexicon.py: the send hook's own word list and "As <Name>" check over a set of documents, as counts.

LOCAL ONLY: no model, judge or web call, and no node call (the hook's scorer and normalizer views are left out, so
this is the hook's deterministic lexicon on the text as given plus its rendered flat view, the part a corpus run can
afford). Reads JSON lines {"set": ..., "text": ...} on stdin and prints one JSON object: per set, the number of docs,
the docs the hook would deny on a send (any hard-ban hit), the docs denied for an "As <Name>" opener, and the docs
with only nudges. Counts only, never text or ids, so a private set can go through it.

Used by human-fp-budget.mjs (the hook lane). VOICE_HOOK points it at another copy of the hook (to measure an older
commit); VOICE_COMPANY_NAMES is set to a missing file by the caller so the run uses the built-in names only.
"""
import importlib.machinery
import importlib.util
import json
import os
import sys

sys.dont_write_bytecode = True

HOOK = os.environ.get("VOICE_HOOK") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hook", "voice-tell-gate.py")


def load(path):
    loader = importlib.machinery.SourceFileLoader("voice_tell_gate_lane", path)
    spec = importlib.util.spec_from_loader("voice_tell_gate_lane", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def views(g, text):
    """The lexicon's hits on the text and, when the hook has it, its flat view (as analyze() reads it)."""
    crit, soft = g.lexicon(text)
    if hasattr(g, "flat_view"):
        flat = g.flat_view(text)
        if flat != text:
            tick = "`" in text
            opener = tick or g._AS_BREAK.search(text)
            c2, s2 = g.lexicon(flat, opener_kinds=("block",) if opener else (), multi_only=not tick)
            crit, soft = crit + c2, soft + s2
    return crit, soft


def main():
    g = load(HOOK)
    out = {}
    for line in sys.stdin:
        if not line.strip():
            continue
        d = json.loads(line)
        s = out.setdefault(d["set"], {"n": 0, "blockDocs": 0, "openerBlockDocs": 0, "nudgeOnlyDocs": 0})
        s["n"] += 1
        crit, soft = views(g, d["text"])
        if crit:
            s["blockDocs"] += 1
            if any(i.get("text", "").startswith('"As ') for i in crit):
                s["openerBlockDocs"] += 1
        elif soft:
            s["nudgeOnlyDocs"] += 1
    print(json.dumps(out))


if __name__ == "__main__":
    main()
