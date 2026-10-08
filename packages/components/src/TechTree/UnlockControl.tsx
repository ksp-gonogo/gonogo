import {
  Cluster,
  CommandButton,
  type CommandButtonHandle,
  Grid,
  NULL_DISPLAY,
  Stack,
  Stat,
  Unit,
  type UnitValue,
} from "@ksp-gonogo/ui-kit";
import type { UnlockHandlers } from "./unlock";
import type { TechNode } from "./wire";

interface UnlockControlProps {
  node: TechNode;
  /** The shared unlock handle; the button holds its own arm and in-flight state. */
  unlockCmd: CommandButtonHandle;
  unlock: UnlockHandlers;
  /** The balance as drawn, held included so Unit can mark it. */
  scienceShown: UnitValue<"science">;
  chargesScience: boolean;
}

/**
 * Unlock with what it spends beside it: the price, and the balance it is drawn from wherever science is charged.
 * Tech is paid up front and refused on affordability, so a short balance colours the price; a verdict is drawn only against a current balance.
 */
export function UnlockControl({
  node,
  unlockCmd,
  unlock,
  scienceShown,
  chargesScience,
}: Readonly<UnlockControlProps>) {
  const short = unlock.moneyDecides && !unlock.canAfford;
  return (
    <Stack>
      <Grid minColWidth="7rem" fit align="stretch" gap="related-compact">
        <Stat label="Price" tone={short ? "nogo" : "neutral"}>
          {node.scienceCost ?? NULL_DISPLAY}
          <Unit>science</Unit>
        </Stat>
        {chargesScience && (
          <Stat label="Balance">
            <Unit value={scienceShown} decimals={0} />
          </Stat>
        )}
      </Grid>
      <Cluster justify="end">
        <CommandButton
          handle={unlockCmd}
          args={{ techId: node.id }}
          commandLabel={`Unlock ${node.title}`}
          size="sm"
          label="Unlock"
          confirmLabel={
            <>
              Confirm unlock: {node.scienceCost ?? NULL_DISPLAY}
              <Unit>science</Unit>
            </>
          }
          pendingLabel="Unlocking..."
        />
      </Cluster>
    </Stack>
  );
}
