/**
 * Set to `1` by `uplink-tools page`, and by nothing else, for the one test run
 * in which the page check writes the page instead of comparing it.
 *
 * It is separate from the update switch a person sets by hand, which is refused
 * under CI so that a check run can never heal itself. This one is a write that
 * was asked for by name, so it is honoured anywhere: a scaffold made inside CI
 * needs its first page as much as one made on a laptop.
 */
export const PAGE_WRITE_ENV = "GONOGO_UPLINK_PAGE_WRITE";
