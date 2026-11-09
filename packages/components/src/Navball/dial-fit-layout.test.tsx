import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { NavballComponent } from "./index";
import { ATTITUDE_CHROME_PX, MIN_DIAL_PX } from "./useDialFit";

/**
 * jsdom lays nothing out, so these give the widget's ResizeObservers the sizes
 * a browser would: the attitude column is as tall as the room the tile leaves
 * it, except under the numeric readout, which it cannot be shorter than. That
 * floor is what lets a measurement taken under the readout overstate the room,
 * and the dial must survive every order the measurements and the stream arrive in.
 */

const pristineObserver = globalThis.ResizeObserver;
afterEach(() => {
  globalThis.ResizeObserver = pristineObserver;
});

function entryFor(el: Element, width: number, height: number) {
  return {
    target: el,
    contentRect: { width, height } as DOMRectReadOnly,
  } as ResizeObserverEntry;
}

interface Tile {
  /** The room the tile leaves the attitude column with the control row out. */
  body: number;
  /** The stacked readout's own height, which the column cannot shrink below while it is drawn. */
  readout: number;
  /** The control row's height once its inputs have arrived. */
  row: () => number;
}

/** Observers that answer, on each flush, with the size the DOM currently drawn would have, reporting only a change as a browser does. */
function installLayout(tile: Tile) {
  const live: Array<{
    el: HTMLElement;
    cb: ResizeObserverCallback;
    last: string;
  }> = [];
  const dialDrawn = () =>
    screen.queryByRole("img", { name: "Attitude indicator" }) !== null;
  const rowDrawn = () =>
    screen.queryByRole("button", { name: /^SAS/ }) !== null;
  const sizeOf = (el: HTMLElement) => {
    const width = 151;
    if (el.style.gap === "var(--gap-rows)") {
      return { width, height: tile.row() };
    }
    const free = tile.body - (rowDrawn() ? tile.row() + 8 : 0);
    return { width, height: dialDrawn() ? free : Math.max(free, tile.readout) };
  };
  class Observer implements ResizeObserver {
    constructor(private readonly cb: ResizeObserverCallback) {}
    observe(el: Element): void {
      live.push({ el: el as HTMLElement, cb: this.cb, last: "" });
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = Observer;
  return () =>
    act(() => {
      for (const rec of live) {
        if (!rec.el.isConnected) continue;
        const { width, height } = sizeOf(rec.el);
        const key = `${width}x${height}`;
        if (key === rec.last) continue;
        rec.last = key;
        rec.cb([entryFor(rec.el, width, height)], {} as ResizeObserver);
      }
    });
}

type Order = "attitude first" | "inputs first" | "inputs late";

function settle(tile: Tile, order: Order) {
  let inputsArrived = order === "inputs first";
  const flush = installLayout({
    ...tile,
    row: () => (inputsArrived ? tile.row() : 28),
  });
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "nav" }}>
        <NavballComponent config={{}} id="nav" w={5} h={8} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  flush();
  act(() => {
    fixture.emit("vessel.attitude", {
      headingRootFrame: 90,
      pitchRootFrame: 45,
      rollRootFrame: 0,
    });
  });
  flush();
  if (order === "inputs late") {
    flush();
    inputsArrived = true;
  }
  for (let i = 0; i < 12; i++) flush();
}

describe("the dial survives the control row and the readout's height", () => {
  const orders: Order[] = ["attitude first", "inputs first", "inputs late"];
  // 5x8 measures near 188; a readout taller than the room (stacked, on a column under three across) is what a short wide tile draws before its dial.
  const bodies = [160, 170, 188, 210, 260];
  const readouts = [100, 150, 190, 230];
  const rows = [28, 64, 102, 144];

  for (const body of bodies) {
    for (const readout of readouts) {
      for (const row of rows) {
        for (const order of orders) {
          it(`body ${body}, readout ${readout}, row ${row}, ${order}`, () => {
            settle({ body, readout, row: () => row }, order);
            const fits = body - ATTITUDE_CHROME_PX >= MIN_DIAL_PX;
            expect(
              screen.queryByRole("img", { name: "Attitude indicator" }) !==
                null,
            ).toBe(fits);
          });
        }
      }
    }
  }
});
