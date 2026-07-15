import { Fab, JoystickIcon, useModal } from "@ksp-gonogo/ui";
import styled from "styled-components";
import {
  type SerialAggregateStatus,
  SerialDeviceProvider,
  useSerialAggregateStatus,
  useSerialDeviceService,
} from "./SerialDeviceContext";
import { SerialDevicesMenu } from "./SerialDevicesMenu";

/**
 * Joystick FAB — opens the Input Devices management modal (user-facing
 * name; the package/component/hook names underneath stay "Serial" — see
 * CLAUDE.md's Serial Input Platform section). Reveals with the FAB cluster
 * on hover. A small status dot appears on the FAB when any registered
 * web-serial device is dropped or errored, so the operator notices a
 * mid-session disconnect without having to open the menu.
 */
export function SerialFab() {
  const { open } = useModal();
  // The modal portal renders its content outside the SerialDeviceProvider's
  // React tree, so wrap the modal content with a fresh provider bound to the
  // service captured here at the call site.
  const service = useSerialDeviceService();
  const aggregate = useSerialAggregateStatus();

  function handleClick() {
    open(
      <SerialDeviceProvider service={service}>
        <SerialDevicesMenu />
      </SerialDeviceProvider>,
      { title: "Input Devices" },
    );
  }

  const tooltip = describe(aggregate);

  return (
    <Fab
      bottom={84}
      onClick={handleClick}
      aria-label={`Manage input devices${tooltip ? ` (${tooltip})` : ""}`}
      title={tooltip ?? "Input devices"}
    >
      <JoystickIcon />
      {(aggregate === "partial" || aggregate === "error") && (
        <StatusDot $tone={aggregate} aria-hidden="true" />
      )}
    </Fab>
  );
}

function describe(status: SerialAggregateStatus): string | null {
  switch (status) {
    case "error":
      return "A device errored — open menu";
    case "partial":
      return "A device is disconnected — open menu";
    case "connected":
      return "All devices connected";
    default:
      return null;
  }
}

const StatusDot = styled.span<{ $tone: "partial" | "error" }>`
  position: absolute;
  top: 4px;
  right: 4px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: ${({ $tone }) =>
    $tone === "error"
      ? "var(--color-status-nogo-bg)"
      : "var(--color-status-warning-bg)"};
  border: 2px solid var(--color-surface-raised);
  pointer-events: none;
`;
