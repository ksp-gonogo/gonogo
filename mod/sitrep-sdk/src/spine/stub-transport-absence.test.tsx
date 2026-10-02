// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { act, render, screen, setupStreamFixture } from "../testing";
import { useStream } from "./use-stream";

function Mission() {
  const reading = useStream<{ name: string }>("missions.active");
  return (
    <output>
      {reading.state === "observed" ? reading.value.name : reading.state}
    </output>
  );
}

describe("StubTransport emitting a null payload", () => {
  it("reads as a confirmed absence after an observed value, never as an observation", () => {
    const stream = setupStreamFixture();
    render(
      <stream.Provider>
        <Mission />
      </stream.Provider>,
    );

    act(() => {
      stream.emit("missions.active", { name: "First Steps" });
      stream.store.beginFrame();
    });
    expect(screen.getByRole("status").textContent).toBe("First Steps");

    act(() => {
      stream.emit("missions.active", null);
      stream.store.beginFrame();
    });
    expect(screen.getByRole("status").textContent).toBe("absent");
  });
});
