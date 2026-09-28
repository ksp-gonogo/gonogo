/**
 * Which colour tokens may be drawn on which grounds, and the WCAG arithmetic
 * that proves it.
 *
 * Token names here drop the `--color-` prefix: `warn-text` is
 * `var(--color-warn-text)`. Values are not repeated; they are read from
 * `tokens.css` by whoever checks the table, so the table states where a token
 * may go and the sheet states what it is.
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
 * The five jobs a tone's colour does, each its own token: `<tone>-text` is the
 * tone's words on a surface or on its own muted ground, `<tone>-mark` a dot,
 * fill, edge or stroke standing alone, `<tone>-status` a fill that carries
 * its own text in `<tone>-on-status`, and `<tone>-muted` a quiet ground.
 */
export const TONE_ROLES = [
  "text",
  "mark",
  "status",
  "on-status",
  "muted",
] as const;

export type ToneRole = (typeof TONE_ROLES)[number];

/**
 * The tones the sheet declares role tokens for: the same list as the sdk's
 * `TONES`, which ui-kit's contrast test holds it to.
 */
export const TONE_NAMES = [
  "neutral",
  "info",
  "go",
  "caution",
  "warn",
  "nogo",
  "offline",
] as const;

/**
 * Tokens a box may paint as its background and draw content on. A status fill
 * (`STATUS_FILLS`) is a ground only where the same rule also names the text it
 * carries; a status fill with no text of its own is a mark, and is checked as
 * one.
 */
export const GROUNDS: readonly string[] = [
  ...SURFACES,
  ...TONE_NAMES.flatMap((t) => [`${t}-status`, `${t}-muted`]),
  "accent-bg",
  "tag-blue-bg",
  "tag-purple-bg",
  "tag-yellow-bg",
  "tag-dark-brown-bg",
];

export const STATUS_FILLS: readonly string[] = [
  ...TONE_NAMES.map((t) => `${t}-status`),
  "accent-bg",
];

export const DECORATIVE: readonly string[] = [
  "border-subtle",
  "border-strong",
  "warn-muted-edge",
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
 * The pairings the token names promise: every `text-*` on every `surface-*`;
 * for each tone its text on the surfaces and its own muted ground, its
 * on-status text on its status fill, and its mark on the surfaces; and
 * `X-fg` as text on `X-bg`. `NAMED_PAIR_EXCEPTIONS` removes the ones the
 * palette does not keep.
 */
export function namedPairings(tokens: readonly string[]): Pairing[] {
  const has = new Set(tokens);
  const surfaces = SURFACES.filter((s) => has.has(s));
  const pairs: Pairing[] = [];
  for (const t of tokens) {
    if (t.startsWith("text-")) {
      pairs.push({ token: t, kind: "text", on: surfaces });
    }
    const m = /^(.*)-fg$/.exec(t);
    if (m && has.has(`${m[1]}-bg`)) {
      pairs.push({ token: t, kind: "text", on: [`${m[1]}-bg`] });
    }
  }
  for (const tone of TONE_NAMES) {
    pairs.push(
      {
        token: `${tone}-text`,
        kind: "text",
        on: [...surfaces, `${tone}-muted`],
      },
      { token: `${tone}-on-status`, kind: "text", on: [`${tone}-status`] },
      { token: `${tone}-mark`, kind: "non-text", on: surfaces },
    );
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
      "go-status",
      "go-muted",
      "nogo-muted",
      "caution-muted",
      "warn-muted",
      "tag-dark-brown-bg",
    ],
  },
  { token: "text-muted", kind: "text", on: ["go-muted"] },
  { token: "text-dim", kind: "text", on: ["go-muted"] },
  { token: "text-inverse", kind: "text", on: ["accent-bg"] },
  { token: "accent-fg", kind: "text", on: [...SURFACES, "go-muted"] },
  { token: "accent-bg", kind: "non-text", on: SURFACES },
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

const DECLARED = /--((?:color|palette)-[a-z0-9-]+):\s*([^;]+);/g;
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const ALIAS = /^var\(--((?:color|palette)-[a-z0-9-]+)\)$/;

/**
 * Every `--color-*` token the sheet declares, keyed without the prefix, with
 * the hex value it resolves to. A token defined as `var(--palette-*)` or
 * `var(--color-*)` resolves through the chain; one whose value is neither a
 * hex nor such an alias is left out.
 */
export function parseColorTokens(css: string): Map<string, string> {
  const raw = new Map<string, string>();
  for (const m of css.matchAll(DECLARED)) raw.set(m[1], m[2].trim());
  const resolve = (name: string, seen: Set<string>): string | undefined => {
    const value = raw.get(name);
    if (value === undefined || seen.has(name)) return undefined;
    if (HEX.test(value)) return value;
    const alias = ALIAS.exec(value);
    if (!alias) return undefined;
    return resolve(alias[1], new Set([...seen, name]));
  };
  const tokens = new Map<string, string>();
  for (const name of raw.keys()) {
    if (!name.startsWith("color-")) continue;
    const hex = resolve(name, new Set());
    if (hex) tokens.set(name.slice("color-".length), hex);
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
