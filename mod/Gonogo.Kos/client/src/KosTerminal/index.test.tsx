import { clearRegistry } from "@ksp-gonogo/core";
import type { KosProcessorInfo } from "@ksp-gonogo/sitrep-sdk";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
  Terminal: vi.fn(function (this: object) {
    Object.assign(this, termSpies);
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

const CARRIED = ["kos.processors", "kos.terminal.7", "kos.terminal.9"];

/**
 * A fixture wired to record every command the widget dispatches, so the tests
 * assert the real open/keystroke/close/resize round-trips (not a mocked hook).
 */
function terminalFixture() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
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
    cleanup();
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
