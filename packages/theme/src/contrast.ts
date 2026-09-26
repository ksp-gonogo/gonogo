/**
 * Which colour tokens may be drawn on which grounds, and the WCAG arithmetic
 * that proves it.
 *
 * Token names here drop the `--color-` prefix: `status-warning-fg` is
 * `var(--color-status-warning-fg)`. Values are not repeated; they are read
 * from `tokens.css` by whoever checks the table, so the table states where a
 * token may go and the sheet states what it is.
 *
 * The pairings are the palette's promises: text at 4.5:1, a mark that carries
 * meaning (a dot, a fill, a focus ring) at 3:1. The sets beside them say what a
 * token is for when it is drawn: `GROUNDS` may be painted behind content,
 * `STATUS_FILLS` are grounds only under their own text and marks otherwise,
 * `DECORATIVE` tokens draw rules and dividers with no floor but never text,
 * and `EXEMPT` tokens are checked by something other than their fill.
 */

export type ContrastKind = "text" | "non-text";

export interface Pairing {
  readonly token: string;
  readonly kind: ContrastKind;
  readonly on: readonly string[];
}

export const CONTRAST_FLOOR: Readonly<Record<ContrastKind, number>> = {
  text: 4.5,
  "non-text": 3,
};

const SURFACES = [
  "surface-app",
  "surface-panel",
  "surface-sunken",
  "surface-raised",
] as const;

/** The surfaces minus `surface-raised`, the lightest of them. */
const DARKEST = ["surface-app", "surface-panel", "surface-sunken"] as const;

/**
 * Tokens a box may paint as its background and draw content on. A status fill
 * (`STATUS_FILLS`) is a ground only where the same rule also names the text it
 * carries; a status fill with no text of its own is a mark, and is checked as
 * one.
 */
export const GROUNDS: readonly string[] = [
  ...SURFACES,
  "status-go-bg",
  "status-nogo-bg",
  "status-warning-bg",
  "status-info-bg",
  "accent-bg",
  "status-alert-muted",
  "status-warning-bg-muted",
  "status-go-muted",
  "tag-blue-bg",
  "tag-purple-bg",
  "tag-yellow-bg",
  "tag-dark-brown-bg",
];

export const STATUS_FILLS: readonly string[] = [
  "status-go-bg",
  "status-nogo-bg",
  "status-warning-bg",
  "status-info-bg",
  "accent-bg",
];

export const DECORATIVE: readonly string[] = [
  "border-subtle",
  "border-strong",
  "status-warning-border-muted",
  "tag-blue-border",
  "tag-purple-border",
  "tag-yellow-border",
  "tag-dark-brown-border",
];

export const EXEMPT: Readonly<Record<string, string>> = {
  "marker-prograde":
    "a navball marker hue is the game's; the glyph's currentColor keyline carries its contrast",
  "marker-normal":
    "a navball marker hue is the game's; the glyph's currentColor keyline carries its contrast",
  "marker-radial":
    "a navball marker hue is the game's; the glyph's currentColor keyline carries its contrast",
  "marker-maneuver":
    "a navball marker hue is the game's; the glyph's currentColor keyline carries its contrast",
  "marker-target":
    "a navball marker hue is the game's; the glyph's currentColor keyline carries its contrast",
};

/**
 * The pairings the token names promise: every `text-*` on every `surface-*`,
 * and `X-fg`, `X-on-bg` and `X-fg-muted` as text on `X-bg` and `X-bg-muted`.
 * `NAMED_PAIR_EXCEPTIONS` removes the ones the palette does not keep.
 */
export function namedPairings(tokens: readonly string[]): Pairing[] {
  const has = new Set(tokens);
  const pairs: Pairing[] = [];
  for (const t of tokens) {
    if (t.startsWith("text-")) {
      pairs.push({
        token: t,
        kind: "text",
        on: SURFACES.filter((s) => has.has(s)),
      });
    }
    const m = /^(.*)-(fg|on-bg|fg-muted)$/.exec(t);
    if (m) {
      const ground = `${m[1]}-${m[2] === "fg-muted" ? "bg-muted" : "bg"}`;
      if (has.has(ground)) pairs.push({ token: t, kind: "text", on: [ground] });
    }
  }
  return pairs;
}

/**
 * Named pairings the palette does not keep, each with the token that does the
 * job instead. A check fails if one of these starts to pass, since it is then
 * a pairing and belongs in the table.
 */
export const NAMED_PAIR_EXCEPTIONS: readonly {
  token: string;
  on: string;
  reason: string;
}[] = [
  {
    token: "text-inverse",
    on: "surface-app",
    reason: "the dark text for bright fills; see its accent-bg pairing",
  },
  {
    token: "text-inverse",
    on: "surface-panel",
    reason: "the dark text for bright fills; see its accent-bg pairing",
  },
  {
    token: "text-inverse",
    on: "surface-sunken",
    reason: "the dark text for bright fills; see its accent-bg pairing",
  },
  {
    token: "text-inverse",
    on: "surface-raised",
    reason: "the dark text for bright fills; see its accent-bg pairing",
  },
  {
    token: "text-dim",
    on: "surface-raised",
    reason:
      "under 4.5:1 on the raised surface; text-muted is the dim tier there",
  },
  {
    token: "text-faint",
    on: "surface-raised",
    reason:
      "under 4.5:1 on the raised surface; text-muted is the faint tier there",
  },
  {
    token: "status-nogo-fg",
    on: "status-nogo-bg",
    reason:
      "nogo-fg is nogo text on a dark ground; status-nogo-on-bg is the text on the red fill",
  },
  {
    token: "accent-fg",
    on: "accent-bg",
    reason: "the same green; text-inverse is the text on the accent fill",
  },
];

/**
 * Pairings the names cannot express: a foreground made for the dark grounds
 * whatever its suffix says, and a bright fill that is also a mark.
 */
export const EXPLICIT_PAIRINGS: readonly Pairing[] = [
  {
    token: "text-primary",
    kind: "text",
    on: [
      "status-go-bg",
      "status-alert-muted",
      "status-warning-bg-muted",
      "status-go-muted",
      "tag-dark-brown-bg",
    ],
  },
  { token: "text-muted", kind: "text", on: ["status-go-muted"] },
  { token: "text-dim", kind: "text", on: ["status-go-muted"] },
  { token: "text-inverse", kind: "text", on: ["accent-bg"] },
  { token: "accent-fg", kind: "text", on: [...SURFACES, "status-go-muted"] },
  { token: "accent-bg", kind: "non-text", on: SURFACES },
  { token: "status-go-fg", kind: "text", on: SURFACES },
  {
    token: "status-nogo-fg",
    kind: "text",
    on: [...SURFACES, "status-alert-muted"],
  },
  { token: "status-info-fg", kind: "text", on: SURFACES },
  {
    token: "status-go-mark",
    kind: "non-text",
    on: ["surface-panel", "surface-raised"],
  },
  { token: "status-warning-fg-muted", kind: "text", on: SURFACES },
  { token: "status-warning-bg", kind: "text", on: SURFACES },
  { token: "status-nogo-bg", kind: "text", on: SURFACES },
  {
    token: "tag-yellow-fg",
    kind: "text",
    on: [...SURFACES, "tag-dark-brown-bg"],
  },
  { token: "tag-blue-fg", kind: "text", on: SURFACES },
  { token: "tag-purple-fg", kind: "text", on: DARKEST },
  { token: "tag-cyan-fg", kind: "text", on: SURFACES },
  { token: "tag-orange-fg", kind: "text", on: SURFACES },
  { token: "tag-red-fg", kind: "text", on: SURFACES },
  ...Array.from(
    { length: 24 },
    (_, i): Pairing => ({
      token: `data-${i + 1}`,
      kind: "text",
      on: SURFACES,
    }),
  ),
  { token: "focus", kind: "non-text", on: SURFACES },
];

/** The whole table: the named pairings the palette keeps, then the explicit ones. */
export function contrastTable(tokens: readonly string[]): Pairing[] {
  const dropped = (token: string, on: string) =>
    NAMED_PAIR_EXCEPTIONS.some((e) => e.token === token && e.on === on);
  const named = namedPairings(tokens)
    .map((p) => ({ ...p, on: p.on.filter((g) => !dropped(p.token, g)) }))
    .filter((p) => p.on.length > 0);
  return [...named, ...EXPLICIT_PAIRINGS];
}

/** Every `--color-*` token declared with a hex value, keyed without the prefix. */
export function parseColorTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const m of css.matchAll(
    /--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\b/g,
  )) {
    tokens.set(m[1], m[2]);
  }
  return tokens;
}

function channels(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3 || h.length === 4) {
    h = [...h.slice(0, 3)].map((c) => c + c).join("");
  }
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** WCAG 2.x relative luminance of an opaque hex colour. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two opaque hex colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
