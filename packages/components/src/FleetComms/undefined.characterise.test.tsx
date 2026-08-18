import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SystemOverlayContext } from "../SystemView";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { FleetCommsBadge, FleetCommsOverlay } from "./index";
import { __resetFleetCommsTogglesForTests } from "./toggles";

/**
 * What FleetComms DOES today when its telemetry reads are `undefined`, recorded
 * before `useTelemetry` becomes a `Reading`.
 *
 * The augment has five absence-sensitive reads and they do NOT agree with each
 * other about what absence means:
 *
 *  - `connectivity?.connected ?? null` (overlay) and `link?.connected ?? null`
 *    (badge) read the same topic and land on OPPOSITE policies. The badge draws
 *    a distinct third state (`NULL_DISPLAY`, honest unknown); the overlay's
 *    `linkConnected === false` tests fall through, so unknown is drawn as the
 *    GO colour, solid, at full opacity: visually identical to a confirmed link
 *  - `identity?.parentBodyIndex != null` and the `nameByIndex` lookup gate the
 *    vessel's projected anchor, so absence there withholds the whole commlink
 *    line rather than styling it differently
 *  - `if (!orbit || universalTime == null ...)` in `trueAnomalyDeg` and
 *    `if (!vesselDot || utNow == null || !pendingQueue)` in `pulses` are the
 *    two plain `!x` gates: after the migration a `Reading` is always truthy, so
 *    a gate written that way stops gating
 *  - `systemBodies?.bodies ?? []` and `describeCommsPath(undefined)` are the two
 *    sites that coerce absence into a value (an empty map, and a confident
 *    "No comms path home" sentence)
 */

const KERBIN_MU = 3.5316e12;
const PINNED_UT = 100;

const CARRIED = [
  "vessel.orbit",
  "vessel.identity",
  "system.bodies",
  "comms.path",
  "comms.link",
  "system.uplink.pending",
];

/**
 * The augment's own overlay `<svg>`, and the only element inside it that draws
 * the commlink. Scoped rather than a bare `document.querySelector("line")`
 * because these tests render the augment alone, so a match anywhere in the
 * document is a match on the thing under test either way, and the scope keeps
 * the query honest if that ever stops being true.
 */
const OVERLAY = '[aria-label="Fleet and comms overlay"]';

function commlinkLine(): SVGLineElement | null {
  return document.querySelector(`${OVERLAY} line`);
}

function pulseDots(): NodeListOf<Element> {
  return document.querySelectorAll(
    `${OVERLAY} circle[fill="url(#fleet-comms-pulse-gradient)"]`,
  );
}

const OVERLAY_CONTEXT: SystemOverlayContext = {
  parentName: "Kerbin",
  width: 400,
  height: 400,
  // Metres -> SVG user units. Any non-zero scale puts the 700 km orbit a
  // measurable distance off the origin, which is all these tests need.
  plotScale: 2e-5,
  center: { x: 0, y: 0 },
};

let fixture: StreamFixture;
const teardowns: Array<() => void> = [];

beforeEach(() => {
  __resetFleetCommsTogglesForTests();
  fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: PINNED_UT,
  });
});

afterEach(() => {
  for (const teardown of teardowns) teardown();
  teardowns.length = 0;
});

function renderOverlay() {
  const rendered = render(
    <fixture.Provider>
      <FleetCommsOverlay {...OVERLAY_CONTEXT} />
    </fixture.Provider>,
  );
  teardowns.push(rendered.unmount);
  return rendered;
}

function renderBadge() {
  const rendered = render(
    <fixture.Provider>
      <FleetCommsBadge frameName="Kerbin" />
    </fixture.Provider>,
  );
  teardowns.push(rendered.unmount);
  return rendered;
}

/**
 * Everything the vessel's projected anchor needs, and nothing about comms. Lets
 * a test isolate an absent `comms.link` from an absent geometry, which the
 * overlay treats completely differently (styling versus withholding).
 */
function emitGeometry() {
  act(() => {
    fixture.emit("system.bodies", {
      bodies: [
        {
          index: 0,
          name: "Kerbin",
          parentIndex: null,
          radius: 600_000,
          gravParameter: KERBIN_MU,
          orbit: null,
        },
      ],
    });
    fixture.emit("vessel.identity", {
      vesselId: "v",
      name: "Test Ship",
      vesselType: 0,
      situation: 3,
      parentBodyIndex: 0,
    });
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: 0,
      sma: 700_000,
      ecc: 0,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: PINNED_UT,
      mu: KERBIN_MU,
    });
  });
}

describe("FleetComms badge: what undefined means today", () => {
  it("renders the placeholder glyph, not a link state, when comms.link has never arrived", () => {
    renderBadge();

    // `link?.connected ?? null` resolving to `null` picks the third, honest
    // state: neither LINK nor NO LINK. The badge is the ONE read in this file
    // that draws unknown distinctly, which is why the overlay's identical read
    // drawing it as connected (below) is worth pinning separately.
    const badge = screen.getByTestId("fleet-comms-badge");
    expect(badge.textContent).toBe(NULL_DISPLAY);
    expect(badge.textContent).not.toBe("LINK");
    expect(badge.textContent).not.toBe("NO LINK");
  });

  it("renders that same placeholder for a confirmed comms.link tombstone", async () => {
    renderBadge();

    act(() => {
      // A whole-topic tombstone: the subject states there is no comms record.
      // The store keeps `undefined` for never-arrived and `null` for this, so
      // the two ARE distinguishable at the read.
      fixture.emit("comms.link", null);
    });

    // Proof the tombstone landed, so the assertion below is about the widget's
    // policy and not about a dropped emit.
    await waitFor(() =>
      expect(fixture.store.sample("comms.link")?.payload).toBeNull(),
    );

    // The widget does NOT distinguish them: `link?.connected` short-circuits on
    // `null` to `undefined`, then `?? null` lands on the same branch as
    // never-arrived. "Confirmed no comms record" and "nothing has come through"
    // render identically.
    expect(screen.getByTestId("fleet-comms-badge").textContent).toBe(
      NULL_DISPLAY,
    );
  });

  it("renders that same placeholder when the record arrives without a connected field", async () => {
    renderBadge();

    act(() => {
      // Partial payload: the record exists, the field inside it does not.
      fixture.emit("comms.link", {});
    });
    await waitFor(() =>
      expect(fixture.store.sample("comms.link")?.payload).toEqual({}),
    );

    // Third meaning collapsed onto the same render: a live comms Uplink that
    // simply omitted `connected` is indistinguishable from no Uplink at all.
    expect(screen.getByTestId("fleet-comms-badge").textContent).toBe(
      NULL_DISPLAY,
    );
  });
});

describe("FleetComms overlay: what undefined means today", () => {
  it("draws the svg frame but no commlink, no pulse and no gradient when nothing has arrived", () => {
    renderOverlay();

    // The overlay itself mounts (width/height are positive), so this is the
    // augment present-and-drawing-nothing, not an unmounted augment.
    expect(document.querySelector(OVERLAY)).not.toBeNull();
    // Named-element absences rather than an empty container: the commlink line,
    // its hover title, the traffic pulses and the gradient `<defs>` the pulses
    // reference are each individually withheld.
    expect(commlinkLine()).toBeNull();
    expect(document.querySelector(`${OVERLAY} line > title`)).toBeNull();
    expect(pulseDots()).toHaveLength(0);
    expect(document.querySelector(`${OVERLAY} radialGradient`)).toBeNull();
  });

  it("draws the commlink as a solid GO-coloured line when comms.link has never arrived", async () => {
    renderOverlay();
    emitGeometry();

    // The fail-open this pass exists to make visible. Geometry is known, link
    // state is not, and `linkConnected === false` is the only test in the
    // styling: so `null` falls through to the GO colour, no dash pattern, and
    // the full-strength 0.85 opacity, which is byte-for-byte the render a
    // CONFIRMED link produces. An operator cannot tell "linked" from "no comms
    // Uplink mounted" by looking at the diagram.
    await waitFor(() => expect(commlinkLine()).not.toBeNull());
    const line = commlinkLine();
    expect(line?.getAttribute("stroke")).toBe("var(--color-status-go-fg)");
    expect(line?.getAttribute("stroke-dasharray")).toBeNull();
    expect(line?.getAttribute("opacity")).toBe("0.85");

    // And the tooltip states an absence as a fact: `describeCommsPath(undefined)`
    // returns the same sentence a REAL empty hop list returns, with no "(no
    // link)" suffix because that suffix also only fires on an explicit `false`.
    expect(document.querySelector(`${OVERLAY} line > title`)?.textContent).toBe(
      "No comms path home",
    );
  });

  it("draws that same solid GO line when comms.link arrives without a connected field", async () => {
    renderOverlay();
    emitGeometry();
    await waitFor(() => expect(commlinkLine()).not.toBeNull());

    act(() => {
      // Partial payload: a comms record that omits `connected`.
      fixture.emit("comms.link", {});
    });
    await waitFor(() =>
      expect(fixture.store.sample("comms.link")?.payload).toEqual({}),
    );

    // Same render as never-arrived: the styling reads one field and treats
    // "field missing" as "not false".
    expect(commlinkLine()?.getAttribute("stroke")).toBe(
      "var(--color-status-go-fg)",
    );
    expect(commlinkLine()?.getAttribute("stroke-dasharray")).toBeNull();
  });

  it("draws the commlink differently ONLY on an explicit connected: false", async () => {
    // The contrast case. Without it the two assertions above could be read as
    // "the line always looks like this", rather than as an absent read being
    // routed into the connected-looking branch.
    renderOverlay();
    emitGeometry();
    await waitFor(() => expect(commlinkLine()).not.toBeNull());

    act(() => {
      fixture.emit("comms.link", { connected: false });
    });

    await waitFor(() =>
      expect(commlinkLine()?.getAttribute("stroke")).toBe(
        "var(--color-status-nogo-fg)",
      ),
    );
    expect(commlinkLine()?.getAttribute("stroke-dasharray")).toBe("3 3");
    expect(commlinkLine()?.getAttribute("opacity")).toBe("0.6");
    expect(
      document.querySelector(`${OVERLAY} line > title`)?.textContent,
    ).toContain("(no link)");
  });

  it("withholds the commlink entirely when the vessel orbit has not arrived", async () => {
    // `if (!orbit ...)` in `trueAnomalyDeg` and `if (orbit == null ...)` in
    // `vesselDot`: the plain-truthiness gates. Identity and bodies are present,
    // so the ONLY thing missing is the orbit, and the line disappears rather
    // than being drawn from a partial anchor.
    renderOverlay();
    act(() => {
      fixture.emit("system.bodies", {
        bodies: [
          {
            index: 0,
            name: "Kerbin",
            parentIndex: null,
            radius: 600_000,
            gravParameter: KERBIN_MU,
            orbit: null,
          },
        ],
      });
      fixture.emit("vessel.identity", {
        vesselId: "v",
        name: "Test Ship",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: 0,
      });
      fixture.emit("comms.link", { connected: true });
    });

    await waitFor(() =>
      expect(fixture.store.sample("comms.link")?.payload).toEqual({
        connected: true,
      }),
    );
    // A KNOWN-connected link still draws nothing, so the absent geometry, not
    // the comms read, is what withholds the line.
    expect(commlinkLine()).toBeNull();
  });

  it("withholds the commlink when system.bodies has not arrived, so the parent body cannot be named", async () => {
    // `nameByIndex` comes off `systemBodies?.bodies ?? []`: absence coerces to
    // an empty map, the lookup misses, `vesselBodyName` is `null`, and the
    // frame-match gate withholds the anchor. The vessel's orbit is fully known
    // here: what is missing is only the NAME of the body it orbits.
    renderOverlay();
    act(() => {
      fixture.emit("vessel.identity", {
        vesselId: "v",
        name: "Test Ship",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: 0,
      });
      fixture.emit("vessel.orbit", {
        referenceBodyIndex: 0,
        sma: 700_000,
        ecc: 0,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: PINNED_UT,
        mu: KERBIN_MU,
      });
      fixture.emit("comms.link", { connected: true });
    });

    await waitFor(() =>
      expect(fixture.store.sample("vessel.orbit")).not.toBeNull(),
    );
    expect(commlinkLine()).toBeNull();
  });

  it("withholds the commlink when the identity record arrives without a parentBodyIndex", async () => {
    // Partial payload, distinct from the record being absent: `parentBodyIndex`
    // is the one field the anchor needs, and `identity?.parentBodyIndex != null`
    // flattens "no identity record" and "identity without a parent body" onto
    // the same `null`.
    renderOverlay();
    act(() => {
      fixture.emit("system.bodies", {
        bodies: [
          {
            index: 0,
            name: "Kerbin",
            parentIndex: null,
            radius: 600_000,
            gravParameter: KERBIN_MU,
            orbit: null,
          },
        ],
      });
      fixture.emit("vessel.identity", {
        vesselId: "v",
        name: "Test Ship",
        vesselType: 0,
        situation: 3,
      });
      fixture.emit("vessel.orbit", {
        referenceBodyIndex: 0,
        sma: 700_000,
        ecc: 0,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: PINNED_UT,
        mu: KERBIN_MU,
      });
      fixture.emit("comms.link", { connected: true });
    });

    await waitFor(() =>
      expect(fixture.store.sample("vessel.orbit")).not.toBeNull(),
    );
    expect(commlinkLine()).toBeNull();
  });

  it("draws no traffic pulse for a real pending queue while the vessel anchor is absent", async () => {
    // `if (!vesselDot || utNow == null || !pendingQueue) return []`: the queue
    // is genuinely non-empty and mid-flight, and the pulses are dropped anyway
    // because the anchor they interpolate between does not exist. Pins that the
    // command-traffic overlay is silent about in-flight commands rather than
    // drawing them somewhere arbitrary.
    renderOverlay();

    act(() => {
      fixture.emit(
        "system.uplink.pending",
        {
          pending: [
            {
              id: "cmd-1",
              command: "kos.run",
              label: "",
              topic: "kos/1",
              vantage: "KSC",
              dispatchedAt: 90,
              oneWaySeconds: 5,
            },
          ],
        },
        { deliveredAt: 95 },
      );
    });

    await waitFor(() =>
      expect(fixture.store.sample("system.uplink.pending")).not.toBeNull(),
    );
    expect(pulseDots()).toHaveLength(0);
    // The gradient is keyed off `pulses.length > 0`, so it stays absent too.
    expect(document.querySelector(`${OVERLAY} radialGradient`)).toBeNull();
  });
});
