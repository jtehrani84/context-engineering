#!/usr/bin/env node
// echo-attribute.mjs — ECHO-style hierarchical + objective-criteria error attribution
// over Claude Code workflow traces (journal.jsonl + agent-<id>.jsonl + agent-<id>.meta.json).
//
// Read-only. Faithful to "Where did it all go wrong? A hierarchical look into multi-agent
// error attribution" (arXiv:2510.04886, 2025): three parts —
//   1) hierarchical context representation  (workflow -> phase -> agent -> step, positional leveling)
//   2) fixed objective criteria             (deterministic failure flags, not ad-hoc judgment)
//   3) consensus voting                     (the --bundle output feeds N independent judges;
//                                            the deterministic core also stands alone)
//
// This is the deterministic core + the judge-bundle emitter. The consensus vote is run
// by the harness over the bundle (spawn N judges; majority = attribution). Faithful-scope
// note: ECHO's consensus is an LLM step; this tool does the leveling + objective criteria
// locally and hands a leveled bundle to the judges, rather than re-implementing the paper's
// exact model.
//
// Usage:
//   node echo-attribute.mjs <wf_dir>                 attribute one workflow run (report)
//   node echo-attribute.mjs <wf_dir> --json          machine-readable attribution
//   node echo-attribute.mjs <wf_dir> --bundle        emit a judge-bundle (for the consensus stage)
//   node echo-attribute.mjs --scan <projects_dir>    rank all runs by failure signal (find known-bad traces)
//
// Exit 0 always (a reader). Never mutates.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

// ---------- small helpers ----------
const readLines = (p) => {
  try { return readFileSync(p, 'utf8').split('\n').filter(Boolean); } catch { return []; }
};
const parseJsonl = (p) => readLines(p).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const isEmpty = (v) =>
  v == null ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

// short error-shaped result: a truthy error field, or a short string that reads as a failure
const ERR_RE = /\b(error|failed|failure|exception|refused|cannot|unable|timed?\s*out|denied|null result|no output)\b/i;
// A result carrying a NARRATIVE `errors`/`notes` field alongside a real payload is a SUCCESS
// that reported recovered issues — NOT a failure. Only fire on explicit failure sentinels, or
// on a result whose ONLY substantive content is an error. (Calibrated after a fully-successful
// research result was mis-flagged for having an `errors` field.)
function resultErrorFlag(result) {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    if (result.ok === false || result.success === false || result.resolved === false) return 'ok/success:false';
    const st = String(result.status ?? result.state ?? '').toLowerCase();
    if (/\b(error|failed|failure|aborted)\b/.test(st)) return `status:${st}`;
    // result is essentially ONLY an error (no successful payload alongside it)
    const keys = Object.keys(result);
    const errKeys = keys.filter((k) => /^(err|error|errors|failure|exception)$/i.test(k));
    if (errKeys.length && keys.length <= errKeys.length + 1) {
      const hasErrVal = errKeys.some((k) => result[k] && !(Array.isArray(result[k]) && result[k].length === 0));
      if (hasErrVal) return 'result is essentially only an error';
    }
    return null;
  }
  if (typeof result === 'string' && result.length < 300 && ERR_RE.test(result)) return 'short error-shaped string';
  return null;
}

// ---------- objective criteria: per-agent failure flags ----------
// PRIMARY = the agent truly failed to deliver a usable result (the ground truth of failure).
// SECONDARY = HOW it failed — evidence that only counts when a PRIMARY flag is present, so a
// recovered tool error or a normal repeated tool call never flags a healthy agent as failing.
// (Calibrated against a known-clean 74-agent run that must read ~0 failing.)
const PRIMARY_WEIGHTS = {
  RESULT_NULL: 5, // agent died / returned null (workflow filters these with .filter(Boolean))
  RESULT_EMPTY: 4, // returned {} / "" / []
  RESULT_ERROR: 5, // result carries an error field or reads as an error
};
const SECONDARY_WEIGHTS = {
  NO_ASSISTANT: 2, // transcript has zero assistant turns — corroborates a null/empty result
  TOOL_ERROR: 1, // a tool_result came back is_error:true (often recovered — evidence only)
  SCHEMA_THRASH: 1, // repeated tool calls of one name near the end (evidence only)
};

function scanTranscript(jsonlPath) {
  const lines = parseJsonl(jsonlPath);
  let assistant = 0, user = 0, toolUses = 0, toolErrors = 0;
  const toolNameSeq = [];
  for (const rec of lines) {
    const type = rec.type;
    if (type === 'assistant') {
      assistant++;
      const content = rec?.message?.content ?? rec?.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b?.type === 'tool_use') { toolUses++; if (b.name) toolNameSeq.push(b.name); }
        }
      }
    } else if (type === 'user') {
      user++;
      const content = rec?.message?.content ?? rec?.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b?.type === 'tool_result' && b?.is_error) toolErrors++;
        }
      }
    }
  }
  // schema-thrash heuristic: the last 6 tool calls are the same name >=4 times
  let schemaThrash = false;
  const tail = toolNameSeq.slice(-6);
  if (tail.length >= 4) {
    const counts = {};
    for (const n of tail) counts[n] = (counts[n] || 0) + 1;
    schemaThrash = Object.values(counts).some((c) => c >= 4);
  }
  return { assistant, user, toolUses, toolErrors, schemaThrash };
}

function agentFlags(agent) {
  const primary = [];
  const secondary = [];
  // "started but no result line" is INCOMPLETE (aborted / in-progress / child agent), NOT a
  // step failure. Only a RECORDED result that is null/empty/error is a genuine agent failure.
  if (!agent.hasResult) {
    const ev = agent.transcript && agent.transcript.assistant === 0 ? ['NO_ASSISTANT'] : [];
    return { flags: [], evidence: ev, failing: false, badness: 0, incomplete: true };
  }
  const r = agent.result;
  if (r === null || r === undefined) primary.push('RESULT_NULL');
  else if (isEmpty(r)) primary.push('RESULT_EMPTY');
  const errf = resultErrorFlag(r);
  if (errf) primary.push('RESULT_ERROR');
  if (agent.transcript) {
    if (agent.transcript.assistant === 0) secondary.push('NO_ASSISTANT');
    if (agent.transcript.toolErrors > 0) secondary.push('TOOL_ERROR');
    if (agent.transcript.schemaThrash) secondary.push('SCHEMA_THRASH');
  }
  const failing = primary.length > 0; // secondary alone never flags a healthy agent
  const badness = failing
    ? primary.reduce((s, f) => s + PRIMARY_WEIGHTS[f], 0) +
      secondary.reduce((s, f) => s + (SECONDARY_WEIGHTS[f] || 0), 0)
    : 0;
  return { flags: primary, evidence: secondary, failing, badness, incomplete: false };
}

// ---------- load one workflow run ----------
function loadRun(dir) {
  const journalPath = join(dir, 'journal.jsonl');
  if (!existsSync(journalPath)) return null;
  const journal = parseJsonl(journalPath);
  const started = []; // preserve start ORDER for positional leveling
  const results = new Map(); // agentId -> result value
  for (const rec of journal) {
    if (rec.type === 'started' && rec.agentId) started.push(rec.agentId);
    if (rec.type === 'result' && rec.agentId) results.set(rec.agentId, rec.result);
  }
  // some agents appear only as result (no started line) — include them after the ordered ones
  const orderedIds = [...started];
  for (const id of results.keys()) if (!orderedIds.includes(id)) orderedIds.push(id);

  const agents = orderedIds.map((agentId, position) => {
    const meta = readJson(join(dir, `agent-${agentId}.meta.json`)) || {};
    const tPath = join(dir, `agent-${agentId}.jsonl`);
    const transcript = existsSync(tPath) ? scanTranscript(tPath) : null;
    const agent = {
      agentId,
      position, // 0 = started first
      phase: meta.workflowPhase ?? null,
      description: meta.description ?? null,
      agentType: meta.agentType ?? null,
      spawnDepth: meta.spawnDepth ?? null,
      result: results.has(agentId) ? results.get(agentId) : null,
      hasResult: results.has(agentId),
      transcript,
    };
    const { flags, evidence, failing, badness, incomplete } = agentFlags(agent);
    agent.flags = flags;
    agent.evidence = evidence;
    agent.failing = failing;
    agent.badness = badness;
    agent.incomplete = incomplete;
    return agent;
  });
  return { dir, id: basename(dir), agents };
}

// ---------- positional leveling + culprit ranking ----------
// Root-cause prior: an earlier failing agent is likelier the ROOT than a later one that may
// merely have inherited a null. rootScore = badness * (1 + (N - position)/N * 0.5).
function rankCulprits(run) {
  const N = run.agents.length || 1;
  const failing = run.agents.filter((a) => a.failing);
  const ranked = failing
    .map((a) => ({
      agentId: a.agentId,
      position: a.position,
      phase: a.phase,
      description: a.description,
      flags: a.flags,
      evidence: a.evidence,
      badness: a.badness,
      rootScore: +(a.badness * (1 + ((N - a.position) / N) * 0.5)).toFixed(2),
    }))
    .sort((x, y) => y.rootScore - x.rootScore);
  return ranked;
}

function phaseRollup(run) {
  const roll = {};
  for (const a of run.agents) {
    const p = a.phase || '(none)';
    roll[p] = roll[p] || { agents: 0, failing: 0, badness: 0 };
    roll[p].agents++;
    if (a.badness > 0) { roll[p].failing++; roll[p].badness += a.badness; }
  }
  return roll;
}

// ---------- outputs ----------
function report(run) {
  const ranked = rankCulprits(run);
  const roll = phaseRollup(run);
  const lines = [];
  const completed = run.agents.filter((a) => a.hasResult).length;
  const incomplete = run.agents.length - completed;
  lines.push(`ECHO attribution — ${run.id}`);
  lines.push(`started: ${run.agents.length}   completed: ${completed}   incomplete(no result line): ${incomplete}`);
  lines.push(`failing (completed with null/empty/error result): ${ranked.length}`);
  if (incomplete > completed) lines.push(`NOTE: majority incomplete → run looks aborted/in-progress, not step-failed.`);
  lines.push('');
  lines.push('phase rollup (workflow -> phase level):');
  for (const [p, r] of Object.entries(roll)) {
    lines.push(`  ${p.padEnd(16)} agents=${r.agents}  failing=${r.failing}  badness=${r.badness}`);
  }
  lines.push('');
  if (ranked.length === 0) {
    lines.push('no objective failure signal in any agent — run reads clean.');
  } else {
    lines.push('ranked culprits (agent -> step level, positional root-cause prior):');
    ranked.slice(0, 10).forEach((c, i) => {
      lines.push(`  #${i + 1} rootScore=${c.rootScore}  pos=${c.position}  phase=${c.phase || '-'}`);
      lines.push(`     ${c.description ? c.description.slice(0, 90) : c.agentId}`);
      lines.push(`     flags: ${c.flags.join(', ')}${c.evidence && c.evidence.length ? '   evidence: ' + c.evidence.join(', ') : ''}`);
    });
    lines.push('');
    lines.push(`ATTRIBUTED ROOT (deterministic): agent ${ranked[0].agentId} @ pos ${ranked[0].position}, flags [${ranked[0].flags.join(', ')}]`);
    lines.push('(run --bundle and pass to a 3-judge consensus vote to confirm/override.)');
  }
  return lines.join('\n');
}

function bundle(run) {
  const ranked = rankCulprits(run);
  const preview = (r) => { try { return JSON.stringify(r).slice(0, 700); } catch { return String(r).slice(0, 700); } };
  return {
    workflow: run.id,
    agentCount: run.agents.length,
    completed: run.agents.filter((a) => a.hasResult).length,
    incomplete: run.agents.filter((a) => !a.hasResult).length,
    objectiveFailures: ranked.length,
    phaseRollup: phaseRollup(run),
    // objective candidates (agents with a recorded null/empty/error result)
    candidates: ranked.slice(0, 8).map((c) => {
      const a = run.agents.find((x) => x.agentId === c.agentId);
      return {
        agentId: c.agentId, position: c.position, phase: c.phase, description: c.description,
        flags: c.flags, evidence: c.evidence, badness: c.badness, rootScore: c.rootScore,
        resultPreview: preview(a?.result),
      };
    }),
    // FULL roster so the consensus can localize a REASONING failure (no objective flag) too
    roster: run.agents.filter((a) => a.hasResult).map((a) => ({
      agentId: a.agentId, position: a.position, phase: a.phase, description: a.description,
      flags: a.flags, resultPreview: preview(a.result),
    })),
    judgeInstruction:
      'ECHO consensus vote. First check the objective candidates (agents with a recorded null/empty/error result). ' +
      'If there is NO objective failure, the run failed on a REASONING error: read the roster and find the agent whose ' +
      'output is wrong, unfaithful to its input/source, or inconsistent with its task, and that a later agent built on. ' +
      'Name the single ROOT-cause agent (not a downstream inheritor). Return {culpritAgentId, whyRoot, notInherited}. Vote independently; majority wins.',
  };
}

// ---------- scan mode: find real known-bad traces ----------
function findWfDirs(root) {
  const out = [];
  const walk = (d, depth) => {
    if (depth > 6) return;
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = join(d, e.name);
      if (existsSync(join(full, 'journal.jsonl'))) out.push(full);
      else walk(full, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

function scan(root) {
  const dirs = findWfDirs(root);
  const rows = [];
  for (const d of dirs) {
    const run = loadRun(d);
    if (!run) continue;
    const ranked = rankCulprits(run);
    const totalBad = ranked.reduce((s, c) => s + c.badness, 0);
    if (totalBad > 0) rows.push({ id: run.id, agents: run.agents.length, failing: ranked.length, totalBad, top: ranked[0] });
  }
  rows.sort((a, b) => b.totalBad - a.totalBad);
  const lines = [`scanned ${dirs.length} workflow runs under ${root}`, `${rows.length} have >=1 objective failure signal`, ''];
  rows.slice(0, 20).forEach((r) => {
    lines.push(`totalBad=${r.totalBad}  failing=${r.failing}/${r.agents}  ${r.id}  topFlags=[${r.top.flags.join(',')}]`);
  });
  return lines.join('\n');
}

// ---------- main ----------
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('usage: node echo-attribute.mjs <wf_dir> [--json|--bundle]  |  --scan <projects_dir>');
  process.exit(0);
}
if (args[0] === '--scan') {
  const root = args[1];
  if (!root || !existsSync(root)) { console.error('scan: provide an existing projects dir'); process.exit(0); }
  console.log(scan(root));
  process.exit(0);
}
const dir = args[0];
if (!existsSync(join(dir, 'journal.jsonl'))) { console.error(`no journal.jsonl in ${dir}`); process.exit(0); }
const run = loadRun(dir);
if (args.includes('--bundle')) console.log(JSON.stringify(bundle(run), null, 2));
else if (args.includes('--json')) console.log(JSON.stringify({ ranked: rankCulprits(run), phaseRollup: phaseRollup(run) }, null, 2));
else console.log(report(run));
