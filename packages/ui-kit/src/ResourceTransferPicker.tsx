import {
  KspTankFlowMode,
  type TransferPickState,
  type TransferRole,
  type TransferTank,
  transferPickProblem,
  transferSideLabel,
  transferStartArgs,
} from "@ksp-gonogo/sitrep-sdk";
import { useEffect, useId, useState } from "react";
import { Badge } from "./Badge";
import { Button, IconButton } from "./Button";
import { ButtonGroup } from "./ButtonGroup";
import { Input } from "./Form";
import { CloseIcon } from "./Icons";
import { Inline } from "./Inline";
import type { UiResourceTransferModel } from "./resourceTransferModel";
import { Stack } from "./Stack";
import { Tag } from "./Tag";
import { Text } from "./Text";
import { ToggleButton } from "./ToggleButton";
import { Tooltip } from "./Tooltip";
import { Unit } from "./Unit";

const ROLES: readonly { role: TransferRole | null; label: string }[] = [
  { role: null, label: "Off" },
  { role: "from", label: "From" },
  { role: "to", label: "To" },
];

function TankRow({
  tank,
  transfer,
  state,
}: Readonly<{
  tank: TransferTank;
  transfer: UiResourceTransferModel;
  state: TransferPickState;
}>) {
  const { pick, setRole } = state;
  const current: TransferRole | null = pick.from.includes(tank.partId)
    ? "from"
    : pick.to.includes(tank.partId)
      ? "to"
      : null;
  const limit =
    tank.flowMode === KspTankFlowMode.Out
      ? "out only"
      : tank.flowMode === KspTankFlowMode.In
        ? "in only"
        : null;

  return (
    <fieldset style={FIELDSET}>
      <legend style={LEGEND}>{tank.title}</legend>
      <Stack>
        <Inline>
          <Text size="sm">
            <Unit value={tank.amount} decimals={1} /> /{" "}
            <Unit value={tank.capacity} decimals={0} />
          </Text>
          {limit && <Tag label={limit} />}
          {tank.locked && <Badge tone="warn">Locked</Badge>}
        </Inline>
        <ButtonGroup equalWidth={false}>
          {ROLES.map(({ role, label }) => {
            const blocked =
              role === null
                ? undefined
                : transfer.blockReason(tank, role, pick);
            return (
              <ToggleButton
                key={label}
                size="sm"
                pressed={current === role}
                disabled={blocked !== undefined}
                disabledReason={blocked}
                onClick={() => setRole(tank.partId, role)}
              >
                {label}
              </ToggleButton>
            );
          })}
        </ButtonGroup>
      </Stack>
    </fieldset>
  );
}

/**
 * Props for {@link ResourceTransferPicker}.
 *
 * @category Telemetry
 */
export interface ResourceTransferPickerProps {
  /** The model from `resourceTransferModel`. */
  transfer: UiResourceTransferModel;
  /** The pick from `useTransferPick`. Its resource is the one offered. */
  state: TransferPickState;
  /**
   * `list` shows every tank with its choices. `tray` is for a surface where the
   * tanks are picked elsewhere, such as a diagram: it shows what is picked and
   * keeps the tank list behind a disclosure.
   */
  form: "list" | "tray";
  /** Called when a transfer of this pick appears as running, which under signal delay is after the command has arrived and word has come back. */
  onStarted?: () => void;
  /** Shows a Cancel control when given. */
  onCancel?: () => void;
}

/**
 * Chooses which tanks of a resource on the active vessel to move fuel between,
 * how much to move, and sends the transfer. A tank that cannot be chosen for a
 * side is disabled with the reason as its tip. Useful for letting the operator
 * set up a transfer from whichever widget they are in. Used by the vessel
 * schematic, the fuel widget and resource operations, beside
 * {@link ResourceFlowRow}.
 *
 * @category Telemetry
 */
export function ResourceTransferPicker({
  transfer,
  state,
  form,
  onStarted,
  onCancel,
}: Readonly<ResourceTransferPickerProps>) {
  const [untilFull, setUntilFull] = useState(true);
  const [amountText, setAmountText] = useState("");
  const sendId = useId();
  const { pick } = state;
  const tanks = transfer.tanks(pick.resource);
  const amount = untilFull ? null : Number(amountText);
  const problem = transferPickProblem(pick, amount);
  const list = (
    <Stack>
      {tanks.map((tank) => (
        <TankRow
          key={tank.partId}
          tank={tank}
          transfer={transfer}
          state={state}
        />
      ))}
    </Stack>
  );
  const started = transfer.running.some(
    (job) =>
      job.resource === pick.resource &&
      job.fromPartIds.some((id) => pick.from.includes(id)) &&
      job.toPartIds.some((id) => pick.to.includes(id)),
  );
  useEffect(() => {
    if (started) onStarted?.();
  }, [started, onStarted]);

  const sideOrNone = (side: readonly string[]) =>
    side.length > 0 ? transferSideLabel(side, transfer.titleOf) : "none";
  const route = `${sideOrNone(pick.from)} → ${sideOrNone(pick.to)}`;
  const label = `Transfer ${pick.resource}, ${transferSideLabel(pick.from, transfer.titleOf)} to ${transferSideLabel(pick.to, transfer.titleOf)}`;

  const amountChoice = (
    <Inline>
      <ButtonGroup equalWidth={false} aria-label="Amount">
        <ToggleButton
          size="sm"
          pressed={untilFull}
          onClick={() => setUntilFull(true)}
        >
          Until full
        </ToggleButton>
        <ToggleButton
          size="sm"
          pressed={!untilFull}
          onClick={() => setUntilFull(false)}
        >
          Units
        </ToggleButton>
      </ButtonGroup>
      {!untilFull && (
        <Input
          aria-label="Amount in units"
          inputMode="decimal"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          style={AMOUNT}
        />
      )}
    </Inline>
  );
  const send = (
    <Button
      id={sendId}
      aria-label={label}
      size="sm"
      variant="primary"
      unavailable={problem}
      command={transfer.start.with(transferStartArgs(pick, amount), {
        label,
      })}
    >
      Transfer
    </Button>
  );

  if (form === "tray") {
    return (
      <Inline wrap style={TRAY}>
        <Tooltip text={route} announce={false}>
          <label htmlFor={sendId} style={TRAY_ROUTE}>
            {route}
          </label>
        </Tooltip>
        {amountChoice}
        <Inline>
          {onCancel && (
            <IconButton type="button" aria-label="Cancel" onClick={onCancel}>
              <CloseIcon size={14} />
            </IconButton>
          )}
          {send}
        </Inline>
      </Inline>
    );
  }

  return (
    <Stack>
      {list}
      <Inline wrap style={ROW}>
        <fieldset style={FIELDSET}>
          <legend style={AMOUNT_LEGEND}>Amount</legend>
          {amountChoice}
        </fieldset>
        <Inline>
          {onCancel && (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          {send}
        </Inline>
      </Inline>
    </Stack>
  );
}

const TRAY = {
  flexWrap: "wrap",
  width: "100%",
  columnGap: "var(--gap-related-compact)",
} as const;
const TRAY_ROUTE = {
  flex: "1 1 0",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "var(--font-size-value)",
  color: "var(--color-text-primary)",
} as const;
const FIELDSET = { border: 0, margin: 0, padding: 0, minWidth: 0 } as const;
const LEGEND = {
  padding: 0,
  fontSize: "var(--font-size-value)",
  color: "var(--color-text-primary)",
} as const;
const AMOUNT_LEGEND = {
  padding: 0,
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-muted)",
} as const;
const ROW = { justifyContent: "space-between", flexWrap: "wrap" } as const;
const AMOUNT = { width: "6em" } as const;
