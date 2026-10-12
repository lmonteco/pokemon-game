/**
 * FNV-1a, 32 bit, incremental. Used to fold simulation state into one number
 * so a test can say "these two runs are the same" cheaply (GDD 9.3).
 *
 * This is a checksum, not a cryptographic hash. It only has to be stable
 * across runs and sensitive to small changes.
 */

export const HASH_SEED = 0x811c9dc5;

const PRIME = 0x01000193;

/** Folds one 32-bit value in, byte by byte. */
export function hashUint32(h: number, value: number): number {
  let out = h;
  const v = value >>> 0;
  out = Math.imul(out ^ (v & 0xff), PRIME);
  out = Math.imul(out ^ ((v >>> 8) & 0xff), PRIME);
  out = Math.imul(out ^ ((v >>> 16) & 0xff), PRIME);
  out = Math.imul(out ^ ((v >>> 24) & 0xff), PRIME);
  return out >>> 0;
}

// One scratch buffer, reused, so hashing a float allocates nothing. The hot
// path folds thousands of floats per frame.
const scratchFloat = new Float64Array(1);
const scratchWords = new Uint32Array(scratchFloat.buffer);

/**
 * Folds the exact bits of a double in. -0 is normalised to 0 so that a
 * velocity that decayed to negative zero does not read as a state change.
 */
export function hashFloat64(h: number, value: number): number {
  scratchFloat[0] = value === 0 ? 0 : value;
  return hashUint32(hashUint32(h, scratchWords[0] ?? 0), scratchWords[1] ?? 0);
}

/** Folds a string in by code unit. Not for hot paths. */
export function hashString(h: number, value: string): number {
  let out = h;
  for (let i = 0; i < value.length; i += 1) {
    out = hashUint32(out, value.charCodeAt(i));
  }
  return out;
}

/** Folds a slice of a typed array in. */
export function hashInt32Array(h: number, values: Int32Array, length: number): number {
  let out = h;
  for (let i = 0; i < length; i += 1) {
    out = hashUint32(out, values[i] ?? 0);
  }
  return out;
}

/** Folds a slice of a typed array in. */
export function hashFloat64Array(h: number, values: Float64Array, length: number): number {
  let out = h;
  for (let i = 0; i < length; i += 1) {
    out = hashFloat64(out, values[i] ?? 0);
  }
  return out;
}

/** Renders a hash as 8 lowercase hex digits, for test output and bug reports. */
export function formatHash(h: number): string {
  return (h >>> 0).toString(16).padStart(8, '0');
}
