# Structural Voice (Anti-AI Detection — Layer 4)

The other anti-slop layers work at the **word** level (banned words, phrases, openers) and are caught by the voice engine (`tools/aiscore.mjs`) and its overlay. This layer governs **structure** — the skeleton and rhythm that make a page read as AI even when every word passes. Senior technical readers detect AI by structure, not vocabulary. A page can clear every word-level check and still instantly read as machine-written because of uniform section shapes, parallel card grids, zero hedging, and even cadence.

Apply these consciously to any content read by senior/technical audiences — especially standalone HTML, docs, and prose generated outside a pipeline.

---

## P0 — mandatory (violating these guarantees AI detection)

### Parallel-structure elimination
- Never use 3+ visually identical cards/items in a row.
- Listing N things: give the most important 3× the space, give one a single sentence, let one be a question or an incomplete thought.
- Reaching for a "grid of cards"? Stop. Write prose. Use grids only for genuine data-comparison tables.
- Vary proof types across a page: one section a table, one narrative, one a specific example, one Q&A, one pure prose. Never repeat the same proof structure (icon + title + paragraph) more than twice.

### Confidence calibration
- Every argument page carries 2–3 specific, named weaknesses. Real hedging names the exact gap ("the data quality is uneven across records"), not "further research is needed."
- Every bold claim earns evidence in the next sentence. A bare "this is irreproducible" is banned; "…irreproducible — the event was three years ago and you can't rerun calendar time" is allowed.
- Vary the uncertainty language; never the same hedge twice. Weaknesses vary in KIND — one data-quality admission, one temporal gap, one open question, one execution risk.

### Announced hedges (the tell that hides as candor) — P0
Narrating that you're about to hedge, instead of just hedging.
- BAD: "Two things I'll flag rather than assert…" · "I want to be honest that…" · "To be clear," / "In fairness," as an opener · the noun-scaffold version: "the honest answer is," "so I'll say it straight."
- GOOD: state the caveat where it lives, no first-person-future scaffold. "I couldn't tie that number to a source this pass, so it stays off the page." names the gap and stops.
- The rule: cut the announcement, keep the substance. "honest" as an accuracy adjective ("honest provenance," "the honest number") is fine — only the candor-*performance* is the tell.

### Aphorisms / maxims — P0
Compressed maxims read as generated copy dressed as a mic-drop.
- BAD: "Trust first, then speed." · "That's reuse, not headcount." · ending a section on a punchy elided-verb couplet.
- GOOD: the same claim, uncompressed, as an ordinary sentence.
- Exception: a *deliberate* POV line or a verbatim quote survives. The rule removes reflexive maxims, not chosen ones.

---

## P1 — voice and flow

- **Progressive argument.** Reuse a term from the previous section without flagging it ("as noted above" is banned — just use the term again). The page has a causal chain: A enables B enables C. End sections with forward tension, not summary. It should FAIL the shuffle test — reordering two sections should break the logic.
- **Dominant mode.** Pick one voice for ~70% of the page (usually direct and claim-forward). Departures — a question to the reader, a flash of frustration, a fragment — hit harder because they're rare. Don't rotate registers evenly; systematic rotation is its own AI tell.
- **Specificity.** At least one concrete artifact reference per page (a version, a count, a date, a named system). Tell-show-tell: name what the reader is thinking before correcting it.

## P2 — polish (after P0/P1)

- No two consecutive sections use the same layout shape. At least one section is pure flowing prose.
- **Sentence rhythm:** no 3 consecutive sentences within 5 words of each other in length. Fragments: max ~3 per page, earned, not scheduled.
- **Em-dash restraint:** few per page; never two in one sentence; if you used one this paragraph, use a period or colon for the next parenthetical. (Over-used em-dashes are a top AI tell.)

## Cadence & flow (what an expert reads in one pass)

Word-clean drafts still get clocked as AI on **rhythm**. A reviewer who reads model output daily catches a clean-scoring draft in two sentences — on cadence, not vocabulary. Watch for:
- **Colon-reveal cadence** — the "setup: tidy payoff" beat, recurring. One is fine; every few lines is a tell.
- **"X, not Y" antithesis** used as a reflex punch-close.
- **Staccato runs** — 3+ short sentences back-to-back.
- **Low flow** — a wall of even, short declaratives. Human writing carries thoughts across commas and varies length.
- **Metric-drama** — a run of identically-shaped `N → M` flourishes.

The generation-side rule: write with varied rhythm, mix sentence lengths, connect clauses. And don't chase the score to zero — optimizing the proxy while the real target (an expert's read) diverges is the Goodhart trap. Fewer scaffolds and genuine irregularity beat one more regex pass.

---

**Note:** the word-level and person-specific tells live in your calibrated overlay (`tools/voice-overlay.mjs`); these structural rules are general and apply to everyone. A text is only clean when the engine, this structural layer, AND a human/gestalt read all pass — a clean automated score alone certifies nothing (see `VOICE-ONBOARDING.md`).
