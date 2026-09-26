import {
  clearBodies,
  DashboardItemContext,
  registerBody,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { installFixedSizeResizeObserver } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { EscapeProfileComponent } from "./index";

const ESCAPE_PROFILE_CHANNELS = [
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
];

/** Names the parent body via `vessel.identity.parentBodyIndex` against a single-entry `system.bodies` roster; the default facts are Kerbin's radius with no gravitational parameter. */
function emitBody(
  fixture: ReturnType<typeof setupStreamFixture>,
  name: string,
  facts: { radius?: number; gravParameter?: number } = {},
) {
  fixture.emit("system.bodies", {
    bodies: [
      {
        name,
        index: 1,
        parentIndex: 0,
        radius: facts.radius ?? 600_000,
        ...(facts.gravParameter === undefined
          ? {}
          : { gravParameter: facts.gravParameter }),
        orbit: null,
      },
    ],
  });
  fixture.emit("vessel.identity", { parentBodyIndex: 1 });
}

describe("EscapeProfileComponent", () => {
  let restoreResizeObserver: () => void = () => {};
  beforeEach(() => {
    clearBodies();
    registerStockBodies();
    restoreResizeObserver = installFixedSizeResizeObserver({
      width: 400,
      height: 300,
    });
  });

  afterEach(() => {
    clearBodies();
    restoreResizeObserver();
    vi.unstubAllGlobals();
  });

  function renderEscape() {
    const fixture = setupStreamFixture({
      carriedChannels: ESCAPE_PROFILE_CHANNELS,
      pinnedUt: 10,
      suspendFrames: true,
    });
    const rendered = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "esc-test" }}>
          <EscapeProfileComponent config={{}} id="esc-test" />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    return { fixture, ...rendered };
  }

  it("renders the title and no curve before v.body arrives", async () => {
    const { container } = renderEscape();
    await screen.findByText("ESCAPE PROFILE");
    expect(container.querySelectorAll("path[stroke-dasharray]")).toHaveLength(
      0,
    );
  });

  it("draws the escape-velocity curve once the body is known", async () => {
    const { fixture, container } = renderEscape();

    act(() => {
      emitBody(fixture, "Kerbin");
    });

    await waitFor(() => {
      expect(
        container.querySelectorAll("path[stroke-dasharray]").length,
      ).toBeGreaterThan(0);
    });
  });

  it("falls back to a notice when the body has no GM", async () => {
    registerBody({
      id: "Modtopia",
      name: "Modtopia",
      radius: 500_000,
      hasAtmosphere: false,
      maxAtmosphere: 0,
    });

    const { fixture } = renderEscape();

    act(() => {
      emitBody(fixture, "Modtopia");
    });

    expect(await screen.findByText(/no reference data/i)).toBeInTheDocument();
  });

  it("draws the notice as the kit's graph notice, with no widget-owned styling", async () => {
    registerBody({
      id: "Modtopia",
      name: "Modtopia",
      radius: 500_000,
      hasAtmosphere: false,
      maxAtmosphere: 0,
    });

    const { fixture, container } = renderEscape();

    act(() => {
      emitBody(fixture, "Modtopia");
    });

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/no reference data/i);
    expect(notice.getAttribute("style")).toBeNull();
    expect(container.firstElementChild?.getAttribute("style")).toBeNull();
  });

  /** `escapeVelocity` is `sqrt(2 * GM / (r + h))`, so the curve needs the reported radius and GM; rendered, since `buildEscapeCurve` takes the body as an argument. */
  it("draws the curve for a body the stock table has never heard of", async () => {
    const { fixture, container } = renderEscape();

    act(() => {
      emitBody(fixture, "Earth", {
        radius: 6_371_000,
        gravParameter: 3.986004418e14,
      });
    });

    await waitFor(() => {
      expect(
        container.querySelectorAll("path[stroke-dasharray]").length,
      ).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/unknown body/i)).toBeNull();
    expect(screen.queryByText(/no reference data/i)).toBeNull();
  });
});
