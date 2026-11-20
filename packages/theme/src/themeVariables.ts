import type { UiKitTheme } from "./theme";

/** Every surface that floats, each drawn with a shadow of its own until a theme names one for the level. */
const FLOATING_SHADOWS = [
  "--shadow-popover",
  "--shadow-banner",
  "--shadow-fab",
  "--shadow-menu",
  "--shadow-modal",
  "--shadow-overlay",
  "--shadow-dialog",
  "--shadow-takeover",
] as const;

/**
 * The CSS variable each theme value sets, as `[variable, read]` pairs. A theme
 * names foundation values (the colours, type, radii, spacing and control sizes
 * the kit is built from); the kit draws from these variables.
 *
 * This table is the whole set a theme can write. A variable that `tokens.css`
 * derives from another (the status tones, every gap and inset) is deliberately
 * absent, so a theme moves them only by changing what they are built from.
 */
const TOKEN_VARIABLES: ReadonlyArray<
  readonly [variable: string, read: (theme: UiKitTheme) => string | undefined]
> = [
  ["--color-text-primary", (t) => t.colors.text.primary],
  ["--color-text-muted", (t) => t.colors.text.muted],
  ["--color-text-dim", (t) => t.colors.text.dim],
  ["--color-text-faint", (t) => t.colors.text.faint],
  ["--color-text-inverse", (t) => t.colors.text.inverse],
  ["--color-surface-app", (t) => t.colors.surface.app],
  ["--color-surface-panel", (t) => t.colors.surface.panel],
  ["--color-surface-raised", (t) => t.colors.surface.raised],
  ["--color-surface-sunken", (t) => t.colors.surface.sunken],
  ["--color-border-subtle", (t) => t.colors.border.subtle],
  ["--color-border-strong", (t) => t.colors.border.strong],
  ["--color-accent-fg", (t) => t.colors.accent.fg],
  ["--color-accent-bg", (t) => t.colors.accent.bg],
  ["--color-focus", (t) => t.colors.focus],
  [
    "--status-go-1",
    (t) => paletteStep(t, "--status-go-1", t.colors.palette?.go1, "go-1"),
  ],
  [
    "--status-go-2",
    (t) => paletteStep(t, "--status-go-2", t.colors.palette?.go2, "go-2"),
  ],
  [
    "--status-go-3",
    (t) => paletteStep(t, "--status-go-3", t.colors.palette?.go3, "go-3"),
  ],
  [
    "--status-go-4",
    (t) => paletteStep(t, "--status-go-4", t.colors.palette?.go4, "go-4"),
  ],
  [
    "--status-nogo-1",
    (t) => paletteStep(t, "--status-nogo-1", t.colors.palette?.nogo1, "nogo-1"),
  ],
  [
    "--status-nogo-2",
    (t) => paletteStep(t, "--status-nogo-2", t.colors.palette?.nogo2, "nogo-2"),
  ],
  [
    "--status-nogo-3",
    (t) => paletteStep(t, "--status-nogo-3", t.colors.palette?.nogo3, "nogo-3"),
  ],
  [
    "--status-warn-1",
    (t) => paletteStep(t, "--status-warn-1", t.colors.palette?.warn1, "warn-1"),
  ],
  [
    "--status-warn-2",
    (t) => paletteStep(t, "--status-warn-2", t.colors.palette?.warn2, "warn-2"),
  ],
  [
    "--status-warn-3",
    (t) => paletteStep(t, "--status-warn-3", t.colors.palette?.warn3, "warn-3"),
  ],
  [
    "--status-warn-4",
    (t) => paletteStep(t, "--status-warn-4", t.colors.palette?.warn4, "warn-4"),
  ],
  [
    "--status-info-1",
    (t) => paletteStep(t, "--status-info-1", t.colors.palette?.info1, "info-1"),
  ],
  [
    "--status-on-fill",
    (t) =>
      paletteStep(t, "--status-on-fill", t.colors.palette?.onFill, "on-fill"),
  ],
  ["--color-tag-blue-fg", (t) => t.colors.tag?.blueFg],
  ["--color-tag-blue-bg", (t) => t.colors.tag?.blueBg],
  ["--color-tag-blue-border", (t) => t.colors.tag?.blueBorder],
  ["--color-tag-purple-fg", (t) => t.colors.tag?.purpleFg],
  ["--color-tag-purple-bg", (t) => t.colors.tag?.purpleBg],
  ["--color-tag-purple-border", (t) => t.colors.tag?.purpleBorder],
  ["--color-tag-yellow-fg", (t) => t.colors.tag?.yellowFg],
  ["--color-tag-yellow-bg", (t) => t.colors.tag?.yellowBg],
  ["--color-tag-yellow-border", (t) => t.colors.tag?.yellowBorder],
  ["--color-tag-dark-brown-bg", (t) => t.colors.tag?.darkBrownBg],
  ["--color-tag-dark-brown-border", (t) => t.colors.tag?.darkBrownBorder],
  ["--color-tag-cyan-fg", (t) => t.colors.tag?.cyanFg],
  ["--color-tag-orange-fg", (t) => t.colors.tag?.orangeFg],
  ["--color-tag-red-fg", (t) => t.colors.tag?.redFg],
  ["--color-marker-prograde", (t) => t.colors.marker?.prograde],
  ["--color-marker-normal", (t) => t.colors.marker?.normal],
  ["--color-marker-radial", (t) => t.colors.marker?.radial],
  ["--color-marker-maneuver", (t) => t.colors.marker?.maneuver],
  ["--color-marker-target", (t) => t.colors.marker?.target],
  ["--color-data-1", (t) => t.colors.data?.[0]],
  ["--color-data-2", (t) => t.colors.data?.[1]],
  ["--color-data-3", (t) => t.colors.data?.[2]],
  ["--color-data-4", (t) => t.colors.data?.[3]],
  ["--color-data-5", (t) => t.colors.data?.[4]],
  ["--color-data-6", (t) => t.colors.data?.[5]],
  ["--color-data-7", (t) => t.colors.data?.[6]],
  ["--color-data-8", (t) => t.colors.data?.[7]],
  ["--color-data-9", (t) => t.colors.data?.[8]],
  ["--color-data-10", (t) => t.colors.data?.[9]],
  ["--color-data-11", (t) => t.colors.data?.[10]],
  ["--color-data-12", (t) => t.colors.data?.[11]],
  ["--color-data-13", (t) => t.colors.data?.[12]],
  ["--color-data-14", (t) => t.colors.data?.[13]],
  ["--color-data-15", (t) => t.colors.data?.[14]],
  ["--color-data-16", (t) => t.colors.data?.[15]],
  ["--color-data-17", (t) => t.colors.data?.[16]],
  ["--color-data-18", (t) => t.colors.data?.[17]],
  ["--color-data-19", (t) => t.colors.data?.[18]],
  ["--color-data-20", (t) => t.colors.data?.[19]],
  ["--color-data-21", (t) => t.colors.data?.[20]],
  ["--color-data-22", (t) => t.colors.data?.[21]],
  ["--color-data-23", (t) => t.colors.data?.[22]],
  ["--color-data-24", (t) => t.colors.data?.[23]],
  ["--color-shadow", (t) => t.colors.shadow],
  ["--color-scrim", (t) => t.colors.scrim],
  ["--color-imagery-ksc", (t) => t.colors.imagery?.ksc],
  ["--color-imagery-launch-site", (t) => t.colors.imagery?.launchSite],
  ["--color-imagery-contract", (t) => t.colors.imagery?.contract],
  ["--color-imagery-anomaly", (t) => t.colors.imagery?.anomaly],
  ["--color-imagery-other", (t) => t.colors.imagery?.other],
  ["--color-highlight", (t) => t.colors.highlight],
  ["--color-alarm-set", (t) => t.colors.alarm?.set],
  ["--color-alarm-arm", (t) => t.colors.alarm?.arm],
  ["--color-alarm-fire", (t) => t.colors.alarm?.fire],
  ["--color-alarm-notice", (t) => t.colors.alarm?.notice],
  ["--color-alarm-offline", (t) => t.colors.alarm?.offline],
  ["--color-alarm-overlay", (t) => t.colors.alarm?.overlay],
  ["--color-poll-go", (t) => t.colors.poll?.go],
  ["--color-poll-no-go", (t) => t.colors.poll?.noGo],
  ["--color-poll-abort", (t) => t.colors.poll?.abort],
  ["--color-poll-none", (t) => t.colors.poll?.none],
  ["--color-diagram-orbit-burn", (t) => t.colors.diagram?.orbitBurn],
  ["--color-diagram-orbit-retro", (t) => t.colors.diagram?.orbitRetro],
  [
    "--color-diagram-atmosphere-oxygen",
    (t) => t.colors.diagram?.atmosphereOxygen,
  ],
  [
    "--color-diagram-atmosphere-inert",
    (t) => t.colors.diagram?.atmosphereInert,
  ],
  ["--color-diagram-encounter", (t) => t.colors.diagram?.encounter],
  ["--color-diagram-flyby", (t) => t.colors.diagram?.flyby],
  ["--color-diagram-impact", (t) => t.colors.diagram?.impact],
  ["--color-diagram-depth-above", (t) => t.colors.diagram?.depthAbove],
  ["--color-diagram-depth-level", (t) => t.colors.diagram?.depthLevel],
  ["--color-diagram-depth-below", (t) => t.colors.diagram?.depthBelow],
  [
    "--color-diagram-docking-misaligned",
    (t) => t.colors.diagram?.dockingMisaligned,
  ],
  ["--color-diagram-signal-live", (t) => t.colors.diagram?.signalLive],
  ["--color-diagram-danger", (t) => t.colors.diagram?.danger],
  ["--color-diagram-power", (t) => t.colors.diagram?.power],
  ["--font-family-mono", (t) => t.typography.family.mono],
  ["--font-size-2xs", (t) => t.typography.microSize],
  ["--font-size-xs", (t) => t.typography.size.xs],
  ["--font-size-sm", (t) => t.typography.size.sm],
  ["--font-size-base", (t) => t.typography.size.base],
  ["--font-size-lg", (t) => t.typography.size.lg],
  ["--line-height-flush", (t) => t.typography.lineHeight?.flush],
  ["--line-height-tight", (t) => t.typography.lineHeight?.tight],
  ["--line-height-body", (t) => t.typography.lineHeight?.body],
  ["--line-height-prose", (t) => t.typography.lineHeight?.prose],
  ["--icon-size-control", (t) => t.typography.iconSize?.control],
  ["--icon-size-standalone", (t) => t.typography.iconSize?.standalone],
  ["--radius-regular", (t) => t.radius?.regular],
  ["--radius-floating", (t) => t.radius?.floating],
  ["--radius-display-frame", (t) => t.radius?.displayFrame],
  ["--radius-display-frame-aside", (t) => t.radius?.displayFrameAside],
  ["--radius-pill", (t) => t.radius?.pill],
  ["--radius-banner", (t) => t.radius?.banner],
  ["--space-hair", (t) => t.space?.hair],
  ["--space-2", (t) => t.space?.["2"]],
  ["--space-4", (t) => t.space?.["4"]],
  ["--space-6", (t) => t.space?.["6"]],
  ["--space-8", (t) => t.space?.["8"]],
  ["--space-10", (t) => t.space?.["10"]],
  ["--space-12", (t) => t.space?.["12"]],
  ["--space-16", (t) => t.space?.["16"]],
  ["--space-24", (t) => t.space?.["24"]],
  ["--control-height", (t) => t.sizes?.controlHeight],
  ["--fab-size", (t) => t.sizes?.fab],
  ["--gap-related-comfortable", (t) => t.density?.related?.comfortable],
  [
    "--gap-related-compact",
    (t) =>
      ordered(
        "--gap-related-compact",
        t.density?.related?.compact,
        "--gap-related-comfortable",
      ),
  ],
  [
    "--gap-related-dense",
    (t) =>
      ordered(
        "--gap-related-dense",
        t.density?.related?.dense,
        "--gap-related-compact",
      ),
  ],
  [
    "--gap-related-packed",
    (t) =>
      ordered(
        "--gap-related-packed",
        t.density?.related?.packed,
        "--gap-related-dense",
      ),
  ],
  ["--gap-section-comfortable", (t) => t.density?.section?.comfortable],
  [
    "--gap-section-compact",
    (t) =>
      ordered(
        "--gap-section-compact",
        t.density?.section?.compact,
        "--gap-section-comfortable",
      ),
  ],
  ["--gutter-panel", (t) => t.density?.panelGutter],
  ["--gutter-screen", (t) => t.density?.screenGutter],
  ["--inset-control", (t) => t.density?.control],
  ["--inset-surface", (t) => t.density?.surface],
  ["--inset-floating", (t) => t.floating?.padding],
  ["--border-width-hairline", (t) => t.borderWidth?.hairline],
  ["--border-width-strong", (t) => t.borderWidth?.strong],
  ["--font-weight-semibold", (t) => t.typography.weight?.semibold],
  ["--font-weight-bold", (t) => t.typography.weight?.bold],
  ["--tracking-scale", (t) => unlessOne(t.typography.tracking)],
  ["--motion-speed", (t) => unlessOne(t.motion?.speed)],
  ["--ease-standard", (t) => t.motion?.standard],
  ["--ease-emphasis", (t) => t.motion?.emphasis],
  [
    "--shadow-raised",
    (t) => dropShadow(t.elevation?.raised, t.elevation?.floating),
  ],
  ...FLOATING_SHADOWS.map(
    (variable) =>
      [variable, (t: UiKitTheme) => dropShadow(t.elevation?.floating)] as const,
  ),
];

/** The theme's value for a size that may never exceed the tier above it, held to that by `min()`; a value that is its own variable is no choice. */
function ordered(
  variable: string,
  value: string | undefined,
  above: string,
): string | undefined {
  if (value === undefined || value === `var(${variable})`) return undefined;
  return `min(${value}, var(${above}))`;
}

/** A number as the string a variable holds, left out at 1 where it changes nothing. */
function unlessOne(value: number | undefined): string | undefined {
  return value === undefined || value === 1 ? undefined : String(value);
}

/** The colour every theme drop shadow is drawn in. */
const SHADOW_COLOUR =
  "color-mix(in srgb, var(--color-shadow) 55%, transparent)";

/**
 * A drop shadow level as a `box-shadow` value. Given the level above it, each
 * length is the smaller of the two, so a raised shadow never outgrows a
 * floating one.
 */
function dropShadow(
  shadow: { offset: string; blur: string } | undefined,
  above?: { offset: string; blur: string },
): string | undefined {
  if (shadow === undefined) return undefined;
  const length = (own: string, cap: string | undefined) =>
    cap === undefined ? own : `min(${own}, ${cap})`;
  return `0 ${length(shadow.offset, above?.offset)} ${length(shadow.blur, above?.blur)} ${SHADOW_COLOUR}`;
}

/**
 * How each palette step is derived from its tone's one colour: the share of the
 * tone colour kept, and what it is mixed toward. `text` is the theme's primary
 * text colour and `ground` its panel colour, both read live, so a light theme
 * turns the same value into the right shade without a rule of its own.
 */
interface StepMix {
  tone: keyof NonNullable<UiKitTheme["colors"]["status"]>;
  keep: number;
  toward?: "text" | "ground";
}

const STEP_MIXES: Readonly<Record<string, StepMix>> = {
  "go-1": { tone: "go", keep: 30, toward: "text" },
  "go-2": { tone: "go", keep: 100 },
  "go-3": { tone: "go", keep: 50, toward: "ground" },
  "go-4": { tone: "go", keep: 14, toward: "ground" },
  "nogo-1": { tone: "nogo", keep: 30, toward: "text" },
  "nogo-2": { tone: "nogo", keep: 100 },
  "nogo-3": { tone: "nogo", keep: 22, toward: "ground" },
  "warn-1": { tone: "warn", keep: 40, toward: "text" },
  "warn-2": { tone: "warn", keep: 100 },
  "warn-3": { tone: "warn", keep: 50, toward: "ground" },
  "warn-4": { tone: "warn", keep: 14, toward: "ground" },
  "info-1": { tone: "info", keep: 100 },
};

const MIX_TARGET = {
  text: "var(--color-text-primary)",
  ground: "var(--color-surface-panel)",
} as const;

/** A share of a colour as the `color-mix` argument that names it. */
const share = (keep: number) =>
  new Intl.NumberFormat("en", { style: "percent" }).format(keep / 100);

/**
 * A palette step: the one the theme set, else the one derived from its tone's
 * colour, else nothing (the default). A step that is the variable it would set
 * is not a choice, so a theme built on the default theme still derives.
 */
function paletteStep(
  theme: UiKitTheme,
  variable: string,
  explicit: string | undefined,
  step: string,
): string | undefined {
  if (explicit !== undefined && explicit !== `var(${variable})`)
    return explicit;
  const mix = STEP_MIXES[step];
  const base = mix ? theme.colors.status?.[mix.tone] : undefined;
  if (!mix || base === undefined) return explicit;
  if (!mix.toward) return base;
  return `color-mix(in srgb, ${base} ${share(mix.keep)}, ${MIX_TARGET[mix.toward]})`;
}

/**
 * The CSS variables a theme sets, by name. A value that is the variable it
 * would set (`var(--color-text-primary)` for `--color-text-primary`) is left
 * out: writing it would make the variable refer to itself, and it already has
 * its value from `tokens.css`. A value the theme leaves out is left out too,
 * so it keeps the default.
 */
export function themeVariables(theme: UiKitTheme): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [variable, read] of TOKEN_VARIABLES) {
    const value = read(theme);
    if (value === undefined || value === `var(${variable})`) continue;
    variables[variable] = value;
  }
  return variables;
}

/** Every variable a theme can set, so a switch can take back the ones the previous theme wrote. */
export const THEME_VARIABLE_NAMES: readonly string[] = TOKEN_VARIABLES.map(
  ([variable]) => variable,
);
