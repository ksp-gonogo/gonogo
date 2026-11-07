import { type TimeContexts, useTelemetry } from "@ksp-gonogo/core";
import {
  type GameAlarm,
  GameAlarmKind,
  type HeldGrade,
  useCommand,
  useStream,
} from "@ksp-gonogo/sitrep-sdk";
import { Badge, Button } from "@ksp-gonogo/ui";
import { Card, heldWord, MissionDate, Tag } from "@ksp-gonogo/ui-kit";
import { useEffect, useMemo, useRef, useState } from "react";
import { DangerButton, RowActions, RowMeta } from "./alarmRowStyles";

const KIND_LABEL: Record<GameAlarmKind, string> = {
  [GameAlarmKind.Time]: "TIME",
  [GameAlarmKind.TransferWindow]: "TRANSFER",
  [GameAlarmKind.SoiChange]: "SOI",
  [GameAlarmKind.Apoapsis]: "APOAPSIS",
  [GameAlarmKind.Periapsis]: "PERIAPSIS",
  [GameAlarmKind.Maneuver]: "MANEUVER",
  [GameAlarmKind.Other]: "TIME",
};

/** The Topic carrying one craft's game alarms, which arrive one signal delay after the craft. */
export function gameAlarmCraftTopic(vesselId: string): string {
  return `alarm.game.craft.${vesselId}.list`;
}

/**
 * The game alarms to list: every one except a copy of an alarm of Gonogo's
 * own, which the list already shows.
 */
export function listedGameAlarms(
  alarms: readonly GameAlarm[] | undefined,
): GameAlarm[] {
  return (alarms ?? []).filter((alarm) => alarm.gonogoId == null);
}

const NO_CRAFTS: never[] = [];

/** A game alarm to list, with how current it is when its craft is out of contact. */
export interface ListedGameAlarm {
  alarm: GameAlarm;
  heldGrade: HeldGrade | undefined;
}

/**
 * Reads the alarms of the game's own alarm clock and hands them to `onAlarms`
 * as the rows for the one alarm list, none while the game has no alarm clock
 * to read. Those the game works out from a craft (an apsis, a sphere of
 * influence change, a maneuver node) are read from that craft's own Topic, so
 * they arrive one signal delay after the craft and are held while it is out of
 * contact. Draws nothing itself.
 */
export function GameAlarmFeed({
  onAlarms,
}: {
  onAlarms: (alarms: ListedGameAlarm[]) => void;
}) {
  const listReading = useTelemetry("alarm.game.list");
  const catalogReading = useTelemetry("trackingStation.catalog");
  const [craftAlarms, setCraftAlarms] = useState<
    Record<string, ListedGameAlarm[]>
  >({});

  const list =
    listReading.state === "observed" || listReading.state === "held"
      ? listReading.value
      : null;
  const available = list?.available === true;
  const crafts = useMemo(
    () =>
      available &&
      (catalogReading.state === "observed" || catalogReading.state === "held")
        ? catalogReading.value.entries
        : NO_CRAFTS,
    [available, catalogReading],
  );

  const merged = useMemo(() => {
    if (!available) return [];
    const own = listedGameAlarms(list?.alarms).map(
      (alarm): ListedGameAlarm => ({ alarm, heldGrade: undefined }),
    );
    return own.concat(crafts.flatMap((c) => craftAlarms[c.vesselId] ?? []));
  }, [available, list, crafts, craftAlarms]);
  useEffect(() => onAlarms(merged), [onAlarms, merged]);

  return (
    <>
      {crafts.map((craft) => (
        <CraftGameAlarms
          key={craft.vesselId}
          vesselId={craft.vesselId}
          onAlarms={(items) =>
            setCraftAlarms((prev) => ({ ...prev, [craft.vesselId]: items }))
          }
        />
      ))}
    </>
  );
}

function CraftGameAlarms({
  vesselId,
  onAlarms,
}: {
  vesselId: string;
  onAlarms: (alarms: ListedGameAlarm[]) => void;
}) {
  const reading = useStream<GameAlarm[]>(gameAlarmCraftTopic(vesselId));
  const report = useRef(onAlarms);
  report.current = onAlarms;
  useEffect(() => {
    const heldGrade = reading.state === "held" ? reading.grade : undefined;
    report.current(
      reading.state === "observed" || reading.state === "held"
        ? listedGameAlarms(reading.value).map((alarm) => ({ alarm, heldGrade }))
        : [],
    );
  }, [reading]);
  return null;
}

/** One game alarm as a row of the alarm list; deleting it asks first. */
export function GameAlarmRow({
  alarm,
  heldGrade,
  contexts,
}: {
  alarm: GameAlarm;
  heldGrade: HeldGrade | undefined;
  contexts: TimeContexts;
}) {
  const deleteAlarm = useCommand("alarm.game.delete");
  const onDelete = (id: number) => void deleteAlarm.send({ id });
  const [confirming, setConfirming] = useState(false);
  const title = alarm.title || "Alarm";
  return (
    <Card
      as="li"
      titleLeft={<Tag label={KIND_LABEL[alarm.kind]} />}
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
            aria-label={`Delete ${title}`}
            onClick={() => setConfirming(true)}
          >
            Delete
          </Button>
        )
      }
    >
      <RowMeta>
        <MissionDate value={alarm.ut} context={contexts.scet} />
      </RowMeta>
    </Card>
  );
}
