import {
  NO_TELEMETRY_HOST_MESSAGE,
  useScreen,
  useTelemetryHostDown,
} from "@ksp-gonogo/core";
import { META_VANTAGE, useCommand } from "@ksp-gonogo/sitrep-client";
import {
  type ModSettingRow,
  value as quantity,
  SettingKind,
} from "@ksp-gonogo/sitrep-sdk";
import { useModSettings } from "@ksp-gonogo/sitrep-sdk/spine";
import { Switch } from "@ksp-gonogo/ui";
import {
  Notice,
  ReadOnlyField,
  type ReadOnlyFieldValue,
  Stack,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import styled from "styled-components";
import { bucketBy } from "./SettingRows";
import {
  Empty,
  GroupTitle,
  RowDesc,
  RowLabel,
  RowText,
  SettingInput,
  SettingLine,
  SettingReadOnlyLine,
} from "./settingsLayout";

type Pending = Record<string, string>;

/**
 * One Uplink's host mod settings, as the Uplink read them off the mod on
 * `settings.<uplink>`.
 *
 * A setting the Uplink offers to write draws a control that writes at once
 * through `settings.mod.write`, since the mod applies it the moment it accepts
 * it; every other one is a value, never a disabled control. What the topic
 * says afterwards is the only authority for whether a write landed, so a
 * control shows the value it asked for only until the topic agrees or the
 * write is refused.
 */
export function ModSettingsSection({
  uplinkId,
  name,
}: {
  uplinkId: string;
  name: string;
}) {
  const stationOnly = useScreen() === "station";
  const hostDown = useTelemetryHostDown();
  const reading = useModSettings(uplinkId);
  const model =
    reading.state === "observed" || reading.state === "stale"
      ? reading.value
      : undefined;
  const write = useCommand("settings.mod.write", { vantage: META_VANTAGE });
  usePanelDelay(write);
  const [pending, setPending] = useState<Pending>({});
  const [outcome, setOutcome] = useState<string | null>(null);

  // A write the topic now carries has landed.
  useEffect(() => {
    if (!model) return;
    setPending((current) => {
      const next: Pending = {};
      let changed = false;
      for (const [id, text] of Object.entries(current)) {
        const row = model.settings.find((s) => s.id === id);
        if (row && row.value === text) {
          changed = true;
        } else {
          next[id] = text;
        }
      }
      return changed ? next : current;
    });
  }, [model]);

  if (model === undefined) {
    return (
      <Empty role="status">
        {hostDown
          ? `${NO_TELEMETRY_HOST_MESSAGE}.`
          : `Waiting for KSP to report ${name}'s settings.`}
      </Empty>
    );
  }

  if (model.failure) {
    return (
      <Notice tone="warning" aria-label={`${name} settings`}>
        {name}'s settings could not be read this session ({model.failure}).
      </Notice>
    );
  }

  if (model.settings.length === 0) {
    return <Empty>{name} lists no settings.</Empty>;
  }

  const canWrite = !stationOnly && !hostDown;

  async function onWrite(row: ModSettingRow, text: string) {
    setPending((current) => ({ ...current, [row.id]: text }));
    setOutcome(null);
    try {
      await write.send({ uplink: uplinkId, id: row.id, value: text });
    } catch (rejected) {
      setPending(({ [row.id]: _dropped, ...rest }) => rest);
      setOutcome(refusalOf(row, rejected));
    }
  }

  const drawRow = (row: ModSettingRow) => (
    <ModSettingLine
      key={row.id}
      row={row}
      pending={pending[row.id]}
      canWrite={canWrite}
      onWrite={(text) => void onWrite(row, text)}
    />
  );
  const grouped = bucketBy(
    model.settings.filter((s) => s.group !== ""),
    (s) => s.group,
  );

  return (
    <Stack gap="related-comfortable">
      {model.settings.filter((s) => s.group === "").map(drawRow)}
      {[...grouped.entries()].map(([group, rows]) => (
        <Stack gap="related-dense" key={group}>
          <GroupTitle>{group}</GroupTitle>
          {rows.map(drawRow)}
        </Stack>
      ))}
      <StatusLine role="status" aria-live="polite">
        {outcome ?? ""}
      </StatusLine>
    </Stack>
  );
}

function ModSettingLine({
  row,
  pending,
  canWrite,
  onWrite,
}: {
  row: ModSettingRow;
  pending: string | undefined;
  canWrite: boolean;
  onWrite: (text: string) => void;
}) {
  const known = row.value !== null && row.value !== undefined;
  if (!row.writable || !known) {
    return (
      <SettingReadOnlyLine>
        <ReadOnlyField
          label={row.label}
          description={hasAbout(row) ? <About row={row} /> : undefined}
          value={shownValueOf(row)}
        />
      </SettingReadOnlyLine>
    );
  }

  const shown = pending ?? row.value ?? "";
  const busy = pending !== undefined;
  return (
    <SettingLine>
      <RowText>
        <RowLabel>{row.label}</RowLabel>
        {hasAbout(row) && <About row={row} />}
      </RowText>
      {row.kind === SettingKind.Bool ? (
        <Switch
          checked={shown === "True"}
          onChange={(next) => onWrite(next ? "True" : "False")}
          disabled={!canWrite || busy}
          aria-label={row.label}
        />
      ) : (
        <ModSettingInput
          row={row}
          text={shown}
          disabled={!canWrite || busy}
          onCommit={onWrite}
        />
      )}
    </SettingLine>
  );
}

/** A number or text setting, written when the operator leaves the field or presses Enter, and only if it changed. */
function ModSettingInput({
  row,
  text,
  disabled,
  onCommit,
}: {
  row: ModSettingRow;
  text: string;
  disabled: boolean;
  onCommit: (text: string) => void;
}) {
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  const valid =
    row.kind !== SettingKind.Number ||
    (draft.trim() !== "" && Number.isFinite(Number(draft)));
  const commit = () => {
    if (!valid || draft === text) return;
    onCommit(draft);
  };
  return (
    <SettingInput
      type="text"
      inputMode={row.kind === SettingKind.Number ? "decimal" : undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      disabled={disabled}
      aria-label={row.label}
      aria-invalid={!valid}
    />
  );
}

function hasAbout(row: ModSettingRow): boolean {
  return row.description !== "" || row.setIn !== "" || !!row.unavailable;
}

/** What the setting is for, where in the game it is set, and why it cannot be read right now. */
function About({ row }: { row: ModSettingRow }) {
  return (
    <AboutLines>
      {row.description && <RowDesc>{row.description}</RowDesc>}
      {row.setIn && <RowDesc>Set in {row.setIn}</RowDesc>}
      {row.unavailable && <RowDesc>{row.unavailable}</RowDesc>}
    </AboutLines>
  );
}

/**
 * The value drawn from its row: on or off for a bool, a quantity in the row's
 * unit for a number, and the null placeholder when the mod could not be read.
 */
function shownValueOf(row: ModSettingRow): ReadOnlyFieldValue {
  if (row.value === null || row.value === undefined) return null;
  if (row.kind === SettingKind.Bool) return row.value === "True";
  if (row.kind !== SettingKind.Number) return row.value;
  const magnitude = Number(row.value);
  return Number.isFinite(magnitude)
    ? quantity(row.unit ?? "", magnitude)
    : row.value;
}

function refusalOf(row: ModSettingRow, rejected: unknown): string {
  if (typeof rejected === "object" && rejected !== null) {
    const detail = (rejected as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.length > 0) {
      return `${row.label} not changed: ${detail}.`;
    }
  }
  return `KSP did not confirm the change to ${row.label}. What is shown is what it holds.`;
}

const AboutLines = styled.span`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const StatusLine = styled.p`
  margin: 0;
  min-height: 1lh;
  color: var(--color-text-dim);
  font-size: var(--font-size-compact);
`;
