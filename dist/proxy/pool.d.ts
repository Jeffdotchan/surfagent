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
export declare function pickSticky(poolFile: string | undefined): StickyCred | null;
