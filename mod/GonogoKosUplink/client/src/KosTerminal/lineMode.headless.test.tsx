import { clearRegistry } from "@ksp-gonogo/core";
import type { KosProcessorInfo } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
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
  // Reads the visible caret's split point directly off the DOM: the bar
  // renders `[before-text, <caret span>, after-text]` as the three children
  // of its text span (`CompositionBar__Text`) — see the component's render.
  // Asserting on this (rather than only on the flattened `compositionText`)
  // proves the caret itself is positioned correctly, not just that the text
  // round-trips.
  function caretSplit(): [string, string] {
    const textSpan = screen.getByLabelText("Line-mode input").children[1];
    return [
      textSpan?.childNodes[0]?.textContent ?? "",
      textSpan?.childNodes[2]?.textContent ?? "",
    ];
  }

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

  it("left arrow moves the cursor so typed characters insert mid-line, not just append", async () => {
    const f = await mountAttached({ lineMode: true });

    act(() => {
      for (const ch of "run.") term().dataHandler(ch);
    });
    expect(compositionText()).toBe("run.");

    // Two Lefts put the cursor between "ru" and "n." — a typed char there
    // should insert, not land at the tail as the pre-fix end-only buffer did.
    act(() => {
      term().dataHandler("\x1b[D");
      term().dataHandler("\x1b[D");
    });
    act(() => term().dataHandler("X"));

    expect(compositionText()).toBe("ruXn.");
    expect(
      f.transport.sentCommands.filter((c) => c.command === "kos.keystroke"),
    ).toHaveLength(0);
  });

  it("left then backspace deletes the character before the cursor, not the tail", async () => {
    await mountAttached({ lineMode: true });

    act(() => {
      for (const ch of "run.") term().dataHandler(ch);
    });
    // Cursor after "run." (index 4) — one Left puts it before the ".".
    act(() => term().dataHandler("\x1b[D"));
    act(() => term().dataHandler("\x7f"));

    // Backspace removed "n" (the char before the cursor), not "." (the tail).
    expect(compositionText()).toBe("ru.");
  });

  it("delete removes the character at the cursor, leaving the cursor in place", async () => {
    await mountAttached({ lineMode: true });

    act(() => {
      for (const ch of "run.") term().dataHandler(ch);
    });
    // Two Lefts: cursor between "ru" and "n.".
    act(() => {
      term().dataHandler("\x1b[D");
      term().dataHandler("\x1b[D");
    });
    act(() => term().dataHandler("\x1b[3~"));

    expect(compositionText()).toBe("ru.");
    // Cursor stayed put (didn't shift onto the deleted char's old neighbour):
    // typing now inserts right where the deletion happened.
    act(() => term().dataHandler("X"));
    expect(compositionText()).toBe("ruX.");
  });

  it("cursor clamps at the start of the line: left never moves it past position 0", async () => {
    await mountAttached({ lineMode: true });

    act(() => {
      for (const ch of "ab") term().dataHandler(ch);
    });
    // Three Lefts on a 2-char line — the third is a no-op past the start.
    act(() => {
      term().dataHandler("\x1b[D");
      term().dataHandler("\x1b[D");
      term().dataHandler("\x1b[D");
    });
    act(() => term().dataHandler("X"));

    expect(compositionText()).toBe("Xab");
  });

  it("cursor clamps at the end of the line: right never moves it past the last character", async () => {
    await mountAttached({ lineMode: true });

    act(() => {
      for (const ch of "ab") term().dataHandler(ch);
    });
    // Cursor is already at the end after typing; extra Rights are no-ops.
    act(() => {
      term().dataHandler("\x1b[C");
      term().dataHandler("\x1b[C");
      term().dataHandler("\x1b[C");
    });
    act(() => term().dataHandler("Y"));

    expect(compositionText()).toBe("abY");
  });

  it("Home and End jump the cursor to the start and end of the composed line", async () => {
    await mountAttached({ lineMode: true });

    act(() => {
      for (const ch of "run.") term().dataHandler(ch);
    });
    act(() => term().dataHandler("\x1b[H")); // Home
    act(() => term().dataHandler("X"));
    expect(compositionText()).toBe("Xrun.");

    act(() => term().dataHandler("\x1b[F")); // End
    act(() => term().dataHandler("Y"));
    expect(compositionText()).toBe("Xrun.Y");
  });

  it("renders a visible caret between the composed characters at the cursor position", async () => {
    await mountAttached({ lineMode: true });

    act(() => {
      for (const ch of "run.") term().dataHandler(ch);
    });
    expect(caretSplit()).toEqual(["run.", ""]);

    act(() => {
      term().dataHandler("\x1b[D");
      term().dataHandler("\x1b[D");
    });
    expect(caretSplit()).toEqual(["ru", "n."]);
  });

  it("Enter still flushes the WHOLE composed line (+ CR) regardless of cursor position", async () => {
    const f = await mountAttached({ lineMode: true });

    act(() => {
      for (const ch of "run.") term().dataHandler(ch);
    });
    // Move the cursor mid-line before committing — Enter must not truncate
    // at the cursor, it sends everything.
    act(() => {
      term().dataHandler("\x1b[D");
      term().dataHandler("\x1b[D");
    });
    act(() => term().dataHandler("\r"));

    await waitFor(() => {
      const key = f.transport.sentCommands.find(
        (c) => c.command === "kos.keystroke",
      );
      expect(key).toBeDefined();
      expect(key?.label).toBe("run.");
      expect((key?.args as { chars: string }).chars).toBe("run.\r");
    });
    expect(compositionText()).toBe("");
  });
});

// kos-nopath-block-input fix: with no comms path, Enter used to clear the
// buffer and push it to history BEFORE the dispatch-layer guard
// (`sendKeystrokeRef`) blocked the send — the command visibly vanished even
// though nothing was ever sent. These tests exercise the real VT engine
// (same as the suite above) so a regression that only shows up through
// xterm's actual `onData` batching wouldn't be masked by a simplified mock.
describe("KosTerminal line mode — no comms path (kos-nopath-block-input fix)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.instances.length = 0;
    clearRegistry();
  });
  afterEach(() => {
    clearRegistry();
  });

  function fixture() {
    return setupStreamFixture({
      carriedChannels: ["kos.processors", "kos.terminal.7", "comms.link"],
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

  const compositionBarEl = () => screen.getByLabelText("Line-mode input");
  const compositionText = () =>
    (compositionBarEl().textContent ?? "").replace("❯", "");

  it("refuses Enter with no path: the typed line stays in the box, nothing is sent, nothing joins history", async () => {
    const f = await mountAttached({ lineMode: true });
    act(() => f.emit("comms.link", { connected: false }));
    await waitFor(() =>
      expect(
        screen.getByText(/No path — commands are not being sent/),
      ).toBeVisible(),
    );

    act(() => {
      for (const ch of "run.") term().dataHandler(ch);
      term().dataHandler("\r");
    });

    // The line is still sitting in the composition bar, un-cleared — this is
    // the actual bug: pre-fix, Enter cleared it here regardless of dispatch.
    expect(compositionText()).toBe("run.");

    // Give any (incorrect) dispatch a chance to land before asserting none
    // did.
    await Promise.resolve();
    expect(
      f.transport.sentCommands.filter((c) => c.command === "kos.keystroke"),
    ).toHaveLength(0);

    // Proof the line never joined history either: up-arrow must NOT recall
    // it (recall only works if pushLineHistory ran, which only happens
    // inside the sendChars callback this fix must never invoke here).
    act(() => term().dataHandler("\x1b[A"));
    expect(compositionText()).toBe("run.");
  });

  it("typing/backspace still edit the buffer while blocked, only Enter is refused", async () => {
    const f = await mountAttached({ lineMode: true });
    act(() => f.emit("comms.link", { connected: false }));
    await waitFor(() =>
      expect(
        screen.getByText(/No path — commands are not being sent/),
      ).toBeVisible(),
    );

    act(() => {
      for (const ch of "run.") term().dataHandler(ch);
      term().dataHandler("\x7f"); // backspace
    });
    expect(compositionText()).toBe("run");

    await Promise.resolve();
    expect(
      f.transport.sentCommands.filter((c) => c.command === "kos.keystroke"),
    ).toHaveLength(0);
  });

  it("no-path still blocks Enter while cursor-based editing continues", async () => {
    const f = await mountAttached({ lineMode: true });
    act(() => f.emit("comms.link", { connected: false }));
    await waitFor(() =>
      expect(
        screen.getByText(/No path — commands are not being sent/),
      ).toBeVisible(),
    );

    act(() => {
      for (const ch of "run.") term().dataHandler(ch);
    });
    // Left-arrow + mid-line insert still edits the composition while blocked.
    act(() => {
      term().dataHandler("\x1b[D");
      term().dataHandler("\x1b[D");
    });
    act(() => term().dataHandler("X"));
    expect(compositionText()).toBe("ruXn.");

    // Enter is still refused — the line stays put, nothing is sent.
    act(() => term().dataHandler("\r"));
    expect(compositionText()).toBe("ruXn.");
    await Promise.resolve();
    expect(
      f.transport.sentCommands.filter((c) => c.command === "kos.keystroke"),
    ).toHaveLength(0);
  });

  it("once the path returns, the preserved line sends normally on the next Enter", async () => {
    const f = await mountAttached({ lineMode: true });
    act(() => f.emit("comms.link", { connected: false }));
    await waitFor(() =>
      expect(
        screen.getByText(/No path — commands are not being sent/),
      ).toBeVisible(),
    );

    act(() => {
      for (const ch of "run.") term().dataHandler(ch);
      term().dataHandler("\r");
    });
    expect(compositionText()).toBe("run.");

    act(() => f.emit("comms.link", { connected: true }));
    await waitFor(() =>
      expect(
        screen.queryByText(/No path — commands are not being sent/),
      ).toBeNull(),
    );

    act(() => term().dataHandler("\r"));

    await waitFor(() => {
      const key = f.transport.sentCommands.find(
        (c) => c.command === "kos.keystroke",
      );
      expect(key).toBeDefined();
      expect(key?.label).toBe("run.");
      expect((key?.args as { chars: string }).chars).toBe("run.\r");
    });
    expect(compositionText()).toBe("");

    // And it's now in history, same as any other sent line.
    act(() => term().dataHandler("\x1b[A"));
    expect(compositionText()).toBe("run.");
  });

  it("with a path, Enter behaves exactly as before (no regression)", async () => {
    const f = await mountAttached({ lineMode: true });
    act(() => f.emit("comms.link", { connected: true }));

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
    });
    expect(compositionText()).toBe("");
  });

  // jsdom's CSS engine doesn't resolve (or even preserve) `var(...)` inside a
  // shorthand `border` declaration through `getComputedStyle` — it silently
  // falls back to the initial value, so `toHaveStyle` can't see which token
  // is active. Read the actual rule styled-components injected instead: its
  // dynamic (non-"sc-*") class name is a direct function of the `$noPath`
  // prop, so finding that class's declaration block in the injected
  // stylesheet and checking which colour token it names is the faithful
  // check — same information a browser's computed style would give, without
  // depending on jsdom's incomplete CSS custom-property support.
  function compositionBorderRule(): string {
    const dynamicClass = Array.from(compositionBarEl().classList).find(
      (c) => !c.startsWith("sc-"),
    );
    if (!dynamicClass) throw new Error("no styled-components class found");
    const css = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent ?? "")
      .join("\n");
    const escaped = dynamicClass.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rule = css.match(new RegExp(`\\.${escaped}[^{]*{([^}]*)}`));
    if (!rule) throw new Error(`no CSS rule found for .${dynamicClass}`);
    return rule[1];
  }

  it("the composition bar's outline switches to the error/danger tone while there is no path, and back on reconnect", async () => {
    const f = await mountAttached({ lineMode: true });

    // Connected (or unreported) — the normal accent tone, never the danger
    // one: a green/accent outline is what let this bug through unnoticed.
    expect(compositionBorderRule()).toContain("--color-accent-fg");
    expect(compositionBorderRule()).not.toContain("--color-status-nogo-fg");

    act(() => f.emit("comms.link", { connected: false }));
    await waitFor(() =>
      expect(compositionBorderRule()).toContain("--color-status-nogo-fg"),
    );
    expect(compositionBorderRule()).not.toContain("--color-accent-fg");

    act(() => f.emit("comms.link", { connected: true }));
    await waitFor(() =>
      expect(compositionBorderRule()).toContain("--color-accent-fg"),
    );
    expect(compositionBorderRule()).not.toContain("--color-status-nogo-fg");
  });

  // Bug 2: the outline alone doesn't say WHY the box turned red — operators
  // asked for an explicit, visible badge near the input itself (the existing
  // `NoPathBadge` sits in the terminal pane's corner, easy to miss while
  // looking at the composition bar). Distinct short text ("NO PATH") from
  // that badge's fuller sentence so the two `role="status"` queries never
  // collide with each other.
  it("shows a visible NO PATH badge next to the composition bar iff there is no comms path", async () => {
    const f = await mountAttached({ lineMode: true });

    expect(screen.queryByText("NO PATH")).toBeNull();

    act(() => f.emit("comms.link", { connected: false }));
    await waitFor(() => expect(screen.getByText("NO PATH")).toBeVisible());
    expect(screen.getByText("NO PATH")).toHaveAttribute("role", "status");

    act(() => f.emit("comms.link", { connected: true }));
    await waitFor(() => expect(screen.queryByText("NO PATH")).toBeNull());
  });
});
