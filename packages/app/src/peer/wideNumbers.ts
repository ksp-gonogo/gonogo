/**
 * The PeerJS packer writes a whole number as a 64-bit integer and throws on
 * one outside that range (a body's mass, 5.29e22 kg for Kerbin, is one) and on
 * any non-finite number. Such a number crosses the wire as a tagged string and
 * is restored exactly on the far side, so a station holds the value the host
 * does.
 */
const TAG = "__wideNumber";

const INT64_MIN = -9223372036854776000;
const UINT64_MAX = 18446744073709552000;

interface WideNumber {
  [TAG]: string;
}

function isUnpackable(value: number): boolean {
  if (!Number.isFinite(value)) return true;
  return (
    Math.floor(value) === value && (value < INT64_MIN || value > UINT64_MAX)
  );
}

function isWide(value: object): value is WideNumber {
  return typeof (value as Partial<WideNumber>)[TAG] === "string";
}

/**
 * `value` with every unpackable number replaced by its tagged form. Returns
 * `value` itself when nothing needed replacing, and never mutates it: the host
 * keeps the original in its own store.
 */
export function encodeWideNumbers<Value>(value: Value): Value {
  if (typeof value === "number") {
    return (isUnpackable(value) ? { [TAG]: String(value) } : value) as Value;
  }
  if (value === null || typeof value !== "object") return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;

  if (Array.isArray(value)) {
    let copy: unknown[] | undefined;
    for (let i = 0; i < value.length; i++) {
      const next = encodeWideNumbers(value[i]);
      if (next === value[i]) continue;
      copy ??= value.slice();
      copy[i] = next;
    }
    return (copy ?? value) as Value;
  }

  const source = value as Record<string, unknown>;
  let copy: Record<string, unknown> | undefined;
  for (const key of Object.keys(source)) {
    const next = encodeWideNumbers(source[key]);
    if (next === source[key]) continue;
    copy ??= { ...source };
    copy[key] = next;
  }
  return (copy ?? value) as Value;
}

/** The inverse of {@link encodeWideNumbers}, for a value nothing else holds. */
export function decodeWideNumbers<Value>(value: Value): Value {
  if (value === null || typeof value !== "object") return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  if (isWide(value)) return Number(value[TAG]) as Value;

  const holder = value as Record<string, unknown>;
  for (const key of Object.keys(holder)) {
    holder[key] = decodeWideNumbers(holder[key]);
  }
  return value;
}
