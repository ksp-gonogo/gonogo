import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OWNERSHIP_ACK_WINDOW_MS,
  TopicOwnershipTracker,
} from "./topic-ownership";

describe("TopicOwnershipTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says undecided about a topic nobody has subscribed to", () => {
    const tracker = new TopicOwnershipTracker(() => {});
    expect(tracker.ownershipOf("vessel.orbit")).toBe("undecided");
  });

  it("stays undecided while the window is still open", () => {
    const tracker = new TopicOwnershipTracker(() => {});
    tracker.noteSubscribeSent("vessel.orbit");
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS - 1);
    expect(tracker.ownershipOf("vessel.orbit")).toBe("undecided");
  });

  it("decides unowned once the window elapses with no ack", () => {
    const seen: string[] = [];
    const tracker = new TopicOwnershipTracker((topic) => seen.push(topic));
    tracker.noteSubscribeSent("nobody.publishes.this");
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS);
    expect(tracker.ownershipOf("nobody.publishes.this")).toBe("unowned");
    expect(seen).toEqual(["nobody.publishes.this"]);
  });

  it("decides owned on the ack, and never fires the callback", () => {
    const seen: string[] = [];
    const tracker = new TopicOwnershipTracker((topic) => seen.push(topic));
    tracker.noteSubscribeSent("vessel.orbit");
    tracker.noteAck("vessel.orbit");
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS * 10);
    expect(tracker.ownershipOf("vessel.orbit")).toBe("owned");
    expect(seen).toEqual([]);
  });

  it("fires once per topic, not once per elapsed window", () => {
    const seen: string[] = [];
    const tracker = new TopicOwnershipTracker((topic) => seen.push(topic));
    tracker.noteSubscribeSent("ghost.topic");
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS);
    // A resubscribe of a topic already judged unowned reopens nothing.
    tracker.noteSubscribeSent("ghost.topic");
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS * 5);
    expect(seen).toEqual(["ghost.topic"]);
  });

  /**
   * `setVantage` sends unsubscribe + subscribe for every active topic. Without
   * stickiness each would reopen a settled question and the whole dashboard
   * would flicker through undecided on every vantage change.
   */
  it("does not reopen an owned topic when it is resubscribed", () => {
    const seen: string[] = [];
    const tracker = new TopicOwnershipTracker((topic) => seen.push(topic));
    tracker.noteSubscribeSent("vessel.orbit");
    tracker.noteAck("vessel.orbit");
    tracker.noteSubscribeSent("vessel.orbit");
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS * 3);
    expect(tracker.ownershipOf("vessel.orbit")).toBe("owned");
    expect(seen).toEqual([]);
  });

  /**
   * The whole design rests on this: silence is only evidence while something is
   * listening. A window that was still open when the link dropped must not
   * mature, because nothing was in a position to answer it.
   */
  it("never decides unowned for a window the disconnect interrupted", () => {
    const seen: string[] = [];
    const tracker = new TopicOwnershipTracker((topic) => seen.push(topic));
    tracker.noteSubscribeSent("vessel.orbit");
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS / 2);
    tracker.handleDisconnected();
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS * 5);
    expect(tracker.ownershipOf("vessel.orbit")).toBe("undecided");
    expect(seen).toEqual([]);
  });

  it("forgets a verdict on disconnect and re-earns it on the next connection", () => {
    const seen: string[] = [];
    const tracker = new TopicOwnershipTracker((topic) => seen.push(topic));
    tracker.noteSubscribeSent("ghost.topic");
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS);
    expect(tracker.ownershipOf("ghost.topic")).toBe("unowned");

    tracker.handleDisconnected();
    expect(tracker.ownershipOf("ghost.topic")).toBe("undecided");

    tracker.handleConnected(["ghost.topic"]);
    expect(tracker.ownershipOf("ghost.topic")).toBe("undecided");
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS);
    expect(tracker.ownershipOf("ghost.topic")).toBe("unowned");
    expect(seen).toEqual(["ghost.topic", "ghost.topic"]);
  });

  it("re-arms a reconnect's topics against the new session, and an ack settles them", () => {
    const seen: string[] = [];
    const tracker = new TopicOwnershipTracker((topic) => seen.push(topic));
    tracker.noteSubscribeSent("vessel.orbit");
    tracker.handleDisconnected();
    tracker.handleConnected(["vessel.orbit"]);
    tracker.noteAck("vessel.orbit");
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS * 3);
    expect(tracker.ownershipOf("vessel.orbit")).toBe("owned");
    expect(seen).toEqual([]);
  });

  /**
   * A widget unmounting cancels the window but keeps a verdict already reached:
   * whether anything publishes a topic is a fact about the mod, not about who
   * happened to be listening at the time.
   */
  it("keeps a reached verdict when the last subscriber goes away", () => {
    const tracker = new TopicOwnershipTracker(() => {});
    tracker.noteSubscribeSent("ghost.topic");
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS);
    tracker.noteReleased("ghost.topic");
    expect(tracker.ownershipOf("ghost.topic")).toBe("unowned");
  });

  it("cancels a window that was still open when the last subscriber went away", () => {
    const seen: string[] = [];
    const tracker = new TopicOwnershipTracker((topic) => seen.push(topic));
    tracker.noteSubscribeSent("ghost.topic");
    tracker.noteReleased("ghost.topic");
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS * 3);
    expect(tracker.ownershipOf("ghost.topic")).toBe("undecided");
    expect(seen).toEqual([]);
  });

  it("lists what it has judged unowned, for a store attaching late", () => {
    const tracker = new TopicOwnershipTracker(() => {});
    tracker.noteSubscribeSent("ghost.one");
    tracker.noteSubscribeSent("ghost.two");
    tracker.noteSubscribeSent("vessel.orbit");
    tracker.noteAck("vessel.orbit");
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS);
    expect([...tracker.unownedTopics()].sort()).toEqual([
      "ghost.one",
      "ghost.two",
    ]);
  });

  it("decides nothing after dispose", () => {
    const seen: string[] = [];
    const tracker = new TopicOwnershipTracker((topic) => seen.push(topic));
    tracker.noteSubscribeSent("ghost.topic");
    tracker.dispose();
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS * 3);
    expect(seen).toEqual([]);
  });
});
