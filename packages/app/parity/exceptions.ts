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

/**
 * Scenes that differ today and should not, by scene id
 * (`<render config label>/<fixture>`), each with what the station lacks. Every
 * entry is a defect: the list only shrinks, and an entry whose scene has come
 * to match fails the gate until it is removed.
 */
export const PARITY_DEBT: Readonly<Record<string, string>> = {};
