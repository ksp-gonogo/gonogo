import { useGameContext } from "@ksp-gonogo/core";
import { Field, FieldLabel, Input } from "@ksp-gonogo/ui";
import {
  type AnchorPoint,
  Box,
  Button,
  ChevronDownIcon,
  Floating,
  Select,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useId, useRef, useState } from "react";
import styled from "styled-components";
import { useGoNoGoHost, useGoNoGoSnapshot } from "./GoNoGoHostContext";
import { onGoLabelOf, useOnGoOptions } from "./onGo";
import {
  MAX_COUNTDOWN_SECONDS,
  MIN_COUNTDOWN_SECONDS,
  pollSettings,
  usePollSettings,
} from "./pollSettings";

/**
 * The main screen's poll settings at the right end of its header: a chip
 * naming what fires at T-0, opening the choice of action, the countdown
 * length and Reset. Also keeps the host service on the saved settings in
 * every scene, so a station that joins hears the right action.
 */
export function PollSettingsControl() {
  const { inFlight } = useGameContext();
  const host = useGoNoGoHost();
  const settings = usePollSettings();
  const options = useOnGoOptions();
  const onGoLabel = onGoLabelOf(options, settings.onGo);

  useEffect(() => {
    host?.setConfig({
      countdownLengthMs: settings.countdownSeconds * 1000,
      onGo: settings.onGo,
      onGoLabel,
    });
  }, [host, settings.countdownSeconds, settings.onGo, onGoLabel]);

  if (!inFlight || !host) return null;
  return <PollSettingsChip onGoLabel={onGoLabel} />;
}

function PollSettingsChip({
  onGoLabel,
}: Readonly<{ onGoLabel: string | null }>) {
  const [anchor, setAnchor] = useState<AnchorPoint | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  const close = (refocus: boolean) => {
    setAnchor(null);
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!anchor) return;
    panelRef.current?.querySelector<HTMLElement>("select")?.focus();
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setAnchor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setAnchor(null);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [anchor]);

  const toggle = () => {
    if (anchor) {
      close(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ x: rect.left, y: rect.bottom });
  };

  return (
    <>
      <Button
        ref={triggerRef}
        size="sm"
        aria-expanded={anchor !== null}
        aria-controls={anchor ? panelId : undefined}
        onClick={toggle}
      >
        <ChipCaption>On go:</ChipCaption>
        <strong>{onGoLabel ?? "Nothing"}</strong>
        <ChevronDownIcon />
      </Button>
      {anchor && (
        <Floating anchor={anchor}>
          <div ref={panelRef} id={panelId}>
            <Box surface="raised" pad="popover" radius="floating" bordered>
              <PollSettingsForm />
            </Box>
          </div>
        </Floating>
      )}
    </>
  );
}

function PollSettingsForm() {
  const host = useGoNoGoHost();
  const snapshot = useGoNoGoSnapshot();
  const settings = usePollSettings();
  const options = useOnGoOptions();
  const [seconds, setSeconds] = useState(String(settings.countdownSeconds));
  const counting = snapshot?.countdown != null;
  const ids = { onGo: useId(), seconds: useId() };

  const commitSeconds = () => {
    const parsed = Number.parseFloat(seconds);
    if (
      Number.isFinite(parsed) &&
      parsed >= MIN_COUNTDOWN_SECONDS &&
      parsed <= MAX_COUNTDOWN_SECONDS
    ) {
      pollSettings.update({ countdownSeconds: parsed });
    } else {
      setSeconds(String(settings.countdownSeconds));
    }
  };

  return (
    <Form>
      <Field>
        <FieldLabel htmlFor={ids.onGo}>On go</FieldLabel>
        <Select
          id={ids.onGo}
          value={settings.onGo}
          disabled={counting}
          onChange={(e) => pollSettings.update({ onGo: e.target.value })}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor={ids.seconds}>Countdown length (s)</FieldLabel>
        <Input
          id={ids.seconds}
          type="number"
          min={MIN_COUNTDOWN_SECONDS}
          max={MAX_COUNTDOWN_SECONDS}
          step={1}
          value={seconds}
          onChange={(e) => setSeconds(e.target.value)}
          onBlur={commitSeconds}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitSeconds();
          }}
        />
      </Field>
      <Button size="sm" onClick={() => host?.reset()}>
        Reset
      </Button>
    </Form>
  );
}

const ChipCaption = styled.span`
  font-weight: 400;
  color: var(--color-text-muted);
`;

const Form = styled.div`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--gap-related);
  min-width: 14rem;
`;
