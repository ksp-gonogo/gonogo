import { clearRegistry } from "@ksp-gonogo/core";
import type {
  KosProcessorInfo,
  PendingUplinkQueue,
} from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "../test/axe";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { KosTerminalComponent } from "./index";

// xterm.js needs a canvas-capable DOM jsdom doesn't provide. Mock it at the
// library boundary: the real component logic, stream hooks, and command
// dispatch all run — only the renderer is stubbed.
const termSpies = vi.hoisted(() => ({
  loadAddon: vi.fn(),
  open: vi.fn(),
  write: vi.fn(),
  writeln: vi.fn(),
  onData: vi.fn(),
  onResize: vi.fn(),
  dispose: vi.fn(),
  rows: 24,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(function (this: { options: Record<string, unknown> }) {
    Object.assign(this, termSpies);
    // Real xterm exposes a live, settable `.options` bag (see the widget's
    // cursor-blink sync effect, which writes `term.options.cursorBlink`
    // whenever line mode toggles) — mirror that shape here rather than
    // defensively guarding the component for a test-only gap.
    this.options = {};
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(function (this: {
    fit: ReturnType<typeof vi.fn>;
    proposeDimensions: ReturnType<typeof vi.fn>;
  }) {
    this.fit = vi.fn();
    this.proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
  }),
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// jsdom has no ResizeObserver; the terminal waits for a sized container, so
// simulate a layout-complete entry on observe().
class MockResizeObserver {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element) {
    this.cb(
      [
        {
          target,
          contentRect: { width: 800, height: 400 } as DOMRectReadOnly,
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

const ONE_CPU: KosProcessorInfo[] = [
  {
    coreId: 7,
    tag: "lander",
    hasBooted: true,
    bootFilePath: undefined,
    processorMode: "READY",
  },
];

const TWO_CPUS: KosProcessorInfo[] = [
  { ...ONE_CPU[0], coreId: 7, tag: "lander" },
  {
    coreId: 9,
    tag: "probe",
    hasBooted: true,
    bootFilePath: undefined,
    processorMode: "READY",
  },
];

const CARRIED = [
  "kos.processors",
  "kos.terminal.7",
  "kos.terminal.9",
  "comms.delay",
  "system.uplink.pending",
];

/**
 * A fixture wired to record every command the widget dispatches, so the tests
 * assert the real open/keystroke/close/resize round-trips (not a mocked
 * hook). `commands` mirrors `setCommandHandler`'s `(command, args)` calls,
 * same shape every existing test here already asserts against; a test that
 * also needs the envelope's `label` reads `fixture.transport.sentCommands`
 * directly (see that field's own doc comment on `StubTransport`).
 */
function terminalFixture(opts?: { pinnedUt?: number }) {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: opts?.pinnedUt ?? 10,
  });
  const commands: Array<{ command: string; args: unknown }> = [];
  fixture.transport.setCommandHandler((command, args) => {
    commands.push({ command, args });
    return { success: true };
  });
  return { ...fixture, commands };
}

function getOnData(): (data: string) => void {
  return vi.mocked(termSpies.onData).mock.calls[0][0] as (d: string) => void;
}

/**
 * Minimal single-active-line terminal emulator over the sequence of
 * `write()` calls xterm would have received — just enough to distinguish
 * "the typed line was committed to the terminal buffer once" from "twice",
 * without reimplementing VT100. Interprets `\r` (return to column 0), `\n`
 * (commit the current line and start a fresh one), `\b` (destructive
 * backspace, as emitted by handleLineModeChar's `"\b \b"`), and `\x1b[K`
 * (erase from the cursor to end of line — the escape a fix for the
 * double-echo bug retracts a local composition with).
 */
function replayCommittedLines(writes: string[]): string[] {
  const committed: string[] = [];
  let line = "";
  let col = 0;
  for (const chunk of writes) {
    let i = 0;
    while (i < chunk.length) {
      const ch = chunk[i];
      if (ch === "\r") {
        col = 0;
        i++;
        continue;
      }
      if (ch === "\n") {
        committed.push(line);
        line = "";
        col = 0;
        i++;
        continue;
      }
      if (ch === "\x1b" && chunk.slice(i, i + 3) === "\x1b[K") {
        line = line.slice(0, col);
        i += 3;
        continue;
      }
      if (ch === "\b") {
        col = Math.max(0, col - 1);
        i++;
        continue;
      }
      line = line.slice(0, col) + ch + line.slice(col + 1);
      col++;
      i++;
    }
  }
  return committed;
}

describe("KosTerminal — streamed over the Uplink (no proxy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRegistry();
  });
  afterEach(() => {
    clearRegistry();
  });

  it("shows a waiting state when no kOS CPUs are present", () => {
    const fixture = terminalFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{}} />
      </fixture.Provider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /No kOS CPUs detected/i,
    );
  });

  it("auto-attaches to the sole CPU and writes downlink frames to xterm", async () => {
    const fixture = terminalFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{}} />
      </fixture.Provider>,
    );

    act(() => fixture.emit("kos.processors", ONE_CPU));

    // The live screen subscribes to that CPU's terminal downlink.
    await waitFor(() =>
      expect(fixture.transport.isSubscribed("kos.terminal.7")).toBe(true),
    );

    act(() =>
      fixture.emit("kos.terminal.7", {
        coreId: 7,
        chunk: "hello kOS",
        fullRepaint: true,
      }),
    );
    await waitFor(() =>
      expect(termSpies.write).toHaveBeenCalledWith("hello kOS"),
    );
  });

  it("acquires the write lease (kos.terminal.open) on attach", async () => {
    const fixture = terminalFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{}} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", ONE_CPU));

    await waitFor(() => {
      const open = fixture.commands.find(
        (c) => c.command === "kos.terminal.open",
      );
      expect(open).toBeDefined();
      expect((open?.args as { coreId: number }).coreId).toBe(7);
      expect((open?.args as { leaseToken: string }).leaseToken).toBeTruthy();
    });
  });

  it("forwards keystrokes as kos.keystroke commands with coreId + lease", async () => {
    const fixture = terminalFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{}} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", ONE_CPU));
    await waitFor(() => expect(termSpies.onData).toHaveBeenCalled());

    act(() => getOnData()('PRINT "hi".\r'));

    await waitFor(() => {
      const key = fixture.commands.find((c) => c.command === "kos.keystroke");
      expect(key).toBeDefined();
      expect((key?.args as { chars: string }).chars).toBe('PRINT "hi".\r');
      expect((key?.args as { coreId: number }).coreId).toBe(7);
    });
  });

  it("read-only: registers no keystroke handler and acquires no lease", async () => {
    const fixture = terminalFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{ readOnly: true }} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", ONE_CPU));

    // It still subscribes to the downlink (a passive viewer)...
    await waitFor(() =>
      expect(fixture.transport.isSubscribed("kos.terminal.7")).toBe(true),
    );
    // ...but never wires input or opens the lease.
    await new Promise((r) => setTimeout(r, 20));
    expect(termSpies.onData).not.toHaveBeenCalled();
    expect(
      fixture.commands.some((c) => c.command === "kos.terminal.open"),
    ).toBe(false);
  });

  it("defaults to line mode when no lineMode is configured", async () => {
    const fixture = terminalFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{}} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", ONE_CPU));

    await waitFor(() =>
      expect(screen.getByLabelText("Line-mode input")).toBeInTheDocument(),
    );
  });

  it("char-mode: shows a signal-delay badge with the round-trip time", async () => {
    const fixture = terminalFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{ lineMode: false }} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", ONE_CPU));
    await waitFor(() =>
      expect(fixture.transport.isSubscribed("kos.terminal.7")).toBe(true),
    );

    act(() =>
      fixture.emit("comms.delay", {
        oneWaySeconds: 3.8,
        source: "SignalDelay",
      }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Signal delay")).toHaveTextContent("~7.6s"),
    );
  });

  it("char-mode: no measurable path (null oneWaySeconds) hides the badge instead of crashing", async () => {
    // comms-delay-nullable-when-no-path fix: `oneWaySeconds` is null when
    // there is no measurable ControlPath (as opposed to 0 for the
    // delay-disabled-but-connected case). The badge must treat null the same
    // as the old 0 sentinel — hidden, never a runtime crash on `null * 2`.
    const fixture = terminalFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{ lineMode: false }} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", ONE_CPU));
    await waitFor(() =>
      expect(fixture.transport.isSubscribed("kos.terminal.7")).toBe(true),
    );

    act(() =>
      fixture.emit("comms.delay", {
        oneWaySeconds: null,
        source: "None",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByLabelText("Signal delay")).not.toBeInTheDocument();
    });
  });

  it("line-mode: sends the whole composed line as one keystroke on Enter", async () => {
    const fixture = terminalFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{ lineMode: true }} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", ONE_CPU));
    await waitFor(() => expect(termSpies.onData).toHaveBeenCalled());

    const onData = getOnData();
    act(() => {
      for (const ch of "list.") onData(ch);
      onData("\r");
    });

    await waitFor(() => {
      const keys = fixture.commands.filter(
        (c) => c.command === "kos.keystroke",
      );
      expect(keys).toHaveLength(1);
      expect((keys[0].args as { chars: string }).chars).toBe("list.\r");
    });
  });

  it("line-mode: the composed line is sent as the command's label", async () => {
    const fixture = terminalFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{ lineMode: true }} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", ONE_CPU));
    await waitFor(() => expect(termSpies.onData).toHaveBeenCalled());

    const onData = getOnData();
    act(() => {
      for (const ch of "run.") onData(ch);
      onData("\r");
    });

    await waitFor(() => {
      const key = fixture.transport.sentCommands.find(
        (c) => c.command === "kos.keystroke",
      );
      expect(key).toBeDefined();
      expect(key?.label).toBe("run.");
      expect(key?.topic).toBe("kos/7");
    });
  });

  it("char-mode: keystrokes carry no label and no topic", async () => {
    const fixture = terminalFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{ lineMode: false }} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", ONE_CPU));
    await waitFor(() => expect(termSpies.onData).toHaveBeenCalled());

    act(() => getOnData()("a"));

    await waitFor(() => {
      const key = fixture.transport.sentCommands.find(
        (c) => c.command === "kos.keystroke",
      );
      expect(key).toBeDefined();
      expect(key?.label).toBe("");
      expect(key?.topic).toBe("");
    });
  });

  it("line-mode: does not double-render a typed line once the server's delayed echo arrives", async () => {
    const fixture = terminalFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{ lineMode: true }} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", ONE_CPU));
    await waitFor(() =>
      expect(fixture.transport.isSubscribed("kos.terminal.7")).toBe(true),
    );

    const onData = getOnData();
    act(() => {
      for (const ch of "list.") onData(ch);
      onData("\r");
    });

    // Under nonzero signal delay, kOS's OWN echo of the same line arrives
    // later over the downlink — well after the instant local echo above.
    act(() =>
      fixture.emit("kos.terminal.7", {
        coreId: 7,
        chunk: "list.\r\n",
        fullRepaint: false,
      }),
    );

    await waitFor(() => {
      const writes = termSpies.write.mock.calls.map((c) => c[0] as string);
      const committed = replayCommittedLines(writes);
      // The server's echo must be the ONLY copy that ends up committed to
      // the terminal buffer — the local composition echo is transient
      // (visible while typing) and gets retracted on Enter rather than
      // scrolled into history, so it must never itself count as a second
      // committed "list." line.
      expect(committed.filter((line) => line === "list.")).toHaveLength(1);
    });
  });

  it("line-mode: a delayed echo for a committed line does not corrupt an in-progress next-line composition", async () => {
    // Gap C (adversarial review of Fix #3): Fix #3 only proved the
    // SAME-line double-render case. This reproduces the deeper bug: the
    // server's delayed, authoritative echo for a line ALREADY committed
    // (typed + Enter) can still land in the middle of the NEXT line's
    // in-progress, not-yet-committed composition — retract-on-Enter moves
    // the cursor back to column 0 for the retracted line, but never
    // accounts for whatever the operator has typed for the line AFTER
    // that by the time the delayed echo actually arrives.
    const fixture = terminalFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{ lineMode: true }} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", ONE_CPU));
    await waitFor(() =>
      expect(fixture.transport.isSubscribed("kos.terminal.7")).toBe(true),
    );

    const onData = getOnData();
    // line1: typed and sent (Enter already pressed).
    act(() => {
      for (const ch of "list.") onData(ch);
      onData("\r");
    });

    // line2: composed locally but Enter NOT pressed yet.
    act(() => {
      for (const ch of "printnow") onData(ch);
    });

    // line1's delayed, authoritative echo now arrives over the downlink --
    // well after the local echo, and while line2 is still mid-composition.
    act(() =>
      fixture.emit("kos.terminal.7", {
        coreId: 7,
        chunk: "list.\r\n",
        fullRepaint: false,
      }),
    );

    await waitFor(() => {
      const writes = termSpies.write.mock.calls.map((c) => c[0] as string);
      const committed = replayCommittedLines(writes);
      expect(committed).toEqual(["list."]);
    });
  });

  it("toggling line mode does NOT tear down and wipe the running terminal", async () => {
    // Bug: the xterm setup effect lists `lineMode` in its dependency array, so
    // flipping the Line-mode config switch disposes and recreates the whole
    // Terminal — but the downlink subscription persists, so nothing reseeds the
    // fresh xterm and the widget goes blank (while the real in-game CPU keeps
    // its screen). The terminal instance must survive a line-mode toggle.
    const fixture = terminalFixture();
    const { rerender } = render(
      <fixture.Provider>
        <KosTerminalComponent config={{ lineMode: false }} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", ONE_CPU));
    await waitFor(() => expect(termSpies.onData).toHaveBeenCalled());

    // Exactly one Terminal has been constructed so far.
    expect(vi.mocked(Terminal)).toHaveBeenCalledTimes(1);

    // Operator flips Line-mode on in config → the widget re-renders with the
    // new prop.
    rerender(
      <fixture.Provider>
        <KosTerminalComponent config={{ lineMode: true }} />
      </fixture.Provider>,
    );

    // The live xterm must NOT have been disposed/recreated — same instance,
    // no wipe.
    expect(termSpies.dispose).not.toHaveBeenCalled();
    expect(vi.mocked(Terminal)).toHaveBeenCalledTimes(1);
  });

  it("uses a fixed 80x24 terminal and imposes it on the CPU once (no dynamic fit)", async () => {
    // The widget must be a fixed-size grid (like the telnet solution): never
    // fit-to-pixels — which line-wraps kOS's output in a narrow panel — and
    // impose that one size on the shared CPU screen exactly once, rather than
    // streaming a resize on every container change.
    const fixture = terminalFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{}} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", ONE_CPU));
    await waitFor(() => expect(termSpies.onData).toHaveBeenCalled());

    // The xterm instance is constructed at a fixed size, not left to a fit.
    const opts = vi.mocked(Terminal).mock.calls[0][0] as {
      cols?: number;
      rows?: number;
    };
    expect(opts.cols).toBe(80);
    expect(opts.rows).toBe(24);

    // Exactly one resize command, carrying that fixed size — the CPU is set
    // once, never streamed a per-fit resize.
    await waitFor(() => {
      const resizes = fixture.commands.filter(
        (c) => c.command === "kos.terminal.resize",
      );
      expect(resizes).toHaveLength(1);
      expect(resizes[0].args).toMatchObject({ cols: 80, rows: 24, coreId: 7 });
    });
  });

  it("resolves the configured cpuName tagname to its coreId", async () => {
    const fixture = terminalFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{ cpuName: "probe" }} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", TWO_CPUS));

    await waitFor(() =>
      expect(fixture.transport.isSubscribed("kos.terminal.9")).toBe(true),
    );
    expect(fixture.transport.isSubscribed("kos.terminal.7")).toBe(false);
  });

  it("offers a CPU picker when several CPUs and no cpuName; clicking attaches", async () => {
    const fixture = terminalFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{}} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", TWO_CPUS));

    const pick = await screen.findByRole("button", { name: "probe" });
    act(() => pick.click());

    await waitFor(() =>
      expect(fixture.transport.isSubscribed("kos.terminal.9")).toBe(true),
    );
  });

  it("releases the lease (kos.terminal.close) on unmount", async () => {
    const fixture = terminalFixture();
    const { unmount } = render(
      <fixture.Provider>
        <KosTerminalComponent config={{}} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", ONE_CPU));
    await waitFor(() =>
      expect(
        fixture.commands.some((c) => c.command === "kos.terminal.open"),
      ).toBe(true),
    );

    unmount();
    await waitFor(() =>
      expect(
        fixture.commands.some((c) => c.command === "kos.terminal.close"),
      ).toBe(true),
    );
  });

  it("has no accessible violations in the waiting state", async () => {
    const fixture = terminalFixture();
    const { container } = render(
      <fixture.Provider>
        <KosTerminalComponent config={{}} />
      </fixture.Provider>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe("KosTerminal — in-transit uplink queue strip (prediction-only, never execution-shaped)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRegistry();
  });
  afterEach(() => {
    clearRegistry();
  });

  async function mountLineMode() {
    const fixture = terminalFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{ lineMode: true }} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", ONE_CPU));
    await waitFor(() =>
      expect(fixture.transport.isSubscribed("kos.terminal.7")).toBe(true),
    );
    return fixture;
  }

  it("renders a predicted up-arrow row in transit, then flips to a down-arrow row once real UT passes dispatchedAt + oneWaySeconds", async () => {
    const fixture = await mountLineMode();

    // Stamp both the delay fact and the queue entry at real UT 100 — the
    // fixture's wall clock hasn't advanced, so this establishes "now" as
    // UT 100 for the strip's real-time clock (`useUtNow`).
    act(() =>
      fixture.emit(
        "comms.delay",
        { oneWaySeconds: 3.8, source: "SignalDelay" },
        { validAt: 100, deliveredAt: 100 },
      ),
    );
    act(() =>
      fixture.emit(
        "system.uplink.pending",
        {
          pending: [
            {
              id: "c1",
              command: "kos.keystroke",
              label: "run.",
              topic: "kos/7",
              vantage: "vessel",
              dispatchedAt: 100,
              oneWaySeconds: 3.8,
            },
          ],
        } satisfies PendingUplinkQueue,
        { validAt: 100, deliveredAt: 100 },
      ),
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Uplink queue")).toHaveTextContent("run."),
    );
    expect(screen.getByLabelText("Uplink queue")).toHaveTextContent("↑");
    expect(screen.getByLabelText("Uplink queue")).not.toHaveTextContent("↓");
    // The row drops the old "reaching craft"/"reply inbound" prose entirely
    // in favor of a bare humanised countdown.
    expect(screen.getByLabelText("Uplink queue")).not.toHaveTextContent(
      "reaching craft",
    );
    // The char-mode-only badge must NOT also be showing — the two are
    // mutually exclusive above the 1s threshold.
    expect(screen.queryByLabelText("Signal delay")).toBeNull();

    // Advance REAL time (the fixture's wall clock — NOT a view-clock scrub)
    // past dispatchedAt (100) + oneWaySeconds (3.8) = 103.8, the predicted
    // arrival at the craft. Nothing about the engine's actual delivery is
    // consulted; this is purely the client's own real-time clock crossing
    // the predicted threshold.
    act(() => fixture.wall.advanceBy(4));

    await waitFor(() =>
      expect(screen.getByLabelText("Uplink queue")).toHaveTextContent("↓"),
    );
    expect(screen.getByLabelText("Uplink queue")).not.toHaveTextContent("↑");
    expect(screen.getByLabelText("Uplink queue")).not.toHaveTextContent(
      "reply inbound",
    );
  });

  it("shows the badge, not the strip, when oneWaySeconds <= 1 in line mode", async () => {
    const fixture = await mountLineMode();

    act(() =>
      fixture.emit("comms.delay", { oneWaySeconds: 1, source: "SignalDelay" }),
    );
    act(() =>
      fixture.emit("system.uplink.pending", {
        pending: [
          {
            id: "c1",
            command: "kos.keystroke",
            label: "run.",
            topic: "kos/7",
            vantage: "vessel",
            dispatchedAt: 100,
            oneWaySeconds: 1,
          },
        ],
      } satisfies PendingUplinkQueue),
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Signal delay")).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("Uplink queue")).toBeNull();
  });

  it("shows a humanised countdown (formatCountdown), never raw seconds or the old prose", async () => {
    const fixture = await mountLineMode();

    act(() =>
      fixture.emit(
        "comms.delay",
        { oneWaySeconds: 80, source: "SignalDelay" },
        { validAt: 100, deliveredAt: 100 },
      ),
    );
    act(() =>
      fixture.emit(
        "system.uplink.pending",
        {
          pending: [
            {
              id: "c1",
              command: "kos.keystroke",
              label: "run.",
              topic: "kos/7",
              vantage: "vessel",
              // dispatchedAt (100) + oneWaySeconds (80) - real "now" (100,
              // stamped by this same emit's validAt) = 80s remaining until
              // predicted arrival at the craft.
              dispatchedAt: 100,
              oneWaySeconds: 80,
            },
          ],
        } satisfies PendingUplinkQueue,
        { validAt: 100, deliveredAt: 100 },
      ),
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Uplink queue")).toHaveTextContent("1m 20s"),
    );
    const strip = screen.getByLabelText("Uplink queue");
    expect(strip).not.toHaveTextContent("80s");
    expect(strip).not.toHaveTextContent("reaching craft");
    expect(strip).not.toHaveTextContent("reply inbound");
  });

  it("filters the strip to this terminal's own CPU (topic), never a sibling CPU's uplinks", async () => {
    const fixture = await mountLineMode();

    act(() =>
      fixture.emit("comms.delay", {
        oneWaySeconds: 3.8,
        source: "SignalDelay",
      }),
    );
    act(() =>
      fixture.emit("system.uplink.pending", {
        pending: [
          {
            id: "c1",
            command: "kos.keystroke",
            label: "run.",
            topic: "kos/7",
            vantage: "vessel",
            dispatchedAt: 100,
            oneWaySeconds: 3.8,
          },
          {
            id: "c2",
            command: "kos.keystroke",
            label: "print other.",
            topic: "kos/9",
            vantage: "vessel",
            dispatchedAt: 100,
            oneWaySeconds: 3.8,
          },
        ],
      } satisfies PendingUplinkQueue),
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Uplink queue")).toHaveTextContent("run."),
    );
    expect(screen.getByLabelText("Uplink queue")).not.toHaveTextContent(
      "print other.",
    );
  });

  it("(Issue A regression) renders and clears the strip in REAL time — never one delay-period late behind the delayed view clock", async () => {
    // A non-zero view delay: `useViewUt`'s confirmed edge lags real UT by
    // 20s. If the strip (queue read or countdown) were still riding that
    // delayed clock, a command dispatched (and pruned) in real time would
    // not appear — or clear — until the view clock's confirmed edge caught
    // up 20s of WALL time later. Deliberately no `pinnedUt` (per
    // `setupStreamFixture`'s own doc: a non-zero `delaySeconds` requires a
    // live, unscrubbed clock).
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      delaySeconds: 20,
    });
    fixture.transport.setCommandHandler(() => ({ success: true }));
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{ lineMode: true }} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", ONE_CPU));
    // `kos.processors` is genuine delayed CRAFT telemetry (read via
    // `useStream`, correctly certainty-gated) — it only becomes visible once
    // the confirmed edge reaches its own `validAt` (0), which needs at least
    // `delaySeconds` (20s) of real time to elapse. Advance the fixture's
    // wall clock past that and force a frame refresh (`setupStreamFixture`'s
    // own doc: "nothing else triggers a frame between ingests") before the
    // CPU picker resolves and this terminal mounts/subscribes.
    act(() => {
      fixture.wall.advanceBy(25);
      fixture.store.beginFrame();
    });
    await waitFor(() =>
      expect(fixture.transport.isSubscribed("kos.terminal.7")).toBe(true),
    );

    // Real UT is 25 right now (wall hasn't moved since the advance above) —
    // stamp the delay fact and the queue entry at that same real "now" via
    // explicit `validAt`/`deliveredAt` overrides (the default `emit()`
    // stamps 0, which would wrongly rewind the clock's UT<->wall anchor).
    // The delayed view's confirmed edge sits at 25 - 20s = 5. A command
    // dispatched at real UT 25 must show up NOW, off the real-time read —
    // not once the confirmed edge reaches 25 (20s of wall time later).
    act(() =>
      fixture.emit(
        "comms.delay",
        { oneWaySeconds: 5, source: "SignalDelay" },
        { validAt: 25, deliveredAt: 25 },
      ),
    );
    act(() =>
      fixture.emit(
        "system.uplink.pending",
        {
          pending: [
            {
              id: "c1",
              command: "kos.keystroke",
              label: "run.",
              topic: "kos/7",
              vantage: "vessel",
              dispatchedAt: 25,
              oneWaySeconds: 5,
            },
          ],
        } satisfies PendingUplinkQueue,
        { validAt: 25, deliveredAt: 25 },
      ),
    );

    // No wall-time advance is needed here — proving this doesn't depend on
    // 20s of (fake) wall time elapsing the way the pre-fix delayed-clock
    // read would have.
    await waitFor(() =>
      expect(screen.getByLabelText("Uplink queue")).toHaveTextContent("run."),
    );
    expect(screen.getByLabelText("Uplink queue")).toHaveTextContent("↑");

    // Sanity check on the bug this guards against: the delayed view clock
    // genuinely IS still stuck at 5 right now (confirming the fixture models
    // the lag the bug depended on, not that delaySeconds is a no-op) — well
    // short of the queue entry's own `validAt` (25), so the OLD
    // `useStream("system.uplink.pending")` read would have returned
    // `undefined` (nothing confirmed yet) at this exact point, showing no
    // strip at all.
    expect(fixture.store.clock.confirmedEdgeUt()).toBeCloseTo(5, 5);

    // The engine prunes the entry once it predicts the round trip complete
    // — modelled here as a later real-time snapshot with an empty queue.
    // The strip must clear immediately off that real-time read too, not
    // wait for the delayed view to catch up.
    act(() =>
      fixture.emit(
        "system.uplink.pending",
        { pending: [] } satisfies PendingUplinkQueue,
        { validAt: 26, deliveredAt: 26 },
      ),
    );

    await waitFor(() =>
      expect(screen.queryByLabelText("Uplink queue")).toBeNull(),
    );
  });
});

describe("KosTerminal — blocks a send with no comms path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRegistry();
  });
  afterEach(() => {
    clearRegistry();
  });

  const CARRIED_WITH_CONNECTIVITY = [...CARRIED, "comms.link"];

  function connectivityFixture() {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED_WITH_CONNECTIVITY,
      pinnedUt: 10,
    });
    const commands: Array<{ command: string; args: unknown }> = [];
    fixture.transport.setCommandHandler((command, args) => {
      commands.push({ command, args });
      return { success: true };
    });
    return { ...fixture, commands };
  }

  it("line-mode: does not dispatch and shows a No path warning when comms.link reports connected: false", async () => {
    const fixture = connectivityFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{ lineMode: true }} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", ONE_CPU));
    await waitFor(() => expect(termSpies.onData).toHaveBeenCalled());

    act(() => fixture.emit("comms.link", { connected: false }));
    await waitFor(() =>
      expect(
        screen.getByText(/No path — commands are not being sent/),
      ).toBeInTheDocument(),
    );

    const onData = getOnData();
    act(() => {
      for (const ch of "run.") onData(ch);
      onData("\r");
    });

    // Give any (incorrect) dispatch a chance to land before asserting none
    // did. `sentCommands` also carries the lease-lifecycle `kos.terminal.open`/
    // `kos.terminal.resize` requests sent on mount, so filter to the command
    // under test rather than asserting on the raw envelope count.
    await Promise.resolve();
    expect(
      fixture.commands.filter((c) => c.command === "kos.keystroke"),
    ).toHaveLength(0);
    expect(
      fixture.transport.sentCommands.filter(
        (c) => c.command === "kos.keystroke",
      ),
    ).toHaveLength(0);
  });

  it("line-mode: dispatches normally and shows no warning when comms.link reports connected: true", async () => {
    const fixture = connectivityFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{ lineMode: true }} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", ONE_CPU));
    await waitFor(() => expect(termSpies.onData).toHaveBeenCalled());

    act(() => fixture.emit("comms.link", { connected: true }));

    const onData = getOnData();
    act(() => {
      for (const ch of "run.") onData(ch);
      onData("\r");
    });

    await waitFor(() => {
      const keys = fixture.commands.filter(
        (c) => c.command === "kos.keystroke",
      );
      expect(keys).toHaveLength(1);
      expect((keys[0].args as { chars: string }).chars).toBe("run.\r");
    });
    expect(
      screen.queryByText(/No path — commands are not being sent/),
    ).toBeNull();
  });

  it("line-mode: dispatches normally when comms.link has not reported yet (undefined treated as connected)", async () => {
    const fixture = connectivityFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{ lineMode: true }} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", ONE_CPU));
    await waitFor(() => expect(termSpies.onData).toHaveBeenCalled());

    expect(
      screen.queryByText(/No path — commands are not being sent/),
    ).toBeNull();

    const onData = getOnData();
    act(() => {
      for (const ch of "run.") onData(ch);
      onData("\r");
    });

    await waitFor(() => {
      const keys = fixture.commands.filter(
        (c) => c.command === "kos.keystroke",
      );
      expect(keys).toHaveLength(1);
    });
  });

  it("char-mode: also blocks keystrokes and shows the warning with no comms path", async () => {
    const fixture = connectivityFixture();
    render(
      <fixture.Provider>
        <KosTerminalComponent config={{ lineMode: false }} />
      </fixture.Provider>,
    );
    act(() => fixture.emit("kos.processors", ONE_CPU));
    await waitFor(() => expect(termSpies.onData).toHaveBeenCalled());

    act(() => fixture.emit("comms.link", { connected: false }));
    await waitFor(() =>
      expect(
        screen.getByText(/No path — commands are not being sent/),
      ).toBeInTheDocument(),
    );

    act(() => getOnData()("a"));
    await Promise.resolve();

    expect(
      fixture.commands.filter((c) => c.command === "kos.keystroke"),
    ).toHaveLength(0);
  });
});
