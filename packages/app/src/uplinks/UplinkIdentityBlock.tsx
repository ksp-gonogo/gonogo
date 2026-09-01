import { Stack, Text } from "@ksp-gonogo/ui-kit";
import {
  hasIdentityToShow,
  hasSelfDeclaredField,
  identityProvenance,
  type UplinkIdentity,
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
      {identity.author && (
        <Text tone="muted" size="sm">
          by {identity.author.value}
        </Text>
      )}
      {identity.repo && (
        <Text tone="muted" size="sm">
          {identity.repo.value}
        </Text>
      )}
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
