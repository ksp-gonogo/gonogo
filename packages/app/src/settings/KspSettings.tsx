import {
  NO_TELEMETRY_HOST_MESSAGE,
  useScreen,
  useTelemetry,
  useTelemetryHostDown,
} from "@ksp-gonogo/core";
import { META_VANTAGE, useCommand } from "@ksp-gonogo/sitrep-client";
import {
  SettingKind,
  type SettingsModel,
  SettingsPersistenceState,
  type SettingsRowState,
} from "@ksp-gonogo/sitrep-sdk";
import { GhostButton, Switch } from "@ksp-gonogo/ui";
import {
  Cluster,
  Notice,
  PrimaryButton,
  SectionTitle,
  Stack,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import styled from "styled-components";
import {
  Empty,
  RowDesc,
  RowLabel,
  RowText,
  SectionStack,
  SettingInput,
  SettingLine,
} from "./settingsLayout";

/** The owner the mod writes for its own rows, as against an Uplink's id. */
const CORE_OWNER = "gonogo";

type Draft = Record<string, string>;

/**
 * The settings the mod and its Uplinks declared, as `settings.gonogo` reports
 * them, changed by one SAVE press through `settings.save`.
 *
 * The rows are drawn from the payload's own descriptions, so a setting an
 * Uplink adds appears here with no code of its own. An edit is held until
 * SAVE and sent as one press, which the mod applies all or nothing; what it
 * then publishes is the only authority for what was saved, because a save can
 * time out and still land.
 *
 * Changes are refused, rather than queued, while KSP is not connected, and a
 * station only reads: both follow from the settings living in KSP's own file.
 */
export function KspSettings() {
  const screen = useScreen();
  const stationOnly = screen === "station";
  const hostDown = useTelemetryHostDown();
  /*
   * Configuration does not lapse when a frame goes missing, so a stale
   * reading is still the settings; only a reading that never arrived is
   * unknown.
   */
  const reading = useTelemetry("settings.gonogo");
  const model: SettingsModel | undefined =
    reading.state === "observed" || reading.state === "stale"
      ? reading.value
      : undefined;
  const save = useCommand("settings.save", { vantage: META_VANTAGE });
  usePanelDelay(save);
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  // An edit the published model now agrees with has landed; keep only the
  // ones still waiting on it.
  useEffect(() => {
    if (!model) return;
    setDraft((current) => {
      const next: Draft = {};
      let changed = false;
      for (const [path, text] of Object.entries(current)) {
        const row = model.rows.find((r) => r.path === path);
        if (row && row.value === text) {
          changed = true;
        } else {
          next[path] = text;
        }
      }
      return changed ? next : current;
    });
  }, [model]);

  const canEdit = !stationOnly && !hostDown && model !== undefined;

  if (model === undefined) {
    return (
      <SectionStack>
        <Empty role="status">
          {stationOnly
            ? "Waiting for the main screen to share KSP's settings."
            : hostDown
              ? `${NO_TELEMETRY_HOST_MESSAGE}. These settings live in KSP's own settings file, so they can be read and changed only while KSP is connected.`
              : "Waiting for KSP to report its settings."}
        </Empty>
      </SectionStack>
    );
  }

  const invalid = Object.entries(draft).filter(([path, text]) => {
    const row = model.rows.find((r) => r.path === path);
    return row !== undefined && !isOfKind(row.kind, text);
  });
  const pending = Object.keys(draft).length;

  async function onSave() {
    const changes = Object.entries(draft).map(([path, value]) => ({
      path,
      value,
    }));
    setSaving(true);
    setOutcome(null);
    try {
      await save.send({ changes });
    } catch (rejected) {
      setOutcome(refusalOf(rejected));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionStack>
      {byOwner(model.rows).map(([owner, rows]) => (
        <Stack as="section" gap="md" key={owner}>
          <SectionTitle as="h3" $rule>
            {owner === CORE_OWNER ? "Gonogo" : owner}
          </SectionTitle>
          {rows.map((row) => (
            <KspSettingRow
              key={row.path}
              row={row}
              text={draft[row.path] ?? row.value}
              disabled={!canEdit}
              onChange={(text) =>
                setDraft((current) =>
                  text === row.value
                    ? withoutPath(current, row.path)
                    : { ...current, [row.path]: text },
                )
              }
            />
          ))}
        </Stack>
      ))}
      {model.undeclared.length > 0 && (
        <Stack as="section" gap="md">
          <SectionTitle as="h3" $rule>
            Not available
          </SectionTitle>
          {model.undeclared.map((failure) => (
            <RowDesc key={failure.uplinkId}>
              {failure.uplinkId}'s settings could not be read this session (
              {failure.reason}). They are at their defaults, and what the
              settings file holds for them is kept.
            </RowDesc>
          ))}
        </Stack>
      )}
      <Footer>
        <FooterLine role="status" aria-live="polite">
          {stationOnly
            ? "Settings are changed on the main screen."
            : hostDown
              ? "Not connected to KSP, so nothing here can be changed."
              : (outcome ??
                (invalid.length > 0
                  ? `${invalid.length === 1 ? "One value is" : `${invalid.length} values are`} not of the kind its setting holds.`
                  : ""))}
        </FooterLine>
        {!stationOnly && (
          <Cluster gap="sm" justify="end">
            <GhostButton
              type="button"
              onClick={() => {
                setDraft({});
                setOutcome(null);
              }}
              disabled={pending === 0 || saving}
            >
              Discard
            </GhostButton>
            <PrimaryButton
              type="button"
              onClick={() => void onSave()}
              disabled={
                !canEdit || pending === 0 || invalid.length > 0 || saving
              }
            >
              {saving
                ? "Saving"
                : pending > 1
                  ? `Save ${pending} changes`
                  : "Save"}
            </PrimaryButton>
          </Cluster>
        )}
        <PersistenceLine model={model} />
      </Footer>
    </SectionStack>
  );
}

/**
 * Where the values in force stand against KSP's settings file. A standing
 * condition rather than a toast: it stays until the next save clears it, and
 * it says nothing while the file holds exactly what is shown.
 */
function PersistenceLine({ model }: { model: SettingsModel }) {
  const { state, path, reason } = model.persistence;
  const text = persistenceText(state, path, reason ?? null);
  if (text === null) return null;
  return (
    <Notice tone="warning" aria-label="Settings file">
      {text}
    </Notice>
  );
}

function persistenceText(
  state: SettingsPersistenceState,
  path: string,
  reason: string | null,
): string | null {
  switch (state) {
    case SettingsPersistenceState.Saved:
      return null;
    case SettingsPersistenceState.MemoryOnly:
      return `Saved for this session only. ${path} could not be written${reason ? ` (${reason})` : ""}. These settings revert when KSP restarts.`;
    case SettingsPersistenceState.Recovered:
      return `The settings file was missing or damaged when KSP started, so its backup was read. Anything saved after that backup was taken is lost.`;
    case SettingsPersistenceState.Defaults:
      return "No settings file yet: every setting is at its default until the first save.";
    case SettingsPersistenceState.Unreadable:
      return `${path} could not be read, nor its backup, so every setting is at its default. The next save replaces the unreadable file.`;
    default:
      return unnamedState(state);
  }
}

function unnamedState(state: never): string {
  return `The settings file is in a state this screen cannot name (${String(state)}).`;
}

function KspSettingRow({
  row,
  text,
  disabled,
  onChange,
}: {
  row: SettingsRowState;
  text: string;
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  const label = row.label || row.path.slice(row.path.lastIndexOf("/") + 1);
  const valid = isOfKind(row.kind, text);
  return (
    <SettingLine>
      <RowText>
        <RowLabel>{label}</RowLabel>
        <RowDesc>
          {valid ? `Default ${row.default}` : `Not a ${kindName(row.kind)}.`}
        </RowDesc>
      </RowText>
      {row.kind === SettingKind.Bool ? (
        <Switch
          checked={text === "True"}
          onChange={(next) => onChange(next ? "True" : "False")}
          disabled={disabled}
          aria-label={label}
        />
      ) : (
        <SettingInput
          type="text"
          inputMode={row.kind === SettingKind.Number ? "decimal" : undefined}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={label}
          aria-invalid={!valid}
        />
      )}
    </SettingLine>
  );
}

/**
 * Whether the mod would take `text` for a row of this kind: the same test it
 * applies on save, so SAVE is offered only for a press it would accept. A kind
 * newer than this screen knows is held to nothing here, and the mod still
 * refuses a value it cannot use.
 */
function isOfKind(kind: SettingKind, text: string): boolean {
  switch (kind) {
    case SettingKind.Bool:
      return text === "True" || text === "False";
    case SettingKind.Number:
      return text.trim() !== "" && Number.isFinite(Number(text));
    case SettingKind.Text:
      return true;
    default:
      return true;
  }
}

function kindName(kind: SettingKind): string {
  switch (kind) {
    case SettingKind.Bool:
      return "true or false value";
    case SettingKind.Number:
      return "number";
    default:
      return "value";
  }
}

function byOwner(
  rows: readonly SettingsRowState[],
): [string, SettingsRowState[]][] {
  const groups = new Map<string, SettingsRowState[]>();
  for (const row of rows) {
    const group = groups.get(row.owner);
    if (group) group.push(row);
    else groups.set(row.owner, [row]);
  }
  return [...groups.entries()];
}

function withoutPath(draft: Draft, path: string): Draft {
  const { [path]: _dropped, ...rest } = draft;
  return rest;
}

/** The mod's own reason for a refused save, or what is known when the save was not confirmed at all. */
function refusalOf(rejected: unknown): string {
  if (typeof rejected === "object" && rejected !== null) {
    const detail = (rejected as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.length > 0) {
      return `Not saved: ${detail}.`;
    }
  }
  return "KSP did not confirm the save. What is shown above is what it holds.";
}

const Footer = styled(Stack).attrs({ gap: "sm" as const })`
  margin-top: auto;
`;

const FooterLine = styled.p`
  margin: 0;
  min-height: 1lh;
  color: var(--color-text-dim);
  font-size: var(--font-size-compact);
`;
