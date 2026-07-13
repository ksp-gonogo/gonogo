import {
  Field,
  FieldHint,
  FieldLabel,
  GhostButton,
  Input,
  PrimaryButton,
  Select,
  Textarea,
} from "@ksp-gonogo/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { parseCharPosition } from "../parsers/charPosition";
import { useSerialDeviceService } from "../SerialDeviceContext";
import type { DeviceInput } from "../types";

interface Props {
  /**
   * The current draft inputs from the editor — start the wizard with these
   * so re-opening it preserves any in-progress assignments. Buttons keep
   * their length; analogs default to length 3 if unset.
   */
  inputs: readonly DeviceInput[];
  onApply: (next: DeviceInput[]) => void;
  onClose: () => void;
}

type CaptureSource = "paste" | string; // "paste" or a deviceId

interface Selection {
  inputIdx: number;
  start: number;
  end: number; // exclusive
}

/**
 * Inline wizard for the char-position parser. Three steps:
 *   1. Capture a sample line — paste one in, or stream the latest from
 *      a connected web-serial device.
 *   2. For each declared input, drag-select its character region. The
 *      live preview shows what the parser would emit using the current
 *      offset/length (and min/max for analogs) so the user can sanity-
 *      check before saving.
 *   3. (analogs only) "Wiggle" each axis through its full range; the
 *      wizard records the raw min/max from the selected slice. Skip
 *      and the manual min/max stays in effect.
 *
 * The wizard mutates a local copy of the inputs and only writes back
 * via `onApply` on Save, so closing without saving discards everything.
 */
export function CalibrateWizard({
  inputs: initialInputs,
  onApply,
  onClose,
}: Readonly<Props>) {
  const svc = useSerialDeviceService();

  const devices = useMemo(
    () => svc.getDevices().filter((d) => svc.getStatus(d.id) === "connected"),
    [svc],
  );

  const [source, setSource] = useState<CaptureSource>(
    devices[0]?.id ?? "paste",
  );
  const [pasted, setPasted] = useState("");
  const [latestLine, setLatestLine] = useState<string>("");
  const [draft, setDraft] = useState<DeviceInput[]>(() =>
    initialInputs.map((i) => ({ ...i })),
  );
  const [activeInputIdx, setActiveInputIdx] = useState<number | null>(null);
  const [calibratingIdx, setCalibratingIdx] = useState<number | null>(null);

  // Per-input range capture state (raw integer min/max from the slice).
  const rangeCapture = useRef<Map<number, { min: number; max: number }>>(
    new Map(),
  );

  // Live capture from a connected device.
  useEffect(() => {
    if (source === "paste") return;
    const transport = svc.getTransport(source);
    if (!transport?.onRawLine) return;
    return transport.onRawLine((line) => {
      setLatestLine(line);
    });
  }, [svc, source]);

  // While calibrating an analog input, watch raw lines and accumulate raw
  // min/max for the currently-selected slice.
  useEffect(() => {
    if (calibratingIdx === null) return;
    const idx = calibratingIdx;
    const input = draft[idx];
    if (!input || input.kind !== "analog") return;
    const offset = input.offset;
    const length = input.length;
    if (offset === undefined || length === undefined) return;
    if (source === "paste") return;
    const transport = svc.getTransport(source);
    if (!transport?.onRawLine) return;
    rangeCapture.current.set(idx, {
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
    });
    return transport.onRawLine((line) => {
      const slice = line.slice(offset, offset + length);
      const raw = Number.parseInt(slice, 10);
      if (Number.isNaN(raw)) return;
      const cur = rangeCapture.current.get(idx) ?? {
        min: Number.POSITIVE_INFINITY,
        max: Number.NEGATIVE_INFINITY,
      };
      const next = {
        min: Math.min(cur.min, raw),
        max: Math.max(cur.max, raw),
      };
      rangeCapture.current.set(idx, next);
      // Force a re-render so the live readout updates.
      setLatestLine(line);
    });
  }, [svc, source, calibratingIdx, draft]);

  const sampleLine =
    source === "paste" ? (pasted.split("\n").pop() ?? "") : latestLine;

  const updateInput = (idx: number, patch: Partial<DeviceInput>) => {
    setDraft((prev) =>
      prev.map((i, k) => (k === idx ? { ...i, ...patch } : i)),
    );
  };

  const handleCharClick = (col: number, shiftKey: boolean) => {
    if (activeInputIdx === null) return;
    const input = draft[activeInputIdx];
    if (!input) return;
    if (!shiftKey || input.offset === undefined || input.length === undefined) {
      updateInput(activeInputIdx, { offset: col, length: 1 });
    } else {
      const start = Math.min(input.offset, col);
      const end = Math.max(input.offset + input.length - 1, col);
      updateInput(activeInputIdx, {
        offset: start,
        length: end - start + 1,
      });
    }
  };

  const startRangeCapture = (idx: number) => {
    rangeCapture.current.delete(idx);
    setCalibratingIdx(idx);
  };

  const finishRangeCapture = (idx: number) => {
    const captured = rangeCapture.current.get(idx);
    if (
      captured &&
      Number.isFinite(captured.min) &&
      captured.max > captured.min
    ) {
      updateInput(idx, { min: captured.min, max: captured.max });
    }
    setCalibratingIdx(null);
  };

  const selections: Selection[] = draft
    .map((input, inputIdx) =>
      input.offset !== undefined && input.length !== undefined
        ? { inputIdx, start: input.offset, end: input.offset + input.length }
        : null,
    )
    .filter((s): s is Selection => s !== null);

  const liveEvents = useMemo(() => {
    if (!sampleLine) return new Map<string, boolean | number>();
    const events = parseCharPosition(sampleLine, draft);
    const map = new Map<string, boolean | number>();
    for (const e of events) map.set(e.inputId, e.value);
    return map;
  }, [sampleLine, draft]);

  return (
    <Wrap>
      <Header>Calibrate from sample</Header>
      <Field>
        <FieldLabel htmlFor="cal-source">Sample source</FieldLabel>
        <Select
          id="cal-source"
          value={source}
          onChange={(e) => setSource(e.target.value as CaptureSource)}
        >
          <option value="paste">Paste a line</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              Live: {d.name}
            </option>
          ))}
        </Select>
        {source === "paste" && (
          <Textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Paste one line of raw output from the device. The last newline-terminated line wins."
            rows={2}
          />
        )}
        {source !== "paste" && devices.length === 0 && (
          <FieldHint>
            Connect a web-serial device first to stream raw lines.
          </FieldHint>
        )}
        {source !== "paste" && !sampleLine && (
          <FieldHint>Waiting for the device to send a line...</FieldHint>
        )}
      </Field>

      {sampleLine && (
        <SampleViewer>
          <Ruler>
            {Array.from(sampleLine).map((_, col) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: column position IS the identity here
              <RulerTick key={col}>{col % 5 === 0 ? col : ""}</RulerTick>
            ))}
          </Ruler>
          <SampleLine>
            {Array.from(sampleLine).map((ch, col) => {
              const sel = selections.find((s) => col >= s.start && col < s.end);
              const isActive =
                activeInputIdx !== null && sel?.inputIdx === activeInputIdx;
              return (
                <Char
                  // biome-ignore lint/suspicious/noArrayIndexKey: column position IS the identity here
                  key={col}
                  type="button"
                  onClick={(e) => handleCharClick(col, e.shiftKey)}
                  $highlighted={sel !== undefined}
                  $active={isActive}
                  aria-label={`Column ${col}: '${ch}'`}
                >
                  {ch === " " ? "·" : ch}
                </Char>
              );
            })}
          </SampleLine>
          <Hint>
            Pick an input below, then click a column to set its offset; shift-
            click another column to extend the length to that position.
          </Hint>
        </SampleViewer>
      )}

      <InputsList>
        {draft.map((input, idx) => {
          const live = liveEvents.get(input.id);
          const isActive = activeInputIdx === idx;
          const isCalibrating = calibratingIdx === idx;
          const captured = rangeCapture.current.get(idx);
          return (
            <InputRow key={input.id} $active={isActive}>
              <InputLabel>
                <strong>{input.name || input.id}</strong>
                <InputKind>{input.kind}</InputKind>
                <Select
                  aria-label={`Set as active calibration target for ${input.id}`}
                  value={isActive ? "active" : ""}
                  onChange={(e) =>
                    setActiveInputIdx(e.target.value === "active" ? idx : null)
                  }
                  style={{ marginLeft: "auto", width: "auto" }}
                >
                  <option value="">{isActive ? "✓ active" : "select"}</option>
                  <option value="active">Make active</option>
                </Select>
              </InputLabel>
              <Slice>
                offset= <SliceVal>{input.offset ?? "?"}</SliceVal>, length={" "}
                <SliceVal>{input.length ?? "?"}</SliceVal>
                {input.kind === "analog" && (
                  <>
                    , min=<SliceVal>{input.min ?? "?"}</SliceVal>, max=
                    <SliceVal>{input.max ?? "?"}</SliceVal>
                  </>
                )}
              </Slice>
              <LivePreview>
                live:{" "}
                <SliceVal>
                  {typeof live === "number"
                    ? live.toFixed(2)
                    : typeof live === "boolean"
                      ? live
                        ? "ON"
                        : "off"
                      : "—"}
                </SliceVal>
              </LivePreview>

              {input.kind === "analog" && source !== "paste" && (
                <RangeRow>
                  {!isCalibrating ? (
                    <GhostButton
                      type="button"
                      onClick={() => startRangeCapture(idx)}
                      disabled={
                        input.offset === undefined || input.length === undefined
                      }
                    >
                      Capture range...
                    </GhostButton>
                  ) : (
                    <>
                      <Capturing>
                        Wiggle {input.name || input.id} through its full range.
                        Captured raw:{" "}
                        <SliceVal>
                          {captured && Number.isFinite(captured.min)
                            ? `${captured.min} – ${captured.max}`
                            : "(none yet)"}
                        </SliceVal>
                      </Capturing>
                      <PrimaryButton
                        type="button"
                        onClick={() => finishRangeCapture(idx)}
                      >
                        Done
                      </PrimaryButton>
                    </>
                  )}
                </RangeRow>
              )}

              {input.kind === "analog" && source === "paste" && (
                <ManualRange>
                  <Field>
                    <FieldLabel htmlFor={`cal-min-${idx}`}>Min</FieldLabel>
                    <Input
                      id={`cal-min-${idx}`}
                      type="number"
                      value={input.min ?? ""}
                      onChange={(e) =>
                        updateInput(idx, { min: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`cal-max-${idx}`}>Max</FieldLabel>
                    <Input
                      id={`cal-max-${idx}`}
                      type="number"
                      value={input.max ?? ""}
                      onChange={(e) =>
                        updateInput(idx, { max: Number(e.target.value) })
                      }
                    />
                  </Field>
                </ManualRange>
              )}
            </InputRow>
          );
        })}
      </InputsList>

      <Actions>
        <GhostButton onClick={onClose}>Cancel</GhostButton>
        <PrimaryButton onClick={() => onApply(draft)}>Apply</PrimaryButton>
      </Actions>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 4px;
  background: var(--color-surface-raised);
`;

const Header = styled.h4`
  margin: 0;
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-faint);
`;

const SampleViewer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  background: var(--color-surface-app);
  border-radius: 4px;
  overflow-x: auto;
`;

const Ruler = styled.div`
  display: flex;
  font-family: var(--font-mono, monospace);
  font-size: 9px;
  color: var(--color-text-faint);
`;

const RulerTick = styled.span`
  width: 14px;
  text-align: center;
  flex-shrink: 0;
`;

const SampleLine = styled.div`
  display: flex;
  font-family: var(--font-mono, monospace);
  font-size: 14px;
`;

const Char = styled.button<{ $highlighted: boolean; $active: boolean }>`
  width: 14px;
  height: 22px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  background: ${({ $highlighted, $active }) =>
    $active
      ? "var(--color-status-info-bg)"
      : $highlighted
        ? "var(--color-border-subtle)"
        : "transparent"};
  color: ${({ $highlighted }) =>
    $highlighted ? "var(--color-status-info-fg)" : "var(--color-text-primary)"};
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
  text-align: center;

  &:hover {
    background: var(--color-border-strong);
  }
`;

const Hint = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
`;

const InputsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const InputRow = styled.div<{ $active: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border-radius: 3px;
  border: 1px solid
    ${({ $active }) =>
      $active ? "var(--color-status-info-fg)" : "var(--color-border-subtle)"};
  background: var(--color-surface-panel);
`;

const InputLabel = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-sm);
`;

const InputKind = styled.span`
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-faint);
`;

const Slice = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-dim);
`;

const SliceVal = styled.span`
  font-family: var(--font-mono, monospace);
  color: var(--color-text-primary);
`;

const LivePreview = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-status-info-fg);
`;

const RangeRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
`;

const Capturing = styled.div`
  flex: 1;
  font-size: var(--font-size-xs);
  color: var(--color-status-warning-bg);
`;

const ManualRange = styled.div`
  display: flex;
  gap: 8px;
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;
