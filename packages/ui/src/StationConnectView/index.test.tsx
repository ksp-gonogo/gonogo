import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECT_STALL_MS,
  describeConnStatus,
  StationConnectView,
  statusTone,
} from "./index";

const baseProps = {
  hostInput: "",
  connStatus: "idle" as const,
  hostNotFound: false,
  everConnected: false,
  onHostInputChange: () => {},
  onConnect: () => {},
  onDownloadLogs: () => {},
};

describe("StationConnectView", () => {
  it("renders the connect prompt with an accessible host input and connect button", () => {
    render(<StationConnectView {...baseProps} />);
    expect(screen.getByText(/Connect to Mission Control/i)).not.toBeNull();
    expect(screen.getByLabelText(/host id/i)).not.toBeNull();
    expect(screen.getByRole("button", { name: /connect/i })).not.toBeNull();
  });

  it("replaces the host input's stripped outline with a :focus-visible ring", () => {
    render(<StationConnectView {...baseProps} />);
    const input = screen.getByLabelText(/host id/i);
    const css = Array.from(document.querySelectorAll("style"))
      .map((el) => el.textContent ?? "")
      .join("\n");
    const inputClass = Array.from(input.classList).find((cls) =>
      css.includes(`.${cls}:focus-visible`),
    );
    expect(inputClass).toBeDefined();
    expect(css).toMatch(
      new RegExp(`\\.${inputClass}:focus-visible\\{[^}]*outline:2px solid`),
    );
  });

  it("calls onConnect on button click and onHostInputChange on typing", async () => {
    const onConnect = vi.fn();
    const onHostInputChange = vi.fn();
    render(
      <StationConnectView
        {...baseProps}
        hostInput="AB3K"
        onConnect={onConnect}
        onHostInputChange={onHostInputChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^connect$/i }));
    expect(onConnect).toHaveBeenCalledWith("AB3K");

    // Typing into the input forwards each change.
    await userEvent.type(screen.getByLabelText(/host id/i), "Z");
    expect(onHostInputChange).toHaveBeenCalled();
  });

  it("disables the connect button and shows the connecting label while connecting", () => {
    render(<StationConnectView {...baseProps} connStatus="connecting" />);
    const button = screen.getByRole("button", { name: /connecting/i });
    expect(button.getAttribute("disabled")).not.toBeNull();
  });

  it("shows the hard not-found error when never connected", () => {
    render(
      <StationConnectView
        {...baseProps}
        hostInput="ZZ9Q"
        connStatus="disconnected"
        hostNotFound
      />,
    );
    expect(screen.getByText(/Couldn't find code/i)).not.toBeNull();
    expect(screen.getByText(/ZZ9Q/)).not.toBeNull();
  });

  it("shows the softer reconnect notice once previously connected", () => {
    render(
      <StationConnectView
        {...baseProps}
        connStatus="reconnecting"
        hostNotFound
        everConnected
      />,
    );
    // Both the reconnect notice and the StatusIndicator are role=status, so match by text.
    expect(
      screen.getByText(/Host reconnecting... The main screen is restarting/i),
    ).not.toBeNull();
  });

  it("blames the broker, not the code, when this device can't reach the broker", () => {
    render(
      <StationConnectView
        {...baseProps}
        hostInput="ZZ9Q"
        connStatus="disconnected"
        hostNotFound
        brokerUnreachable
      />,
    );
    expect(
      screen.getByText(/needs a working internet connection/i),
    ).not.toBeNull();
    expect(
      screen.getByText(/this device needs internet access/i),
    ).not.toBeNull();
    // The code-is-wrong copy would send the operator to the main screen for a fault on this device's network.
    expect(screen.queryByText(/Couldn't find code/i)).toBeNull();
    expect(screen.queryByText(/Check the host ID/i)).toBeNull();
  });

  it("states why it stopped when the host channel never opened, and Connect tries again", async () => {
    const onConnect = vi.fn();
    render(
      <StationConnectView
        {...baseProps}
        hostInput="AB3K"
        connStatus="disconnected"
        hostChannelFailed
        onConnect={onConnect}
      />,
    );
    expect(
      screen.getByText(/Couldn't reach the main screen directly/i),
    ).not.toBeNull();
    expect(screen.queryByText(/Connection lost/i)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^connect$/i }));
    expect(onConnect).toHaveBeenCalledWith("AB3K");
  });

  it("tells a relay that did not answer from a link that names none", () => {
    const { rerender } = render(
      <StationConnectView
        {...baseProps}
        connStatus="disconnected"
        hostChannelFailed
        relayLookup="unreachable"
      />,
    );
    expect(
      screen.getByText(/relay in this link did not answer/i),
    ).not.toBeNull();
    rerender(
      <StationConnectView
        {...baseProps}
        connStatus="disconnected"
        hostChannelFailed
      />,
    );
    expect(screen.getByText(/this link names no relay/i)).not.toBeNull();
    rerender(
      <StationConnectView
        {...baseProps}
        connStatus="disconnected"
        hostChannelFailed
        relayLookup="used"
      />,
    );
    expect(screen.getByText(/even through the relay/i)).not.toBeNull();
  });

  it("renders the injected name editor slot", () => {
    render(
      <StationConnectView
        {...baseProps}
        nameEditor={<span data-testid="name-slot">slot</span>}
      />,
    );
    expect(screen.getByTestId("name-slot")).not.toBeNull();
  });

  it("fires onDownloadLogs from the diagnostics button", async () => {
    const onDownloadLogs = vi.fn();
    render(
      <StationConnectView {...baseProps} onDownloadLogs={onDownloadLogs} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /download logs/i }),
    );
    expect(onDownloadLogs).toHaveBeenCalledTimes(1);
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <StationConnectView
        {...baseProps}
        nameEditor={<span>Station name: LFV-1b</span>}
      />,
    );
    await expectNoA11yViolations(container);
  });
});

describe("connect progress", () => {
  const T0 = 1_000_000;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists the stage reached with its elapsed time and the attempt", () => {
    vi.useFakeTimers({ now: T0 + 4_000, toFake: ["Date", "setInterval"] });
    render(
      <StationConnectView
        {...baseProps}
        connStatus="connecting"
        progress={{
          startedAt: T0,
          attempt: 1,
          entered: { broker: T0, host: T0 + 800 },
        }}
      />,
    );
    const stages = screen.getByRole("list", { name: /connection stages/i });
    expect(stages.textContent).toContain("Connection serviceok, 0s");
    expect(stages.textContent).toContain("Main screenwaiting, 3s");
    expect(stages.textContent).toContain("Main screen datanot started");
    expect(stages.textContent).toContain("Elapsed4s, attempt 1");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports a stall once the stall window passes", () => {
    vi.useFakeTimers({
      now: T0 + CONNECT_STALL_MS + 2_000,
      toFake: ["Date", "setInterval"],
    });
    render(
      <StationConnectView
        {...baseProps}
        connStatus="reconnecting"
        progress={{
          startedAt: T0,
          attempt: 7,
          entered: { broker: T0 + 31_000 },
        }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(
      /No connection after 32s\. Still trying in the background/,
    );
  });

  it("says it is trying a direct connection, then switching to the relay, then that it is connected through it", () => {
    vi.useFakeTimers({ now: T0 + 2_000, toFake: ["Date", "setInterval"] });
    const progress = {
      startedAt: T0,
      attempt: 1,
      entered: { broker: T0, host: T0 + 500 },
    };
    const { rerender } = render(
      <StationConnectView
        {...baseProps}
        connStatus="connecting"
        relayLookup="used"
        progress={progress}
      />,
    );
    expect(screen.getByText(/Trying a direct connection/)).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(
      screen.getByText(/No direct path yet, switching to the relay/),
    ).not.toBeNull();
    rerender(
      <StationConnectView
        {...baseProps}
        connStatus="connecting"
        relayLookup="used"
        progress={{ ...progress, attempt: 2, viaRelay: true }}
      />,
    );
    expect(
      screen.getByText(/No direct path, switching to the relay/),
    ).not.toBeNull();
    rerender(
      <StationConnectView
        {...baseProps}
        connStatus="connected"
        relayLookup="used"
        progress={{ ...progress, attempt: 2, viaRelay: true, relayed: true }}
      />,
    );
    expect(screen.getByText(/Connected through the relay/)).not.toBeNull();
  });

  it("does not mention the relay for a station whose link names none", () => {
    vi.useFakeTimers({ now: T0 + 8_000, toFake: ["Date", "setInterval"] });
    render(
      <StationConnectView
        {...baseProps}
        connStatus="connecting"
        progress={{
          startedAt: T0,
          attempt: 1,
          entered: { broker: T0, host: T0 + 500 },
        }}
      />,
    );
    expect(screen.queryByText(/relay/i)).toBeNull();
  });

  it("advances the elapsed time each second", () => {
    vi.useFakeTimers({ now: T0, toFake: ["Date", "setInterval"] });
    render(
      <StationConnectView
        {...baseProps}
        connStatus="connecting"
        progress={{ startedAt: T0, attempt: 1, entered: { broker: T0 } }}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByRole("list").textContent).toContain("Elapsed3s");
  });
});

describe("connect status helpers", () => {
  it("describes the never-connected not-found state distinctly from reconnect", () => {
    expect(describeConnStatus("disconnected", true, false)).toMatch(
      /Broker doesn't know that code/i,
    );
    expect(describeConnStatus("reconnecting", true, true)).toMatch(
      /Host reconnecting/i,
    );
  });

  it("ranks an unreachable broker above a missing host in both helpers", () => {
    expect(describeConnStatus("disconnected", true, false, true)).toMatch(
      /Can't reach the peer broker/i,
    );
    expect(statusTone("reconnecting", true, true, true)).toBe("nogo");
  });

  it("tones a never-connected dead code nogo but a reclaim window info", () => {
    expect(statusTone("disconnected", true, false)).toBe("nogo");
    expect(statusTone("reconnecting", true, true)).toBe("info");
    expect(statusTone("connected", false, true)).toBe("go");
    expect(statusTone("idle", false, false)).toBe("neutral");
  });
});

describe("relay stage and the status banner", () => {
  it("hides the reconnecting banner while the relay stage line is showing", () => {
    vi.useFakeTimers({
      now: 1_000_000 + 16_000,
      toFake: ["Date", "setInterval"],
    });
    render(
      <StationConnectView
        {...baseProps}
        connStatus="reconnecting"
        relayLookup="used"
        progress={{
          startedAt: 1_000_000,
          attempt: 1,
          entered: { broker: 1_000_000, host: 1_000_500 },
        }}
      />,
    );
    expect(screen.getByText(/switching to the relay/)).not.toBeNull();
    expect(screen.queryByText(/Reconnecting: the host or broker/)).toBeNull();
    vi.useRealTimers();
  });
});
