import { Tooltip } from "@ksp-gonogo/ui-kit";

interface Props {
  x: number;
  y: number;
  /** The mark's width in pixels. */
  size: number;
  /** The colour of the trace that went past the limit, drawn as the mark's outline so two traces' marks tell apart. */
  color: string;
  /** Which trace, which limit, the reading and when. It is the mark's accessible name and its tip. */
  text: string;
}

/**
 * The mark a chart sets where a trace went past a limit: a warning triangle
 * with an exclamation mark, so the shape says what it is and the colour only
 * says whose it is. It is a tab stop, and its tip opens on hover and on focus.
 */
export function LimitCrossingMark({ x, y, size, color, text }: Props) {
  const half = size / 2;
  // An upright triangle centred on the mark's box.
  const triangle = `M 0 ${-half} L ${half} ${half * 0.8} L ${-half} ${half * 0.8} Z`;
  // The exclamation mark is cut out of the fill, so it is the ground showing through and needs no ink of its own.
  const bar = `M -0.9 ${-half * 0.42} H 0.9 V ${half * 0.2} H -0.9 Z`;
  const dot = `M -0.9 ${half * 0.4} H 0.9 V ${half * 0.64} H -0.9 Z`;
  return (
    <Tooltip text={text} focusable>
      {/* biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: a g is not interactive; it is a named picture that can be focused to read its tip */}
      <g
        role="img"
        aria-label={text}
        data-limit-crossing=""
        transform={`translate(${x} ${y})`}
      >
        {/* Empty, so the chart's own title is not also shown as a browser tip over the mark. */}
        <title />
        {/* A pointer target the size the mark is too small to be. */}
        <circle r={12} fill="transparent" />
        <path
          d={`${triangle} ${bar} ${dot}`}
          fillRule="evenodd"
          fill="var(--color-warn-mark)"
        />
        <path
          d={triangle}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      </g>
    </Tooltip>
  );
}
