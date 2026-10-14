import type { PlotWaterLayer } from "@ksp-gonogo/sitrep-sdk";
import { useEffect, useRef } from "react";
import type { PlotLayerFrame } from "./plotLayers";
import { RELIEF_RESOLUTION, sampleGrid } from "./reliefGrid";
import {
  liquidShade,
  type SeaColour,
  seaHeight,
  seaWaves,
  shadePlan,
} from "./seaField";

/** The most columns a side view samples its surface at. */
const SECTION_COLUMNS = 192;
/** The frame rate the sea is redrawn at, at most. */
const FRAMES_PER_SECOND = 30;
/** The tone token the water is drawn in. */
const WATER_TOKEN = "--color-info-mark";
/** How opaque the water under a side view's surface is. */
const SECTION_FILL_ALPHA = 0.42;

interface Placement {
  /** The canvas's box in the chart's pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The data-space rectangle that box shows. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Where the layer's bounds fall, in pixels and in data, or null when they miss the plot box. A plan view keeps its whole bounds, so its cells are the relief's and the chart's clip trims them; a side view is cut to the plot box, so its canvas never outgrows the plot.
 */
function placementOf(
  layer: PlotWaterLayer,
  frame: PlotLayerFrame,
): Placement | null {
  const whole = layer.view === "plan";
  const toX = frame.scaleX;
  const toY = frame.scaleYPrimary;
  // The frames a sea is drawn on are linear, so two points give the way back from pixels.
  const xPerPx = 1 / (toX(1) - toX(0));
  const yPerPx = 1 / (toY(1) - toY(0));
  const fromX = (px: number) => (px - toX(0)) * xPerPx;
  const fromY = (py: number) => (py - toY(0)) * yPerPx;
  const left = Math.min(toX(layer.bounds.x0), toX(layer.bounds.x1));
  const right = Math.max(toX(layer.bounds.x0), toX(layer.bounds.x1));
  const top = Math.min(toY(layer.bounds.y0), toY(layer.bounds.y1));
  const bottom = Math.max(toY(layer.bounds.y0), toY(layer.bounds.y1));
  const pxA = whole ? left : Math.max(frame.plotX0, left);
  const pxB = whole ? right : Math.min(frame.plotX1, right);
  const pyA = whole ? top : Math.max(frame.plotY0, top);
  const pyB = whole ? bottom : Math.min(frame.plotY1, bottom);
  if (
    whole &&
    (right < frame.plotX0 ||
      left > frame.plotX1 ||
      bottom < frame.plotY0 ||
      top > frame.plotY1)
  ) {
    return null;
  }
  if (
    !(pxB - pxA >= 1 && pyB - pyA >= 1) ||
    !Number.isFinite(xPerPx + yPerPx)
  ) {
    return null;
  }
  return {
    left: pxA,
    top: pyA,
    width: pxB - pxA,
    height: pyB - pyA,
    x0: fromX(pxA),
    x1: fromX(pxB),
    y0: fromY(pyB),
    y1: fromY(pyA),
  };
}

/** A CSS colour as the canvas reads it back, a six-digit hex triple; null for one it cannot read. */
function rgbOf(ctx: CanvasRenderingContext2D, css: string): SeaColour | null {
  if (!css) return null;
  ctx.fillStyle = css;
  const triple = /^#([0-9a-f]{6})$/i.exec(String(ctx.fillStyle));
  if (!triple) return null;
  const n = Number.parseInt(triple[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * The water's colour: the theme's water token, or the body's own liquid colour drawn at that token's brightness when the layer carries one. Null when the theme does not resolve the token, and then no water is drawn.
 */
function waterColour(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  tint: string | undefined,
): SeaColour | null {
  const water = rgbOf(
    ctx,
    getComputedStyle(canvas).getPropertyValue(WATER_TOKEN).trim(),
  );
  if (!water) return null;
  const liquid = tint ? rgbOf(ctx, tint) : null;
  return liquid ? liquidShade(liquid, water) : water;
}

/**
 * Shades a plan view one flat cell at a time, on the cells a relief of the same bounds is drawn on: the same grid, and the same rule for which of them are under the sea, so a coast meets the land cell for cell.
 */
function drawPlan(
  ctx: CanvasRenderingContext2D,
  layer: PlotWaterLayer,
  at: Placement,
  frame: PlotLayerFrame,
  seconds: number,
  colour: SeaColour,
): void {
  const grid = RELIEF_RESOLUTION;
  const dx = (at.x1 - at.x0) / grid;
  const dy = (at.y1 - at.y0) / grid;
  const sea = layer.sea;
  // A relief draws its first row at the bottom when the plot's y runs up the screen, so the rows are read the way it reads them.
  const flipRows =
    frame.scaleYPrimary(layer.bounds.y0) < frame.scaleYPrimary(layer.bounds.y1);
  const isSea =
    sea && sea.size > 1 && sea.heights.length >= sea.size * sea.size
      ? (col: number, screenRow: number) => {
          const row = flipRows ? screenRow : grid - 1 - screenRow;
          return (
            sampleGrid(
              sea.heights,
              sea.size,
              (col / (grid - 1)) * (sea.size - 1),
              (row / (grid - 1)) * (sea.size - 1),
            ) < 0
          );
        }
      : undefined;
  const image = ctx.createImageData(grid, grid);
  shadePlan(image.data, grid, grid, {
    east0: layer.origin.east + at.x0,
    north0: layer.origin.north + at.y1,
    dx,
    dy,
    seconds,
    colour,
    waves: seaWaves(Math.max(dx, dy), at.x1 - at.x0, layer.gravity),
    isSea,
  });
  ctx.putImageData(image, 0, 0);
}

function drawSection(
  ctx: CanvasRenderingContext2D,
  layer: PlotWaterLayer,
  at: Placement,
  seconds: number,
  colour: SeaColour,
): void {
  const { width, height } = ctx.canvas;
  // The ground's own sample points, so the waterline steps as the ground line does; evenly spaced columns where none are given.
  const along = sectionSamples(layer, at, width);
  const spacing =
    along.length > 1
      ? (along[along.length - 1] - along[0]) / (along.length - 1)
      : at.x1 - at.x0;
  const waves = seaWaves(spacing, at.x1 - at.x0, layer.gravity);
  const bearing = ((layer.bearingDeg ?? 90) * Math.PI) / 180;
  const pxOf = (x: number) => ((x - at.x0) / (at.x1 - at.x0)) * width;
  const pyOf = (y: number) => ((at.y1 - y) / (at.y1 - at.y0)) * height;
  ctx.clearRect(0, 0, width, height);
  ctx.beginPath();
  along.forEach((x, i) => {
    const surface = seaHeight(
      waves,
      layer.origin.east + x * Math.sin(bearing),
      layer.origin.north + x * Math.cos(bearing),
      seconds,
    );
    if (i === 0) ctx.moveTo(pxOf(x), pyOf(surface));
    else ctx.lineTo(pxOf(x), pyOf(surface));
  });
  const rgb = `${colour.r}, ${colour.g}, ${colour.b}`;
  ctx.strokeStyle = `rgba(${rgb}, 0.9)`;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.lineTo(pxOf(along[along.length - 1]), height);
  ctx.lineTo(pxOf(along[0]), height);
  ctx.closePath();
  ctx.fillStyle = `rgba(${rgb}, ${SECTION_FILL_ALPHA})`;
  ctx.fill();
}

/** Where a side view samples its surface: the layer's own points inside what is drawn, with its ends, else one point a canvas column. */
function sectionSamples(
  layer: PlotWaterLayer,
  at: Placement,
  width: number,
): number[] {
  const given = (layer.samples ?? []).filter((x) => x > at.x0 && x < at.x1);
  if (layer.samples && layer.samples.length > 1) {
    return [at.x0, ...given, at.x1];
  }
  return Array.from(
    { length: width + 1 },
    (_, i) => at.x0 + (i / width) * (at.x1 - at.x0),
  );
}

/**
 * Open water, drawn on a canvas inside the chart: under the marks, over the ground, and outside React's own frames, since the surface moves every frame and the chart does not.
 * It draws one frame at once, at the time `Date.now` gives, so a render with that pinned is the same render every time; with motion allowed it then runs at up to 30 frames a second while the plot is on screen and the page is visible.
 */
export function WaterLayer({
  layer,
  frame,
}: Readonly<{ layer: PlotWaterLayer; frame: PlotLayerFrame }>) {
  const at = placementOf(layer, frame);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The latest geometry, read by the running loop, so a new reading moves the sea without restarting it.
  const latest = useRef<{
    layer: PlotWaterLayer;
    at: Placement;
    frame: PlotLayerFrame;
  } | null>(null);
  latest.current = at ? { layer, at, frame } : null;

  const bufferWidth = at
    ? layer.view === "plan"
      ? RELIEF_RESOLUTION
      : Math.max(1, Math.min(SECTION_COLUMNS, Math.round(at.width)))
    : 0;
  const bufferHeight = at
    ? layer.view === "plan"
      ? RELIEF_RESOLUTION
      : Math.max(1, Math.round((at.height * bufferWidth) / at.width))
    : 0;

  // The body's own liquid colour: a new body means a new colour, so the loop is set up again.
  const tint = layer.tint;
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d") ?? null;
    // A canvas resized clears, so a new buffer size redraws; an empty one has nothing to draw.
    if (!canvas || !ctx || bufferWidth === 0 || bufferHeight === 0) return;
    const colour = waterColour(canvas, ctx, tint);
    if (!colour) return;
    // Wall-clock seconds from Date.now, the clock every render harness pins, so a still frame is the same frame every run; the animation frame's own timestamp only paces the redraws.
    const draw = () => {
      const current = latest.current;
      if (!current) return;
      const seconds = Date.now() / 1000;
      if (current.layer.view === "plan") {
        drawPlan(
          ctx,
          current.layer,
          current.at,
          current.frame,
          seconds,
          colour,
        );
      } else {
        drawSection(ctx, current.layer, current.at, seconds, colour);
      }
    };
    draw();
    const still =
      typeof window.matchMedia !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still || typeof requestAnimationFrame !== "function") return;

    let onScreen = true;
    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            onScreen = entries.some((e) => e.isIntersecting);
          })
        : null;
    observer?.observe(canvas);
    let last = Number.NEGATIVE_INFINITY;
    let handle = 0;
    const tick = (now: number) => {
      handle = requestAnimationFrame(tick);
      if (
        !onScreen ||
        document.hidden ||
        now - last < 1000 / FRAMES_PER_SECOND
      ) {
        return;
      }
      last = now;
      draw();
    };
    handle = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(handle);
      observer?.disconnect();
    };
  }, [bufferWidth, bufferHeight, tint]);

  if (!at) return null;
  return (
    // Hidden from assistive technology: the chart's own name carries the layer's description, and a chart showing its crosshair is a group whose children would be read.
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: an SVG <g> with no tabindex and no interactive descendant is not focusable; the rule treats every <g> as one
    <g
      aria-hidden="true"
      data-plot-layer={layer.id}
      data-plot-layer-kind="water"
    >
      <foreignObject x={at.left} y={at.top} width={at.width} height={at.height}>
        <canvas
          ref={canvasRef}
          width={bufferWidth}
          height={bufferHeight}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            // One flat shade a cell, as the land beside it is drawn.
            imageRendering: layer.view === "plan" ? "pixelated" : "auto",
          }}
        />
      </foreignObject>
    </g>
  );
}
