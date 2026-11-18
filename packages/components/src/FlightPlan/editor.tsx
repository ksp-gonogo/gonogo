import type { PlanStepKind } from "@ksp-gonogo/sitrep-sdk";
import {
  Button,
  Grid,
  Inline,
  Stack,
  Tag,
  TextField,
  ToggleButton,
  useModal,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { triggerText } from "./format";
import type { FlightPlan, PlanIntent, PlanStep } from "./plan";
import { savePlan } from "./planStore";
import type { PlanLive, ScoredPlan } from "./scoring";
import { stepKind, useStepKinds } from "./stepKinds";
import { StepCard } from "./steps";

const SCALE: Record<string, number> = { km: 1000, "%": 0.01 };

/** An input's value as the operator types it: kilometres, percent, or as kept. */
function shown(
  def: PlanStepKind,
  key: string,
  v: number | string | undefined,
): string {
  if (typeof v !== "number") return v ?? "";
  const unit = def.inputs[key]?.unit;
  const scale = unit ? (SCALE[unit] ?? 1) : 1;
  return String(+(v / scale).toFixed(3));
}

function parsed(
  def: PlanStepKind,
  key: string,
  text: string,
): number | string | undefined {
  const input = def.inputs[key];
  if (!input) return undefined;
  if (typeof input.default === "string") return text.trim();
  const n = Number(text);
  if (!Number.isFinite(n)) return undefined;
  const scale = input.unit ? (SCALE[input.unit] ?? 1) : 1;
  return n * scale;
}

/** An id not yet used by any step of the plan. */
function freshStepId(plan: FlightPlan, kind: string): string {
  const taken = new Set(plan.steps.map((s) => s.id));
  let n = plan.steps.length + 1;
  while (taken.has(`${kind}-${n}`)) n += 1;
  return `${kind}-${n}`;
}

function newStep(def: PlanStepKind, id: string): PlanStep {
  const inputs = Object.fromEntries(
    Object.entries(def.inputs).map(([k, i]) => [k, i.default]),
  );
  return {
    id,
    kind: def.id,
    inputs,
    needsDv: def.needsDv?.(inputs),
    intents: [],
  };
}

/**
 * The plan's steps as editable cards, scored against the craft in the editor,
 * with Add step listing every step kind: core's first, then each contributor's
 * under its own heading.
 */
export function PlanEditor({
  plan,
  scored,
  live,
}: {
  plan: FlightPlan;
  scored: ScoredPlan;
  live: PlanLive;
}) {
  const kinds = useStepKinds();
  const { open, close } = useModal();
  const groups = [...new Set(kinds.map((k) => k.group))];
  const replace = (steps: PlanStep[]) => savePlan({ ...plan, steps });
  return (
    <Stack gap="related-compact">
      {scored.steps.map((s, i) => {
        const def = stepKind(s.step.kind);
        return (
          <StepCard
            key={s.step.id}
            index={i}
            scored={s}
            current={false}
            live={live}
            planning
            onEdit={
              def
                ? () => {
                    const id = open(
                      <EditStep
                        def={def}
                        step={s.step}
                        onSave={(step) => {
                          replace(
                            plan.steps.map((x) =>
                              x.id === step.id ? step : x,
                            ),
                          );
                          close(id);
                        }}
                        onRemove={() => {
                          replace(plan.steps.filter((x) => x.id !== s.step.id));
                          close(id);
                        }}
                        onCancel={() => close(id)}
                      />,
                      { title: def.name },
                    );
                  }
                : undefined
            }
          />
        );
      })}
      {groups.map((g) => (
        <Stack key={g ?? "core"} gap="related-dense">
          {g === undefined ? <span>Add step</span> : <span>{g}</span>}
          <Inline gap="related-dense" wrap>
            {kinds
              .filter((k) => k.group === g)
              .map((k) => (
                <Button
                  key={k.id}
                  variant="ghost"
                  onClick={() =>
                    replace([
                      ...plan.steps,
                      newStep(k, freshStepId(plan, k.id)),
                    ])
                  }
                >
                  {`+ ${k.name}`}
                </Button>
              ))}
          </Inline>
        </Stack>
      ))}
    </Stack>
  );
}

function EditStep({
  def,
  step,
  onSave,
  onRemove,
  onCancel,
}: {
  def: PlanStepKind;
  step: PlanStep;
  onSave: (step: PlanStep) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const { open, close } = useModal();
  const [intents, setIntents] = useState<readonly PlanIntent[]>(step.intents);
  const [text, setText] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.keys(def.inputs).map((k) => [k, shown(def, k, step.inputs[k])]),
    ),
  );
  const values = Object.fromEntries(
    Object.keys(def.inputs).map((k) => [k, parsed(def, k, text[k] ?? "")]),
  );
  const invalid = Object.values(values).some(
    (v) => v === undefined || v === "",
  );
  return (
    <Stack gap="related">
      {Object.entries(def.inputs).map(([k, input]) => (
        <TextField
          key={k}
          label={input.unit ? `${input.label} (${input.unit})` : input.label}
          value={text[k] ?? ""}
          onChange={(v) => setText((t) => ({ ...t, [k]: v }))}
          invalid={values[k] === undefined ? "Not a number" : undefined}
        />
      ))}
      <Stack gap="related-dense">
        {intents.map((intent, i) => (
          <Grid
            key={`${intent.group}-${intent.label}-${triggerText(intent.trigger)}`}
            cols="auto 1fr auto auto"
            gap="related-compact"
            align="center"
          >
            <Tag label={`AG${intent.group}`} name />
            <span>{intent.label}</span>
            <span>{triggerText(intent.trigger)}</span>
            <Button
              variant="ghost"
              onClick={() => setIntents(intents.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </Grid>
        ))}
        <Inline gap="related-compact">
          <Button
            variant="ghost"
            onClick={() => {
              const id = open(
                <EditIntent
                  onSave={(intent) => {
                    setIntents([...intents, intent]);
                    close(id);
                  }}
                  onCancel={() => close(id)}
                />,
                { title: "Add intent" },
              );
            }}
          >
            + Intent
          </Button>
        </Inline>
      </Stack>
      <Inline gap="related-compact">
        <Button variant="ghost" onClick={onRemove}>
          Remove step
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={invalid}
          disabledReason="Every input needs a value"
          onClick={() => {
            const inputs = values as Record<string, number | string>;
            onSave({
              ...step,
              inputs,
              intents,
              needsDv: def.needsDv?.(inputs) ?? step.needsDv,
            });
          }}
        >
          Save
        </Button>
      </Inline>
    </Stack>
  );
}

type When = "time" | "altitude-above" | "altitude-below" | "apoapsis-above";

const WHEN_LABEL: Record<When, string> = {
  time: "At a time",
  "altitude-above": "Altitude ≥",
  "altitude-below": "Altitude ≤",
  "apoapsis-above": "Apoapsis ≥",
};

/** An action group the step fires, at a mission time or when a value crosses a threshold. */
function EditIntent({
  onSave,
  onCancel,
}: {
  onSave: (intent: PlanIntent) => void;
  onCancel: () => void;
}) {
  const [group, setGroup] = useState("1");
  const [label, setLabel] = useState("");
  const [when, setWhen] = useState<When>("altitude-above");
  const [at, setAt] = useState("");
  const g = Number(group);
  const n = Number(at);
  const ok =
    Number.isInteger(g) &&
    g >= 1 &&
    Number.isFinite(n) &&
    at.trim() !== "" &&
    label.trim() !== "";
  return (
    <Stack gap="related">
      <TextField label="Action group" value={group} onChange={setGroup} />
      <TextField label="Action" value={label} onChange={setLabel} />
      <Inline gap="related-dense" wrap>
        {(Object.keys(WHEN_LABEL) as When[]).map((w) => (
          <ToggleButton key={w} pressed={when === w} onClick={() => setWhen(w)}>
            {WHEN_LABEL[w]}
          </ToggleButton>
        ))}
      </Inline>
      <TextField
        label={when === "time" ? "Seconds after lift-off" : "Kilometres"}
        value={at}
        onChange={setAt}
      />
      <Inline gap="related-compact">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!ok}
          disabledReason="Needs an action group, an action and a value"
          onClick={() =>
            onSave({
              group: g,
              label: label.trim(),
              trigger:
                when === "time"
                  ? { kind: "time", at: n }
                  : {
                      kind: "value",
                      quantity:
                        when === "apoapsis-above" ? "apoapsis" : "altitude",
                      op: when === "altitude-below" ? "<=" : ">=",
                      value: n * 1000,
                    },
            })
          }
        >
          Save
        </Button>
      </Inline>
    </Stack>
  );
}
