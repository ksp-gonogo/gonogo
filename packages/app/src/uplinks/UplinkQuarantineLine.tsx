import { Button, Cluster, Text } from "@ksp-gonogo/ui-kit";
import { requestSettings } from "../settings/settingsRequest";

/**
 * One line counting the Uplink clients quarantined for a reason other than an
 * integrity failure, such as a refused contract version, a failed download or a
 * mod that vouches for no client hash, with a button to the Uplinks page in
 * Settings where each one says why. `following` words the count as additional
 * to the integrity failures shown above it. Useful for telling the operator
 * that Uplink widgets are missing and where to look, without spending the
 * integrity banner's loud channel on them. Used by the Uplink integrity banner.
 */
export function UplinkQuarantineLine({
  count,
  following,
}: Readonly<{ count: number; following: boolean }>) {
  const noun = count === 1 ? "Uplink" : "Uplinks";
  return (
    <Cluster justify="start" gap="related-dense" wrap>
      <Text level="muted" size="sm">
        {following
          ? `${count} more quarantined, see`
          : `${count} ${noun} quarantined, see`}
      </Text>
      <Button variant="text" onClick={() => requestSettings("uplinks")}>
        Settings &gt; Uplinks
      </Button>
    </Cluster>
  );
}
