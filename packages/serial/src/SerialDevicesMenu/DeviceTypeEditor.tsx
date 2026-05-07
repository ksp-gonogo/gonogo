import {
  Button,
  Field,
  FieldHint,
  FieldLabel,
  FormActions,
  GhostButton,
  Input,
  PrimaryButton,
  Select,
} from "@gonogo/ui";
import { useMemo, useState } from "react";
import styled from "styled-components";
import { getSerialRenderStyles } from "../registry";
import type {
  AnalogCurve,
  DeviceInput,
  DeviceInputKind,
  DeviceParserId,
  DeviceType,
} from "../types";
import { CalibrateWizard } from "./CalibrateWizard";
import { ProtocolReferenceButton } from "./ProtocolReferenceModal";

interface Props {
  initial?: DeviceType;
  onCancel: () => void;
  onSave: (type: DeviceType) => void;
}

interface DraftInput extends Partial<DeviceInput> {
  id: string;
  name: string;
  kind: DeviceInputKind;
}

function slug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "device-type"
  );
}

export function DeviceTypeEditor({
  initial,
  onCancel,
  onSave,
}: Readonly<Props>) {
  const renderStyles = useMemo(() => getSerialRenderStyles(), []);

  const [name, setName] = useState(initial?.name ?? "");
  const [parser, setParser] = useState<DeviceParserId>(
    initial?.parser ?? "char-position",
  );
  const [renderStyleId, setRenderStyleId] = useState(
    initial?.renderStyleId ?? "",
  );
  const [inputs, setInputs] = useState<DraftInput[]>(
    (initial?.inputs as DraftInput[] | undefined) ?? [
      { id: "a", name: "A", kind: "button", offset: 1, length: 1 },
    ],
  );

  const isDeviceAuthored = parser === "json-state";
  const [showCalibrate, setShowCalibrate] = useState(false);

  const updateInput = (idx: number, patch: Partial<DraftInput>) => {
    setInputs((prev) =>
      prev.map((input, i) => (i === idx ? { ...input, ...patch } : input)),
    );
  };

  const addInput = () => {
    setInputs((prev) => [
      ...prev,
      {
        id: `input-${prev.length + 1}`,
        name: "",
        kind: "button",
        offset: 0,
        length: 1,
      },
    ]);
  };

  const removeInput = (idx: number) => {
    setInputs((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = () => {
    if (!name.trim()) return;
    const type: DeviceType = {
      id: initial?.id ?? slug(name),
      name: name.trim(),
      parser,
      renderStyleId: renderStyleId || undefined,
      // For json-state types we preserve whatever inputs the device has
      // already reported; the editor doesn't let the user edit them. For
      // new json-state types this starts empty and fills on first connect.
      inputs: isDeviceAuthored
        ? (initial?.inputs ?? [])
        : inputs.map((i) => ({
            id: i.id,
            name: i.name,
            kind: i.kind,
            offset: i.offset,
            length: i.length,
            min: i.min,
            max: i.max,
            deadzone: i.deadzone,
            curve: i.curve,
          })),
      renderStyleConfig: initial?.renderStyleConfig,
      authoredBy: initial?.authoredBy,
    };
    onSave(type);
  };

  return (
    <Wrap>
      <Field>
        <FieldLabel htmlFor="type-name">Type name</FieldLabel>
        <Input
          id="type-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Cockpit Panel"
        />
      </Field>
      <Field>
        <ParserHeader>
          <FieldLabel htmlFor="type-parser">Parser</FieldLabel>
          <ProtocolReferenceButton parser={parser} />
        </ParserHeader>
        <Select
          id="type-parser"
          value={parser}
          onChange={(e) => setParser(e.target.value as DeviceParserId)}
        >
          <option value="char-position">
            Character position (fixed-width)
          </option>
          <option value="json-state">JSON state (self-describing)</option>
        </Select>
        {isDeviceAuthored && (
          <FieldHint>
            Device-authored: the device reports its own inputs and screen on
            connect. You can't edit the input list here.
          </FieldHint>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor="type-render">Render Style</FieldLabel>
        <Select
          id="type-render"
          value={renderStyleId}
          onChange={(e) => setRenderStyleId(e.target.value)}
        >
          <option value="">— none —</option>
          {renderStyles.map((style) => (
            <option key={style.id} value={style.id}>
              {style.name}
            </option>
          ))}
        </Select>
      </Field>

      <InputsHeader>
        <FieldLabel>Inputs</FieldLabel>
        {!isDeviceAuthored && (
          <>
            <Button
              type="button"
              onClick={() => setShowCalibrate((prev) => !prev)}
            >
              {showCalibrate ? "Hide calibrate" : "Calibrate from sample…"}
            </Button>
            <Button type="button" onClick={addInput}>
              + add input
            </Button>
          </>
        )}
      </InputsHeader>
      {!isDeviceAuthored && showCalibrate && (
        <CalibrateWizard
          inputs={inputs as DeviceInput[]}
          onApply={(next) => {
            setInputs(next as DraftInput[]);
            setShowCalibrate(false);
          }}
          onClose={() => setShowCalibrate(false)}
        />
      )}
      {isDeviceAuthored ? (
        <DiscoveredInputs inputs={initial?.inputs ?? []} />
      ) : null}
      {!isDeviceAuthored &&
        inputs.map((input, idx) => (
          <InputRow key={input.id}>
            <SmallField>
              <FieldLabel htmlFor={`input-id-${idx}`}>ID</FieldLabel>
              <Input
                id={`input-id-${idx}`}
                value={input.id}
                onChange={(e) => updateInput(idx, { id: e.target.value })}
              />
            </SmallField>
            <SmallField>
              <FieldLabel htmlFor={`input-name-${idx}`}>Name</FieldLabel>
              <Input
                id={`input-name-${idx}`}
                value={input.name}
                onChange={(e) => updateInput(idx, { name: e.target.value })}
              />
            </SmallField>
            <SmallField>
              <FieldLabel htmlFor={`input-kind-${idx}`}>Kind</FieldLabel>
              <Select
                id={`input-kind-${idx}`}
                value={input.kind}
                onChange={(e) =>
                  updateInput(idx, {
                    kind: e.target.value as DeviceInputKind,
                  })
                }
              >
                <option value="button">button</option>
                <option value="analog">analog</option>
              </Select>
            </SmallField>
            <TinyField>
              <FieldLabel htmlFor={`input-offset-${idx}`}>Offset</FieldLabel>
              <Input
                id={`input-offset-${idx}`}
                type="number"
                value={input.offset ?? ""}
                onChange={(e) =>
                  updateInput(idx, { offset: Number(e.target.value) })
                }
              />
            </TinyField>
            <TinyField>
              <FieldLabel htmlFor={`input-length-${idx}`}>Length</FieldLabel>
              <Input
                id={`input-length-${idx}`}
                type="number"
                value={input.length ?? ""}
                onChange={(e) =>
                  updateInput(idx, { length: Number(e.target.value) })
                }
              />
            </TinyField>
            {input.kind === "analog" && (
              <>
                <TinyField>
                  <FieldLabel htmlFor={`input-min-${idx}`}>Min</FieldLabel>
                  <Input
                    id={`input-min-${idx}`}
                    type="number"
                    value={input.min ?? ""}
                    onChange={(e) =>
                      updateInput(idx, { min: Number(e.target.value) })
                    }
                  />
                </TinyField>
                <TinyField>
                  <FieldLabel htmlFor={`input-max-${idx}`}>Max</FieldLabel>
                  <Input
                    id={`input-max-${idx}`}
                    type="number"
                    value={input.max ?? ""}
                    onChange={(e) =>
                      updateInput(idx, { max: Number(e.target.value) })
                    }
                  />
                </TinyField>
                <TinyField>
                  <FieldLabel htmlFor={`input-deadzone-${idx}`}>
                    Deadzone
                  </FieldLabel>
                  <Input
                    id={`input-deadzone-${idx}`}
                    type="number"
                    step="0.05"
                    min="0"
                    max="0.95"
                    value={input.deadzone ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      updateInput(idx, {
                        deadzone: v === "" ? undefined : Number(v),
                      });
                    }}
                    placeholder="0"
                  />
                </TinyField>
                <TinyField>
                  <FieldLabel htmlFor={`input-curve-${idx}`}>Curve</FieldLabel>
                  <Select
                    id={`input-curve-${idx}`}
                    value={input.curve ?? "linear"}
                    onChange={(e) =>
                      updateInput(idx, {
                        curve: e.target.value as AnalogCurve,
                      })
                    }
                  >
                    <option value="linear">linear</option>
                    <option value="squared">squared</option>
                    <option value="cubic">cubic</option>
                  </Select>
                </TinyField>
              </>
            )}
            <RemoveBtn
              type="button"
              onClick={() => removeInput(idx)}
              aria-label={`Remove input ${input.name || input.id}`}
            >
              ✕
            </RemoveBtn>
          </InputRow>
        ))}

      <FormActions>
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
        <PrimaryButton onClick={handleSave}>Save type</PrimaryButton>
      </FormActions>
    </Wrap>
  );
}

function DiscoveredInputs({ inputs }: Readonly<{ inputs: DeviceInput[] }>) {
  if (inputs.length === 0) {
    return (
      <FieldHint>
        No inputs reported yet. Connect the device — the inputs it announces
        will show up here.
      </FieldHint>
    );
  }
  return (
    <DiscoveredList>
      {inputs.map((input) => (
        <DiscoveredRow key={input.id}>
          <DiscoveredKind>{input.kind}</DiscoveredKind>
          <DiscoveredId>{input.id}</DiscoveredId>
          {input.kind === "analog" && (
            <DiscoveredRange>
              {input.min ?? "?"}–{input.max ?? "?"}
            </DiscoveredRange>
          )}
        </DiscoveredRow>
      ))}
    </DiscoveredList>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const ParserHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const DiscoveredList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const DiscoveredRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-surface-raised);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11px;
`;

const DiscoveredKind = styled.span`
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-size: var(--font-size-xs);
  color: var(--color-text-dim);
  flex: 0 0 52px;
`;

const DiscoveredId = styled.span`
  color: var(--color-text-primary);
  flex: 1 1 auto;
`;

const DiscoveredRange = styled.span`
  color: var(--color-status-info-fg);
  font-size: var(--font-size-xs);
`;

const InputsHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
`;

const InputRow = styled.div`
  display: flex;
  gap: 6px;
  align-items: flex-end;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  border-radius: 4px;
  padding: 6px 8px;
`;

const SmallField = styled(Field)`
  flex: 1 1 80px;
  min-width: 0;
`;

const TinyField = styled(Field)`
  flex: 0 0 56px;
`;

const RemoveBtn = styled.button`
  background: none;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  font-size: 14px;
  padding: 6px;
  &:hover {
    color: var(--color-status-nogo-fg);
  }
`;
