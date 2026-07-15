// Attribution data for the vendored gamepad glyphs (see gamepadGlyphs.ts for
// the assets themselves). CC BY 3.0 is prescriptive about *how* credit is
// given — each pack's own LICENSE.txt (in the source repo) states a "must
// include" block naming the product title, author, source, and licence,
// and requires disclosing that changes were made. This is surfaced in the
// Input Devices menu (see SerialDevicesMenu/index.tsx) to satisfy that.
export const CC_BY_3_LICENSE_URL =
  "http://creativecommons.org/licenses/by/3.0/";

export interface GamepadArtCredit {
  productTitle: string;
  author: string;
  sourceUrl: string;
}

export const GAMEPAD_ART_CREDITS: readonly GamepadArtCredit[] = [
  {
    productTitle: "Xbox Series Button Icons and Controls",
    author: "Zacksly",
    sourceUrl: "https://zacksly.itch.io",
  },
  {
    productTitle: "PS5 Button Icons and Controls",
    author: "Zacksly",
    sourceUrl: "https://zacksly.itch.io",
  },
  {
    productTitle: "Switch Button Icons and Controls",
    author: "Zacksly",
    sourceUrl: "https://zacksly.itch.io",
  },
] as const;

/** Disclosure text CC BY 3.0 requires alongside the credit above. */
export const GAMEPAD_ART_CHANGES_NOTE =
  "Recoloured to follow the active theme and re-encoded as inline styles (originally class-based); no other changes.";
