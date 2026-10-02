// schema-lite.mjs: a small JSON Schema validator for the onboarding config (no npm dependencies).
//
// Supports the keywords voice-config.schema.json uses: type (one or a list), properties, required,
// additionalProperties (false or a schema), items, enum, const, minimum, maximum, minLength, minItems,
// uniqueItems, pattern, anyOf. Annotation keywords ($schema, $id, title, description, default, examples,
// $comment) are ignored. Any other keyword is an error, so the schema can't quietly use something this
// validator doesn't check.
//
// validate(schema, value) -> [] when valid, else a list of "path: message" strings.
// applyDefaults(schema, value) -> a copy of value with every missing property that has a `default` filled in.

const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', 'default', 'examples', '$comment']);
const KNOWN = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
  'minimum', 'maximum', 'minLength', 'minItems', 'uniqueItems', 'pattern', 'anyOf', ...ANNOTATIONS]);

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}
const typeMatches = (want, v) => {
  const t = typeOf(v);
  return want === t || (want === 'number' && t === 'integer');
};

export function validate(schema, value, path = '$') {
  const errs = [];
  for (const k of Object.keys(schema)) if (!KNOWN.has(k)) errs.push(`${path}: schema uses unsupported keyword "${k}"`);
  if (errs.length) return errs;
  if (schema.anyOf) {
    const branches = schema.anyOf.map((s) => validate(s, value, path));
    if (!branches.some((b) => b.length === 0)) errs.push(`${path}: matches none of the allowed forms (${branches.map((b) => b[0]).join(' | ')})`);
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(t, value))) return [...errs, `${path}: expected ${types.join(' or ')}, got ${typeOf(value)}`];
  }
  if ('const' in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) errs.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) errs.push(`${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path}: must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${path}: must be <= ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errs.push(`${path}: must have at least ${schema.minLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errs.push(`${path}: must match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${path}: must have at least ${schema.minItems} items`);
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const v of value) { const k = JSON.stringify(v); if (seen.has(k)) errs.push(`${path}: duplicate item ${k}`); seen.add(k); }
    }
    if (schema.items) value.forEach((v, i) => errs.push(...validate(schema.items, v, `${path}[${i}]`)));
  }
  if (typeOf(value) === 'object') {
    for (const r of schema.required || []) if (!(r in value)) errs.push(`${path}: missing required property "${r}"`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) errs.push(...validate(props[k], v, `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}: unknown property "${k}"`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') errs.push(...validate(schema.additionalProperties, v, `${path}.${k}`));
    }
  }
  return errs;
}

export function applyDefaults(schema, value) {
  if (typeOf(value) !== 'object' || !schema.properties) return value;
  const out = { ...value };
  for (const [k, s] of Object.entries(schema.properties)) {
    if (!(k in out)) {
      if ('default' in s) out[k] = structuredClone(s.default);
      else if (s.properties) out[k] = applyDefaults(s, {});
    } else if (typeOf(out[k]) === 'object' && s.properties) out[k] = applyDefaults(s, out[k]);
  }
  return out;
}

// The defaults alone, for a config file that is missing.
export const defaultsFrom = (schema) => applyDefaults(schema, {});
