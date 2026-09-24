import type { CommsDelay } from "../__generated__/contract";
import { isValue } from "../unit-system/value";

/**
 * The `comms.delay` channel topic: the CORE `SignalDelay` capability's
 * output (`mod/Gonogo.KSP/CommsCoreUplink.cs:DelayTopic`,
 * `mod/Sitrep.Host/ChannelEngine.cs:CommsDelayTopic`). A `Delayed` channel:
 * what defines the delay is the mod's ledger, written by the capture pass, and
 * this is the READOUT published from the same numbers, so it travels home at
 * the speed everything else does. Read it as an observation of the link, not as
 * the link's current state.
 */
export const COMMS_DELAY_TOPIC = "comms.delay";

/**
 * The `commandCentre.activeVesselDelay` channel topic: each command centre's
 * own delay to the active craft, the rows the mod's ledger times that centre's
 * traffic by (`mod/Gonogo.KSP/CommandCentres/CommandCentreDelayUplink.cs`).
 * Sparse: home and any centre without a route are absent, and both ride
 * `comms.delay` in the ledger.
 */
export const CENTRE_DELAY_TOPIC = "commandCentre.activeVesselDelay";

/**
 * The minimal client surface `DelayAuthority` needs: topic subscription, and
 * the vantage the session stands at, which picks whose delay applies.
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
 * Each listed centre's own delay to the active craft, keyed by centre id, or
 * `null` for a payload that is not one. An entry with no usable number is left
 * out rather than read as zero, which puts that centre back on `comms.delay`
 * exactly as a missing ledger row does.
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
 * Extract the one-way delay (seconds) a `comms.delay` payload REPORTS, or
 * `null` when it reports no measurable one, which the caller holds through
 * rather than reading as zero.
 *
 * The discriminator is the VALUE, never `source`
 * (`mod/Sitrep.Contract/Comms.cs:CommsDelay`). `CommsDelaySource.None` covers
 * two opposite states that share it: a 0 is "the delay feature is off and the
 * vessel is connected", a null is "there is no path home to measure". Reading
 * the source first collapsed the second onto the first, so a craft nothing
 * could reach was clocked as if it were on the LAN. `command-delay.ts`'s
 * `currentMode` reads the same payload the same value-first way; the two now
 * agree.
 *
 * A wrapped, finite, non-negative reading is the only thing that MOVES the
 * delay. Absence, malformation, NaN and a negative alike return `null`: not
 * one of them is evidence that the craft got closer, and zero is the single
 * direction this must never fail in, because a zero pins the whole clock to
 * the predicted present and releases every delayed channel at once.
 */
export function readOneWaySeconds(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const delay = payload as Partial<CommsDelay>;
  return readSeconds(delay.oneWaySeconds);
}

/**
 * The client-side delay authority. Holds the delay this session's frames are
 * timed by and exposes it as a `delaySeconds()` accessor wired into the ONE
 * `ViewClock` (`ViewClockOptions.delaySeconds`).
 *
 * The number is the mod's ledger lookup, restated: the session's own centre's
 * row on `commandCentre.activeVesselDelay` where it has one, and otherwise
 * `comms.delay`, the whole-network delay every centre without a row is timed
 * by. So a session at a forward centre runs its clock on that centre's own
 * light-time, and one at home runs it on home's.
 *
 * **This is legibility, NOT enforcement.** The mod's reveal gate
 * (`ChannelEngine`) has already withheld each channel's samples
 * until `UT <= now - delay`, so the raw timeline the client receives is
 * already delayed: for the SDK, a curl script, or a station relay alike.
 * This value does not re-gate anything; it only sizes the SDK's
 * PREDICT-FORWARD horizon: how far `utNowEstimate()` leads `confirmedEdgeUt()`
 * so a delayed vessel can be dead-reckoned to the predicted present and the
 * certainty-horizon snap is drawn in the right place. Because
 * media (kerbcast `DelayedPlayoutBuffer`) reads the same clock, aligning this
 * one value aligns telemetry and video for free.
 *
 * There is no loop here, though it takes a moment to see why. `comms.delay` is
 * itself `Delayed`, so the reading arrives one light-time after the delay it
 * reports took that value. What decides when it arrives is the SERVER's ledger,
 * not this clock, and `attach` below subscribes to the raw stream rather than
 * to a view-time-gated reading, so nothing the view clock computes feeds back
 * into what the view clock is computed from. The consequence is only that the
 * horizon is sized from the last delay the operator could have known, which is
 * the same standard every other readout on this wire is held to.
 */
export class DelayAuthority {
  private oneWaySeconds = 0;
  private ownCraftVantage = false;
  private centreDelays: ReadonlyMap<string, number> = new Map();
  private vantageSource: DelaySubscribable | undefined;

  /**
   * Feed one `comms.delay` payload. A frame that reports a measurable one-way
   * time sets it; one that reports none (no path home, or a malformed frame)
   * HOLDS the last known delay.
   *
   * Holding is what makes a blackout behave like a blackout. Losing the path
   * does not move the craft closer, and `comms.delay` stops arriving while the
   * link is down (an ordinary Delayed channel freezes at last-known), so
   * holding is the only behaviour that leaves the horizon where the last real
   * measurement put it. `comms.link` is freeze-exempt and keeps arriving, as do
   * the TrueNow channels, so `ViewClock.maxSampleUt` still advances through the
   * outage: the sample clamp does not hold the horizon back, only the delay
   * term does. Reset it to 0
   * and `confirmedEdgeUt()` snaps a whole light-time forward at the moment the
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
   * light-time over the timeline's retention that is not merely late:
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
   * observed one's before this session has chosen, and `comms.delay` for a
   * centre with no row. Both are kept rather than cleared on a vantage change,
   * so a move to another centre reports that centre's last measured
   * light-time immediately instead of waiting a whole one to re-learn it.
   */
  delaySeconds = (): number => {
    if (this.ownCraftVantage) return 0;
    const vantage =
      this.vantageSource?.selectedVantage ??
      this.vantageSource?.observedVantage;
    const own =
      vantage === undefined ? undefined : this.centreDelays.get(vantage);
    return own ?? this.oneWaySeconds;
  };

  /**
   * Subscribe to `comms.delay` and `commandCentre.activeVesselDelay` on
   * `client`, keeping `delaySeconds()` current, and read the session's vantage
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
    return () => {
      detachCentres();
      detachHome();
      if (this.vantageSource === client) this.vantageSource = undefined;
    };
  }
}
