import { FramedDisplay } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import type { AspectCase } from "./cases";

/** A checkerboard of square cells as an SVG, `columns` by `rows` cells of `cell` px. */
function checkerUrl(columns: number, rows: number, cell: number): string {
  const width = columns * cell;
  const height = rows * cell;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" shape-rendering="crispEdges">` +
    `<defs><pattern id="c" width="${cell * 2}" height="${cell * 2}" patternUnits="userSpaceOnUse">` +
    `<rect width="${cell * 2}" height="${cell * 2}" fill="#000"/>` +
    `<rect width="${cell}" height="${cell}" fill="#fff"/>` +
    `<rect x="${cell}" y="${cell}" width="${cell}" height="${cell}" fill="#fff"/>` +
    "</pattern></defs>" +
    `<rect width="${width}" height="${height}" fill="url(#c)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Painted the way a camera augment paints its video: absolutely filling the frame. */
const PICTURE_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
};

function Case({ spec }: { spec: AspectCase }) {
  return (
    <div
      style={{
        width: spec.tile.width,
        height: spec.tile.height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <FramedDisplay
        style={
          spec.frame === "tile"
            ? { width: "100%", height: "100%" }
            : { width: spec.frame.width, height: spec.frame.height }
        }
      >
        <img
          data-aspect-case={spec.name}
          alt=""
          src={checkerUrl(
            spec.picture.columns,
            spec.picture.rows,
            spec.picture.cell,
          )}
          style={{ ...PICTURE_STYLE, objectFit: spec.fit }}
        />
      </FramedDisplay>
    </div>
  );
}

declare global {
  interface Window {
    __renderAspectCases?: (cases: AspectCase[]) => void;
  }
}

window.__renderAspectCases = (cases) => {
  const root = document.getElementById("root");
  if (!root) throw new Error("aspect-entry: no #root");
  createRoot(root).render(
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: 16 }}>
      {cases.map((spec) => (
        <Case key={spec.name} spec={spec} />
      ))}
    </div>,
  );
};
