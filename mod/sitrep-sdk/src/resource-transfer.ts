import { useMemo, useState } from "react";
import {
  KspTankFlowMode,
  type ResourceTransferJob,
  TransferJobState,
  type TransferReach,
  type VesselPart,
} from "./__generated__/contract";
import { type Value, value } from "./unit-system/value";

/**
 * One tank that holds a resource, read off `vessel.parts`. Used by {@link ResourceTransferModel}.
 *
 * @category Telemetry
 */
export interface TransferTank {
  /** The part's flight id. */
  partId: string;
  /** The part's display title. */
  title: string;
  /** How much the tank holds. */
  amount: Value<"units">;
  /** How much the tank can hold. */
  capacity: Value<"units">;
  /** The tank's direction limit. Null when the game has not reported one. */
  flowMode: KspTankFlowMode | null;
  /** The player's flow lock. A locked tank can still be used in a transfer. */
  locked: boolean;
}

/**
 * The part fields a transfer reads, which any `vessel.parts` entry supplies.
 *
 * @category Telemetry
 */
export type TransferPartSource = Pick<VesselPart, "id" | "title" | "resources">;

/**
 * Which side of a transfer a tank is picked for.
 *
 * @category Telemetry
 */
export type TransferRole = "from" | "to";

/**
 * A resource and the tanks picked on each side of a transfer. Held by {@link useTransferPick}.
 *
 * @category Telemetry
 */
export interface TransferPick {
  /** The resource's name. */
  resource: string;
  /** The tanks to draw from, as part flight ids. */
  from: readonly string[];
  /** The tanks to fill, as part flight ids. */
  to: readonly string[];
}

const EMPTY: readonly string[] = [];

/**
 * The transferable tanks of one resource on the craft, in part order.
 *
 * @category Telemetry
 */
export function transferTanks(
  parts: readonly TransferPartSource[],
  resource: string,
): TransferTank[] {
  const tanks: TransferTank[] = [];
  for (const part of parts) {
    const row = part.resources[resource];
    if (!row?.transferable) continue;
    tanks.push({
      partId: part.id,
      title: part.title,
      amount: row.amount ?? value("units", 0),
      capacity: row.maxAmount ?? value("units", 0),
      flowMode: row.flowMode ?? null,
      locked: row.locked === true,
    });
  }
  return tanks;
}

/**
 * The resources the craft holds in two or more transferable tanks, which are the ones a transfer could move.
 *
 * @category Telemetry
 */
export function transferableResources(
  parts: readonly TransferPartSource[],
): string[] {
  const counts = new Map<string, number>();
  for (const part of parts) {
    for (const [name, row] of Object.entries(part.resources)) {
      if (row.transferable) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts].filter(([, n]) => n >= 2).map(([name]) => name);
}

/**
 * Whether a tank in `toPartId` can take `resource` from `fromPartId` under the save's crossfeed rule.
 *
 * @category Telemetry
 */
export function canTransferBetween(
  reach: TransferReach | undefined,
  resource: string,
  fromPartId: string,
  toPartId: string,
): boolean {
  if (!reach?.obeysCrossfeed) return true;
  const tanks = reach.resources[resource];
  if (!tanks) return true;
  const destination = tanks.find((t) => t.partId === toPartId);
  if (!destination) return true;
  if (destination.drawsFromSet == null) return fromPartId === toPartId;
  const set = reach.sets.find((s) => s.id === destination.drawsFromSet);
  return set?.partIds.includes(fromPartId) === true;
}

/**
 * Why a tank cannot be picked for one side of a transfer, in the words the
 * operator reads on a disabled control, or undefined when it can be. Every
 * surface that offers a transfer asks this, so they all give the same reason.
 * `titleOf` names a tank in a crossfeed reason.
 *
 * @category Telemetry
 */
export function transferBlockReason(
  tank: TransferTank,
  role: TransferRole,
  pick: TransferPick,
  reach: TransferReach | undefined,
  running: readonly ResourceTransferJob[],
  titleOf: (partId: string) => string,
): string | undefined {
  if (tank.flowMode === KspTankFlowMode.None) return "set not to flow";
  if (role === "to" && tank.flowMode === KspTankFlowMode.Out) return "out only";
  if (role === "from" && tank.flowMode === KspTankFlowMode.In) return "in only";

  const inJob = running.some(
    (job) =>
      job.resource === pick.resource &&
      [...job.fromPartIds, ...job.toPartIds].includes(tank.partId),
  );
  if (inJob) return "already in a transfer";

  const others = role === "to" ? pick.from : pick.to;
  for (const other of others) {
    const connected =
      role === "to"
        ? canTransferBetween(reach, pick.resource, other, tank.partId)
        : canTransferBetween(reach, pick.resource, tank.partId, other);
    if (!connected) return `not connected by crossfeed to ${titleOf(other)}`;
  }
  return undefined;
}

/**
 * The arguments of `vessel.resource.transfer.start` for a pick. A null `amount` means until full.
 *
 * @category Telemetry
 */
export function transferStartArgs(pick: TransferPick, amount: number | null) {
  return {
    resource: pick.resource,
    fromPartIds: [...pick.from],
    toPartIds: [...pick.to],
    untilFull: amount === null,
    amount: amount ?? undefined,
  };
}

/**
 * Why a pick cannot be sent yet, or undefined when it can. A null `amount` means until full.
 *
 * @category Telemetry
 */
export function transferPickProblem(
  pick: TransferPick,
  amount: number | null,
): string | undefined {
  if (pick.from.length === 0) return "pick a tank to draw from";
  if (pick.to.length === 0) return "pick a tank to fill";
  if (amount !== null && !(amount > 0)) return "enter an amount above zero";
  return undefined;
}

/**
 * A resource's internal name spaced for reading, so `LiquidFuel` reads `Liquid Fuel`.
 *
 * @category Telemetry
 */
export function transferResourceLabel(resource: string): string {
  return resource.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/**
 * A side of a transfer in few words: a tank's title, `FL-T400 ×2` for several of one kind, or a count.
 *
 * @category Telemetry
 */
export function transferSideLabel(
  partIds: readonly string[],
  titleOf: (partId: string) => string,
): string {
  const titles = [...new Set(partIds.map(titleOf))];
  if (titles.length === 1) {
    return partIds.length > 1 ? `${titles[0]} ×${partIds.length}` : titles[0];
  }
  return `${partIds.length} tanks`;
}

/**
 * The running and recent transfers, and what a widget needs to offer one. Built by {@link resourceTransferModel}.
 *
 * @category Telemetry
 */
export interface ResourceTransferModel<Start = unknown, Stop = unknown> {
  /** The resources the craft could transfer. */
  resources: readonly string[];
  /** Running transfers. Empty when none are running or none has been reported. */
  running: readonly ResourceTransferJob[];
  /** True when the running list is the last one received rather than a current one. */
  held: boolean;
  /** The tanks of a resource. */
  tanks: (resource: string) => TransferTank[];
  /** A part's title, or its id when the craft's parts have not arrived. */
  titleOf: (partId: string) => string;
  /** Why a tank cannot be picked for one side of a pick, as {@link transferBlockReason} answers. */
  blockReason: (
    tank: TransferTank,
    role: TransferRole,
    pick: TransferPick,
  ) => string | undefined;
  /** The `vessel.resource.transfer.start` command. */
  start: Start;
  /** The `vessel.resource.transfer.stop` command. */
  stop: Stop;
}

/**
 * What {@link resourceTransferModel} is built from: the three Topics, read by the caller, and the two commands.
 *
 * @category Telemetry
 */
export interface ResourceTransferSources<Start, Stop> {
  /** The craft's parts. */
  parts: readonly TransferPartSource[];
  /** Which tanks can exchange, from `vessel.transferReach`. */
  reach: TransferReach | undefined;
  /** The list from `vessel.resourceTransfers`. */
  transfers: readonly ResourceTransferJob[] | undefined;
  /** Whether that list is the last one received rather than a current one. */
  held: boolean;
  /** The `vessel.resource.transfer.start` command. */
  start: Start;
  /** The `vessel.resource.transfer.stop` command. */
  stop: Stop;
}

/**
 * The tanks, running transfers and commands for moving resources between the
 * active vessel's tanks, from the Topics and command handles a widget has read.
 * Useful for offering a transfer from a widget. Used with
 * `ResourceTransferPicker` and `ResourceFlowRow` from ui-kit.
 *
 * @category Telemetry
 */
export function resourceTransferModel<Start, Stop>({
  parts,
  reach,
  transfers,
  held,
  start,
  stop,
}: ResourceTransferSources<Start, Stop>): ResourceTransferModel<Start, Stop> {
  const titles = new Map(parts.map((p) => [p.id, p.title]));
  const titleOf = (id: string) => titles.get(id) ?? id;
  const running = (transfers ?? []).filter(
    (job) => job.state === TransferJobState.Running,
  );
  return {
    resources: transferableResources(parts),
    running,
    held,
    tanks: (resource) => transferTanks(parts, resource),
    titleOf,
    blockReason: (tank, role, pick) =>
      transferBlockReason(tank, role, pick, reach, running, titleOf),
    start,
    stop,
  };
}

/**
 * A pick being made, and the ways to change it. Returned by {@link useTransferPick}.
 *
 * @category Telemetry
 */
export interface TransferPickState {
  /** The pick so far. */
  pick: TransferPick;
  /** Puts a tank on one side, or takes it off both with null. */
  setRole: (partId: string, role: TransferRole | null) => void;
  /** Starts again on another resource, optionally with a tank already on one side. */
  reset: (
    resource: string,
    seed?: { partId: string; role: TransferRole },
  ) => void;
}

/**
 * Holds the tanks picked for a transfer, shared between a picker and a surface that shows them, such as a diagram.
 *
 * @category Telemetry
 */
export function useTransferPick(resource = ""): TransferPickState {
  const [pick, setPick] = useState<TransferPick>({
    resource,
    from: EMPTY,
    to: EMPTY,
  });

  return useMemo(
    () => ({
      pick,
      setRole: (partId, role) =>
        setPick((current) => ({
          resource: current.resource,
          from:
            role === "from"
              ? [...current.from.filter((id) => id !== partId), partId]
              : current.from.filter((id) => id !== partId),
          to:
            role === "to"
              ? [...current.to.filter((id) => id !== partId), partId]
              : current.to.filter((id) => id !== partId),
        })),
      reset: (next, seed) =>
        setPick({
          resource: next,
          from: seed?.role === "from" ? [seed.partId] : EMPTY,
          to: seed?.role === "to" ? [seed.partId] : EMPTY,
        }),
    }),
    [pick],
  );
}
