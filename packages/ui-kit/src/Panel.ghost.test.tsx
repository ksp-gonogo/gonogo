import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Panel } from "./Panel";
import { PanelStatusStoreProvider } from "./status/PanelStatusStore";

/**
 * The condensing ghost: a presentation-only duplicate of the title that fades
 * in ONLY while the real title is scrolled out of view, re-surfacing identity
 * and status without a permanent band. These drive the registered scroller in
 * jsdom (the whole reason the trigger reuses the glow's scroll/ResizeObserver
 * machinery rather than an IntersectionObserver, which jsdom does not
 * implement) and assert the relationships, never pixels.
 */

/** jsdom reports 0 for both; the ghost's trigger reads scrollTop and the
 *  header's measured height, so a test has to supply them. */
function setScrollTop(el: HTMLElement, value: number) {
  Object.defineProperty(el, "scrollTop", { configurable: true, value });
}
function setOffsetHeight(el: HTMLElement, value: number) {
  Object.defineProperty(el, "offsetHeight", { configurable: true, value });
}

function scroll(el: HTMLElement, top: number) {
  act(() => {
    setScrollTop(el, top);
    el.dispatchEvent(new Event("scroll"));
  });
}

function ghost(): HTMLElement {
  return document.querySelector("[data-panel-ghost]") as HTMLElement;
}
function body(): HTMLElement {
  return document.querySelector("[data-panel-body]") as HTMLElement;
}
function header(): HTMLElement {
  return document.querySelector("[data-panel-header]") as HTMLElement;
}

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion") ? matches : false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Panel ghost trigger", () => {
  it("hides at the top and shows once the real title is scrolled past", () => {
    render(<Panel panelTitle="ALTITUDE">body</Panel>);
    setOffsetHeight(header(), 40);

    // At the top: hidden.
    scroll(body(), 0);
    expect(getComputedStyle(ghost()).opacity).toBe("0");

    // Scrolled past the header's measured height: shown.
    scroll(body(), 40);
    expect(getComputedStyle(ghost()).opacity).toBe("1");

    // Back to the top: hidden again.
    scroll(body(), 0);
    expect(getComputedStyle(ghost()).opacity).toBe("0");
  });

  it("keys off the MEASURED header height, not a constant", () => {
    render(<Panel panelTitle="ALTITUDE">body</Panel>);
    // A wrapped aside makes the header taller; the threshold must follow it.
    setOffsetHeight(header(), 80);

    // A scroll that would have crossed a 40px header stays hidden here.
    scroll(body(), 50);
    expect(getComputedStyle(ghost()).opacity).toBe("0");

    // Only past the real 80px height does it show.
    scroll(body(), 80);
    expect(getComputedStyle(ghost()).opacity).toBe("1");
  });

  it("never becomes a second heading, even while shown", () => {
    render(<Panel panelTitle="ALTITUDE">body</Panel>);
    setOffsetHeight(header(), 40);
    scroll(body(), 60);
    expect(getComputedStyle(ghost()).opacity).toBe("1");
    // The real h3 is still the ONLY heading; the ghost is aria-hidden.
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(ghost()).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Panel ghost reduced motion", () => {
  it("drops the fade transition when the viewer asks for reduced motion", () => {
    stubReducedMotion(true);
    render(<Panel panelTitle="ALTITUDE">body</Panel>);
    expect(getComputedStyle(ghost()).transition).toBe("none");
  });

  it("fades by default when motion is allowed", () => {
    stubReducedMotion(false);
    render(<Panel panelTitle="ALTITUDE">body</Panel>);
    // Some real opacity transition, not the reduced-motion "none".
    expect(getComputedStyle(ghost()).transition).not.toBe("none");
    expect(getComputedStyle(ghost()).transition).toContain("opacity");
  });
});

describe("Panel ghost status dot", () => {
  it("renders no dot when there is no status store in the tree", () => {
    // No PanelStatusStore, so useStatusSummary is null and the dot stays dark.
    render(<Panel panelTitle="ALTITUDE">body</Panel>);
    expect(ghost().querySelector("[data-panel-ghost-dot]")).toBeNull();
  });

  it("renders no dot for a healthy stream", () => {
    // A store is present, but a live stream contributes nothing, so the summary
    // is null and the dot stays dark: the silent-when-healthy rule.
    render(
      <PanelStatusStoreProvider>
        <Panel.Status status="live">
          <Panel panelTitle="ALTITUDE">body</Panel>
        </Panel.Status>
      </PanelStatusStoreProvider>,
    );
    setOffsetHeight(header(), 40);
    scroll(body(), 60);
    expect(ghost().querySelector("[data-panel-ghost-dot]")).toBeNull();
  });

  it("lights the dot for a degraded stream, aria-hidden with the label as its tooltip", () => {
    render(
      <PanelStatusStoreProvider>
        <Panel.Status status="held-stale">
          <Panel panelTitle="ALTITUDE">body</Panel>
        </Panel.Status>
      </PanelStatusStoreProvider>,
    );
    // The ghost's content exists only while shown, so scroll past the header.
    setOffsetHeight(header(), 40);
    scroll(body(), 60);
    const dot = ghost().querySelector("[data-panel-ghost-dot]") as HTMLElement;
    expect(dot).not.toBeNull();
    // The canonical severity drives the colour; the label is the tooltip hint.
    expect(dot).toHaveAttribute("data-severity", "warning");
    expect(dot).toHaveAttribute("title", "STALE");
    // The dot is decorative: the authoritative status is the header badge.
    expect(dot).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the announced summary badge in the DOM while the ghost dot mirrors it", () => {
    render(
      <PanelStatusStoreProvider>
        <Panel.Status status="disconnected">
          <Panel panelTitle="ALTITUDE">body</Panel>
        </Panel.Status>
      </PanelStatusStoreProvider>,
    );
    // The announced status stays in the header (role=status) whatever the
    // scroll position; the ghost dot only re-surfaces it while scrolled off.
    expect(screen.getByRole("status")).toHaveTextContent("OFFLINE");
    setOffsetHeight(header(), 40);
    scroll(body(), 60);
    const dot = ghost().querySelector("[data-panel-ghost-dot]") as HTMLElement;
    expect(dot).toHaveAttribute("data-severity", "offline");
  });
});
