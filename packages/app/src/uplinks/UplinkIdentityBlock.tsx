import { Stack, Text } from "@ksp-gonogo/ui-kit";
import {
  hasIdentityToShow,
  hasSelfDeclaredField,
  identityProvenance,
  type UplinkIdentity,
  type UplinkIdentityField,
  type UplinkIdentitySource,
} from "./identity";

export interface UplinkIdentityBlockProps {
  identity: UplinkIdentity;
  /**
   * Announce the provenance line as it arrives. Set where the identity appears
   * asynchronously and the trust reading changes underneath a reader (the
   * Settings loaded-clients list, fed by the loader as each outcome lands);
   * leave it off inside a dialog, where the whole block is already read out on
   * open through `aria-describedby`.
   */
  live?: boolean;
}

/** How a losing claim names its own source, in the same voice as the values. */
const DISPUTE_PREFIX: Record<UplinkIdentitySource, string> = {
  mod: "Installed mod's",
  index: "Registry index's",
  bundle: "Bundle's own",
};

/**
 * The value that lost a disagreement, shown directly under the one that won.
 *
 * It sits beneath its own field rather than in a summary line so the pairing
 * needs no explaining: the reader sees the held value and the competing one
 * together, and decides. Nothing here says which to believe.
 */
function DisputedClaim({
  label,
  field,
}: Readonly<{ label: string; field: UplinkIdentityField | undefined }>) {
  if (!field?.disputed) return null;
  return (
    <Text tone="warn" size="sm">
      {DISPUTE_PREFIX[field.disputed.source]} {label}: “{field.disputed.value}”
    </Text>
  );
}

/**
 * The name, author and repo an Uplink declares, with one line saying who
 * declared them.
 *
 * A field nothing declared renders nothing at all: the block exists to carry
 * readings, and there is no reading in an empty author. The name appears here
 * ONLY when the bundle declared it, because that is the case where the caller's
 * own heading is showing the mod-reported id instead and the declared name has
 * nowhere else to go.
 *
 * Where the mod and the bundle named the same field differently, the mod's
 * value is still the one shown, and the bundle's appears under it. That
 * disagreement is not a refusal: `integrity` is what refuses, and it already
 * did or did not. This is the reading an operator weighs before consenting to
 * a pull, and until now the app resolved it silently and threw the loser away.
 *
 * The repo is text, not a link. It is an address an operator copies or types
 * into a browser they choose, and a self-declared URL in a consent dialog is
 * exactly the thing that should not be one click away.
 */
export function UplinkIdentityBlock({
  identity,
  live = false,
}: Readonly<UplinkIdentityBlockProps>) {
  if (!hasIdentityToShow(identity)) return null;
  const selfDeclared = hasSelfDeclaredField(identity);

  return (
    <Stack gap="xs">
      {identity.name.source === "bundle" && (
        <Text tone="muted" size="sm">
          Calls itself “{identity.name.value}”
        </Text>
      )}
      <DisputedClaim label="name" field={identity.name} />
      {identity.author && (
        <Text tone="muted" size="sm">
          by {identity.author.value}
        </Text>
      )}
      <DisputedClaim label="author" field={identity.author} />
      {identity.repo && (
        <Text tone="muted" size="sm">
          {identity.repo.value}
        </Text>
      )}
      <DisputedClaim label="repo" field={identity.repo} />
      <Text
        tone={selfDeclared ? "warn" : "muted"}
        size="sm"
        role={live ? "status" : undefined}
        aria-live={live ? "polite" : undefined}
      >
        {identityProvenance(identity)}
      </Text>
    </Stack>
  );
}
