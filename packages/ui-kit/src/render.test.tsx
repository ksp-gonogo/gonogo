import { useCommand } from "@ksp-gonogo/sitrep-sdk/spine";
import {
  act,
  fireEvent,
  screen,
  render as sdkRender,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { renderHookWithRail, renderWithRail } from "./testing";

/** A widget-shaped dispatch, the same command id the sdk's own rail tests use. */
function Unlock({ rail }: { rail?: false }) {
  const cmd = useCommand("career.tech.unlock", rail === false ? { rail } : {});
  return (
    <button type="button" onClick={() => void cmd.send({ techId: "n" })}>
      unlock
    </button>
  );
}

describe("@ksp-gonogo/ui-kit/testing renderWithRail/renderHookWithRail", () => {
  it("mounts a command rail, so a dispatched command reaches the transport with no throw", async () => {
    const stream = setupStreamFixture();
    renderWithRail(
      <stream.Provider>
        <Unlock />
      </stream.Provider>,
    );
    expect(() => {
      fireEvent.click(screen.getByText("unlock"));
    }).not.toThrow();
    expect(stream.transport.sentCommands).toHaveLength(1);
    expect(stream.transport.sentCommands[0].command).toBe("career.tech.unlock");
    // The stub transport answers over a microtask; hold the scope open so the reply settles inside act.
    await act(async () => {});
  });

  it("is what an Uplink test needs: the bare sdk render mounts no rail and throws on the same dispatch", () => {
    const stream = setupStreamFixture();
    sdkRender(
      <stream.Provider>
        <Unlock />
      </stream.Provider>,
    );
    expect(() => {
      fireEvent.click(screen.getByText("unlock"));
    }).toThrow(/no command rail/);
  });

  it("renderHookWithRail mounts the same rail, so a hook-level dispatch reaches the transport", async () => {
    const stream = setupStreamFixture();
    const { result } = renderHookWithRail(
      () => useCommand("career.tech.unlock"),
      { wrapper: stream.Provider },
    );
    expect(() => {
      act(() => {
        result.current.send({ techId: "n" });
      });
    }).not.toThrow();
    expect(stream.transport.sentCommands).toHaveLength(1);
    await act(async () => {});
  });

  it("composes with a caller's own wrapper rather than replacing it", async () => {
    const stream = setupStreamFixture();
    renderWithRail(<Unlock />, { wrapper: stream.Provider });
    expect(() => {
      fireEvent.click(screen.getByText("unlock"));
    }).not.toThrow();
    expect(stream.transport.sentCommands).toHaveLength(1);
    await act(async () => {});
  });

  it("still keeps a rail: false handle off the rail, same as the sdk's bare render", async () => {
    const stream = setupStreamFixture();
    renderWithRail(
      <stream.Provider>
        <Unlock rail={false} />
      </stream.Provider>,
    );
    expect(() => {
      fireEvent.click(screen.getByText("unlock"));
    }).not.toThrow();
    expect(stream.transport.sentCommands).toHaveLength(1);
    await act(async () => {});
  });
});
