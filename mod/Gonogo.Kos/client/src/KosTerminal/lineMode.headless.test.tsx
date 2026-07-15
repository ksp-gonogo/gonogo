import { clearRegistry } from "@ksp-gonogo/core";
import type { KosProcessorInfo } from "@ksp-gonogo/sitrep-sdk";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { KosTerminalComponent } from "./index";

// Faithful terminal reconstruction: back the component's @xterm/xterm import
// with @xterm/headless (the IDENTICAL VT engine, same 6.0.0), so these tests
// assert the ACTUAL rendered screen the operator sees — real cursor moves,
// real erase-in-line, real full-clears — not a single-line stand-in emulator.
// The only additions are a no-op open() (no DOM headless) and capturing the
// live instance + its onData handler.
const hoisted = vi.hoisted(() => ({ instances: [] as unknown[] }));

vi.mock("@xterm/xterm", async () => {
  const headless =
    await vi.importActual<typeof import("@xterm/headless")>("@xterm/headless");
  class TestTerminal extends headless.Terminal {
    dataHandler?: (data: string) => void;
    // biome-ignore lint/suspicious/noExplicitAny: mirroring xterm's option bag
    constructor(options?: any) {
      // Respect the component's chosen cols/rows (its fixed size) — only
      // default to a NARROW grid when it doesn't specify one, so a pre-fix
      // build (no fixed size) wraps and a fixed-size build doesn't.
      // allowProposedApi: read .buffer to assert the actual rendered screen.
      super({ cols: 40, rows: 12, ...options, allowProposedApi: true });
      hoisted.instances.push(this);
    }
    open() {
      /* headless: no DOM to attach to */
    }
    // biome-ignore lint/suspicious/noExplicitAny: xterm onData signature
    onData(cb: any) {
      this.dataHandler = cb;
      return super.onData(cb);
    }
  }
  return { Terminal: TestTerminal };
});

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    activate() {}
    dispose() {}
    fit() {}
    proposeDimensions() {
      return { cols: 40, rows: 12 };
    }
  },
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

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

// biome-ignore lint/suspicious/noExplicitAny: reading the headless buffer
function screenText(term: any): string {
  const buf = term.buffer.active;
  const rows: string[] = [];
  for (let i = 0; i < term.rows; i++) {
    const line = buf.getLine(i);
    rows.push(line ? line.translateToString(true) : "");
  }
  return rows.join("\n").replace(/\s+$/g, "");
}

// xterm's write() is asynchronous (batched through a write buffer). A callback
// on an empty write fires after every prior queued write has been parsed, so
// this drains the buffer before we read the rendered screen.
// biome-ignore lint/suspicious/noExplicitAny: the live TestTerminal instance
function flush(t: any): Promise<void> {
  return new Promise((resolve) => t.write("", () => resolve()));
}

// biome-ignore lint/suspicious/noExplicitAny: the live TestTerminal instance
async function readScreen(t: any): Promise<string> {
  await flush(t);
  return screenText(t);
}

describe("KosTerminal line mode — faithful VT (real @xterm/headless)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.instances.length = 0;
    clearRegistry();
  });
  afterEach(() => {
    cleanup();
    clearRegistry();
  });

  function fixture() {
    return setupStreamFixture({
      carriedChannels: ["kos.processors", "kos.terminal.7"],
      pinnedUt: 10,
    });
  }

  // biome-ignore lint/suspicious/noExplicitAny: the live TestTerminal instance
  const term = (): any => hoisted.instances[hoisted.instances.length - 1];

  async function mountAttached(config: Record<string, unknown>) {
    const f = fixture();
    render(
      <f.Provider>
        <KosTerminalComponent config={config} />
      </f.Provider>,
    );
    act(() => f.emit("kos.processors", ONE_CPU));
    await waitFor(() => expect(hoisted.instances.length).toBeGreaterThan(0));
    await waitFor(() => expect(term().dataHandler).toBeTruthy());
    return f;
  }

  const compositionBar = () =>
    screen.getByLabelText("Line-mode input").textContent ?? "";
  // The bar always renders a leading prompt glyph ("❯") ahead of the actual
  // composition text — strip it so history-recall assertions can compare the
  // composed line itself.
  const compositionText = () => compositionBar().replace("❯", "");

  it("a real Enter keypress through the VT engine sends the composed line as the label, tagged with this terminal's topic", async () => {
    const f = await mountAttached({ lineMode: true });

    act(() => {
      for (const ch of "run.") term().dataHandler(ch);
      term().dataHandler("\r");
    });

    await waitFor(() => {
      const key = f.transport.sentCommands.find(
        (c) => c.command === "kos.keystroke",
      );
      expect(key).toBeDefined();
      expect(key?.label).toBe("run.");
      expect(key?.topic).toBe("kos/7");
      expect((key?.args as { chars: string }).chars).toBe("run.\r");
    });
  });

  it("line-mode composition stays OFF the terminal screen and survives a keyframe", async () => {
    const f = await mountAttached({ lineMode: true });
    // Server draws the kOS prompt (a full-repaint keyframe).
    act(() =>
      f.emit("kos.terminal.7", {
        coreId: 7,
        chunk: "\x1b[2J\x1b[HkOS> ",
        fullRepaint: true,
      }),
    );
    // Operator composes a line — it lands in the bar, never the screen.
    act(() => term().dataHandler("run."));
    const s1 = await readScreen(term());
    expect(s1).toContain("kOS>");
    expect(s1).not.toContain("run");
    expect(compositionBar()).toContain("run.");

    // A periodic keyframe (unchanged screen) arrives WHILE composing — the
    // screen resyncs and the composition is untouched.
    act(() =>
      f.emit("kos.terminal.7", {
        coreId: 7,
        chunk: "\x1b[2J\x1b[HkOS> ",
        fullRepaint: true,
      }),
    );
    const s2 = await readScreen(term());
    expect(s2).toContain("kOS>");
    expect(s2).not.toContain("run");
    expect(compositionBar()).toContain("run.");
  });

  it("a full-width kOS line does not wrap (fixed-size terminal)", async () => {
    // The widget is a fixed-size grid wider than any kOS screen line, so
    // kOS output never wraps — the telnet-era learning. A pre-fix build fits
    // to a narrow container and wraps a long line onto a second buffer row.
    const f = await mountAttached({});
    const line = "STATUS: ALL SYSTEMS NOMINAL - ALT 000075420 M"; // 45 chars
    act(() =>
      f.emit("kos.terminal.7", {
        coreId: 7,
        chunk: `\x1b[2J\x1b[H${line}`,
        fullRepaint: true,
      }),
    );
    await flush(term());
    const buf = term().buffer.active;
    // The whole line is on row 0; row 1 is empty (no wrap).
    expect(buf.getLine(0).translateToString(true)).toBe(line);
    expect(buf.getLine(1).translateToString(true)).toBe("");
  });

  it("a cursor-positioned status diff mid-composition corrupts neither the screen nor the composition", async () => {
    const f = await mountAttached({ lineMode: true });
    act(() =>
      f.emit("kos.terminal.7", {
        coreId: 7,
        chunk: "\x1b[2J\x1b[HkOS> ",
        fullRepaint: true,
      }),
    );
    act(() => term().dataHandler("run."));

    // kOS updates a status line elsewhere on the screen (cursor-positioned
    // incremental diff — exactly what ScreenDiffMapper emits when one row
    // changes), NOT a full repaint. Previously this merged the composition
    // into "MET 00:12run." and wiped the prompt line.
    act(() =>
      f.emit("kos.terminal.7", {
        coreId: 7,
        chunk: "\x1b[6;1HMET 00:12",
        fullRepaint: false,
      }),
    );

    const text = await readScreen(term());
    // Prompt and status both render cleanly; the composition never leaks in.
    expect(text).toContain("kOS>");
    expect(text).toContain("MET 00:12");
    expect(text).not.toContain("run");
    expect(text).not.toContain("MET 00:12run.");
    // The composition is intact in its bar.
    expect(compositionBar()).toContain("run.");
  });

  it("up/down arrow walks line-mode composition history, most recent first", async () => {
    const f = await mountAttached({ lineMode: true });

    act(() => {
      for (const ch of "run.") term().dataHandler(ch);
      term().dataHandler("\r");
    });
    await waitFor(() => {
      const sent = f.transport.sentCommands.filter(
        (c) => c.command === "kos.keystroke",
      );
      expect(sent).toHaveLength(1);
    });

    act(() => {
      for (const ch of "list.") term().dataHandler(ch);
      term().dataHandler("\r");
    });
    await waitFor(() => {
      const sent = f.transport.sentCommands.filter(
        (c) => c.command === "kos.keystroke",
      );
      expect(sent).toHaveLength(2);
    });

    // Up recalls the most recently sent line first, then walks further back.
    act(() => term().dataHandler("\x1b[A"));
    expect(compositionText()).toBe("list.");

    act(() => term().dataHandler("\x1b[A"));
    expect(compositionText()).toBe("run.");

    // Further up at the oldest entry stays put (nothing further back).
    act(() => term().dataHandler("\x1b[A"));
    expect(compositionText()).toBe("run.");

    // Down walks back toward the present...
    act(() => term().dataHandler("\x1b[B"));
    expect(compositionText()).toBe("list.");

    // ...and past the newest entry returns to the empty in-progress draft.
    act(() => term().dataHandler("\x1b[B"));
    expect(compositionText()).toBe("");
  });

  it("Ctrl+C clears the composition bar and sends an interrupt keystroke", async () => {
    const f = await mountAttached({ lineMode: true });

    act(() => {
      for (const ch of "run.") term().dataHandler(ch);
    });
    expect(compositionText()).toBe("run.");

    act(() => term().dataHandler("\x03"));

    expect(compositionText()).toBe("");
    await waitFor(() => {
      const interrupt = f.transport.sentCommands.find(
        (c) =>
          c.command === "kos.keystroke" &&
          (c.args as { chars: string }).chars === "\x03",
      );
      expect(interrupt).toBeDefined();
      expect(interrupt?.topic).toBe("kos/7");
    });
  });
});
