import { Text } from "@ksp-gonogo/ui-kit";
import { say } from "../copy";

/**
 * The first thing a new operator reads: what the two halves of Gonogo are.
 *
 * The copy names no Uplink on purpose. Listing a few of them dates the moment
 * it is written and reads as an endorsement of those over the rest.
 */
export function WelcomeStep() {
  return (
    <Text level="muted" size="sm">
      {say("welcome.parts")}
    </Text>
  );
}
