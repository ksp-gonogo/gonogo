/**
 * Deciding whether anything will EVER publish a topic, from the mod's own
 * answer rather than from a reconstruction of it.
 *
 * ## The authority, and the one that was rejected
 *
 * `ProcessSubscribe` answers a subscribe for a declared channel (or one under a
 * registered dynamic namespace) with an `EventMsg { name: "subscribed" }`, and
 * answers a subscribe for anything else with a bare return: no error, no ack,
 * nothing at all. So the mod already states ownership positively and withholds
 * the statement in exactly the case where it cannot be made. "We sent a
 * subscribe and no ack came back inside a bounded window" is therefore the
 * authority's own answer.
 *
 * The alternative was deriving it from `system.uplinks`'s `ownedPrefixes`, and
 * it does not work: that list is built from `_channelOwner`, which is only
 * written for channels declared through an uplink MANIFEST. Four engine
 * built-ins are declared outside one and would have been reported as unowned,
 * `system.units` among them. Worse, an Uplink whose `Register` throws is
 * fail-soft-caught and declares no channels at all, so the rule would tell an
 * author "nothing owns this" when the truth is "your Uplink is installed and
 * broke on load". The ack gets that case right for free: still no ack, and the
 * roster carries the reason.
 *
 * ## Silence is not evidence. Everything here is built around that
 *
 * A false `unowned` tells an author their correct code is broken, which is
 * worse than the silence it removes. So this tracker only ever moves a topic to
 * `"unowned"` from a POSITIVE observation: a subscribe frame that we know left
 * on a live connection, and a window that then elapsed with the connection
 * still live. Everything else is {@link TopicOwnership} `"undecided"`, which
 * the reading layer renders as `pending`.
 *
 * The lifecycle rules that keep that true:
 *
 * - a topic is armed only when a subscribe is actually SENT
 * - losing the connection disarms everything and forgets every verdict. A
 *   subscribe whose ack was still in flight when the socket dropped must not
 *   mature into "unowned" while nothing can answer
 * - reconnecting re-arms every still-subscribed topic, because the transports
 *   re-send their whole subscription set on each connect and the mod's session
 *   (and its ack bookkeeping) is new
 * - `owned` is sticky for the life of a connection. Channels are declared and
 *   never undeclared, so ownership within one session can only grow. This is
 *   also what makes a vantage change safe: it unsubscribes and resubscribes
 *   every topic, and without stickiness each would flap back to undecided
 */

/**
 * What we can say about whether anything will ever publish a topic.
 *
 * Three values rather than two, and the third is the important one:
 * `"undecided"` is a real answer that a caller must not collapse into either
 * neighbour. Not yet asked, asked too recently to know, asked over a transport
 * that cannot tell, and asked while disconnected are all `"undecided"`.
 */
export type TopicOwnership = "owned" | "unowned" | "undecided";

/**
 * How long to wait for a `subscribed` ack before calling a topic unowned.
 *
 * The ack is minted synchronously inside `ProcessSubscribe` and rides the
 * reliable lane, so on a healthy link it arrives in milliseconds. This is sized
 * for an unhealthy one instead: a courier thread busy behind a scene load, a
 * relay hop, a station's PeerJS round trip. Generous on purpose, because the
 * cost of waiting too long is a diagnostic arriving late and the cost of not
 * waiting long enough is telling an author their working code is broken.
 */
export const OWNERSHIP_ACK_WINDOW_MS = 10_000;

interface Armed {
  /** Cleared when the ack lands, the topic is released, or the link drops. */
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Tracks the `subscribed` acks for one connection.
 *
 * One instance per {@link TelemetryClient}, and its whole state is scoped to a
 * single connection: {@link handleDisconnected} throws all of it away, because
 * a verdict reached against one mod session says nothing about the next.
 */
export class TopicOwnershipTracker {
  private readonly owned = new Set<string>();
  private readonly unowned = new Set<string>();
  private readonly armed = new Map<string, Armed>();
  private readonly windowMs: number;
  private readonly onUnowned: (topic: string) => void;
  private connected = true;

  /**
   * `onUnowned` fires once per topic per connection, at the moment the verdict
   * is reached. It is how the store learns to re-derive the reading and how the
   * warning gets logged, so it must not be used to fan out a value.
   */
  constructor(
    onUnowned: (topic: string) => void,
    windowMs: number = OWNERSHIP_ACK_WINDOW_MS,
  ) {
    this.onUnowned = onUnowned;
    this.windowMs = windowMs;
  }

  ownershipOf(topic: string): TopicOwnership {
    if (this.owned.has(topic)) return "owned";
    if (this.unowned.has(topic)) return "unowned";
    return "undecided";
  }

  /** Every topic this connection has decided is unowned. For diagnostics. */
  unownedTopics(): readonly string[] {
    return [...this.unowned];
  }

  /**
   * A `subscribe` frame for `topic` has just gone out. Starts the window.
   *
   * A no-op once the topic is known owned: a resubscribe (a vantage change
   * sends one for every active topic) must not reopen a settled question, and a
   * second window would decide nothing the first has not already.
   */
  noteSubscribeSent(topic: string): void {
    if (!this.connected) return;
    if (this.owned.has(topic)) return;
    if (this.armed.has(topic)) return;
    this.armed.set(topic, {
      timer: setTimeout(() => {
        this.armed.delete(topic);
        // Re-checked rather than assumed: the ack can land in the same tick the
        // timer fires, and a disconnect can beat both.
        if (!this.connected || this.owned.has(topic)) return;
        if (this.unowned.has(topic)) return;
        this.unowned.add(topic);
        this.onUnowned(topic);
      }, this.windowMs),
    });
  }

  /** The mod acked `topic`. Settles it owned for the life of this connection. */
  noteAck(topic: string): void {
    this.unowned.delete(topic);
    this.owned.add(topic);
    this.disarm(topic);
  }

  /**
   * The mod REFUSED `topic` outright, with an `unknown-topic` error frame.
   * Settles it unowned now rather than waiting out the ack window.
   *
   * The window exists because silence was the only answer an undeclared topic
   * used to get. A refusal is the same verdict arriving as a statement, so it
   * reaches the same callback: one diagnostic, one message, and no second one
   * from the timer that is still armed behind it.
   */
  noteRefused(topic: string): void {
    if (!this.connected) return;
    this.disarm(topic);
    if (this.owned.has(topic) || this.unowned.has(topic)) return;
    this.unowned.add(topic);
    this.onUnowned(topic);
  }

  /**
   * Nothing subscribes to `topic` any more.
   *
   * Cancels a window in flight but keeps a verdict already reached, so a widget
   * unmounting and remounting does not restart the wait. The verdict is a fact
   * about the mod, not about who happened to be listening.
   */
  noteReleased(topic: string): void {
    this.disarm(topic);
  }

  /**
   * The link went down. Forgets every verdict and cancels every window.
   *
   * Deliberately destructive, including of `owned`: the next connection is a
   * new mod session, possibly a different install, and re-earning an ack costs
   * one round trip. Keeping a stale `owned` would be harmless; keeping a stale
   * `unowned` would not, and one rule for both is easier to keep true.
   */
  handleDisconnected(): void {
    this.connected = false;
    for (const topic of this.armed.keys()) this.disarm(topic);
    this.armed.clear();
    this.owned.clear();
    this.unowned.clear();
  }

  /**
   * The link came up. `activeTopics` is every topic still subscribed, which the
   * transports re-send on each connect, so each needs a fresh window against
   * the new session.
   */
  handleConnected(activeTopics: Iterable<string>): void {
    this.connected = true;
    for (const topic of activeTopics) this.noteSubscribeSent(topic);
  }

  /** Cancels every timer. Call when the client is disposed. */
  dispose(): void {
    this.connected = false;
    for (const topic of [...this.armed.keys()]) this.disarm(topic);
  }

  private disarm(topic: string): void {
    const entry = this.armed.get(topic);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.armed.delete(topic);
  }
}
