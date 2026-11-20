/*
 * The theme contract: what a theme supplies, and what `ThemeDefinition.theme`
 * holds. Tokens are named by role so a palette change edits the value behind
 * the role instead of forcing a sweep across every consumer. Each token names
 * the CSS variable of `@ksp-gonogo/ui-kit/tokens.css` that it sets: a theme
 * provider writes the values onto those variables, and the kit draws from the
 * variables, never from the theme object.
 *
 * The styled-components DefaultTheme augmentation lives in ui-kit's
 * src/styledComponentsTheme.ts, because an augmentation only applies where it
 * is compiled from source.
 */

/**
 * The colour half of a `UiKitTheme`. Tokens are named by role
 * (`text.muted`, `surface.raised`), not by hue, and each value is a CSS colour
 * that becomes the matching `--color-*` variable (`text.muted` sets
 * `--color-text-muted`). Useful for colouring text, surfaces and borders by
 * role, so every widget under a `UiKitThemeProvider` takes the theme's colours.
 *
 * @category Theme
 */
export interface ThemeColors {
  /** Foreground text, from `primary` (strongest) down to `faint`. */
  text: {
    primary: string;
    muted: string;
    dim: string;
    /**
     * Lowest-contrast foreground tier: placeholder text, disabled labels,
     * extreme captions. Fails large-text WCAG contrast on dark surfaces;
     * use sparingly for non-essential content.
     */
    faint: string;
    /** Text on an accent or light fill. */
    inverse: string;
  };
  /** Backgrounds: `app` behind everything, `panel` for a widget, `raised` and `sunken` for areas within one. */
  surface: {
    app: string;
    panel: string;
    raised: string;
    sunken: string;
  };
  /** Border colours. */
  border: {
    subtle: string;
    strong: string;
  };
  /** The accent colour, as a foreground and as a background. */
  accent: {
    fg: string;
    bg: string;
  };
  /** The focus ring colour. */
  focus: string;
  /** One colour each for go, no-go, warning and info, from which the palette steps are derived. Leave one out to keep the default. */
  status?: ThemeStatusColors;
  /** The steps every status colour is built from. A step set here replaces the one derived from `status`; leave it out to keep the derived or default one. */
  palette?: ThemePalette;
  /** The colours of the labelled-state chips. Leave one out to keep the default. */
  tag?: ThemeTagColors;
  /** The hue of each navball marker, as the game paints it. Leave one out to keep the default. */
  marker?: ThemeMarkerColors;
  /**
   * The categorical colours for chart series and anything else that must be
   * told apart from its neighbours. Entry 0 is the first colour and the list
   * cycles; entries left out keep the default.
   */
  data?: readonly string[];
  /** The ink of drop shadows and of the backdrop that dims the page behind a modal. Each use mixes it to the strength it needs. */
  shadow?: string;
  /**
   * The backing drawn behind text and marks that the theme colours, such as the
   * label chips on a chart and the ground of a banner. Set it to a colour the
   * text colours read on: dark on a dark theme, light on a light one. Each use
   * mixes it to the strength it needs.
   */
  scrim?: string;
  /** The marks drawn over map imagery, such as the contract markers on the ground track. Leave one out to keep the default. */
  imagery?: ThemeImageryColors;
  /** The light tint laid over a dark ground, mixed to the strength a use needs. */
  highlight?: string;
  /** The grounds of the alarm banners and floating panels. Leave one out to keep the default. */
  alarm?: ThemeAlarmColors;
  /** The tints of the go/no-go header. Leave one out to keep the default. */
  poll?: ThemePollColors;
  /** The hues of diagrams, maps and device glows. Leave one out to keep the default. */
  diagram?: ThemeDiagramColors;
}

/**
 * The colours of the marks drawn over map imagery, which stays dark whatever
 * the theme, so these hold their own value rather than following the text
 * and tag colours. Useful for keeping the ground track's markers readable on
 * a light theme. Used by the ground track.
 *
 * @category Theme
 */
export interface ThemeImageryColors {
  /** The mark of the space centre. */
  ksc?: string;
  /** The mark of a launch site. */
  launchSite?: string;
  /** The mark and label of a contract waypoint. */
  contract?: string;
  /** The mark of an anomaly. */
  anomaly?: string;
  /** The mark of a place of a kind the map does not know. */
  other?: string;
}

/**
 * The colour each status wears, one value per status. Every step of that
 * status's palette is derived from it: the step nearest the text colour mixes
 * the value toward the text colour, the steps nearest the surfaces mix it toward
 * the panel colour, and the middle step is the value itself. Because the mix
 * reads the theme's own text and panel colours, the same value gives a dark
 * green on a light theme and a pale one on a dark theme. Caution follows `warn`,
 * as it always has. Useful for changing what go looks like in one line, such as
 * a blue go and an orange no-go for a colour-blind palette. A step set in
 * {@link ThemePalette} still replaces the derived one.
 *
 * @category Theme
 */
export interface ThemeStatusColors {
  /** The colour of a go status: the `go` steps derive from it. */
  go?: string;
  /** The colour of a no-go status: the `nogo` steps derive from it. */
  nogo?: string;
  /** The colour of a warning and a caution: the `warn` steps derive from it. */
  warn?: string;
  /** The colour of an info status and of a modelled figure: `info1`. */
  info?: string;
}

/**
 * The steps the status colours (go, caution, warn, no-go, info) are derived
 * from. Each name is a status and a step, such as `go2`. Steps count away from
 * the theme's text colour: step 1 is the shade nearest the text, the highest
 * step the one nearest the surfaces, so on a light theme step 1 is the darkest.
 * A step is not a role: the status tokens choose which steps they read, and a
 * theme cannot change that. Setting a step recolours every status built from it.
 * Useful for shifting the whole status scheme at once, such as for a light ground
 * or a colour-blind palette.
 *
 * @category Theme
 */
export interface ThemePalette {
  /** The go colour nearest the text colour, read as the words of a go status. */
  go1?: string;
  /** The go colour that marks a go state on its own. */
  go2?: string;
  /** The go colour filled behind a go status's own text. */
  go3?: string;
  /** The go colour nearest the surfaces, the quiet ground under a go card. */
  go4?: string;
  /** The no-go colour nearest the text colour, read as the words of a no-go status. */
  nogo1?: string;
  /** The no-go colour that marks and fills a no-go state. */
  nogo2?: string;
  /** The no-go colour nearest the surfaces, the quiet ground under a no-go card. */
  nogo3?: string;
  /** The warn colour nearest the text colour, read as the words of a caution or warning. */
  warn1?: string;
  /** The warn colour that marks and fills a warning. */
  warn2?: string;
  /** The edge of a warning box. */
  warn3?: string;
  /** The warn colour nearest the surfaces, the quiet ground under a caution or warning card. */
  warn4?: string;
  /** The colour of an info status and of a modelled figure. */
  info1?: string;
  /** The text colour drawn on a saturated status fill, such as an info or no-go chip. It must read on the nogo2, warn2 and info1 fills. */
  onFill?: string;
}

/**
 * The colours of the labelled-state chips: a foreground, a background and a
 * border for each hue that has them. Useful for restyling the chips that mark
 * a prediction, a station link or a similar state.
 *
 * @category Theme
 */
export interface ThemeTagColors {
  /** Text and glyph of the blue chip. */
  blueFg?: string;
  /** Ground of the blue chip. */
  blueBg?: string;
  /** Edge of the blue chip. */
  blueBorder?: string;
  /** Text and glyph of the purple chip. */
  purpleFg?: string;
  /** Ground of the purple chip. */
  purpleBg?: string;
  /** Edge of the purple chip. */
  purpleBorder?: string;
  /** Text and glyph of the yellow chip. */
  yellowFg?: string;
  /** Ground of the yellow chip. */
  yellowBg?: string;
  /** Edge of the yellow chip. */
  yellowBorder?: string;
  /** Ground of the dark brown chip. */
  darkBrownBg?: string;
  /** Edge of the dark brown chip. */
  darkBrownBorder?: string;
  /** Text and glyph of the cyan chip. */
  cyanFg?: string;
  /** Text and glyph of the orange chip. */
  orangeFg?: string;
  /** Text and glyph of the red chip. */
  redFg?: string;
}

/**
 * The colour each navball marker is drawn in. A pair (prograde and retrograde,
 * normal and anti-normal) shares one colour, since the marker's shape tells
 * the two apart. Useful for matching the markers to the game's own.
 *
 * @category Theme
 */
export interface ThemeMarkerColors {
  /** Prograde and retrograde markers. */
  prograde?: string;
  /** Normal and anti-normal markers. */
  normal?: string;
  /** Radial in and radial out markers. */
  radial?: string;
  /** The manoeuvre node marker. */
  maneuver?: string;
  /** Target and anti-target markers. */
  target?: string;
}

/**
 * The colours of the alarm banners and floating panels: one ground for each state an alarm is in, and the ground of a floating panel. Useful for restyling the alarm banners and the panels that float over the dashboard.
 *
 * @category Theme
 */
export interface ThemeAlarmColors {
  /** The ground of an alarm banner for an alarm that has been set. */
  set?: string;
  /** The ground of an alarm banner for an alarm that is armed. */
  arm?: string;
  /** The ground of an alarm banner for an alarm that has fired. */
  fire?: string;
  /** The ground of a notice that an alarm fired somewhere else. */
  notice?: string;
  /** The ground of the banner shown when a data source is offline. */
  offline?: string;
  /** The ground of a floating panel that sits over the dashboard. */
  overlay?: string;
}

/**
 * The tints of the go/no-go header, one for each state of the vote. Useful for recolouring the header that shows the vote.
 *
 * @category Theme
 */
export interface ThemePollColors {
  /** The tint of the go/no-go header while the vote is go. */
  go?: string;
  /** The tint of the go/no-go header while the vote is no-go. */
  noGo?: string;
  /** The tint of the go/no-go header while the vote is abort. */
  abort?: string;
  /** The tint of the go/no-go header while no vote is open. */
  none?: string;
}

/**
 * The hues of orbit drawings, ground-track maps, depth cues and device glows. Useful for recolouring the drawings a theme's ground would otherwise leave unreadable.
 *
 * @category Theme
 */
export interface ThemeDiagramColors {
  /** The manoeuvre burn arc and its markers on an orbit drawing. */
  orbitBurn?: string;
  /** The path of an orbit that does not stay in orbit. */
  orbitRetro?: string;
  /** The band drawn round a body whose atmosphere has oxygen. */
  atmosphereOxygen?: string;
  /** The band drawn round a body whose atmosphere has no oxygen. */
  atmosphereInert?: string;
  /** The marker where a predicted track meets another body. */
  encounter?: string;
  /** The marker where a predicted track leaves a body's influence. */
  flyby?: string;
  /** The marker where a predicted track meets the ground. */
  impact?: string;
  /** A body or path above the reference plane. */
  depthAbove?: string;
  /** A body or path in the reference plane. */
  depthLevel?: string;
  /** A body or path below the reference plane. */
  depthBelow?: string;
  /** The docking reticle's glow while the ports are not aligned. */
  dockingMisaligned?: string;
  /** The glow of an input that is live or pressed on a serial device. */
  signalLive?: string;
  /** The glow of a banner that reports lost signal. */
  danger?: string;
  /** The glow of the floating action cluster toggle. */
  power?: string;
}

/**
 * The corner radii of the kit's boxes, as CSS lengths. A fully round pill or
 * circle is not set here. Useful for squaring or softening every widget at
 * once.
 *
 * @category Theme
 */
export interface ThemeRadius {
  /** Controls, cards and most boxes. */
  regular?: string;
  /** Boxes that float above the app: a modal, a floating button. */
  floating?: string;
  /** The frame around a display such as a navball or a map. */
  displayFrame?: string;
  /** A box sitting beside a display frame. */
  displayFrameAside?: string;
  /** The ends of a chip, a switch track and a tab pill. A large value makes the ends fully round and `0px` makes them square. */
  pill?: string;
  /** The ends of an event banner in the banner stack. A large value makes the ends fully round and `0px` makes them square. */
  banner?: string;
}

/**
 * The spacing ladder every gap, inset and offset is measured from, as CSS
 * lengths. The kit's named gaps and insets are built on these steps, so
 * setting one moves everything that sits on it. Useful for tightening or
 * loosening a whole dashboard at once.
 *
 * @category Theme
 */
export interface ThemeSpace {
  /** The one-pixel step below the ladder. */
  hair?: string;
  /** The 2px step. */
  "2"?: string;
  /** The 4px step. */
  "4"?: string;
  /** The 6px step. */
  "6"?: string;
  /** The 8px step. */
  "8"?: string;
  /** The 10px step. */
  "10"?: string;
  /** The 12px step. */
  "12"?: string;
  /** The 16px step. */
  "16"?: string;
  /** The 24px step. */
  "24"?: string;
}

/**
 * The named gaps and insets of the kit, as CSS lengths, for a theme that wants
 * to say what "comfortable" or "compact" means rather than move the whole
 * spacing ladder. A size left out follows the ladder step it is built on. The
 * tiers are kept in order: a smaller tier is never larger than the one above
 * it, whatever lengths are given. Useful for tightening a dashboard without
 * changing the proportions of every other gap.
 *
 * @category Theme
 */
export interface ThemeDensity {
  /** The gap between related items, by how tightly a widget packs them: comfortable is the default, then compact, dense and packed. */
  related?: {
    comfortable?: string;
    compact?: string;
    dense?: string;
    packed?: string;
  };
  /** The gap between sections of a widget: comfortable is the default and compact the tighter tier. */
  section?: {
    comfortable?: string;
    compact?: string;
  };
  /** A panel's horizontal gutter, shared by its title, toolbar and body. */
  panelGutter?: string;
  /** A screen's outer gutter. */
  screenGutter?: string;
  /** The padding inside a button, input or select, as a CSS `padding` value. */
  control?: string;
  /** The padding inside a bordered surface such as a card or a readout box, as a CSS `padding` value. */
  surface?: string;
}

/**
 * One drop shadow, as the distance it falls and how far it blurs. Its colour
 * is the theme's shadow colour.
 *
 * @category Theme
 */
export interface ThemeShadow {
  /** How far the shadow falls below the box, as a CSS length. */
  offset: string;
  /** How far the shadow spreads and softens, as a CSS length. */
  blur: string;
}

/**
 * How far a surface stands off the page, as a drop shadow. A raised surface
 * is an ordinary panel, which draws no shadow by default; a floating surface
 * is a modal, popover, menu or banner. A raised shadow is never larger than
 * the floating one when both are set. Useful for letting a light theme read by
 * shadow, or a flat theme drop shadows altogether.
 *
 * @category Theme
 */
export interface ThemeElevation {
  /** The shadow of an ordinary panel. */
  raised?: ThemeShadow;
  /** The shadow shared by modals, popovers, menus and banners. */
  floating?: ThemeShadow;
}

/**
 * The floating surface's padding, as one CSS length: a popover or menu is
 * padded by it and a modal's body by twice it. Its corner is the floating radius
 * and its shadow the floating elevation. Useful for tightening or loosening
 * every modal, popover and menu together.
 *
 * @category Theme
 */
export interface ThemeFloating {
  /** The padding of a popover or menu. Leave out to keep the default. */
  padding?: string;
}

/**
 * The widths of borders, as CSS lengths. Useful for thinning the edges of a
 * dense theme or thickening those of a high-contrast one.
 *
 * @category Theme
 */
export interface ThemeBorderWidth {
  /** The edge of a panel, control or table row. */
  hairline?: string;
  /** The heavier edge of an emphasised box. */
  strong?: string;
}

/**
 * How fast the kit's transitions run, and the curves they run on. Reduced
 * motion always wins: a person who asks for it gets none of this. Useful for
 * making a theme feel quick or mechanical.
 *
 * @category Theme
 */
export interface ThemeMotion {
  /** A multiplier on every duration: `1` is the default, `0.5` is twice as quick. */
  speed?: number;
  /** The CSS easing of ordinary transitions. */
  standard?: string;
  /** The CSS easing of emphasised transitions. */
  emphasis?: string;
}

/**
 * Fixed box sizes of the kit's controls, as CSS lengths. Useful for making
 * controls taller or shorter on every widget.
 *
 * @category Theme
 */
export interface ThemeSizes {
  /** The height of a button, input or select. */
  controlHeight?: string;
  /** The side of a floating action button. */
  fab?: string;
}

/**
 * The type half of a `UiKitTheme`: the font family and a size scale. Each
 * value is a CSS value that becomes the matching `--font-family-*` or
 * `--font-size-*` variable. Useful for setting type in every widget from one
 * scale.
 *
 * @category Theme
 */
export interface ThemeTypography {
  /** The font families, as CSS `font-family` values. */
  family: {
    /** The monospace family every widget is set in. */
    mono: string;
  };
  /** The size scale, smallest first, each a CSS length. */
  size: {
    /** The smallest step of the scale. */
    xs: string;
    /** One step below body text. */
    sm: string;
    /** Body text. */
    base: string;
    /** One step above body text. */
    lg: string;
  };
  /** The step below the smallest size, for micro-labels, as a CSS length. Leave out to keep the default. */
  microSize?: string;
  /** Unitless line heights, named by job. Leave one out to keep the default. */
  lineHeight?: {
    /** Glyphs and single-line chrome. */
    flush?: string;
    /** Dense multi-line readouts. */
    tight?: string;
    /** Default widget text. */
    body?: string;
    /** Running paragraphs and help text. */
    prose?: string;
  };
  /** Font weights, named by job. Leave one out to keep the default. */
  weight?: {
    /** Titles and labels that are set heavier than body text. */
    semibold?: string;
    /** The heaviest text: readout values, chip labels and headings. */
    bold?: string;
  };
  /** A multiplier on every letter spacing the kit sets on legends and labels: `1` is the default, `0` sets them solid. */
  tracking?: number;
  /** The size of an icon, as a CSS length. Leave one out to keep the default. */
  iconSize?: {
    /** The glyph inside a control. */
    control?: string;
    /** A glyph that is its own control. */
    standalone?: string;
  };
}

/**
 * What a theme supplies: the foundation values the kit is built from, which
 * are colour, type, corner radius, spacing, control size, shadow, border width and motion. A theme provider
 * writes each value onto its CSS variable, and the same object is what `theme`
 * holds inside a styled-components template.
 *
 * Only the foundation is a theme's to set. The named roles built on it (the
 * status tones, the gaps, the insets) follow from these values and cannot be
 * set directly. Every group beyond the first colour and type roles is
 * optional, and a value left out keeps the default dark theme's.
 * Useful for giving an Uplink's widgets the same look as the rest of the
 * dashboard, and for supplying a new theme.
 *
 * @category Theme
 */
export interface UiKitTheme {
  /** Every colour the kit draws with. */
  colors: ThemeColors;
  /** The font family and sizes. */
  typography: ThemeTypography;
  /** The corner radii. Leave out to keep the defaults. */
  radius?: ThemeRadius;
  /** The spacing ladder. Leave out to keep the default. */
  space?: ThemeSpace;
  /** The fixed box sizes of controls. Leave out to keep the defaults. */
  sizes?: ThemeSizes;
  /** The named gaps and insets. Leave out to keep the defaults. */
  density?: ThemeDensity;
  /** The drop shadows. Leave out to keep the defaults. */
  elevation?: ThemeElevation;
  /** The padding of modals, popovers and menus. Leave out to keep the default. */
  floating?: ThemeFloating;
  /** The widths of borders. Leave out to keep the defaults. */
  borderWidth?: ThemeBorderWidth;
  /** The speed and easing of transitions. Leave out to keep the defaults. */
  motion?: ThemeMotion;
}
