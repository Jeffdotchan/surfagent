import fs from 'node:fs';

export interface StickyCred {
  host: string;
  port: number;
  username: string;
  password: string;
}

/**
 * Read a pool file of sticky-session credentials and pick one at random.
 *
 * Pool file format: one line per sticky session, colon-separated:
 *   username:password_with_session_id:host:port
 *
 * Returns null on any failure (missing file, empty file, malformed line,
 * unset/undefined poolFile). Never throws.
 */
export function pickSticky(poolFile: string | undefined): StickyCred | null {
  if (!poolFile) return null;
  try {
    const raw = fs.readFileSync(poolFile, 'utf-8');
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    const line = lines[Math.floor(Math.random() * lines.length)];
    const parts = line.split(':');
    // Format is user:pass:host:port — password may contain colons (e.g. session-IDs
    // with base62 chars), but in the PacketStream format the last two fields are
    // always host and port. So split from the right: port = parts[-1], host = parts[-2],
    // username = parts[0], password = parts[1..-3].join(':')
    if (parts.length < 4) return null;
    const portStr = parts[parts.length - 1];
    const host = parts[parts.length - 2];
    const username = parts[0];
    const password = parts.slice(1, parts.length - 2).join(':');
    const port = parseInt(portStr, 10);
    if (!username || !password || !host || !Number.isFinite(port) || isNaN(port)) return null;
    return { username, password, host, port };
  } catch {
    return null;
  }
}
