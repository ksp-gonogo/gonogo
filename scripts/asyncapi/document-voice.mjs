// The voice gate for the emitted document.
//
// `prose-hygiene.mjs` reads the contract model and catches maintainer
// rationale. This reads the finished document, so it also covers the prose
// written in `document.mjs`, and holds every string in it to the voice the other
// published docs use: no em-dashes, the person at the screen is "the operator",
// and no aphorisms or lines that narrate a reader's thinking. Capitals for
// emphasis are held by `asyncapi-document.test.ts`, which shares the scan with
// the doc-comment gate.

/** The phrase families, each with a text that must match so a dead pattern is noticed. */
const EM_DASH = String.fromCharCode(0x2014);

export const VOICE_FAMILIES = {
  "em-dash": {
    pattern: new RegExp(EM_DASH, "g"),
    plant: `a frame ${EM_DASH} never queued ${EM_DASH} is dropped`,
  },
  "the-user": {
    pattern: /\b(?:the|a|an) users?\b/gi,
    plant: "the user presses the control",
  },
  aphorism: {
    pattern:
      /\b(?:honest(?:ly)?|confident(?:ly)?|the whole point|a lie|rots|footguns?)\b/gi,
    plant: "this gets a confident no about a channel",
  },
  narration: {
    pattern:
      /\b(?:schema-first (?:reader|author)|the (?:reader|author)'s question|what (?:an author|a reader) wants)\b/gi,
    plant: "a schema-first reader will not find it",
  },
};

/**
 * Declarations whose emitted prose still carries a voice marker, keyed by the
 * JSON path of the string, with the number of markers it holds.
 *
 * SHRINK-ONLY, like the prose-hygiene list: a key may fall or go, and a key not
 * here may not appear. It is empty because the document was clean when the gate
 * was added.
 */
export const VOICE_DEBT = {};

const TEXT_KEYS = new Set(["description", "title", "summary"]);

/** Every prose string in the document with its JSON path. */
export function proseStrings(document) {
  const found = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => {
        walk(item, `${path}/${i}`);
      });
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      if (TEXT_KEYS.has(key) && typeof value === "string") {
        found.push({ path: `${path}/${key}`, text: value });
      } else {
        walk(value, `${path}/${key}`);
      }
    }
  };
  walk(document, "");
  return found;
}

/** Voice markers in one string, as `{ family, text }`. Whitespace is collapsed first so a wrapped phrase still matches. */
export function voiceMarkersIn(text) {
  const flat = text.replace(/\s+/g, " ");
  const found = [];
  for (const [family, { pattern }] of Object.entries(VOICE_FAMILIES)) {
    for (const match of flat.matchAll(pattern)) {
      found.push({ family, text: match[0] });
    }
  }
  return found;
}

/** That every family still sees its own kind of offence. */
export function assertVoiceDetectorSees() {
  const blind = Object.entries(VOICE_FAMILIES)
    .filter(
      ([family, { plant }]) =>
        !voiceMarkersIn(plant).some((marker) => marker.family === family),
    )
    .map(([family]) => family);
  if (blind.length > 0) {
    throw new Error(
      `asyncapi: the voice detector is BLIND for ${blind.join(", ")}: a planted violation of each was not matched. Fix the pattern in scripts/asyncapi/document-voice.mjs before trusting a clean verdict.`,
    );
  }
}

/** Throws on any string over its allowance. A count below its allowance only reports. */
export function assertDocumentVoice(document, { debt = VOICE_DEBT } = {}) {
  assertVoiceDetectorSees();
  const over = [];
  let markers = 0;
  for (const { path, text } of proseStrings(document)) {
    const found = voiceMarkersIn(text);
    markers += found.length;
    if (found.length > (debt[path] ?? 0)) {
      over.push({ path, found, allowed: debt[path] ?? 0 });
    }
  }
  if (over.length > 0) {
    const lines = over
      .slice(0, 12)
      .map(
        ({ path, found, allowed }) =>
          `  ${path} (${found.length} marker(s), ${allowed} allowed): ${[
            ...new Set(found.map((m) => `${m.family}: "${m.text}"`)),
          ]
            .slice(0, 4)
            .join(", ")}`,
      )
      .join("\n");
    throw new Error(
      `asyncapi: ${over.length} string(s) in the document break the published voice:\n${lines}\nReword the C# doc comment, or the text in scripts/asyncapi/document.mjs, and regenerate.`,
    );
  }
  return { strings: proseStrings(document).length, markers };
}
