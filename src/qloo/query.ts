/** A single query-string value. Arrays are sent comma-separated. */
export type QlooParamValue = string | number | boolean | string[];

/**
 * Flat parameter record. Names are sent verbatim, dots included
 * (`filter.type`, `signal.interests.entities`). Entries whose value is
 * `undefined` or an empty array are omitted.
 */
export type QlooParams = Readonly<Record<string, QlooParamValue | undefined>>;

function serialiseValue(value: QlooParamValue): string | undefined {
  if (Array.isArray(value)) {
    // Commas are the list separator Qloo expects, so only the items are escaped.
    return value.length === 0 ? undefined : value.map(encodeURIComponent).join(',');
  }
  return encodeURIComponent(String(value));
}

/**
 * Builds a query string (without the leading `?`). Keys are sorted so that the
 * same logical request always yields the same URL, which the cache relies on.
 */
export function buildQuery(params: QlooParams): string {
  const parts: string[] = [];
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined) continue;
    const serialised = serialiseValue(value);
    if (serialised === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${serialised}`);
  }
  return parts.join('&');
}
