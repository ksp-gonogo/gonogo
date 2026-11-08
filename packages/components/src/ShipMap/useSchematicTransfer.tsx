import {
  type TransferPick,
  type TransferRole,
  type TransferTank,
  transferResourceLabel,
  useTransferPick,
} from "@ksp-gonogo/sitrep-sdk";
import {
  ResourceFlowRow,
  ResourceTransferPicker,
  Stack,
  type UiResourceTransferModel,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { StopTransfersAction } from "../shared/StopTransfersAction";
import { useResourceTransfer } from "../shared/useResourceTransfer";
import type { TransferResourceOption } from "./PartActionMenu";
import type { ShipMapPart, ShipMapPartMetaEntry } from "./shipTopology";
import type { TankMark, TransferDrawing } from "./TransferLayer";

/** The next side for a tank pressed on the diagram: Off, From, To, Off, passing over a side it cannot take. */
function nextRole(
  current: TransferRole | null,
  allowed: (role: TransferRole) => boolean,
): TransferRole | null {
  if (current === null) {
    if (allowed("from")) return "from";
    return allowed("to") ? "to" : null;
  }
  if (current === "from" && allowed("to")) return "to";
  return null;
}

function runningDrawing(
  transfer: UiResourceTransferModel,
  marks: Map<number, TankMark>,
): TransferDrawing["flows"] {
  return transfer.running.map((job) => {
    for (const id of job.fromPartIds) marks.set(Number(id), "out");
    for (const id of job.toPartIds) marks.set(Number(id), "in");
    return {
      id: job.id,
      resource: job.resource,
      fromPartIds: job.fromPartIds.map(Number),
      toPartIds: job.toPartIds.map(Number),
      rate: job.rate ?? undefined,
    };
  });
}

/** How a tank reads during a pick, or undefined when it is simply available. */
function pickMark(
  transfer: UiResourceTransferModel,
  tank: TransferTank,
  pick: TransferPick,
): TankMark | undefined {
  if (pick.from.includes(tank.partId)) return "from";
  if (pick.to.includes(tank.partId)) return "to";
  const blocked =
    transfer.blockReason(tank, "from", pick) &&
    transfer.blockReason(tank, "to", pick);
  return blocked ? "blocked" : undefined;
}

/** Transfers on the Vessel Schematic: the part menu entry, picking tanks on the diagram, and drawing what is running. */
export function useSchematicTransfer(
  partMeta: Map<string, ShipMapPartMetaEntry[]>,
) {
  const transfer = useResourceTransfer();
  const state = useTransferPick();
  const [picking, setPicking] = useState(false);
  const { pick, setRole, reset } = state;

  const stopPicking = useCallback(() => setPicking(false), []);
  const tanks = useMemo(
    () => (picking ? transfer.tanks(pick.resource) : []),
    [picking, transfer, pick.resource],
  );

  const drawing = useMemo<TransferDrawing | undefined>(() => {
    if (!picking && transfer.running.length === 0) return undefined;
    const marks = new Map<number, TankMark>();
    const flows = runningDrawing(transfer, marks);
    for (const tank of tanks) {
      const mark = pickMark(transfer, tank, pick);
      if (mark) marks.set(Number(tank.partId), mark);
    }
    return { marks, flows, held: transfer.held };
  }, [picking, transfer, tanks, pick]);

  /* A blocked tank's reason reads in the part's hover card, since it cannot be a tooltip on a press that does nothing. */
  const partMetaWithReasons = useMemo(() => {
    if (!picking) return partMeta;
    const merged = new Map(partMeta);
    for (const tank of tanks) {
      const reason =
        transfer.blockReason(tank, "to", pick) ??
        transfer.blockReason(tank, "from", pick);
      if (!reason) continue;
      const entry: ShipMapPartMetaEntry = {
        partId: tank.partId,
        label: "Transfer",
        kind: "text",
        text: reason,
      };
      merged.set(tank.partId, [...(partMeta.get(tank.partId) ?? []), entry]);
    }
    return merged;
  }, [picking, partMeta, tanks, transfer, pick]);

  const onPickTank = useCallback(
    (part: ShipMapPart) => {
      const partId = String(part.flightId);
      const tank = tanks.find((t) => t.partId === partId);
      if (!tank) return;
      const current = pick.from.includes(partId)
        ? "from"
        : pick.to.includes(partId)
          ? "to"
          : null;
      setRole(
        partId,
        nextRole(current, (role) => !transfer.blockReason(tank, role, pick)),
      );
    },
    [tanks, pick, setRole, transfer],
  );

  const transferResourcesOf = useCallback(
    (part: ShipMapPart): readonly TransferResourceOption[] => {
      const partId = String(part.flightId);
      return transfer.resources
        .filter((resource) =>
          transfer.tanks(resource).some((t) => t.partId === partId),
        )
        .map((resource) => ({
          resource,
          label: transferResourceLabel(resource),
        }));
    },
    [transfer],
  );

  const onStartTransferPick = useCallback(
    (part: ShipMapPart, resource: string) => {
      const partId = String(part.flightId);
      const tank = transfer.tanks(resource).find((t) => t.partId === partId);
      const blank = { resource, from: [], to: [] };
      const role =
        tank && transfer.blockReason(tank, "from", blank) ? "to" : "from";
      reset(resource, { partId, role });
      setPicking(true);
    },
    [transfer, reset],
  );

  const tray: ReactNode =
    picking || transfer.running.length > 0 ? (
      <Stack>
        {transfer.running.length > 0 && (
          <StopTransfersAction transfer={transfer} />
        )}
        {transfer.running.map((job) => (
          <ResourceFlowRow key={job.id} job={job} transfer={transfer} />
        ))}
        {picking && (
          <ResourceTransferPicker
            transfer={transfer}
            state={state}
            form="tray"
            onCancel={stopPicking}
            onStarted={stopPicking}
          />
        )}
      </Stack>
    ) : null;

  return {
    drawing,
    tray,
    partMeta: partMetaWithReasons,
    onPickTank: picking ? onPickTank : undefined,
    transferResourcesOf,
    onStartTransferPick,
  };
}
