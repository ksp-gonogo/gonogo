import type { CommsDelay } from "../__generated__/contract";
import { isValue } from "../unit-system/value";
import { ROUTE_TOPIC, readRouteDelays } from "./comms-route";

/**
 * The `comms.delay` channel topic: the one-way signal delay between the vessel
 * and the command centre, published by the core `SignalDelay` capability. Useful
 * for timing everything the operator sees by how long the signal takes to
 * arrive. Read by `DelayAuthority`.
 *
 * It is a `Delayed` channel, so it travels home at the same delay as every
 * other channel. A reading describes the delay when the signal left the vessel
 * and not the delay now.
 */
export const COMMS_DELAY_TOPIC = "comms.delay";

/**
 * The `commandCentre.activeVesselDelay` channel topic: each command centre's
 * own delay to the active vessel, the rows the mod times that centre's traffic
 * by. Useful for showing the operator the delay at a forward command centre.
 * Read by `DelayAuthority`.
 *
 * The rows are sparse: home and any centre without a route are absent, and
 * both use `comms.delay`.
 */
export const CENTRE_DELAY_TOPIC = "commandCentre.activeVesselDelay";

export const ROSTER_TOPIC = "commandCentre.roster";

/**
 * What `DelayAuthority` needs of a client: Topic subscription, and the vantage
 * the session stands at, which picks which command centre's delay applies.
 * Taken by the `DelayAuthority` constructor, and met by the telemetry client.
 */
export interface DelaySubscribable {
  subscribe(topic: string, cb: (payload: unknown) => void): () => void;
  /** The centre this session asked to observe from, if it has asked. */
  readonly selectedVantage?: string;
  /** The centre the latest ordinary frame was delayed from. */
  readonly observedVantage?: string;
}

/**
 * A wire seconds field, bare or wrapped by the decode, as a finite
 * non-negative number, or `null` for anything else. The one unwrap in this
 * file: the view clock takes a plain number.
 */
function readSeconds(field: unknown): number | null {
  const seconds =
    typeof field === "number"
      ? field
      : isValue(field)
        ? field.magnitude
        : undefined;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  return seconds;
}

/**
 * Each listed command centre's own delay to the active vessel, keyed by centre
 * id, or `null` for a payload that is not a `commandCentre.activeVesselDelay`
 * payload. Useful for showing the operator the delay at each command centre.
 * Used by the signal delay readout, the chip that shows the one-way delay
 * between a command centre and a vessel.
 *
 * An entry with no usable number is left out and never read as zero, so that
 * centre uses `comms.delay`, as it does when its row is missing.
 */
export function readCentreDelays(
  payload: unknown,
): ReadonlyMap<string, number> | null {
  if (typeof payload !== "object" || payload === null) return null;
  if (!("centres" in payload) || !Array.isArray(payload.centres)) return null;
  const delays = new Map<string, number>();
  for (const entry of payload.centres) {
    if (typeof entry !== "object" || entry === null) continue;
    const id = "id" in entry ? entry.id : undefined;
    const seconds = readSeconds(
      "oneWaySeconds" in entry ? entry.oneWaySeconds : undefined,
    );
    if (typeof id === "string" && id !== "" && seconds !== null) {
      delays.set(id, seconds);
    }
  }
  return delays;
}

/**
 * The id of the command centre marked home in a roster payload, or `null` for a
 * payload that names none. Useful for telling which command centre the operator
 * is at by default.
 */
export function readHomeCentre(payload: unknown): string | null {
  if (!Array.isArray(payload)) return null;
  for (const entry of payload) {
    if (typeof entry !== "object" || entry === null) continue;
    if ("isHome" in entry && entry.isHome === true && "id" in entry) {
      return typeof entry.id === "string" ? entry.id : null;
    }
  }
  return null;
}

/**
 * The one-way delay in seconds that a `comms.delay` payload reports, or
 * `null` when it reports no measurable delay. Useful for anything timed by
 * the signal delay. Used by the delay clock and by the signal delay readout.
 * A caller keeps its previous delay through a `null` and never reads it as
 * zero.
 *
 * The answer comes from the value and never from `source`, because
 * `CommsDelaySource.None` covers two opposite states: a 0 is "the delay
 * feature is off and the vessel is connected", and a null is "there is no
 * path home to measure".
 *
 * Only a finite, non-negative delay is returned, as a bare number or as the
 * magnitude of a `Value`. An absent or malformed payload, NaN and a negative
 * all return `null`, because a zero reported wrongly would release every
 * delayed channel at once.
 */
export function readOneWaySeconds(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const delay = payload as Partial<CommsDelay>;
  return readSeconds(delay.oneWaySeconds);
}

/**
 * Holds the one-way delay between this session's command centre and the vessel,
 * which times the frames the operator sees, and exposes it as `delaySeconds()`
 * for the view clock to read (`ViewClockOptions.delaySeconds`). Useful for
 * keeping telemetry and video aligned to how long the signal takes to arrive.
 * Used by `TelemetryProvider`, which builds one for the shared view clock.
 *
 * The delay is the session's own command centre's row on
 * `commandCentre.activeVesselDelay` where it has one, and otherwise
 * `comms.delay`, the delay used by every centre without a row. So a session at
 * a forward centre runs its clock on that centre's delay, and one at home on
 * home's.
 *
 * It enforces nothing: the mod has already withheld each channel's samples
 * until `UT <= now - delay`. The value only sizes how far `utNowEstimate()`
 * leads `confirmedEdgeUt()`. Media reads the same clock.
 */
export class DelayAuthority {
  /*
   * **This is legibility, not enforcement.** The mod's reveal gate
   * (`ChannelEngine`) has already withheld each channel's samples
   * until `UT <= now - delay`, so the raw timeline the client receives is
   * already delayed: for the SDK, a curl script, or a station relay alike.
   * This value does not re-gate anything; it only sizes the SDK's
   * predict-forward horizon: how far `utNowEstimate()` leads `confirmedEdgeUt()`
   * so a delayed vessel can be dead-reckoned to the predicted present and the
   * certainty-horizon snap is drawn in the right place. Because
   * media (kerbcast `DelayedPlayoutBuffer`) reads the same clock, aligning this
   * one value aligns telemetry and video for free.
   *
   * There is no loop here, though it takes a moment to see why. `comms.delay` is
   * itself `Delayed`, so the reading arrives one signal delay after the delay it
   * reports took that value. What decides when it arrives is the server's ledger,
   * not this clock, and `attach` below subscribes to the raw stream rather than
   * to a view-time-gated reading, so nothing the view clock computes feeds back
   * into what the view clock is computed from. The consequence is only that the
   * horizon is sized from the last delay the operator could have known, which is
   * the same standard every other readout on this wire is held to.
   */
  private oneWaySeconds = 0;
  private ownCraftVantage = false;
  private centreDelays: ReadonlyMap<string, number> = new Map();
  /** Each centre's own delay as last listed, kept after its row goes. */
  private readonly lastCentreDelays = new Map<string, number>();
  /** Each centre's predicted downlink delay, waits included, from the latest routes. */
  private routeDelays: ReadonlyMap<string, number> = new Map();
  /** Each centre's last predicted live downlink delay, kept after the route stops being live. */
  private readonly lastLiveRouteDelays = new Map<string, number>();
  /** The centre the roster names home, once a roster has said. */
  private homeCentre: string | undefined;
  private vantageSource: DelaySubscribable | undefined;

  /**
   * Feed one `comms.delay` payload. A frame that reports a measurable one-way
   * time sets it; one that reports none (no path home, or a malformed frame)
   * holds the last known delay.
   *
   * Holding is what makes a blackout behave like a blackout. Losing the path
   * does not move the craft closer, and `comms.delay` stops arriving while the
   * link is down (an ordinary Delayed channel freezes at last-known), so
   * holding is the only behaviour that leaves the horizon where the last real
   * measurement put it. `comms.link` is freeze-exempt and keeps arriving, as do
   * the TrueNow channels, so `ViewClock.maxSampleUt` still advances through the
   * outage: the sample clamp does not hold the horizon back, only the delay
   * term does. Reset it to 0
   * and `confirmedEdgeUt()` snaps a whole signal delay forward at the moment the
   * craft becomes unreachable, dumping the media playout buffer and reporting
   * the disconnect at T+0 instead of the T+delay `CommsLink` promises.
   *
   * The three alternatives all lose something this keeps. Freezing the clock
   * (a non-finite delay) drives `confirmedEdgeUt()` to `-Infinity`, which is
   * the post-rewind "resynchronizing" state: every widget drops its last-known
   * reading, where the blackout design wants exactly those held and labelled
   * `LastBeforeBlackout`. Refusing to advance view time stalls the release of
   * samples already in flight, which are real and still arriving. A large
   * constant is a fabricated measurement, and would misplace the certainty
   * horizon by however much it missed by.
   *
   * A LAN session is unaffected: nothing to hold before the first reading, so
   * the delay stays 0 and `confirmedEdgeUt()` sits on `utNowEstimate()`
   * byte-for-byte, and a real zero (delay switched off, vessel connected)
   * still sets 0 like any other reading.
   */
  observe(payload: unknown): void {
    const reported = readOneWaySeconds(payload);
    if (reported === null) return;
    this.oneWaySeconds = reported;
  }

  /**
   * Feed one `commandCentre.activeVesselDelay` payload: each listed centre's
   * own delay to the active craft replaces the last set whole, since a centre
   * dropped from the list has lost its row. A payload that is not one leaves
   * the last set standing.
   *
   * Nothing here is held per centre through a blackout because nothing needs
   * to be: the channel is Delayed, so it stops arriving while the craft is out
   * of contact, and the last set stands until it resumes.
   */
  observeCentreDelays(payload: unknown): void {
    const delays = readCentreDelays(payload);
    if (delays === null) return;
    this.centreDelays = delays;
    for (const [centre, seconds] of delays) {
      this.lastCentreDelays.set(centre, seconds);
    }
  }

  /**
   * Feed one `comms.route` payload: each centre's predicted downlink delay
   * replaces the last set whole, and a live one is also kept as that centre's
   * last live delay.
   */
  observeRoutes(payload: unknown): void {
    const routes = readRouteDelays(payload);
    if (routes === null) return;
    const delays = new Map<string, number>();
    for (const [centre, route] of routes) {
      const seconds = readSeconds(route.seconds);
      if (seconds === null) continue;
      delays.set(centre, seconds);
      if (route.live) this.lastLiveRouteDelays.set(centre, seconds);
    }
    this.routeDelays = delays;
  }

  /** Feed one `commandCentre.roster` payload, to learn which centre is home. */
  observeRoster(payload: unknown): void {
    const home = readHomeCentre(payload);
    if (home !== null) this.homeCentre = home;
  }

  /**
   * Tell the authority whether this session's selected vantage is the craft
   * its own telemetry is about (`isOwnCraftVantage`). While it is, the delay
   * is 0 whatever `comms.delay` reports.
   *
   * The craft's own centre is also listed at zero on
   * `commandCentre.activeVesselDelay`, and this flag covers the moment before
   * that list reaches the new session: a pilot's vantage changes on the frame
   * the craft names itself, and until then the clock would read home's
   * `comms.delay` over frames the mod is already delivering live. At a
   * signal delay over the timeline's retention that is not merely late:
   * `ClientTimeline.at(viewUt)` falls below the oldest retained point and
   * every widget goes absent on a live feed.
   */
  setOwnCraftVantage(ownCraft: boolean): void {
    this.ownCraftVantage = ownCraft;
  }

  /**
   * The current one-way delay in seconds. Pass `authority.delaySeconds` (bound
   * below) straight into `ViewClockOptions.delaySeconds`. Bound as an arrow
   * field so the identity is stable across renders and `this` is preserved
   * when handed off as a bare function reference.
   *
   * Zero while the session is at its own craft's vantage, per
   * `setOwnCraftVantage`. Otherwise the selected centre's own row, or the
   * observed one's before this session has chosen. A centre whose row has gone
   * has lost its own route, which is not home's, so it holds the delay it was
   * last listed at, as `comms.delay` holds home's through a blackout; playing
   * it at home's delay would show it pictures and readings on a path it does
   * not have. A centre never listed takes its own routed delay from
   * `comms.route` once the roster has said it is not home: its last live route
   * if it has had one, held through a gap as the listed delay is, and otherwise
   * the route that would reach it, waits included. `comms.delay` is home's, and
   * every centre's until the roster and a route say otherwise. All of it is
   * kept across a vantage change, so a move to another centre reports that
   * centre's last measured signal delay immediately instead of waiting a whole
   * one to re-learn it.
   */
  delaySeconds = (): number => {
    if (this.ownCraftVantage) return 0;
    const vantage =
      this.vantageSource?.selectedVantage ??
      this.vantageSource?.observedVantage;
    if (vantage === undefined) return this.oneWaySeconds;
    return (
      this.centreDelays.get(vantage) ??
      this.lastCentreDelays.get(vantage) ??
      this.routedDelay(vantage) ??
      this.oneWaySeconds
    );
  };

  private routedDelay(vantage: string): number | undefined {
    if (this.homeCentre === undefined || vantage === this.homeCentre) {
      return undefined;
    }
    return (
      this.lastLiveRouteDelays.get(vantage) ?? this.routeDelays.get(vantage)
    );
  }

  /**
   * Subscribe to `comms.delay`, `commandCentre.activeVesselDelay`,
   * `comms.route` and `commandCentre.roster` on `client`, keeping `delaySeconds()` current, and read the session's vantage
   * off it from then on. `TelemetryClient.subscribe` replays its sticky last
   * value immediately, so a late-attaching authority still learns the current
   * delay on the next delivery: no full-cycle wait. Returns the unsubscribe
   * function.
   */
  attach(client: DelaySubscribable): () => void {
    this.vantageSource = client;
    const detachHome = client.subscribe(COMMS_DELAY_TOPIC, (payload) =>
      this.observe(payload),
    );
    const detachCentres = client.subscribe(CENTRE_DELAY_TOPIC, (payload) =>
      this.observeCentreDelays(payload),
    );
    const detachRoutes = client.subscribe(ROUTE_TOPIC, (payload) =>
      this.observeRoutes(payload),
    );
    const detachRoster = client.subscribe(ROSTER_TOPIC, (payload) =>
      this.observeRoster(payload),
    );
    return () => {
      detachRoster();
      detachRoutes();
      detachCentres();
      detachHome();
      if (this.vantageSource === client) this.vantageSource = undefined;
    };
  }
}
