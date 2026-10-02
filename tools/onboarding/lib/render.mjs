// render.mjs: fill the overlay template's marked fields. A field in the template looks like
//   export const NAME = /*@NAME*/<default value>/*@END*/;
// and renderOverlay replaces the default with a new JavaScript literal. The template stays a valid module on its
// own, so tests and profile-build can import it unrendered.
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

export const TEMPLATE_PATH = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'templates', 'voice-overlay.template.mjs');
export const FIELDS = ['REVIEWED', 'ISSUE_PREFIX', 'PROBE', 'APPROVED_LINES', 'TEAM_WORDS', 'TEAM_PHRASES', 'REGISTER', 'VERDICT_STRUCT_TYPES', 'BASE_OVERLAY', 'PROFILE', 'NOTES'];
export const newProbe = () => `voice-probe-${randomBytes(8).toString('hex')}`;

const lit = (v, indent = '') => JSON.stringify(v, null, 2).replace(/\n/g, `\n${indent}`);

// APPROVED_LINES with a comment per entry: how many tune samples and which checks.
function approvedLiteral(entries) {
  if (!entries.length) return '[]';
  const rows = entries.map((e) => (typeof e === 'string'
    ? `  ${JSON.stringify(e)},`
    : `  ${JSON.stringify(e.line)}, // in ${e.docs} tune samples; flagged by ${e.checks.join(', ')}`));
  return `[\n${rows.join('\n')}\n]`;
}

export function renderOverlay(fields, templateText = readFileSync(TEMPLATE_PATH, 'utf8')) {
  let out = templateText;
  for (const [name, value] of Object.entries(fields)) {
    if (!FIELDS.includes(name)) throw new Error(`unknown overlay field ${name}`);
    const rx = new RegExp(`/\\*@${name}\\*/[\\s\\S]*?/\\*@END\\*/`);
    if (!rx.test(out)) throw new Error(`template has no ${name} field`);
    const body = name === 'APPROVED_LINES' ? approvedLiteral(value) : lit(value);
    out = out.replace(rx, () => `/*@${name}*/${body}/*@END*/`);
  }
  return out;
}
