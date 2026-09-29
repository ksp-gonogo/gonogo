import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  type CheckerGrid,
  fitOf,
  framingFaults,
  paintChecker,
} from "./checkerFraming";
import { FramedDisplay } from "./FramedDisplay";
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
