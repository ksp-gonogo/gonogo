import { type TimeContexts, useTelemetry } from "@ksp-gonogo/core";
import {
  type GameAlarm,
  GameAlarmKind,
  GameAlarmWarp,
  type HeldGrade,
  useCommand,
  useStream,
} from "@ksp-gonogo/sitrep-sdk";
import { Badge, Button } from "@ksp-gonogo/ui";
import {
  Card,
  heldWord,
  MissionDate,
  SectionTitle,
  Stack,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import styled from "styled-components";
import { DangerButton, List, RowActions, RowMeta } from "./alarmRowStyles";

const KIND_LABEL: Record<GameAlarmKind, string> = {
  [GameAlarmKind.Time]: "Time",
  [GameAlarmKind.TransferWindow]: "Transfer window",
  [GameAlarmKind.SoiChange]: "SOI change",
  [GameAlarmKind.Apoapsis]: "Apoapsis",
  [GameAlarmKind.Periapsis]: "Periapsis",
  [GameAlarmKind.Maneuver]: "Maneuver",
  [GameAlarmKind.Other]: "Other",
};

const WARP_LABEL: Record<GameAlarmWarp, string> = {
  [GameAlarmWarp.Nothing]: "leaves warp alone",
  [GameAlarmWarp.StopWarp]: "stops warp",
  [GameAlarmWarp.Pause]: "pauses the game",
};

/** The Topic carrying one craft's game alarms, which arrive one signal delay after the craft. */
export function gameAlarmCraftTopic(vesselId: string): string {
  return `alarm.game.craft.${vesselId}.list`;
}

/**
 * The game alarms to list here: every one except a copy of an alarm of
 * Gonogo's own, which the Scheduled list already shows.
 */
export function listedGameAlarms(
  alarms: readonly GameAlarm[] | undefined,
): GameAlarm[] {
  return (alarms ?? []).filter((alarm) => alarm.gonogoId == null);
}

/**
 * The alarms in the game's own alarm clock. Those the game works out from a
 * craft (an apsis, a sphere of influence change, a maneuver node) are read
 * from that craft's own Topic, so they appear here one signal delay after the
 * craft and show as held while it is out of contact.
 */
export function GameAlarmsSection({ contexts }: { contexts: TimeContexts }) {
  const listReading = useTelemetry("alarm.game.list");
  const catalogReading = useTelemetry("trackingStation.catalog");
  const deleteAlarm = useCommand("alarm.game.delete");
  const onDelete = (id: number) => void deleteAlarm.send({ id });

  const list =
    listReading.state === "observed" || listReading.state === "held"
      ? listReading.value
      : null;
  if (list === null) return null;
  if (!list.available) {
    return (
      <Stack as="section" gap="related-comfortable">
        <SectionTitle as="h3">In the game</SectionTitle>
        <Note>The game is not running an alarm clock here.</Note>
      </Stack>
    );
  }

  const crafts =
    catalogReading.state === "observed" || catalogReading.state === "held"
      ? catalogReading.value.entries
      : [];
  const plan = listedGameAlarms(list.alarms);
  return (
    <Stack as="section" gap="related-comfortable">
      <SectionTitle as="h3">In the game</SectionTitle>
      <List aria-label="Game alarms">
        {plan.map((alarm) => (
          <GameAlarmRow
            key={alarm.id}
            alarm={alarm}
            heldGrade={undefined}
            contexts={contexts}
            onDelete={onDelete}
          />
        ))}
        {crafts.map((craft) => (
          <CraftGameAlarms
            key={craft.vesselId}
            vesselId={craft.vesselId}
            contexts={contexts}
            onDelete={onDelete}
          />
        ))}
      </List>
    </Stack>
  );
}

function CraftGameAlarms({
  vesselId,
  contexts,
  onDelete,
}: {
  vesselId: string;
  contexts: TimeContexts;
  onDelete: (id: number) => void;
}) {
  const reading = useStream<GameAlarm[]>(gameAlarmCraftTopic(vesselId));
  if (reading.state !== "observed" && reading.state !== "held") return null;
  return (
    <>
      {listedGameAlarms(reading.value).map((alarm) => (
        <GameAlarmRow
          key={alarm.id}
          alarm={alarm}
          heldGrade={reading.state === "held" ? reading.grade : undefined}
          contexts={contexts}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

function GameAlarmRow({
  alarm,
  heldGrade,
  contexts,
  onDelete,
}: {
  alarm: GameAlarm;
  heldGrade: HeldGrade | undefined;
  contexts: TimeContexts;
  onDelete: (id: number) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const title = alarm.title || KIND_LABEL[alarm.kind];
  return (
    <Card
      as="li"
      titleLeft={
        <Badge size="md">{KIND_LABEL[alarm.kind].toUpperCase()}</Badge>
      }
      title={title}
      titleRight={
        alarm.triggered ? (
          <Badge tone="warn" size="sm">
            DUE
          </Badge>
        ) : heldGrade !== undefined ? (
          <Badge tone="warn" size="sm">
            {heldWord(heldGrade)}
          </Badge>
        ) : undefined
      }
      right={
        confirming ? (
          <RowActions>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <DangerButton
              type="button"
              onClick={() => {
                onDelete(alarm.id);
                setConfirming(false);
              }}
            >
              Delete
            </DangerButton>
          </RowActions>
        ) : (
          <Button
            variant="ghost"
            type="button"
            aria-label={`Delete ${title} from the game`}
            onClick={() => setConfirming(true)}
          >
            Delete
          </Button>
        )
      }
    >
      <RowMeta>
        <MissionDate value={alarm.ut} context={contexts.scet} /> ·{" "}
        {WARP_LABEL[alarm.warp]}
      </RowMeta>
    </Card>
  );
}

const Note = styled.div`
  color: var(--color-text-dim);
  font-size: var(--font-size-compact);
`;
