/**
 * Discord IDs ("snowflakes") are 64-bit integers whose top 42 bits are a
 * millisecond timestamp relative to the Discord epoch. They arrive as strings
 * and must be handled with BigInt to keep full precision.
 *
 * https://discord.com/developers/docs/reference#snowflakes
 */

export const DISCORD_EPOCH_MS = 1420070400000;
const DISCORD_EPOCH = BigInt(DISCORD_EPOCH_MS);

const SNOWFLAKE_RE = /^\d{1,20}$/;

export function isSnowflake(value: unknown): value is string {
  return typeof value === 'string' && SNOWFLAKE_RE.test(value);
}

/** Creation time (epoch ms) encoded in a snowflake. */
export function snowflakeToMs(id: string): number {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

/** Creation time of a snowflake as an ISO 8601 string. */
export function snowflakeToIso(id: string): string {
  return new Date(snowflakeToMs(id)).toISOString();
}

/**
 * Smallest snowflake that can exist at `ms`. Every message created at or after
 * `ms` has an ID greater than or equal to this value.
 */
export function msToSnowflake(ms: number): string {
  const offset = BigInt(Math.floor(ms)) - DISCORD_EPOCH;
  if (offset <= 0n) return '0';
  return (offset << 22n).toString();
}

/** Numeric comparison of two snowflakes without converting to BigInt. */
export function compareSnowflakes(a: string, b: string): number {
  const x = stripLeadingZeros(a);
  const y = stripLeadingZeros(b);
  if (x.length !== y.length) return x.length - y.length;
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Fixed-width key whose lexicographic order matches numeric order. Used as
 * the IndexedDB key so stored messages iterate chronologically.
 */
export function snowflakeSortKey(id: string): string {
  return stripLeadingZeros(id).padStart(20, '0');
}

export function sortKeyToSnowflake(key: string): string {
  return stripLeadingZeros(key);
}

function stripLeadingZeros(value: string): string {
  const stripped = value.replace(/^0+/, '');
  return stripped === '' ? '0' : stripped;
}
