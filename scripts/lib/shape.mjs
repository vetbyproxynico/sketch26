// Pure helpers for describing a parsed JSON value WITHOUT repeating any value
// from it. No I/O, no dependencies. Used by scripts/live-probe.mjs, whose output
// ends up in public workflow logs, where Qloo response data must not appear.
//
// What may appear in the output:
//   - field names (but see "data-keyed maps" below), JSON type names;
//   - counts: values seen, array lengths, key counts, how many elements have a field;
//   - for strings, only a length bucket such as "1-20". Never the string itself.
// What never appears: any string, number or boolean value from the input.
//
// Data-keyed maps: an object keyed by data (more than 30 keys, or any key that
// does not look like a field name, such as an identifier, a URN, a year or a
// name) has its key names hidden. Only the number of keys and the merged shape
// of its values are reported. The same rule applies to the keys of the objects
// at one position taken together, so an array of one-key objects cannot leak
// its keys either.

/** Limits that keep the description readable. All are overridable per call. */
export const DEFAULT_LIMITS = Object.freeze({
  /** Nesting levels expanded below the root. Deeper levels report types only. */
  maxDepth: 8,
  /** An object with more keys than this is treated as a data-keyed map. */
  maxKeys: 30,
  /** Total shape nodes in one description. Further fields are counted, not shown. */
  maxNodes: 150,
  /** Values looked at per position. Larger arrays are sampled and flagged. */
  maxSamples: 500,
});

const TYPE_ORDER = ['object', 'array', 'string', 'number', 'boolean', 'null', 'other'];
const BUCKETS = ['0', '1-20', '21-100', '101-500', '501+'];

/** The JSON type of a parsed value. Anything that is not JSON (undefined, functions, ...) is "other". */
export function jsonTypeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    default:
      return 'other';
  }
}

/** "0", "1-20", "21-100", "101-500" or "501+". The only thing ever said about a string's content. */
export function lengthBucket(length) {
  if (length === 0) return BUCKETS[0];
  if (length <= 20) return BUCKETS[1];
  if (length <= 100) return BUCKETS[2];
  if (length <= 500) return BUCKETS[3];
  return BUCKETS[4];
}

const SNAKE_CASE = /^(?:[a-z]+|[0-9]+)(?:_(?:[a-z]+|[0-9]+))*$/;
const CAMEL_CASE = /^[a-z]+(?:[A-Z][a-z]+)*$/;

/**
 * True when a key reads as a field name that an API author chose: lower-case
 * snake_case whose parts are all letters or all digits ("entity_id",
 * "55_and_older") or plain camelCase. False for anything that could be data:
 * identifiers (mixed letters and digits in one part, hyphens, colons, dots,
 * spaces), URNs, years or other all-digit keys, capitalised words, and long
 * unbroken words. A false negative only hides a harmless name; a false positive
 * would print data, so the test errs towards "not a field name".
 */
export function isFieldName(key) {
  if (typeof key !== 'string' || key.length === 0 || key.length > 40) return false;
  if (SNAKE_CASE.test(key)) {
    if (!/[a-z]/.test(key)) return false; // all digits, e.g. a year
    return key.includes('_') || key.length <= 24; // a long unbroken word looks like an encoded ID
  }
  return CAMEL_CASE.test(key) && key.length <= 24;
}

function sanitise(limits) {
  const merged = { ...DEFAULT_LIMITS };
  for (const name of Object.keys(DEFAULT_LIMITS)) {
    const value = limits?.[name];
    // maxDepth may be 0 (describe the root only); the other limits need at least 1.
    if (Number.isFinite(value)) merged[name] = Math.max(name === 'maxDepth' ? 0 : 1, Math.floor(value));
  }
  return merged;
}

function range(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

function describeArrays(arrays, depth, ctx, expand) {
  const out = { count: arrays.length, length: range(arrays.map((array) => array.length)) };
  if (!expand) return out;

  const items = [];
  let total = 0;
  for (const array of arrays) {
    total += array.length;
    const room = ctx.maxSamples - items.length;
    for (let index = 0; index < room && index < array.length; index += 1) items.push(array[index]);
  }
  if (total > items.length) out.sampled = true;
  if (items.length > 0) out.items = profile(items, depth + 1, ctx);
  return out;
}

function describeObjects(objects, depth, ctx, expand) {
  const out = { count: objects.length, keys: range(objects.map((object) => Object.keys(object).length)) };
  if (!expand || out.keys.max === 0) return out;

  // Collect the union of key names, stopping as soon as the objects turn out to be a data-keyed map.
  const names = [];
  const known = new Set();
  let keyed = false;
  scan: for (const object of objects) {
    for (const key of Object.keys(object)) {
      if (known.has(key)) continue;
      if (known.size >= ctx.maxKeys || !isFieldName(key)) {
        keyed = true;
        break scan;
      }
      known.add(key);
      names.push(key);
    }
  }

  if (keyed) {
    const values = [];
    for (const object of objects) {
      for (const key of Object.keys(object)) {
        if (values.length >= ctx.maxSamples) break;
        values.push(object[key]);
      }
    }
    out.keyed = true;
    out.value = profile(values, depth + 1, ctx);
    return out;
  }

  const fields = [];
  let omitted = 0;
  for (const name of names) {
    if (ctx.nodes >= ctx.maxNodes) {
      omitted += 1;
      continue;
    }
    const column = [];
    for (const object of objects) if (Object.hasOwn(object, name)) column.push(object[name]);
    fields.push({ name, shape: profile(column, depth + 1, ctx) });
  }
  out.fields = fields;
  if (omitted > 0) out.omittedFields = omitted;
  return out;
}

/** The shape of all values seen at one position in the tree. */
function profile(values, depth, ctx) {
  ctx.nodes += 1;
  const present = new Set();
  const buckets = new Set();
  const arrays = [];
  const objects = [];
  for (const value of values) {
    const type = jsonTypeOf(value);
    present.add(type);
    if (type === 'string') buckets.add(lengthBucket(value.length));
    else if (type === 'array') arrays.push(value);
    else if (type === 'object') objects.push(value);
  }

  const shape = { seen: values.length, types: TYPE_ORDER.filter((type) => present.has(type)) };
  if (buckets.size > 0) shape.strings = BUCKETS.filter((bucket) => buckets.has(bucket));

  const expand = depth < ctx.maxDepth && ctx.nodes < ctx.maxNodes;
  if (arrays.length > 0) shape.array = describeArrays(arrays, depth, ctx, expand);
  if (objects.length > 0) shape.object = describeObjects(objects, depth, ctx, expand);
  const hidden = (shape.array?.length.max ?? 0) > 0 || (shape.object?.keys.max ?? 0) > 0;
  if (!expand && hidden) shape.truncated = true;
  return shape;
}

/**
 * Describes the structure of any parsed JSON value. The result is plain,
 * JSON-serialisable data:
 *
 *   { seen, types, strings?, array?, object?, truncated? }
 *
 *   seen     how many values were looked at at this position
 *   types    JSON types present, in a fixed order
 *   strings  length buckets of the strings present
 *   array    { count, length: {min, max}, items?, sampled? }
 *   object   { count, keys: {min, max}, fields?: [{name, shape}], omittedFields?,
 *              keyed?, value? }   keyed maps carry `value` instead of `fields`
 *   truncated  set where depth or size limits stopped the description
 *
 * `fields[].shape.seen` against `object.count` tells on how many of the objects
 * seen at that position a field occurs. Use renderShape for a readable form.
 */
export function describeShape(value, limits = {}) {
  const ctx = { ...sanitise(limits), nodes: 0 };
  return profile([value], 0, ctx);
}

function span({ min, max }) {
  return min === max ? String(min) : `${min}-${max}`;
}

function labelOf(shape) {
  const parts = shape.types.map((type) => {
    switch (type) {
      case 'string':
        return shape.strings === undefined ? 'string' : `string(${shape.strings.join('|')})`;
      case 'array': {
        const array = shape.array;
        const items = array.items === undefined ? '' : ` of ${labelOf(array.items)}`;
        return `array[${span(array.length)}]${items}${array.sampled ? ' (sampled)' : ''}`;
      }
      case 'object': {
        const object = shape.object;
        return object.keyed ? `map (${span(object.keys)} keys, key names hidden)` : 'object';
      }
      default:
        return type;
    }
  });
  return parts.join(' | ') + (shape.truncated ? ' (not expanded)' : '');
}

function childrenOf(shape) {
  const children = [];
  const notes = [];
  if (shape.object !== undefined) {
    if (shape.object.keyed) {
      if (shape.object.value !== undefined) children.push({ name: '<each value>', shape: shape.object.value, of: 0 });
    } else {
      for (const field of shape.object.fields ?? []) {
        children.push({ name: field.name, shape: field.shape, of: shape.object.count });
      }
      if (shape.object.omittedFields) notes.push(`... ${shape.object.omittedFields} more fields not shown`);
    }
  }
  if (shape.array?.items !== undefined) {
    // Children and notes are bounded by the node budget, so spreading them is safe.
    const inner = childrenOf(shape.array.items);
    children.push(...inner.children);
    notes.push(...inner.notes);
  }
  return { children, notes };
}

function walk(name, shape, level, of, lines) {
  const pad = '  '.repeat(level);
  const count = of > 1 && shape.seen !== of ? `  [${shape.seen}/${of}]` : '';
  lines.push(`${pad}${name === null ? '' : `${name}: `}${labelOf(shape)}${count}`);
  const { children, notes } = childrenOf(shape);
  for (const child of children) walk(child.name, child.shape, level + 1, child.of, lines);
  for (const note of notes) lines.push(`${pad}  ${note}`);
}

/**
 * Turns a describeShape result into indented text lines, for example
 *
 *   object
 *     results: object
 *       entities: array[16] of object
 *         name: string(1-20)
 *         image: object  [12/16]
 *
 * `[n/m]` means the field occurs in only n of the m objects at that position.
 * A field present in every object carries no count.
 */
export function renderShape(shape) {
  const lines = [];
  walk(null, shape, 0, 0, lines);
  return lines;
}

function collectSignature(path, shape, lines) {
  lines.push(`${path === '' ? '.' : path}: ${shape.types.join('|')}${shape.truncated ? ' ~' : ''}`);
  if (shape.object !== undefined) {
    if (shape.object.keyed) {
      if (shape.object.value !== undefined) collectSignature(`${path}{}`, shape.object.value, lines);
    } else {
      for (const field of shape.object.fields ?? []) collectSignature(`${path}.${field.name}`, field.shape, lines);
    }
  }
  if (shape.array?.items !== undefined) collectSignature(`${path}[]`, shape.array.items, lines);
}

/**
 * A text key for the structure of a shape: every field path with its JSON
 * types, and nothing else (no counts, no string lengths). Two answers with the
 * same fields and types have the same signature, so a report can say "same as
 * before" instead of printing the same tree again.
 */
export function shapeSignature(shape) {
  const lines = [];
  collectSignature('', shape, lines);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Path checks
// ---------------------------------------------------------------------------

/** "a.b[].c" becomes [{key:'a'},{key:'b'},{each:true},{key:'c'}]. "[]" alone means each element of the root. */
function parsePath(path) {
  const steps = [];
  for (const segment of path.split('.')) {
    let name = segment;
    let each = 0;
    while (name.endsWith('[]')) {
      name = name.slice(0, -2);
      each += 1;
    }
    if (name !== '') steps.push({ key: name });
    for (let index = 0; index < each; index += 1) steps.push({ each: true });
  }
  return steps;
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

function checkOne(value, path) {
  const steps = parsePath(path);
  const lastEach = steps.findLastIndex((step) => step.each === true);
  let frontier = [value];
  let of = lastEach === -1 ? 1 : 0;
  let structureMissing = false;

  steps.forEach((step, index) => {
    const next = [];
    for (const current of frontier) {
      if (step.each === true) {
        if (Array.isArray(current)) for (const element of current) next.push(element);
        else if (index <= lastEach) structureMissing = true;
      } else if (isObject(current) && Object.hasOwn(current, step.key) && current[step.key] !== undefined) {
        next.push(current[step.key]);
      } else if (index <= lastEach) {
        structureMissing = true;
      }
    }
    if (index === lastEach) of = next.length;
    frontier = next;
  });

  const nulls = frontier.filter((item) => item === null).length;
  const found = frontier.filter((item) => item !== null);
  const present = found.length;
  const kinds = new Set(found.map(jsonTypeOf));
  const types = TYPE_ORDER.filter((type) => kinds.has(type));

  let status = 'OK';
  if (present === 0) status = of > 0 || structureMissing ? 'MISSING' : 'NO_DATA';
  return { path, status, present, of, nulls, types };
}

/**
 * Checks dotted paths against a parsed value. `[]` after a name means "each
 * element of that array", so `results.entities[].properties.image.url` asks
 * about every entity. For each path the result says:
 *
 *   status   OK when the path leads to a non-null value on at least one
 *            element; MISSING when it leads to none (or an array or object on
 *            the way is absent); NO_DATA when the arrays on the way are empty,
 *            so there was nothing to look at
 *   present  elements (at the last `[]`, or 1 without one) where the full
 *            path leads to a non-null value
 *   of       how many elements were looked at
 *   nulls    elements where the path leads to null
 *   types    JSON types of the non-null values found
 *
 * The output holds the caller's own path strings, counts and type names only.
 */
export function checkPaths(value, paths) {
  return paths.map((path) => checkOne(value, path));
}
