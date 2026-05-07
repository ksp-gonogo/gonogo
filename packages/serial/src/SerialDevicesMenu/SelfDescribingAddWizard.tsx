import { logger } from "@gonogo/logger";
import {
  Field,
  FieldHint,
  FieldLabel,
  GhostButton,
  Input,
  PrimaryButton,
} from "@gonogo/ui";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { useSerialDeviceService } from "../SerialDeviceContext";
import type { DeviceType } from "../types";

interface Props {
  onClose: () => void;
}

type Step =
  | { kind: "picking" }
  | { kind: "connecting"; deviceId: string; typeId: string }
  | { kind: "awaiting"; deviceId: string; typeId: string }
  | { kind: "naming"; deviceId: string; typeId: string }
  | { kind: "error"; message: string; cleanup?: () => Promise<void> };

const RANDOM_SUFFIX_LEN = 6;

function randomSuffix(): string {
  return Math.random()
    .toString(36)
    .slice(2, 2 + RANDOM_SUFFIX_LEN);
}

/**
 * Pair a self-describing (json-state) controller in one go: pick a port
 * with the browser, auto-create a device-authored type + instance behind
 * the scenes, connect, and wait for the device to either announce a
 * schema or send any input event so we know it's alive. Once confirmed
 * the user names it; the type is hidden from the type editor since it's
 * fully managed by this device.
 */
export function SelfDescribingAddWizard({ onClose }: Readonly<Props>) {
  const svc = useSerialDeviceService();
  const [step, setStep] = useState<Step>({ kind: "picking" });
  const [name, setName] = useState("Self-describing controller");
  // Keep teardown closures pinned across renders so cancel paths can run
  // even while the active step has changed underneath us.
  const cleanupRef = useRef<(() => Promise<void>) | null>(null);

  // While in awaiting, listen for the first sign of life: schema or input.
  useEffect(() => {
    if (step.kind !== "awaiting") return;
    const transport = svc.getTransport(step.deviceId);
    if (!transport) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setStep({
        kind: "naming",
        deviceId: step.deviceId,
        typeId: step.typeId,
      });
    };
    const offSchema = transport.onSchema?.(finish);
    const offInput = transport.onInput(finish);
    return () => {
      offSchema?.();
      offInput();
    };
  }, [svc, step]);

  const cancel = async () => {
    const cleanup = cleanupRef.current;
    cleanupRef.current = null;
    if (cleanup) await cleanup();
    onClose();
  };

  const startPick = async () => {
    if (typeof navigator === "undefined" || !navigator.serial?.requestPort) {
      setStep({ kind: "error", message: "Web Serial isn't available." });
      return;
    }
    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort();
    } catch (err) {
      // User-cancelled the browser's port picker — return to the start
      // without raising; bail entirely if it's a real error.
      logger.debug("[SelfDescribingAddWizard] requestPort cancelled", {
        err: String(err),
      });
      onClose();
      return;
    }

    const portInfo = port.getInfo();
    const typeId = `auto-${randomSuffix()}`;
    const deviceId = `sd-${randomSuffix()}`;
    const autoType: DeviceType = {
      id: typeId,
      name: "(self-describing)",
      parser: "json-state",
      inputs: [],
      authoredBy: "device",
    };
    svc.upsertDeviceType(autoType);
    svc.addDevice({
      id: deviceId,
      name,
      typeId,
      transport: "web-serial",
      portInfo: {
        vendorId: portInfo.usbVendorId,
        productId: portInfo.usbProductId,
      },
    });

    cleanupRef.current = async () => {
      // Best-effort rollback if the user cancels mid-flow.
      await svc.removeDevice(deviceId).catch(() => {});
    };

    setStep({ kind: "connecting", deviceId, typeId });

    try {
      await svc.connect(deviceId, { port });
    } catch (err) {
      setStep({
        kind: "error",
        message: `Connect failed: ${String(err)}`,
        cleanup: cleanupRef.current ?? undefined,
      });
      return;
    }
    setStep({ kind: "awaiting", deviceId, typeId });
  };

  const finishNaming = () => {
    if (step.kind !== "naming") return;
    svc.updateDevice(step.deviceId, { name: name.trim() || "Controller" });
    cleanupRef.current = null; // commit — don't tear down on close
    onClose();
  };

  return (
    <Wrap>
      <Header>Add self-describing controller</Header>

      {step.kind === "picking" && (
        <>
          <FieldHint>
            Pair a controller that announces its own inputs over JSON
            (json-state parser). The browser will prompt you to pick the USB
            port; we handle the type registration automatically.
          </FieldHint>
          <Actions>
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <PrimaryButton onClick={() => void startPick()}>
              Pick USB port…
            </PrimaryButton>
          </Actions>
        </>
      )}

      {step.kind === "connecting" && (
        <Status role="status" aria-live="polite">
          Connecting…
        </Status>
      )}

      {step.kind === "awaiting" && (
        <>
          <Status role="status" aria-live="polite">
            <PulseDot /> Press a button or move a control on your controller…
          </Status>
          <FieldHint>
            We're listening for a schema announcement or any input event so we
            know the device is talking. Cancel rolls everything back.
          </FieldHint>
          <Actions>
            <GhostButton onClick={() => void cancel()}>Cancel</GhostButton>
          </Actions>
        </>
      )}

      {step.kind === "naming" && (
        <>
          <Status role="status" aria-live="polite">
            ✓ Got input — give the controller a name.
          </Status>
          <Field>
            <FieldLabel htmlFor="sd-name">Name</FieldLabel>
            <Input
              id="sd-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>
          <Actions>
            <GhostButton onClick={() => void cancel()}>Cancel</GhostButton>
            <PrimaryButton onClick={finishNaming}>Save</PrimaryButton>
          </Actions>
        </>
      )}

      {step.kind === "error" && (
        <>
          <ErrorBox role="alert">{step.message}</ErrorBox>
          <Actions>
            <GhostButton
              onClick={async () => {
                await step.cleanup?.();
                onClose();
              }}
            >
              Close
            </GhostButton>
          </Actions>
        </>
      )}
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

const Status = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-sm);
  color: var(--color-status-info-fg);
`;

const PulseDot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-status-info-fg);
  box-shadow: 0 0 6px rgba(124, 204, 255, 0.7);
  flex-shrink: 0;

  @media (prefers-reduced-motion: no-preference) {
    animation: sd-add-pulse 1.2s ease-in-out infinite;
  }

  @keyframes sd-add-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }
`;

const ErrorBox = styled.div`
  background: var(--color-status-nogo-fg);
  border-radius: 3px;
  padding: 8px;
  font-size: var(--font-size-xs);
  color: var(--color-status-nogo-bg);
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;
