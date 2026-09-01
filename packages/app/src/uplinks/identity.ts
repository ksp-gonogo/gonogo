// An Uplink's human identity (name / author / repo) plus WHO said it.
//
// An Uplink is a mod in its own right, and every mod ecosystem shows a
// self-declared author and repo, because that is the information an operator
// actually wants even though nobody verified it. The app used to withhold the
// bundle's own declaration and print `by unknown` instead, which is not safer,
// only less useful.
//
// What must survive is the distinction, not the withholding: the running mod
// vouching for an Uplink is a different claim from a bundle describing itself,
// so every value here carries its source and the render surfaces say which one
// they are showing. Nothing in this module gates a load: the hash gates in
// `loader.ts` are the trust boundary, this is what an operator reads while
// deciding whether to consent to it.

/**
 * Who supplied one piece of an Uplink's identity.
 *
 * `mod` is the running mod's `system.uplinks` roster, which the loader prefers
 * over everything else; `index` is the built Uplink index, an artifact separate
 * from the bundle bytes; `bundle` is the manifest sidecar the bundle
 * ships, which is whatever its author wrote and which nothing checks.
 */
export type UplinkIdentitySource = "mod" | "index" | "bundle";

/** One identity value and the source that supplied it. */
export interface UplinkIdentityField {
  value: string;
  source: UplinkIdentitySource;
}

/**
 * A resolved identity. `name` is always present because the mod-reported id
 * stands in when nothing names the Uplink; `author` and `repo` are absent when
 * no source declared them, and an absent field renders nothing rather than a
 * line saying it is absent.
 */
export interface UplinkIdentity {
  name: UplinkIdentityField;
  author?: UplinkIdentityField;
  repo?: UplinkIdentityField;
}

/** A declared, non-blank value, or undefined. Blank and absent are the same claim. */
function declared(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function field(
  value: string | null | undefined,
  source: UplinkIdentitySource,
): UplinkIdentityField | undefined {
  const declaredValue = declared(value);
  return declaredValue === undefined
    ? undefined
    : { value: declaredValue, source };
}

/**
 * Resolve one field across the roster then the manifest, in that order: the mod
 * vouches, so its value wins wherever it has one, and the bundle's own claim is
 * used only where the mod said nothing.
 */
function preferRoster(
  rosterValue: string | null | undefined,
  manifestValue: string | null | undefined,
): UplinkIdentityField | undefined {
  return field(rosterValue, "mod") ?? field(manifestValue, "bundle");
}

/**
 * The identity of a third-party Uplink: the mod's roster entry where it speaks,
 * the bundle's own manifest where it does not.
 *
 * `id` is the mod-reported id, used as the name when neither source names the
 * Uplink, matching the "not found in the registry index" quarantine's fallback.
 * An id is not a name, so it is marked `mod` rather than dressed up as one.
 */
export function resolveUplinkIdentity(
  id: string,
  roster: {
    name?: string | null;
    author?: string | null;
    repo?: string | null;
  },
  manifest: { name?: string; author?: string; repo?: string },
): UplinkIdentity {
  return {
    name: preferRoster(roster.name, manifest.name) ?? {
      value: id,
      source: "mod",
    },
    author: preferRoster(roster.author, manifest.author),
    repo: preferRoster(roster.repo, manifest.repo),
  };
}

/**
 * The identity of an Uplink resolved from the built Uplink index: every field
 * comes from the index, which is a different artifact from the bundle it
 * describes, so none of it is the bundle talking about itself.
 */
export function registryIdentity(descriptor: {
  id: string;
  name: string;
  author: string;
  repo: string;
}): UplinkIdentity {
  return {
    name: field(descriptor.name, "index") ?? {
      value: descriptor.id,
      source: "index",
    },
    author: field(descriptor.author, "index"),
    repo: field(descriptor.repo, "index"),
  };
}

/** The populated fields, in the order they read. */
function populated(
  identity: UplinkIdentity,
): { label: string; field: UplinkIdentityField }[] {
  const entries: { label: string; field: UplinkIdentityField }[] = [
    { label: "name", field: identity.name },
  ];
  if (identity.author)
    entries.push({ label: "author", field: identity.author });
  if (identity.repo) entries.push({ label: "repo", field: identity.repo });
  return entries;
}

/** True when any part of this identity is the bundle describing itself. */
export function hasSelfDeclaredField(identity: UplinkIdentity): boolean {
  return populated(identity).some((entry) => entry.field.source === "bundle");
}

/**
 * True when there is a reading here beyond the id the title already carries.
 * An Uplink that declared nothing gets no identity block at all: an empty
 * author line announcing its own emptiness is not a reading.
 */
export function hasIdentityToShow(identity: UplinkIdentity): boolean {
  return (
    identity.author !== undefined ||
    identity.repo !== undefined ||
    identity.name.source === "bundle"
  );
}

const SOURCE_CLAUSE: Record<UplinkIdentitySource, string> = {
  mod: "vouched by the installed mod",
  index: "listed in the app's built Uplink index",
  bundle: "self-declared by the bundle, unverified",
};

function capitalise(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * The one-line reading of where this identity came from.
 *
 * One source covering every field states it plainly; a mixed identity (the mod
 * naming some fields and the bundle the rest) enumerates each group, because
 * collapsing it would either credit the mod with a claim it never made or
 * withhold one it did.
 */
export function identityProvenance(identity: UplinkIdentity): string {
  const entries = populated(identity);
  const sources = [...new Set(entries.map((entry) => entry.field.source))];
  if (sources.length === 1) return capitalise(SOURCE_CLAUSE[sources[0]]);

  const clauses = sources.map((source) => {
    const labels = entries
      .filter((entry) => entry.field.source === source)
      .map((entry) => entry.label);
    return `${joinLabels(labels)} ${SOURCE_CLAUSE[source]}`;
  });
  return capitalise(clauses.join("; "));
}
