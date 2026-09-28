import { railTagsForCommand } from "@ksp-gonogo/sitrep-sdk";
import { ArrowRightIcon, CloseIcon } from "@ksp-gonogo/ui";
import { Button, CommandList, Row, Stack } from "@ksp-gonogo/ui-kit";
import { PRESETS } from "./presets";
import type { ArmedTrigger } from "./triggerTypes";

interface ArmedTriggersListProps {
  triggers: readonly ArmedTrigger[];
  onCancel: (id: string) => void;
}

export function ArmedTriggersList({
  triggers,
  onCancel,
}: ArmedTriggersListProps) {
  if (triggers.length === 0) return null;
  return (
    <Stack as="ul" style={LIST_STYLE}>
      {triggers.map((t) => {
        const presetLabel =
          PRESETS.find((p) => p.id === t.inputs.preset)?.label ??
          t.inputs.preset;
        return (
          <Row key={t.id} style={ARMED_ROW_STYLE}>
            <div style={MAIN_STYLE}>
              <div style={PRIMARY_STYLE}>
                {t.dataKey} {t.op} {t.value}
              </div>
              <div style={META_STYLE}>
                <ArrowRightIcon size={11} /> {presetLabel}
              </div>
              {t.refusals && (
                <CommandList
                  kind="refused"
                  live={false}
                  entries={t.refusals.map((r) => ({
                    ...r,
                    tags: railTagsForCommand(r.command ?? ""),
                  }))}
                />
              )}
            </div>
            <Button
              type="button"
              onClick={() => onCancel(t.id)}
              aria-label={
                t.refusals ? "Dismiss refused trigger" : "Cancel armed trigger"
              }
            >
              <CloseIcon size={12} />
            </Button>
          </Row>
        );
      })}
    </Stack>
  );
}

/** The gap is named, not sized, so a surrounding card tightens it like everything else. */
const LIST_STYLE = {
  gap: "var(--gap-related)",
  listStyle: "none",
  margin: 0,
  padding: 0,
} as const;

/** A warned card on the kit's Row, with the surface inset in place of a row's hairline padding. */
const ARMED_ROW_STYLE = {
  padding: "var(--inset-surface)",
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-status-warning-bg)",
  borderRadius: "var(--radius-regular)",
} as const;

const MAIN_STYLE = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-line)",
  minWidth: 0,
} as const;

const PRIMARY_STYLE = {
  fontSize: "var(--font-size-value)",
  color: "var(--color-status-warning-bg)",
  fontWeight: 600,
  letterSpacing: "0.02em",
} as const;

const META_STYLE = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-dim)",
  letterSpacing: "0.04em",
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--gap-related)",
} as const;
