// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { registerDynamicTopicPrefix } from "../runtime-topic-registry";
import { act, render, screen, setupStreamFixture } from "../testing";
import { useStream } from "./use-stream";

function Forecast({ topic }: Readonly<{ topic: string }>) {
  const reading = useStream<number>(topic);
  return (
    <output>{reading.state === "observed" ? reading.value : "none"}</output>
  );
}

/** The widget mounted on `topic`, then the mod's value emitted on it; the emit reaches the store only if the widget subscribed that exact topic. */
function readThroughTheWire(topic: string): string | null {
  const stream = setupStreamFixture();
  render(
    <stream.Provider>
      <Forecast topic={topic} />
    </stream.Provider>,
  );
  act(() => {
    stream.emit(topic, 4_200_000);
    stream.store.beginFrame();
  });
  return screen.getByRole("status").textContent;
}

describe("a Topic under a dynamic prefix a client package registers", () => {
  it("is subscribed and read whole", () => {
    registerDynamicTopicPrefix("planted.forecast.");
    expect(readThroughTheWire("planted.forecast.250000")).toBe("4200000");
  });

  it("is subscribed as a parent nobody publishes when no prefix covers it", () => {
    expect(readThroughTheWire("planted.unregistered.250000")).toBe("none");
  });
});
