/**
 * File-name handling for downloaded attachments. Names are kept as close to
 * the original as the target file systems (Windows, macOS, Linux, ZIP) allow,
 * and made unique case-insensitively with a " (2)" style suffix.
 */

const INVALID_CHARS_RE = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const RESERVED_WINDOWS_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const MAX_NAME_LENGTH = 150;

export function splitExtension(name: string): [base: string, ext: string] {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return [name, ''];
  const ext = name.slice(dot);
  // Treat very long "extensions" as part of the name.
  if (ext.length > 16) return [name, ''];
  return [name.slice(0, dot), ext];
}

export function sanitizeFilename(name: string, fallback = 'file'): string {
  let cleaned = name.normalize('NFC').replace(INVALID_CHARS_RE, '_').trim();
  // Windows strips trailing dots and spaces.
  cleaned = cleaned.replace(/[. ]+$/, '');
  if (!cleaned || cleaned === '.' || cleaned === '..') cleaned = fallback;

  let [base, ext] = splitExtension(cleaned);
  if (RESERVED_WINDOWS_RE.test(base)) base = `${base}_`;
  if (base.length + ext.length > MAX_NAME_LENGTH) {
    base = truncateCodePoints(base, Math.max(1, MAX_NAME_LENGTH - ext.length));
  }
  return `${base}${ext}`;
}

function truncateCodePoints(value: string, max: number): string {
  return Array.from(value).slice(0, max).join('');
}

/** Hands out unique file names within one folder (case-insensitive). */
export class FilenameAllocator {
  private readonly taken = new Set<string>();

  constructor(existing: Iterable<string> = []) {
    for (const name of existing) this.taken.add(name.toLowerCase());
  }

  allocate(original: string, fallback = 'file'): string {
    const safe = sanitizeFilename(original, fallback);
    if (!this.taken.has(safe.toLowerCase())) {
      this.taken.add(safe.toLowerCase());
      return safe;
    }
    const [base, ext] = splitExtension(safe);
    for (let n = 2; ; n++) {
      const candidate = `${base} (${n})${ext}`;
      if (!this.taken.has(candidate.toLowerCase())) {
        this.taken.add(candidate.toLowerCase());
        return candidate;
      }
    }
  }
}

/**
 * Makes a readable name safe as one folder/file name on Windows, macOS and
 * Linux: invalid and control characters become "_", whitespace is collapsed,
 * leading dots (hidden files) and trailing dots/spaces are removed, Windows
 * reserved names get a suffix, and the length is capped (in code points).
 */
export function safeNameSegment(value: string, maxLength = 60): string {
  let cleaned = value
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(INVALID_CHARS_RE, '_')
    .trim()
    .replace(/^[.\s]+/, '');
  cleaned = truncateCodePoints(cleaned, maxLength).replace(/[. ]+$/, '');
  if (RESERVED_WINDOWS_RE.test(cleaned.split('.')[0] ?? '')) cleaned = `${cleaned}_`;
  return cleaned;
}
