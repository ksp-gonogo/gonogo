import { useTelemetry } from "@ksp-gonogo/core";
import { useViewUt } from "@ksp-gonogo/sitrep-client";
import { stillTrue, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Button,
  type CommandButtonHandle,
  MissionDate,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { ArmedButton } from "./ArmedButton";
import { useBoundPress } from "./actions";
import { FlightStatRow, FlightStats, StatLabel, StatValue } from "./styles";

/**
 * The rows for one save: when it holds, and how far loading it would move the
 * operator, signed, from the UT on their own delayed view to the UT the save
 * holds.
 */
/** How far loading a save would move the operator, signed: from the UT on their own delayed view to the UT the save holds. */
function Moves({
  saveUt,
  viewUt,
}: {
  saveUt: Value<"ut">;
  viewUt: Value<"ut">;
}) {
  const behind = viewUt.minus(saveUt);
  const movesBack = behind.greaterThan(value("s", 0));
  return (
    <>
      {movesBack ? "\u2212" : "+"}
      <Unit value={movesBack ? behind : behind.times(-1)} />
    </>
  );
}

function SlotRows({
  label,
  saveUt,
  viewUt,
}: {
  label: string;
  saveUt: Value<"ut"> | undefined;
  viewUt: Value<"ut"> | undefined;
}) {
  return (
    <FlightStats>
      <FlightStatRow>
        <StatLabel>{label}</StatLabel>
        <StatValue>
          {saveUt === undefined ? "none" : <MissionDate value={saveUt} />}
        </StatValue>
      </FlightStatRow>
      {saveUt !== undefined && viewUt !== undefined && (
        <FlightStatRow>
          <StatLabel>Moves</StatLabel>
          <StatValue>
            <Moves saveUt={saveUt} viewUt={viewUt} />
          </StatValue>
        </FlightStatRow>
      )}
    </FlightStats>
  );
}

/**
 * Quicksave, quickload and the previous quicksave, as the Launch Director's
 * in-flight panel shows them. The facts are drawn at rest so arming changes only
 * the button faces.
 */
export function SaveControls({
  quicksaveCmd,
  quickloadCmd,
}: {
  quicksaveCmd: CommandButtonHandle;
  quickloadCmd: CommandButtonHandle;
}) {
  const saves = stillTrue(useTelemetry("ksp.saves"), undefined);
  const viewUt = useViewUt();
  const onQuicksavePress = useBoundPress("quicksave");
  const slot = saves?.quicksave ?? null;
  const previous = saves?.previousQuicksave ?? null;
  return (
    <>
      <SlotRows label="Save UT" saveUt={slot?.ut} viewUt={viewUt} />
      <Button
        command={quicksaveCmd.with(undefined, { label: "Quicksave" })}
        variant="ghost"
        onPressReady={onQuicksavePress}
      >
        Quicksave
      </Button>
      <ArmedButton
        bindAs="quickload"
        kind="revert"
        handle={quickloadCmd}
        args={{ saveId: slot?.saveId ?? "", requestedBy: "" }}
        commandLabel="Quickload"
        label="Quickload"
        confirmLabel="Confirm quickload"
      />
      {previous && (
        <>
          <SlotRows label="Previous" saveUt={previous.ut} viewUt={viewUt} />
          <ArmedButton
            bindAs="quickload-previous"
            kind="revert"
            handle={quickloadCmd}
            args={{ saveId: previous.saveId, requestedBy: "" }}
            commandLabel="Load previous quicksave"
            label="Load previous"
            confirmLabel="Confirm load previous"
          />
        </>
      )}
    </>
  );
}
