import { Stack, Text } from "@ksp-gonogo/ui-kit";
import { SitrepConnection } from "../../settings/SitrepConnection";

/**
 * The connect step embeds the SAME host/data-source row the Settings Data
 * Sources tab renders (`SitrepConnection`, which lives in its own file for
 * exactly this reuse), so an operator meets one connection control, not two
 * that could drift.
 *
 * Moving on does not require a connected status. The next step reports "waiting
 * for the mod" as a state of its own, which is a reading, not an error.
 */
export function ConnectStep() {
  return (
    <Stack gap="sm">
      <Text tone="muted" size="sm">
        Connect to the mod running in KSP. The next step reads back what it
        reports.
      </Text>
      <SitrepConnection />
    </Stack>
  );
}
