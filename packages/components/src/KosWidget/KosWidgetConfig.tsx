import type { ConfigComponentProps } from "@gonogo/core";
import type { KosWidgetArg } from "@gonogo/data";
import { useDataSchema } from "@gonogo/data";
import {
  ConfigForm,
  DataKeyPicker,
  Field,
  FieldHint,
  FieldLabel,
  Input,
  PrimaryButton,
} from "@gonogo/ui";
import { useState } from "react";
import styled from "styled-components";
import type { KosWidgetConfig } from "./types";

type ArgType = KosWidgetArg["type"];

function blankArg(type: ArgType): KosWidgetArg {
  if (type === "telemetry") return { type, key: "" };
  if (type === "number") return { type, value: 0 };
  if (type === "boolean") return { type, value: false };
  return { type, value: "" };
}

export function KosWidgetConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<KosWidgetConfig>>) {
  const [cpu, setCpu] = useState(config?.cpu ?? "");
  const [script, setScript] = useState(config?.script ?? "");
  const [title, setTitle] = useState(config?.title ?? "");
  const [mode, setMode] = useState<"command" | "interval">(
    config?.mode ?? "command",
  );
  const [intervalMs, setIntervalMs] = useState(
    String(config?.intervalMs ?? 1000),
  );
  const [args, setArgs] = useState<KosWidgetArg[]>(config?.args ?? []);
  const [helpOpen, setHelpOpen] = useState(false);

  const schema = useDataSchema("data");

  const updateArg = (i: number, next: KosWidgetArg) => {
    setArgs((prev) => prev.map((a, idx) => (idx === i ? next : a)));
  };

  const changeType = (i: number, type: ArgType) => {
    updateArg(i, blankArg(type));
  };

  const handleSave = () => {
    onSave({
      cpu: cpu.trim(),
      script: script.trim(),
      title: title.trim() || undefined,
      mode,
      intervalMs:
        mode === "interval"
          ? Math.max(100, Number.parseInt(intervalMs, 10) || 1000)
          : undefined,
      args,
    });
  };

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="kw-cpu">CPU tagname</FieldLabel>
        <Input
          id="kw-cpu"
          value={cpu}
          placeholder="datastream"
          onChange={(e) => setCpu(e.target.value)}
        />
        <FieldHint>
          The inner tag of the kOS CPU part you want this widget to attach to
          (set via kOS&apos;s part right-click menu in-game).
        </FieldHint>
      </Field>

      <Field>
        <FieldLabel htmlFor="kw-script">Script path</FieldLabel>
        <Input
          id="kw-script"
          value={script}
          placeholder="0:/widget_scripts/my_widget.ks"
          onChange={(e) => setScript(e.target.value)}
        />
        <FieldHint>
          Path to the saved script kOS will run. Prefer the Archive (
          <code>0:/…</code>) — the CPU&apos;s local volume gets wiped on reverts
          and isn&apos;t always populated. Subdirectories are fine; the{" "}
          <code>.ks</code> extension is optional.
        </FieldHint>
      </Field>

      <Field>
        <FieldLabel htmlFor="kw-title">Display title (optional)</FieldLabel>
        <Input
          id="kw-title"
          value={title}
          placeholder="Leave blank to use the script name"
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>

      <Field>
        <FieldLabel>Mode</FieldLabel>
        <ModeRow>
          <label>
            <input
              type="radio"
              name="mode"
              checked={mode === "command"}
              onChange={() => setMode("command")}
            />{" "}
            Command (manual Run button)
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              checked={mode === "interval"}
              onChange={() => setMode("interval")}
            />{" "}
            Interval
          </label>
        </ModeRow>
        {mode === "interval" && (
          <IntervalRow>
            <Input
              id="kw-interval"
              type="number"
              min={100}
              step={100}
              value={intervalMs}
              onChange={(e) => setIntervalMs(e.target.value)}
            />
            <span>ms between runs</span>
          </IntervalRow>
        )}
      </Field>

      <Field>
        <FieldLabel>Arguments</FieldLabel>
        <ArgList>
          {args.map((arg, i) => (
            // Positional args — the index IS the identity (RUN passes them
            // by position), so a stable-uid approach would be misleading.
            // biome-ignore lint/suspicious/noArrayIndexKey: positional-semantic list
            <ArgRow key={`arg-${i}-${arg.type}`}>
              <TypeSelect
                value={arg.type}
                onChange={(e) => changeType(i, e.target.value as ArgType)}
              >
                <option value="number">number</option>
                <option value="string">string</option>
                <option value="boolean">boolean</option>
                <option value="telemetry">telemetry</option>
              </TypeSelect>
              {arg.type === "number" && (
                <Input
                  type="number"
                  value={arg.value}
                  onChange={(e) =>
                    updateArg(i, {
                      type: "number",
                      value: Number.parseFloat(e.target.value) || 0,
                    })
                  }
                />
              )}
              {arg.type === "string" && (
                <Input
                  value={arg.value}
                  onChange={(e) =>
                    updateArg(i, { type: "string", value: e.target.value })
                  }
                />
              )}
              {arg.type === "boolean" && (
                <BoolSelect
                  value={String(arg.value)}
                  onChange={(e) =>
                    updateArg(i, {
                      type: "boolean",
                      value: e.target.value === "true",
                    })
                  }
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </BoolSelect>
              )}
              {arg.type === "telemetry" && (
                <PickerWrap>
                  <DataKeyPicker
                    keys={schema}
                    value={arg.key || null}
                    onChange={(k) =>
                      updateArg(i, { type: "telemetry", key: k ?? "" })
                    }
                    placeholder="Pick a data key…"
                    clearable
                  />
                </PickerWrap>
              )}
              <RemoveButton
                type="button"
                aria-label="Remove argument"
                onClick={() =>
                  setArgs((prev) => prev.filter((_, idx) => idx !== i))
                }
              >
                ×
              </RemoveButton>
            </ArgRow>
          ))}
        </ArgList>
        <AddButton
          type="button"
          onClick={() => setArgs((prev) => [...prev, blankArg("number")])}
        >
          + Add argument
        </AddButton>
        <FieldHint>
          Args are passed positionally to the script:{" "}
          <code>RUNPATH("script", a, b, …).</code>
        </FieldHint>
      </Field>

      <Field>
        <HelpToggle type="button" onClick={() => setHelpOpen((o) => !o)}>
          {helpOpen ? "▾" : "▸"} How to write a widget script
        </HelpToggle>
        {helpOpen && (
          <HelpBox>
            <p>Your kOS script must emit exactly one line in the form:</p>
            <pre>[KOSDATA] key1=value1;key2=value2 [/KOSDATA]</pre>
            <p>
              Values can be numbers, <code>true</code>/<code>false</code>, or
              plain strings (no semicolons). Everything else the script prints
              is ignored by the widget.
            </p>
            <p>Minimal example:</p>
            <pre>
              {`PARAMETER stage.
SET dv TO CALCULATED_DV(stage).
PRINT "[KOSDATA] dv=" + dv + ";stage=" + stage + " [/KOSDATA]".`}
            </pre>
            <p>
              Keep scripts short-lived — no long WAITs or loops. Long-running
              action scripts will block other widgets that target the same CPU,
              and a call that doesn&apos;t emit <code>[KOSDATA]</code> within
              10s is treated as a failure.
            </p>
          </HelpBox>
        )}
      </Field>

      <PrimaryButton onClick={handleSave}>Save</PrimaryButton>
    </ConfigForm>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const ModeRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #bbb;
`;

const IntervalRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #888;
  margin-top: 4px;
`;

const ArgList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const ArgRow = styled.div`
  display: grid;
  grid-template-columns: 110px 1fr 32px;
  gap: 6px;
  align-items: center;
`;

const TypeSelect = styled.select`
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 3px;
  color: #ccc;
  font-family: monospace;
  font-size: 12px;
  padding: 5px 6px;
`;

const BoolSelect = styled(TypeSelect)``;

const PickerWrap = styled.div`
  min-width: 0;
`;

const RemoveButton = styled.button`
  background: none;
  border: 1px solid #3a1a1a;
  border-radius: 3px;
  color: #a55;
  font-size: 14px;
  line-height: 1;
  padding: 2px 6px;
  cursor: pointer;
  &:hover {
    background: #2a1010;
  }
`;

const AddButton = styled.button`
  align-self: flex-start;
  background: none;
  border: 1px dashed #333;
  border-radius: 3px;
  color: #888;
  font-family: monospace;
  font-size: 11px;
  padding: 4px 10px;
  cursor: pointer;
  margin-top: 6px;
  &:hover {
    border-color: #555;
    color: #ccc;
  }
`;

const HelpToggle = styled.button`
  background: none;
  border: none;
  color: #888;
  font-family: monospace;
  font-size: 11px;
  padding: 0;
  cursor: pointer;
  text-align: left;
  &:hover {
    color: #ccc;
  }
`;

const HelpBox = styled.div`
  background: #101010;
  border: 1px solid #2a2a2a;
  border-radius: 3px;
  padding: 10px 12px;
  margin-top: 6px;
  font-family: monospace;
  font-size: 11px;
  color: #aaa;
  line-height: 1.5;

  p {
    margin: 0 0 6px;
  }
  pre {
    background: #080808;
    padding: 6px 8px;
    border-radius: 2px;
    margin: 4px 0 10px;
    font-size: 11px;
    color: #cfe;
    overflow-x: auto;
  }
  code {
    background: #080808;
    padding: 1px 4px;
    border-radius: 2px;
    color: #cfe;
  }
`;
