# Vendored dependency — avoid-ai-writing (MIT)

This directory contains the **generic AI-writing detector** from the open-source project
**[avoid-ai-writing](https://github.com/conorbronsdon/avoid-ai-writing)** by Conor Bronsdon,
vendored **unmodified** under its MIT license (see `LICENSE`, Copyright © 2026 Conor Bronsdon).

## What this is
`detector/patterns.js` is the generic 0–100 AI-writing scorer — layer 0 of this kit's voice system.
It catches AI slop for anyone, out of the box. `../aiscore.mjs` wraps it and adds the local layers.

## What this is NOT
This is the *generic* engine. It knows nothing about any specific person's voice. Your team's or
your own voice calibration lives in **`../voice-overlay.mjs`** (drafted from `../onboarding/templates/voice-overlay.template.mjs` by `/voice-setup`),
**outside this vendored directory on purpose** — so that pulling a newer version of avoid-ai-writing
can never clobber your calibration. Never put team-specific rules in here.

## Updating
To take an upstream update: replace `detector/` from `github.com/conorbronsdon/avoid-ai-writing`,
keep this NOTICE and the LICENSE, and leave `../voice-overlay.mjs` untouched.
