/**
 * One standing socket to the mod that holds the newest payload of every Topic
 * it was asked for, so a scenario can wait on a value and record what the game
 * said at the moment it captured a frame.
 *
 * The mod pushes nothing until each Topic is subscribed by name, and a
 * reveal-gated `vessel.*` Topic stays silent while the vessel has no link, so
 * "no payload yet" is reported as its own state rather than as a timeout on the
 * value.
 */
import WebSocket from "ws";

export class TopicWatch {
  constructor(url) {
    this.url = url;
    this.latest = new Map();
    this.waiters = new Set();
    this.topics = new Set();
    this.socket = null;
  }

  /** Open the socket and resolve once it is ready to subscribe. */
  open() {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      socket.once("open", () => {
        for (const topic of this.topics) this.#send(topic);
        resolve();
      });
      socket.once("error", reject);
      socket.on("message", (data) => this.#receive(data));
    });
  }

  close() {
    this.socket?.close();
  }

  /** Ask the mod for `topic`. Idempotent. */
  subscribe(topic) {
    if (this.topics.has(topic)) return;
    this.topics.add(topic);
    if (this.socket?.readyState === WebSocket.OPEN) this.#send(topic);
  }

  /** The newest payload seen for `topic`, with the local time it arrived. */
  get(topic) {
    return this.latest.get(topic);
  }

  /** Every Topic's newest payload, keyed by Topic. */
  snapshot() {
    return Object.fromEntries(this.latest);
  }

  /**
   * Resolve with the payload once `until(payload)` holds for `topic`. Rejects
   * after `timeoutMs`, saying whether any payload had arrived at all.
   */
  waitFor(topic, until, timeoutMs) {
    this.subscribe(topic);
    const current = this.latest.get(topic);
    if (current && until(current.payload))
      return Promise.resolve(current.payload);
    return new Promise((resolve, reject) => {
      const waiter = {
        topic,
        check: (payload) => {
          if (!until(payload)) return;
          clearTimeout(timer);
          this.waiters.delete(waiter);
          resolve(payload);
        },
      };
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        const last = this.latest.get(topic);
        reject(
          new Error(
            last
              ? `${topic}: condition not met in ${timeoutMs} ms; last payload ${JSON.stringify(last.payload).slice(0, 400)}`
              : `${topic}: no payload at all in ${timeoutMs} ms`,
          ),
        );
      }, timeoutMs);
      this.waiters.add(waiter);
    });
  }

  #send(topic) {
    this.socket.send(JSON.stringify({ type: "subscribe", topic }));
  }

  #receive(data) {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (message?.type !== "stream-data") return;
    this.latest.set(message.topic, {
      at: new Date().toISOString(),
      payload: message.payload,
    });
    for (const waiter of this.waiters) {
      if (waiter.topic === message.topic) waiter.check(message.payload);
    }
  }
}
