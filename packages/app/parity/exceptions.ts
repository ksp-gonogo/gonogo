/**
 * Widgets that are MEANT to draw differently on a station, by registered id,
 * each with the reason. A widget named here is not compared.
 *
 * The bar for an entry: the difference is the widget doing its job, because
 * what it shows is a fact about the screen it is on (its role, its identity,
 * its vantage) rather than about the game. A widget that differs because a
 * station was not told something belongs in {@link PARITY_DEBT}, never here.
 */
export const MEANT_TO_DIFFER: Readonly<Record<string, string>> = {
  gonogo:
    "The main screen tallies every participant's vote and runs the countdown; every other screen casts its own vote and reads the tally back",
  notes:
    "The main screen owns the canonical list and edits it in place; a station mirrors it over the notes channel, not the telemetry relay",
};

const HISTORY_NOT_BACKFILLED =
  "A late station's chart holds only the one sample the host replays on joining; the history the main screen plotted before it joined is never sent";

/**
 * Scenes that differ today and should not, by scene id
 * (`<render config label>/<fixture>`), each with what the station lacks. Every
 * entry is a defect: the list only shrinks, and an entry whose scene has come
 * to match fails the gate until it is removed.
 */
export const PARITY_DEBT: Readonly<Record<string, string>> = {
  /*
   * The relay replays only the newest frame of each topic to a joining
   * station, so every series the main screen has been plotting starts again
   * from one point there.
   */
  "graph/blackout/link-loss-gap-marked": HISTORY_NOT_BACKFILLED,
  "graph/blackout/link-loss-gap-not-marked": HISTORY_NOT_BACKFILLED,
  "graph/blackout/link-loss-nothing-recorded": HISTORY_NOT_BACKFILLED,
  "graph/warp-charge-1x/charge-at-1x": HISTORY_NOT_BACKFILLED,
  "graph/warp-charge-fast/charge-at-100000x": HISTORY_NOT_BACKFILLED,
  "graph/warp-conic-1000x/altitude-on-rails-at-1000x": HISTORY_NOT_BACKFILLED,
  "graph/warp-conic-fast/altitude-on-rails-at-100000x": HISTORY_NOT_BACKFILLED,
  "graph/warp-dock-1x/dock-distance-at-1x": HISTORY_NOT_BACKFILLED,
  "graph/warp-dock-fast/dock-distance-at-100000x": HISTORY_NOT_BACKFILLED,
  "launch-director/in-flight-modelled-altitude":
    "The funds balance reads HELD on the main screen and live on the station: the backfilled career.status lands after later frames have moved the certainty horizon, so the heartbeat tracker counts it as a fresh arrival",
};
