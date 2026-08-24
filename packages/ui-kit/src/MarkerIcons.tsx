import { forwardRef, type SVGProps } from "react";

/**
 * Attitude and manoeuvre markers: an original rendering of the standard
 * spaceflight notation (a ring with a centre dot for prograde, and so on).
 * Nothing here is traced from the game's artwork; only the HUES follow KSP, via
 * the `--color-marker-*` tokens, so an operator who knows a marker by colour is
 * not retrained.
 *
 * Two rules the set is built on:
 *
 * SHAPE carries the meaning, hue only confirms it. Every "towards" marker
 * carries a centre DOT and every "away" marker a centre CROSS, which is the
 * physics vector notation for out-of-page and into-page (⊙ and ⊗). Prograde and
 * retrograde, normal and anti-normal, radial-out and radial-in, target and
 * anti-target each share one hue in game and here, so the dot/cross is the
 * whole distinction and it survives greyscale and every colour-vision
 * deficiency. Across pairs the OUTLINE differs: ring, triangle, ring with
 * chevrons, diamond, square.
 *
 * The glyph is legible on either ground. KSP's hues were picked for a
 * blue-and-brown sphere; on a near-black panel the maneuver blue has almost no
 * luminance contrast and on a light panel the prograde yellow has none. Each
 * marker is therefore drawn twice: first a wider keyline in `currentColor`,
 * which the theme guarantees contrasts with the surface because it is the text
 * colour, then the coloured stroke on top. The keyline is what a greyscale
 * reader sees; the colour is what a sighted operator recognises first.
 *
 * Authoring follows `Icons.tsx`: a 24-unit viewBox drawn at 20px by default,
 * `strokeWidth` 1.8, decorative unless named.
 */

export interface MarkerIconProps
  extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** Rendered width and height. Defaults to the kit's 20px icon size. */
  size?: number | string;
  /** Width of the coloured stroke, in viewBox units. */
  strokeWidth?: number;
  /**
   * Naming the icon makes it MEANINGFUL: it renders as `role="img"` with this as
   * its accessible name. Without one it is decorative and hidden from assistive
   * technology, so a marker beside its own text label costs a reader nothing.
   */
  label?: string;
}

/** Extra width of the keyline beyond the coloured stroke, split across both sides. */
const KEYLINE_EXTRA = 1.4;
const DOT_RADIUS = 1.7;
const DEFAULT_SIZE = 20;
const DEFAULT_STROKE_WIDTH = 1.8;

type MarkerColour = "prograde" | "normal" | "radial" | "maneuver" | "target";

interface MarkerShape {
  /** Stroked open paths; each string is one `d` attribute. */
  paths: string[];
  /** A filled centre dot, the ⊙ half of the notation. */
  dot?: [cx: number, cy: number];
  colour: MarkerColour;
}

const RING = "M12 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12";
/** A tighter ring for the radial pair, leaving clear space for the chevrons outside it. */
const SMALL_RING = "M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10";
/** The ⊗ half of the notation, centred on (cx, cy). */
const cross = (cx: number, cy: number): string =>
  `M${cx - 2.5} ${cy - 2.5}l5 5M${cx + 2.5} ${cy - 2.5}l-5 5`;

const SHAPES = {
  prograde: {
    colour: "prograde",
    paths: [RING, "M12 6V2.5M6 12H2.5M18 12H21.5"],
    dot: [12, 12],
  },
  retrograde: {
    colour: "prograde",
    paths: [
      RING,
      cross(12, 12),
      "M7.76 7.76L5.3 5.3M16.24 7.76L18.7 5.3M12 18V21.5",
    ],
  },
  normal: {
    colour: "normal",
    paths: ["M12 4.5L19 17H5Z"],
    dot: [12, 13],
  },
  antiNormal: {
    colour: "normal",
    paths: ["M12 19.5L5 7H19Z", cross(12, 11)],
  },
  radialOut: {
    colour: "radial",
    paths: [
      SMALL_RING,
      "M10 4.5L12 2.5L14 4.5M19.5 10L21.5 12L19.5 14M10 19.5L12 21.5L14 19.5M4.5 10L2.5 12L4.5 14",
    ],
    dot: [12, 12],
  },
  radialIn: {
    colour: "radial",
    paths: [
      SMALL_RING,
      "M10 2.5L12 4.5L14 2.5M21.5 10L19.5 12L21.5 14M10 21.5L12 19.5L14 21.5M2.5 10L4.5 12L2.5 14",
      cross(12, 12),
    ],
  },
  maneuver: {
    colour: "maneuver",
    paths: ["M12 5L19 12L12 19L5 12Z", "M12 5V2"],
    dot: [12, 12],
  },
  target: {
    colour: "target",
    paths: [
      "M6 6H18V18H6Z",
      "M6 6L3.5 3.5M18 6L20.5 3.5M18 18L20.5 20.5M6 18L3.5 20.5",
    ],
    dot: [12, 12],
  },
  antiTarget: {
    colour: "target",
    paths: [
      "M6 6H18V18H6Z",
      "M6 6L3.5 3.5M18 6L20.5 3.5M18 18L20.5 20.5M6 18L3.5 20.5",
      cross(12, 12),
    ],
  },
} satisfies Record<string, MarkerShape>;

export type MarkerId = keyof typeof SHAPES;

/** Every marker id, in the order a legend or contact sheet should show them. */
export const MARKER_IDS = Object.keys(SHAPES) as MarkerId[];

function Layer({
  shape,
  colour,
  strokeWidth,
  dotRadius,
}: {
  shape: MarkerShape;
  colour: string;
  strokeWidth: number;
  dotRadius: number;
}) {
  return (
    <g
      fill="none"
      stroke={colour}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shape.paths.map((d) => (
        <path key={d} d={d} />
      ))}
      {shape.dot && (
        <circle
          cx={shape.dot[0]}
          cy={shape.dot[1]}
          r={dotRadius}
          fill={colour}
          stroke="none"
        />
      )}
    </g>
  );
}

function makeMarker(id: MarkerId, displayName: string) {
  const shape: MarkerShape = SHAPES[id];
  const colour = `var(--color-marker-${shape.colour})`;
  const Marker = forwardRef<SVGSVGElement, MarkerIconProps>(
    (
      {
        size = DEFAULT_SIZE,
        strokeWidth = DEFAULT_STROKE_WIDTH,
        label,
        ...rest
      },
      ref,
    ) => {
      const frame = {
        ref,
        xmlns: "http://www.w3.org/2000/svg",
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        "data-marker": id,
      };
      const layers = (
        <>
          <Layer
            shape={shape}
            colour="currentColor"
            strokeWidth={strokeWidth + KEYLINE_EXTRA}
            dotRadius={DOT_RADIUS + KEYLINE_EXTRA / 2}
          />
          <Layer
            shape={shape}
            colour={colour}
            strokeWidth={strokeWidth}
            dotRadius={DOT_RADIUS}
          />
        </>
      );
      return label ? (
        <svg {...frame} role="img" aria-label={label} {...rest}>
          {layers}
        </svg>
      ) : (
        <svg {...frame} aria-hidden="true" {...rest}>
          {layers}
        </svg>
      );
    },
  );
  Marker.displayName = displayName;
  return Marker;
}

export const ProgradeIcon = makeMarker("prograde", "ProgradeIcon");
export const RetrogradeIcon = makeMarker("retrograde", "RetrogradeIcon");
export const NormalIcon = makeMarker("normal", "NormalIcon");
export const AntiNormalIcon = makeMarker("antiNormal", "AntiNormalIcon");
export const RadialOutIcon = makeMarker("radialOut", "RadialOutIcon");
export const RadialInIcon = makeMarker("radialIn", "RadialInIcon");
export const ManeuverIcon = makeMarker("maneuver", "ManeuverIcon");
export const TargetIcon = makeMarker("target", "TargetIcon");
export const AntiTargetIcon = makeMarker("antiTarget", "AntiTargetIcon");

/**
 * The Frenet manoeuvring frame (tangent, normal, binormal) that n-body flight
 * plans are expressed in. Its axes are the same physical directions as
 * three of the navball markers, so they get the same glyphs rather than a
 * second set an operator would have to learn: tangent is the velocity
 * direction, the Frenet normal points at the centre of curvature (towards the
 * body, so radial-IN), and the binormal is the orbit normal.
 */
export const TangentIcon = ProgradeIcon;
export const FrenetNormalIcon = RadialInIcon;
export const BinormalIcon = NormalIcon;

/** The component for a marker id, for callers driven by data rather than JSX. */
export const MARKER_ICONS: Record<MarkerId, typeof ProgradeIcon> = {
  prograde: ProgradeIcon,
  retrograde: RetrogradeIcon,
  normal: NormalIcon,
  antiNormal: AntiNormalIcon,
  radialOut: RadialOutIcon,
  radialIn: RadialInIcon,
  maneuver: ManeuverIcon,
  target: TargetIcon,
  antiTarget: AntiTargetIcon,
};
