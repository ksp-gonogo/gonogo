/**
 * The environment variable that makes the page check write the page instead of
 * comparing it. `uplink-tools page` sets it to `1` for the one test run in
 * which it writes, and nothing else sets it. Useful for letting a scaffold
 * made inside CI write its first page. Read by the page check in
 * `page-check.ts`.
 *
 * Unlike the update switch a person sets by hand, which is refused under CI,
 * this one is honoured on any machine.
 */
export const PAGE_WRITE_ENV = "GONOGO_UPLINK_PAGE_WRITE";
