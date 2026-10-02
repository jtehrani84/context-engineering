// flags.mjs: what the installed checks flag in one text, as [{ check, text }]. Three sources, all local:
//   detector:<type>     the generic detector (loaded in this process)
//   overlay:<type>      the scorer's overlay issues (aiscore.mjs --json in a guarded child process)
//   send-hook:<type>    the send hook's flagged items when it blocks or nudges a synthetic send
import { loadDetector, runScorer } from './engine.mjs';
import { runHook, hookBullets, sendPayload } from './hook.mjs';

export function makeFlagger({ paths, hook = null, sendTool, useScorer = true, useHook = true, env = process.env }) {
  const D = loadDetector(paths);
  const used = { detector: !!D, scorer: false, hook: false };
  const errors = [];
  const flagger = (text) => {
    const out = [];
    if (D) {
      try {
        for (const i of D.analyzeText(text, { contextMode: 'general', sourceMode: 'rendered-markdown' }).issues || []) {
          if (i && typeof i.text === 'string') out.push({ check: `detector:${i.type}`, text: i.text });
        }
      } catch (e) { errors.push(`detector: ${e.message}`); }
    }
    if (useScorer) {
      const r = runScorer(paths, text, { env });
      if (r.ok) { used.scorer = true; for (const i of r.issues) if (typeof i.text === 'string') out.push({ check: `overlay:${i.type}`, text: i.text }); }
      else errors.push(`scorer: ${r.error}`);
    }
    if (useHook && hook && hook.exists) {
      const h = runHook({ command: hook.command, hookPath: hook.hookPath, payload: sendPayload(text, sendTool), env });
      if (h.decision === 'deny' || h.decision === 'context') {
        used.hook = true;
        for (const b of hookBullets(h.message)) out.push({ check: `send-hook:${b.type}`, text: b.text });
      } else if (h.decision === 'pass') used.hook = true;
      else errors.push(`send hook: exit ${h.code}`);
    }
    return out;
  };
  return { flagger, used, errors };
}
