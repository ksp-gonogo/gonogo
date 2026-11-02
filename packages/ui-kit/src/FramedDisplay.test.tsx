import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  type CheckerGrid,
  fitOf,
  framingFaults,
  paintChecker,
} from "./checkerFraming";
import { edgeCuePath, FramedDisplay } from "./FramedDisplay";
import { emittedRuleFor, emittedStateRuleFor } from "./test/emittedRule";

describe("FramedDisplay", () => {
  it("renders its visual content", () => {
    render(
      <FramedDisplay>
        <svg aria-label="diagram" />
      </FramedDisplay>,
    );
    expect(screen.getByLabelText("diagram")).toBeInTheDocument();
  });

  it("forwards div props so it can be laid out by the caller", () => {
    // The caller decides how much room the visual gets; the frame never sizes itself.
    const { container } = render(<FramedDisplay className="probe" />);
    expect(container.querySelector(".probe")).not.toBeNull();
  });

  it("inlays a caption on the frame instead of drawing it as a sibling", () => {
    render(
      <FramedDisplay caption="orbit plane">
        <svg aria-label="diagram" />
      </FramedDisplay>,
    );
    // Inside the frame's own box, not beside it: the caller's Panel body holds nothing but this one element.
    const frame = screen.getByLabelText("diagram").closest("div");
    expect(frame).toHaveTextContent("orbit plane");
  });

  it("inlays a footer line on the frame", () => {
    render(
      <FramedDisplay footer="axes needed">
        <svg aria-label="diagram" />
      </FramedDisplay>,
    );
    const frame = screen.getByLabelText("diagram").closest("div");
    expect(frame).toHaveTextContent("axes needed");
  });

  it("is a disc when given the circle shape, and says so", () => {
    render(
      <FramedDisplay data-testid="frame" shape="circle" style={{ width: 200 }}>
        <svg aria-label="lens" />
      </FramedDisplay>,
    );
    const frame = screen.getByTestId("frame");
    expect(frame).toHaveAttribute("data-shape", "circle");
    expect(frame).toContainElement(screen.getByLabelText("lens"));
    const rule = emittedRuleFor(frame);
    expect(rule).toContain("border-radius:50%");
    expect(rule).toContain("aspect-ratio:1/1");
  });

  it("draws no strip on a circle", () => {
    render(
      <FramedDisplay
        data-testid="frame"
        shape="circle"
        strip={<svg aria-label="trend" />}
      >
        <svg aria-label="lens" />
      </FramedDisplay>,
    );
    expect(screen.queryByLabelText("trend")).toBeNull();
  });

  it("lights an arc of a circle's border in the tone given, outside the clipped contents", () => {
    render(
      <FramedDisplay
        data-testid="frame"
        shape="circle"
        edgeCue={{ angle: 0, tone: "warn", grow: 0.5 }}
      >
        <svg aria-label="lens" />
      </FramedDisplay>,
    );
    const frame = screen.getByTestId("frame");
    const arc = frame.querySelector("[data-edge-cue]");
    expect(arc).not.toBeNull();
    expect(arc?.getAttribute("fill")).toBe("var(--color-warn-mark)");
    // The contents are cut to the disc in a layer of their own, so the frame itself no longer clips the arc.
    expect(emittedRuleFor(frame)).toContain("overflow:visible");
    expect(frame.querySelector("[data-edge-cues]")).not.toBeNull();
    expect(frame).toContainElement(screen.getByLabelText("lens"));
  });

  it("draws one arc for each cue given", () => {
    render(
      <FramedDisplay
        data-testid="frame"
        shape="circle"
        edgeCue={[
          { angle: 0, tone: "warn", grow: 0.2 },
          { angle: 180, tone: "accent", grow: 1 },
        ]}
      />,
    );
    expect(
      screen.getByTestId("frame").querySelectorAll("[data-edge-cue]"),
    ).toHaveLength(2);
  });

  it("draws no cue on a rounded frame and leaves the frame clipping as before", () => {
    render(
      <FramedDisplay
        data-testid="frame"
        edgeCue={{ angle: 0, tone: "warn", grow: 1 }}
      />,
    );
    const frame = screen.getByTestId("frame");
    expect(frame.querySelector("[data-edge-cue]")).toBeNull();
    expect(emittedRuleFor(frame)).toContain("overflow:hidden");
  });

  it("draws no cue and changes nothing without one", () => {
    render(<FramedDisplay data-testid="frame" shape="circle" />);
    const frame = screen.getByTestId("frame");
    expect(frame.querySelector("[data-edge-cues]")).toBeNull();
    expect(emittedRuleFor(frame)).toContain("overflow:hidden");
  });

  it("is the rounded rectangle by default", () => {
    render(<FramedDisplay data-testid="frame" />);
    expect(screen.getByTestId("frame")).toHaveAttribute(
      "data-shape",
      "rounded",
    );
  });

  it("holds a strip inside the same frame as the drawing above it", () => {
    render(
      <FramedDisplay data-testid="frame" strip={<svg aria-label="trend" />}>
        <svg aria-label="gauge" />
      </FramedDisplay>,
    );
    const frame = screen.getByTestId("frame");
    expect(frame).toContainElement(screen.getByLabelText("gauge"));
    const strip = frame.querySelector("[data-framed-display-strip]");
    expect(strip).toContainElement(screen.getByLabelText("trend"));
    expect(strip).not.toContainElement(screen.getByLabelText("gauge"));
  });

  it("keeps the frame's gutter off the strip, so a trend reaches the inner edges", () => {
    render(
      <FramedDisplay
        data-testid="frame"
        padded
        strip={<svg aria-label="trend" />}
      >
        <svg aria-label="gauge" />
      </FramedDisplay>,
    );
    const main = screen.getByLabelText("gauge").parentElement as HTMLElement;
    const strip = screen.getByLabelText("trend").parentElement as HTMLElement;
    expect(emittedRuleFor(screen.getByTestId("frame"))).toContain("padding:0");
    expect(emittedRuleFor(main)).toContain(
      "padding:var(--inset-framed-display)",
    );
    expect(emittedRuleFor(strip)).not.toContain("padding");
  });

  it("draws no caption element at all when none is given", () => {
    const { container } = render(
      <FramedDisplay>
        <svg aria-label="diagram" />
      </FramedDisplay>,
    );
    expect(container).not.toHaveTextContent(/./);
  });
});

/** A 16:9 camera's own picture, one cell per 64px of a 1024x576 frame. */
const FEED: CheckerGrid = { cols: 16, rows: 9 };

/**
 * Each tile is the frame's outer size; the picture gets that less the frame's
 * border, which is what the expected cell counts are worked from.
 */
const TILES = [
  {
    shape: "landscape",
    tile: { width: 402, height: 202 },
    cell: 25,
    visible: { cols: 16, rows: 8 },
  },
  {
    shape: "portrait",
    tile: { width: 202, height: 402 },
    cell: 400 / 9,
    visible: { cols: 4.5, rows: 9 },
  },
  {
    shape: "square",
    tile: { width: 302, height: 302 },
    cell: 300 / 9,
    visible: { cols: 9, rows: 9 },
  },
] as const;

function frameBorderPx(frame: HTMLElement): number {
  const match = /border:(\d+)px/.exec(emittedRuleFor(frame));
  if (!match) throw new Error("FramedDisplay's rule carries no px border");
  return Number(match[1]);
}

/**
 * The box a picture laid over the frame gets: the frame's size inside its
 * border, since an absolutely positioned child with `inset: 0` fills the
 * padding box.
 */
function overlayBox(frame: HTMLElement) {
  const border = frameBorderPx(frame);
  return {
    width: Number.parseFloat(frame.style.width) - 2 * border,
    height: Number.parseFloat(frame.style.height) - 2 * border,
  };
}

describe("FramedDisplay checkered flag", () => {
  describe.each(
    TILES,
  )("$shape tile, object-fit cover as a camera backdrop paints it", ({
    tile,
    cell,
    visible,
  }) => {
    function renderFeed() {
      render(
        <FramedDisplay data-testid="frame" style={tile}>
          <video
            data-testid="feed"
            muted
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: 0.55,
            }}
          />
        </FramedDisplay>,
      );
      const frame = screen.getByTestId("frame");
      const feed = screen.getByTestId("feed");
      // The picture must fill the frame, or the box below is not the box it gets.
      expect(emittedRuleFor(frame)).toContain("position:relative");
      expect(feed.style.position).toBe("absolute");
      expect(feed.style.inset).toBe("0px");
      return paintChecker(FEED, overlayBox(frame), fitOf(feed));
    }

    it("renders a cell exactly as wide as it is high", () => {
      const paint = renderFeed();
      expect(paint.cellWidth).toBeCloseTo(cell, 6);
      expect(paint.cellHeight).toBeCloseTo(paint.cellWidth, 6);
      expect(framingFaults(paint, FEED)).not.toContain("distortion");
    });

    it(`shows ${visible.cols} x ${visible.rows} cells of the feed's ${FEED.cols} x ${FEED.rows}`, () => {
      const paint = renderFeed();
      expect(paint.visible.cols).toBeCloseTo(visible.cols, 6);
      expect(paint.visible.rows).toBeCloseTo(visible.rows, 6);
    });

    it("loses cells to cropping, never to a changed field of view", () => {
      expect(framingFaults(renderFeed(), FEED)).toEqual(["cropping"]);
    });
  });

  it.each(
    TILES,
  )("an svg filling a $shape frame keeps the whole grid in square cells", ({
    tile,
  }) => {
    render(
      <FramedDisplay data-testid="frame" style={tile}>
        <svg data-testid="scene" viewBox={`0 0 ${FEED.cols} ${FEED.rows}`} />
      </FramedDisplay>,
    );
    const frame = screen.getByTestId("frame");
    // The frame's own rule sizes a child svg to its content box, which is the overlay box with no padding.
    expect(emittedStateRuleFor(frame, ">svg")).toMatch(
      /width:100%;height:100%/,
    );
    const paint = paintChecker(
      FEED,
      overlayBox(frame),
      fitOf(screen.getByTestId("scene")),
    );
    expect(paint.cellWidth).toBeCloseTo(paint.cellHeight, 6);
    expect(paint.visible).toEqual(FEED);
    expect(framingFaults(paint, FEED)).toEqual([]);
  });
});

describe("FramedDisplay's cue coming and going", () => {
  it("keeps the contents mounted while a circle's cue appears and clears", () => {
    const mounted = vi.fn();
    function Probe() {
      useEffect(() => {
        mounted();
      }, []);
      return <svg aria-label="picture" />;
    }
    const cue = { angle: 0, tone: "warn" as const, grow: 0.5 };
    const { rerender } = render(
      <FramedDisplay shape="circle" edgeCue={[]}>
        <Probe />
      </FramedDisplay>,
    );
    for (const edgeCue of [cue, [], cue, []] as const) {
      rerender(
        <FramedDisplay shape="circle" edgeCue={edgeCue}>
          <Probe />
        </FramedDisplay>,
      );
    }
    expect(mounted).toHaveBeenCalledTimes(1);
  });
});

describe("edgeCuePath", () => {
  const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

  it("starts on the border circle, at the angle a quarter either side of the middle", () => {
    // Angle 0 with a 90 degree span: from 45 degrees below the right-hand point.
    const [x, y] = nums(edgeCuePath({ angle: 0, tone: "warn", grow: 0 }));
    expect(x).toBeCloseTo(50 + 50 * Math.cos(Math.PI / 4), 2);
    expect(y).toBeCloseTo(50 + 50 * Math.sin(Math.PI / 4), 2);
  });

  it("reaches further out as it grows, and a little way at none", () => {
    const reach = (grow: number) => {
      const d = edgeCuePath({ angle: 0, tone: "warn", grow });
      // The outer edge's start point is the second coordinate pair after the line command.
      const [, , , , , , , , , lx, ly] = nums(d);
      return Math.hypot(lx - 50, ly - 50);
    };
    expect(reach(0)).toBeGreaterThan(50);
    expect(reach(1)).toBeGreaterThan(reach(0.5));
    expect(reach(0.5)).toBeGreaterThan(reach(0));
  });

  it("holds grow to its range and treats a missing number as none", () => {
    expect(edgeCuePath({ angle: 0, tone: "warn", grow: 7 })).toBe(
      edgeCuePath({ angle: 0, tone: "warn", grow: 1 }),
    );
    expect(edgeCuePath({ angle: 0, tone: "warn", grow: Number.NaN })).toBe(
      edgeCuePath({ angle: 0, tone: "warn", grow: 0 }),
    );
  });

  it("is one border thick where it first lights and three at full reach", () => {
    const thickness = (grow: number, borderUnits: number) => {
      const d = edgeCuePath({ angle: 0, tone: "warn", grow }, borderUnits);
      const [, , , , , , , , , lx, ly] = nums(d);
      return Math.hypot(lx - 50, ly - 50) - 50;
    };
    expect(thickness(0, 0.5)).toBeCloseTo(0.5, 2);
    expect(thickness(1, 0.5)).toBeCloseTo(1.5, 2);
    expect(thickness(0, 1.1)).toBeCloseTo(1.1, 2);
    expect(thickness(1, 1.1)).toBeCloseTo(3.3, 2);
  });
});
