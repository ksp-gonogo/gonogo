import { GhostButton, PrimaryButton, useModal } from "@ksp-gonogo/ui";
import { useEffect, useRef } from "react";
import styled from "styled-components";
import { useSerialDeviceService } from "./SerialDeviceContext";

/**
 * Top-level effect-only component that listens for
 * `onPortRecoveryRequested` and opens a modal when the user's
 * controller has come back but the JS-side SerialPort can't be reopened
 * without a page refresh. Mount inside both `<SerialDeviceProvider>`
 * and `<ModalProvider>`.
 *
 * Only the locked-streams unrecoverable case fires this event — the
 * rest of the hot-plug path adopts silently.
 */
export function SerialPortRecoveryWatcher() {
  const svc = useSerialDeviceService();
  const { open, close } = useModal();
  // Per-device modal id, so if the user replugs twice without dismissing
  // we don't stack duplicate prompts for the same controller.
  const openModalIds = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    return svc.onPortRecoveryRequested((deviceId, deviceName) => {
      if (openModalIds.current.has(deviceId)) return;
      const closeThis = () => {
        const id = openModalIds.current.get(deviceId);
        if (id) {
          close(id);
          openModalIds.current.delete(deviceId);
        }
      };
      const id = open(
        <RecoveryContent
          deviceName={deviceName}
          onLater={closeThis}
          onRefresh={() => {
            window.location.reload();
          }}
        />,
        { title: "Controller reconnect" },
      );
      openModalIds.current.set(deviceId, id);
    });
  }, [svc, open, close]);

  return null;
}

function RecoveryContent({
  deviceName,
  onLater,
  onRefresh,
}: Readonly<{
  deviceName: string;
  onLater: () => void;
  onRefresh: () => void;
}>) {
  return (
    <Wrap>
      <Body>
        <strong>{deviceName}</strong> is plugged back in, but the page needs to
        refresh before it can be used. Web Serial holds the prior session's port
        state on the JS object, and only a fresh page context releases it.
      </Body>
      <Body>
        Refresh keeps your saved devices and dashboard, but discards any unsaved
        app state.
      </Body>
      <Actions>
        <GhostButton onClick={onLater}>Later</GhostButton>
        <PrimaryButton onClick={onRefresh}>Refresh now</PrimaryButton>
      </Actions>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Body = styled.p`
  margin: 0;
  font-size: var(--font-size-sm);
  line-height: 1.5;
  color: var(--color-text-primary);
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;
