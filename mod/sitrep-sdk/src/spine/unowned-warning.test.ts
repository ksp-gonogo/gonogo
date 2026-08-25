import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StubTransport } from "../testing/stub-transport";
import { TelemetryClient } from "./client";
import { OWNERSHIP_ACK_WINDOW_MS } from "./topic-ownership";
import {
  installUnownedTopicWarning,
  unownedTopicMessage,
} from "./unowned-warning";

describe("the unowned-topic warning", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the topic and every widget reading it", () => {
    const message = unownedTopicMessage("weather.forecast", [
      "weather-panel",
      "mission-log",
    ]);
    expect(message).toContain('"weather.forecast"');
    expect(message).toContain("Read by weather-panel, mission-log");
  });

  it("still says something useful when the read is outside a widget", () => {
    const message = unownedTopicMessage("weather.forecast", []);
    expect(message).toContain('"weather.forecast"');
    expect(message).toContain("Something is reading it");
  });

  /**
   * The three causes are the whole value of the line. An author reading it
   * should not have to already know this mechanism exists to act on it.
   */
  it("says what to check, including the fail-soft case a roster explains", () => {
    const message = unownedTopicMessage("weather.forecast", []);
    expect(message).toContain("spelled");
    expect(message).toContain("installed and enabled");
    expect(message).toContain("system.uplinks");
  });

  it("fires once per topic however long the session runs", () => {
    const transport = new StubTransport({ decidesTopicOwnership: true });
    const client = new TelemetryClient(transport);
    const seen: string[] = [];
    // Stands in for the logger, which is host-injected and absent here. What is
    // under test is the once-per-topic gate, which sits above the log call.
    const detach = client.onTopicUnowned((topic) => seen.push(topic));
    installUnownedTopicWarning(client);

    client.subscribe("ghost.topic", () => {});
    vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS * 5);
    expect(seen).toEqual(["ghost.topic"]);
    detach();
  });

  /**
   * A diagnostic must never be the thing that breaks the run it is diagnosing.
   * The SDK's logger is a Proxy that throws when no host is installed, which is
   * the ordinary state of a unit test, so the warning has to check first.
   */
  it("does not throw when no host is installed", () => {
    const transport = new StubTransport({ decidesTopicOwnership: true });
    const client = new TelemetryClient(transport);
    installUnownedTopicWarning(client);
    client.subscribe("ghost.topic", () => {});
    expect(() => vi.advanceTimersByTime(OWNERSHIP_ACK_WINDOW_MS)).not.toThrow();
  });

  it("reports the widgets that were reading the topic when the verdict landed", () => {
    const transport = new StubTransport({ decidesTopicOwnership: true });
    const client = new TelemetryClient(transport);
    client.subscribe("ghost.topic", () => {});
    const release = client.noteSubscriberLabel("ghost.topic", "weather-panel");
    client.noteSubscriberLabel("ghost.topic", "mission-log");
    expect([...client.readersOf("ghost.topic")].sort()).toEqual([
      "mission-log",
      "weather-panel",
    ]);
    release();
    expect(client.readersOf("ghost.topic")).toEqual(["mission-log"]);
  });

  /**
   * Two instances of one widget id both reading a topic, one unmounting. The
   * label has to survive, which is why the registry refcounts rather than
   * holding a set.
   */
  it("keeps a label while a second instance of the same widget still reads it", () => {
    const transport = new StubTransport({ decidesTopicOwnership: true });
    const client = new TelemetryClient(transport);
    const releaseFirst = client.noteSubscriberLabel("ghost.topic", "twin");
    client.noteSubscriberLabel("ghost.topic", "twin");
    releaseFirst();
    expect(client.readersOf("ghost.topic")).toEqual(["twin"]);
  });
});
