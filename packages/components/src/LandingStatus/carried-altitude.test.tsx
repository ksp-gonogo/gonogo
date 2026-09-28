import {
  DashboardItemContext,
  PerfBudget,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { act, type RenderResult, render } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  flushResizeObservers,
  installSizedResizeObserver,
  WidgetContributions,
} from "../test/widgetDomSnapshot";
import { type HandoverFixture, loadHandoverFixture } from "./handoverFixture";
import { LandingStatusComponent } from "./index";

/**
 * The carried ASL altitude and its band, on screen.
 * The handover fixtures are the only committed descent across the atmosphere interface, and each is a perfect quadratic that a residual-based band can say nothing about, so the banded case perturbs one.
 */
/** The same descent with residuals: the two interior vertical-speed samples moved 6 m/s off the line, enough for a visible interval while the fitted acceleration stays inside the model's envelope. */
function withScatteredHistory(fixture: HandoverFixture): HandoverFixture {
  let seen = 0;
  const emits = fixture._stream.emits.map((emit) => {
    if (emit.channel !== "vessel.flight") return emit;
    seen += 1;
    const nudge = seen === 2 ? 6 : seen === 3 ? -6 : 0;
    if (nudge === 0) return emit;
    const speed = emit.value.verticalSpeed;
    if (typeof speed !== "number") {
      throw new Error("fixture flight sample carries no verticalSpeed");
    }
    return { ...emit, value: { ...emit.value, verticalSpeed: speed + nudge } };
  });
  return { ...fixture, _stream: { ...fixture._stream, emits } };
}

async function mount(fixture: HandoverFixture): Promise<RenderResult> {
  const stream = setupStreamFixture({
    pinnedUt: fixture._stream.pinnedUt,
    suspendFrames: true,
  });
  const tree = render(
    <stream.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "carried" }}>
        <WidgetContributions Widget={LandingStatusComponent}>
          <LandingStatusComponent id="carried" w={8} h={12} />
        </WidgetContributions>
      </DashboardItemContext.Provider>
    </stream.Provider>,
  );
  act(() => {
    for (const emit of fixture._stream.emits) {
      stream.emit(emit.channel, emit.value, emit.meta);
    }
  });
  await flushResizeObservers();
  return tree;
}

/** Everything the altitude readout says, found through its heading, since an interval is two `<Unit>`s in one span with no single text node or role. */
function readoutText(tree: RenderResult): string {
  const heading = tree.getByRole("heading", { name: /altitude asl/i });
  const section = heading.parentElement;
  if (section === null) throw new Error("the heading has no section");
  return section.textContent ?? "";
}

/** The two ends of the drawn interval, or `null`, found through the row's own label and split on `<Band>`'s dash. */
function drawnInterval(tree: RenderResult): { lo: string; hi: string } | null {
  const row = tree.queryByText("Known to")?.nextElementSibling;
  if (!row) return null;
  const [lo, hi] = (row.textContent ?? "").split("–");
  if (lo === undefined || hi === undefined) {
    throw new Error(`the interval row is not a pair: "${row.textContent}"`);
  }
  return { lo: lo.trim(), hi: hi.trim() };
}

/** `drawnInterval`, refusing where the point of the case is that one exists. */
function requireInterval(tree: RenderResult): { lo: string; hi: string } {
  const interval = drawnInterval(tree);
  if (interval === null) {
    throw new Error(
      `no interval was drawn; the readout says "${readoutText(tree)}"`,
    );
  }
  return interval;
}

describe("the carried ASL altitude reaches the operator", () => {
  let restoreResizeObserver: () => void;

  beforeEach(() => {
    for (const b of PerfBudget.getAll()) b.reset();
    restoreResizeObserver = installSizedResizeObserver({ w: 720, h: 640 });
    registerStockBodies();
  });

  afterEach(() => {
    restoreResizeObserver();
  });

  it("names the quantity it is describing, as a heading", async () => {
    const tree = await mount(loadHandoverFixture("05-drag-biting-42km.json"));
    expect(
      tree.getByRole("heading", { name: /altitude asl/i }),
    ).toBeInTheDocument();
  });

  it("draws the OBSERVED altitude, which nothing on this widget drew before", async () => {
    // 42 000 m is the anchor sample of the drag-biting frame.
    expect(
      readoutText(await mount(loadHandoverFixture("05-drag-biting-42km.json"))),
    ).toMatch(/42\.0/);
  });

  it("draws the CARRIED altitude beside it rather than in place of it", async () => {
    // Six seconds past the anchor the craft is carried to 37 977 m, shown as its own figure beside the observation, never replacing it.
    const text = readoutText(
      await mount(loadHandoverFixture("05-drag-biting-42km.json")),
    );
    expect(text).toMatch(/42\.0/);
    expect(text).toMatch(/38\.0/);
  });

  it("draws the descent fit's band as its two ends", async () => {
    const interval = requireInterval(
      await mount(
        withScatteredHistory(loadHandoverFixture("05-drag-biting-42km.json")),
      ),
    );
    expect(interval.lo).not.toBe(interval.hi);
  });

  it("says what the interval claims, rather than leaving it assumed", async () => {
    expect(
      readoutText(
        await mount(
          withScatteredHistory(loadHandoverFixture("05-drag-biting-42km.json")),
        ),
      ),
    ).toMatch(/the carried altitude is inside that interval/);
  });

  /** A noiseless history gives the fit no sigma, so no interval is drawn, and the readout says so in words rather than drawing a zero-width band that would read as exact. */
  it("draws no band at all through the handover set, and says so", async () => {
    const tree = await mount(loadHandoverFixture("05-drag-biting-42km.json"));
    expect(drawnInterval(tree)).toBeNull();
    expect(readoutText(tree)).toMatch(
      /carried with no interval: this model bounds nothing/,
    );
  });

  it("draws no interval where the conic carried the altitude, and invents none", async () => {
    // Above the interface Kepler propagation offers no band; the carried figure stays and an interval must not appear.
    const tree = await mount(
      loadHandoverFixture("01-above-interface-95km.json"),
    );
    expect(readoutText(tree)).toMatch(/92\.6/);
    expect(drawnInterval(tree)).toBeNull();
  });

  it("says why the model withdrew, where it withdrew", async () => {
    // Peak deceleration closes the rate integration's horizon, so there is no carried altitude.
    const tree = await mount(
      loadHandoverFixture("06-peak-deceleration-30km.json"),
    );
    expect(readoutText(tree)).toMatch(
      /honest for about 2\.5 seconds at the sensed deceleration/,
    );
    expect(drawnInterval(tree)).toBeNull();
  });

  it("has no a11y violations with the band drawn", async () => {
    const tree = await mount(
      withScatteredHistory(loadHandoverFixture("05-drag-biting-42km.json")),
    );
    await expectNoA11yViolations(tree.container);
  });
});

describe("the carried ASL altitude under signal delay", () => {
  let restoreResizeObserver: () => void;

  beforeEach(() => {
    for (const b of PerfBudget.getAll()) b.reset();
    restoreResizeObserver = installSizedResizeObserver({ w: 720, h: 640 });
    registerStockBodies();
  });

  afterEach(() => {
    restoreResizeObserver();
  });

  /** The drag-biting descent, current on the link, with every frame arriving `owlt` seconds after the craft sent it. */
  async function mountDelayed(owlt: number): Promise<RenderResult> {
    const fixture = loadHandoverFixture("05-drag-biting-42km.json");
    const stream = setupStreamFixture({
      delaySeconds: owlt,
      suspendFrames: true,
    });
    const tree = render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "carried-delay" }}>
          <WidgetContributions Widget={LandingStatusComponent}>
            <LandingStatusComponent id="carried-delay" w={8} h={12} />
          </WidgetContributions>
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
    act(() => {
      for (const emit of fixture._stream.emits) {
        const stamped = emit.meta?.validAt;
        const validAt = typeof stamped === "number" ? stamped : 0;
        stream.emit(emit.channel, emit.value, {
          ...emit.meta,
          staleness: 0,
          validAt,
          deliveredAt: validAt + owlt,
        });
      }
      stream.emitFrame();
    });
    await flushResizeObservers();
    return tree;
  }

  it("carries a current reading across the light-time to SCET beside the observation", async () => {
    const tree = await mountDelayed(6);
    const text = readoutText(tree);
    expect(text).toMatch(/42\.0/);
    expect(text).toMatch(/38\.0/);
    expect(tree.getByText("Carried to SCET")).toBeInTheDocument();
  });

  it("draws the observation alone when there is no light-time to carry it across", async () => {
    const tree = await mountDelayed(0);
    expect(tree.queryByText("Carried to SCET")).toBeNull();
  });
});
