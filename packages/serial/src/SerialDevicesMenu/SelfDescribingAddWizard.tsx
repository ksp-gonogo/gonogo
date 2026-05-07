import { logger } from "@gonogo/logger";
import {
  Field,
  FieldHint,
  FieldLabel,
  GhostButton,
  Input,
  PrimaryButton,
  Select,
} from "@gonogo/ui";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { useSerialDeviceService } from "../SerialDeviceContext";
import type { DeviceType } from "../types";

const trace = logger.tag("serial:wizard");

// 115200 is the modern Arduino-class default; 9600 is legacy. The other
// rates are uncommon but not unheard of — surface them rather than make
// users edit JSON. Wrong baud → garbled bytes → no newlines surface →
// wizard hangs at "press a button" indefinitely.
const COMMON_BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400] as const;
const DEFAULT_BAUD_RATE = 115200;

interface Props {
  onClose: () => void;
}

type Step =
  | { kind: "picking" }
  | { kind: "connecting"; deviceId: string; typeId: string }
  | { kind: "awaiting"; deviceId: string; typeId: string }
  | { kind: "naming"; deviceId: string; typeId: string }
  | { kind: "error"; message: string; cleanup?: () => Promise<void> }
  /**
   * The picked port matches the VID/PID of a device already registered
   * on this screen — almost always because it was paired the manual way
   * and autoReconnect grabbed it on screen mount, holding the port open.
   * Offering "remove & retry" lets the user migrate to self-describing
   * without going through the type editor first.
   */
  | { kind: "conflict"; existingId: string; existingName: string };

const RANDOM_SUFFIX_LEN = 6;

function randomSuffix(): string {
  return Math.random()
    .toString(36)
    .slice(2, 2 + RANDOM_SUFFIX_LEN);
}

type DeviceServiceShape = ReturnType<typeof useSerialDeviceService>;

/**
 * Find a saved web-serial device that already claims the picked port.
 *
 * Two strategies, in order:
 *   1. Port identity. If any existing managed transport's live SerialPort
 *      is the same JS object the browser just handed us, that's a
 *      collision — reliable even when VID/PID is 0 or undefined.
 *   2. VID/PID match, but ONLY when the picked port has a real
 *      `usbVendorId`. Otherwise `undefined === undefined` would falsely
 *      collapse every VID-less device into a single match.
 *
 * Strategy 1 misses across screen reloads (port references aren't
 * persisted), which is fine — autoReconnect repopulates the live port
 * before the user can hit the wizard again.
 */
function findConflict(
  svc: DeviceServiceShape,
  port: SerialPort,
  portInfo: { usbVendorId?: number; usbProductId?: number },
) {
  // Identity match first — most reliable.
  for (const d of svc.getDevices()) {
    if (d.transport !== "web-serial") continue;
    const transport = svc.getTransport(d.id) as
      | { getPort?: () => SerialPort | null }
      | undefined;
    if (transport?.getPort?.() === port) return d;
  }
  // VID/PID fallback for the case where the existing device's transport
  // hasn't been opened yet (e.g. autoReconnect hadn't fired).
  if (portInfo.usbVendorId === undefined) return undefined;
  return svc
    .getDevices()
    .find(
      (d) =>
        d.transport === "web-serial" &&
        d.portInfo?.vendorId === portInfo.usbVendorId &&
        d.portInfo?.productId === portInfo.usbProductId,
    );
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
  const [baudRate, setBaudRate] = useState<number>(DEFAULT_BAUD_RATE);
  // Keep teardown closures pinned across renders so cancel paths can run
  // even while the active step has changed underneath us.
  const cleanupRef = useRef<(() => Promise<void>) | null>(null);

  // If the user closes the menu (or otherwise unmounts the wizard) before
  // committing the new device, roll back the auto-created type + instance
  // so the next attempt doesn't hit "port already open" on the same VID/PID.
  useEffect(() => {
    return () => {
      const cleanup = cleanupRef.current;
      cleanupRef.current = null;
      if (cleanup) void cleanup();
    };
  }, []);

  // While in awaiting, listen for any sign of life: schema announcement,
  // parsed input event, OR raw line. The first two only fire if the device
  // already speaks json-state cleanly; raw lines catch the case where the
  // device IS streaming but the parser hasn't recognised it yet — without
  // that fallback the wizard hangs on devices the user knows are talking.
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
    const offRaw = transport.onRawLine?.(finish);
    return () => {
      offSchema?.();
      offInput();
      offRaw?.();
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
    trace.debug("wizard: pre-connect conflict check", {
      portVid: portInfo.usbVendorId,
      portPid: portInfo.usbProductId,
      existingDevices: svc.getDevices().map((d) => ({
        id: d.id,
        name: d.name,
        transport: d.transport,
        portInfo: d.portInfo,
      })),
    });

    // If this VID/PID is already registered on this screen, the manual
    // device's transport almost certainly has the port open — the next
    // port.open() will throw InvalidStateError. Catch it up front so the
    // user gets a path forward instead of a generic "port already open"
    // dump in the console.
    const conflict = findConflict(svc, port, portInfo);
    if (conflict) {
      setStep({
        kind: "conflict",
        existingId: conflict.id,
        existingName: conflict.name,
      });
      return;
    }

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
      baudRate,
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
      // Recovery for the specific "port already open" failure: roll back
      // the device we just added (so we don't leave a half-paired ghost
      // referring to a port we don't actually own) and try once more to
      // route to the conflict step. Reaching here means the upfront
      // findConflict missed something — most often a VID-less port that
      // matches an existing VID-less device, or a race where the existing
      // device opened the port between getDevices() and connect().
      const isPortOpen =
        err instanceof Error && err.name === "InvalidStateError";
      if (isPortOpen) {
        await svc.removeDevice(deviceId).catch(() => {});
        cleanupRef.current = null;
        const after = findConflict(svc, port, portInfo);
        trace.debug("wizard: port-open recovery", {
          foundExisting: !!after,
          existingId: after?.id,
        });
        if (after) {
          setStep({
            kind: "conflict",
            existingId: after.id,
            existingName: after.name,
          });
          return;
        }
        setStep({
          kind: "error",
          message:
            "This USB port is already open, but no existing pairing on this screen claims it. Another tab or app may have it — close other consumers or unplug + replug the controller, then retry.",
        });
        return;
      }
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
          <Field>
            <FieldLabel htmlFor="sd-baud">Baud rate</FieldLabel>
            <Select
              id="sd-baud"
              value={String(baudRate)}
              onChange={(e) => setBaudRate(Number(e.target.value))}
            >
              {COMMON_BAUD_RATES.map((rate) => (
                <option key={rate} value={rate}>
                  {rate}
                  {rate === DEFAULT_BAUD_RATE ? " (Arduino default)" : ""}
                </option>
              ))}
            </Select>
            <FieldHint>
              Has to match the rate the controller is sending at. Wrong rate →
              garbled bytes → wizard never progresses past "press a button".
            </FieldHint>
          </Field>
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

      {step.kind === "conflict" && (
        <>
          <ConflictBox role="alert">
            That USB port is already paired on this screen as{" "}
            <strong>{step.existingName}</strong>. The existing device's
            connection is holding the port open, which is why a fresh pair
            attempt would fail with "port already open".
          </ConflictBox>
          <FieldHint>
            Remove the existing pairing to migrate it to a self-describing
            device, or cancel and use the existing one as-is.
          </FieldHint>
          <Actions>
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <PrimaryButton
              onClick={async () => {
                await svc.removeDevice(step.existingId);
                setStep({ kind: "picking" });
              }}
            >
              Remove existing & retry
            </PrimaryButton>
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

const ConflictBox = styled.div`
  background: var(--color-status-warning-bg);
  border-radius: 3px;
  padding: 8px;
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;
