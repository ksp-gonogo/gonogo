// The operator's route past a mod/index hash DECLARATION disagreement.
//
// This renders for exactly one finding and refuses to render for any other. A
// `declaration` finding means nothing was fetched and two parties expect
// different builds; a `bundle` or `manifest` finding means an artifact was
// measured and hashes to something nobody vouched for. There is no button for
// the second, here or anywhere: `isOverridableIntegrityFailure` is the gate and
// this component asks it rather than reading the subject itself.
//
// The reload is not ceremony. The loader runs once at boot and `import()` IS
// registration, so a decision recorded now takes effect on the next load pass
// and nothing else. Saying so on the button is more honest than a control that
// appears to act immediately and does not, and it matches the "Reconsider"
// affordance beside it in the same list.

import { Cluster, GhostButton, Stack, Text } from "@ksp-gonogo/ui-kit";
import {
  isOverridableIntegrityFailure,
  type UplinkIntegrityFailure,
} from "./integrity";
import type { UplinkLoadOutcome } from "./loaderState";
import {
  grantSkewOverride,
  hasSkewOverride,
  revokeSkewOverride,
} from "./skewOverride";

interface Props {
  outcome: UplinkLoadOutcome;
  /** Injected so a test drives the decision without navigating the harness. */
  reload?: () => void;
}

function defaultReload(): void {
  window.location.reload();
}

/**
 * Whether this outcome has an override route at all: an overridable finding AND
 * a resolved version, since the version is half of what binds a grant to one
 * build. Exported so the banner and the Settings list partition on the same
 * question rather than each deciding it.
 */
export function canOverrideSkew(
  outcome: UplinkLoadOutcome,
): outcome is UplinkLoadOutcome & {
  integrity: UplinkIntegrityFailure;
  version: string;
} {
  return (
    outcome.integrity !== undefined &&
    isOverridableIntegrityFailure(outcome.integrity) &&
    outcome.version !== undefined
  );
}

/**
 * The control, plus the one sentence that states what accepting does. Both
 * hashes and both parties are already on screen: `UplinkIntegrityDetail` prints
 * them for every finding and this sits below it, so the operator reads the
 * disagreement first and the decision second.
 */
export function UplinkSkewOverride({ outcome, reload = defaultReload }: Props) {
  if (!canOverrideSkew(outcome)) return null;
  const { id, version, integrity } = outcome;
  const granted = hasSkewOverride(id, version, integrity);

  if (granted) {
    return (
      <Cluster justify="start" gap="sm" wrap>
        <Text tone="warn" size="sm">
          Override recorded for this pair. Reload to apply.
        </Text>
        <GhostButton
          type="button"
          onClick={() => {
            revokeSkewOverride(id, version, integrity);
            reload();
          }}
        >
          Withdraw override
        </GhostButton>
      </Cluster>
    );
  }

  return (
    <Stack gap="xs">
      <Text tone="muted" size="sm">
        Accepting loads the client the index offers. The bundle is still fetched
        and still refused unless it hashes to {integrity.observed}. The decision
        covers this id, this version and this pair of hashes only.
      </Text>
      <Cluster justify="start" gap="sm" wrap>
        <GhostButton
          type="button"
          onClick={() => {
            grantSkewOverride(id, version, integrity);
            reload();
          }}
        >
          Use anyway
        </GhostButton>
      </Cluster>
    </Stack>
  );
}
