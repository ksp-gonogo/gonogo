import {
  type AugmentDefinition,
  type ContributionDefinition,
  type ContributionDep,
  registerAugment,
  registerBarePrimitiveTopic,
} from "@ksp-gonogo/sitrep-sdk";
import { registerContribution } from "@ksp-gonogo/sitrep-sdk/spine";
import type { ComponentType, ReactNode } from "react";
import { PLANTED_UPLINK } from "../plantedUplink";

/**
 * The Domain one extension point's stub requires. Each point has its own, so a
 * scene lights exactly the stubs whose Domains it announces, and two scenes on
 * one page light different stubs without touching the shared registries.
 */
export function plantedSlotDomain(slot: string): string {
  return `planted-slot-${slot.replace(/\./g, "-")}`;
}

/** The Topic a scene emits to light the stub on `slot`. */
export function plantedSlotAvailableTopic(slot: string): string {
  return `${plantedSlotDomain(slot)}.available`;
}

/** The augment or contribution id a slot's stub registers under. */
export function slotStubId(slot: string): string {
  return `planted-slot:${slot}`;
}

/** Every extension point that has a stub, in the order they were planted. */
const planted: string[] = [];

/** The extension points with a stub. */
export function plantedSlots(): readonly string[] {
  return planted;
}

function notePlanted(slot: string): void {
  if (planted.includes(slot)) return;
  planted.push(slot);
  registerBarePrimitiveTopic(plantedSlotAvailableTopic(slot));
}

/** A dashed, labelled box naming the slot it fills, for a slot drawn in HTML. */
export function SlotStub({
  slot,
  children,
}: {
  slot: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-slot-stub={slot}
      style={{
        border: "1px dashed var(--color-info-mark)",
        borderRadius: 4,
        padding: "4px 8px",
        color: "var(--color-info-text)",
        fontSize: 11,
      }}
    >
      <div>{slot}</div>
      {children}
    </div>
  );
}

/**
 * Registers the stand-in augment for one slot: `component` when the slot
 * needs a particular shape (an SVG overlay, a table row), a {@link SlotStub}
 * naming the slot otherwise. `label` is for a slot whose host reads the
 * augment's own caption, such as a tab strip built from whatever is bound.
 */
export function plantSlot<Slot extends string>(
  slot: Slot,
  component?: AugmentDefinition<Slot>["component"],
  label?: string,
): void {
  notePlanted(slot);
  registerAugment({
    id: slotStubId(slot),
    augments: slot,
    requires: plantedSlotDomain(slot),
    owner: PLANTED_UPLINK,
    label,
    component:
      component ??
      ((() => <SlotStub slot={slot} />) as unknown as ComponentType<never>),
  } as AugmentDefinition<Slot>);
}

/**
 * Registers the stand-in contribution for one contribution slot. `compute`
 * returns entries of the slot's own type, labelled with the slot's name
 * wherever the entry carries text.
 */
export function plantContribution<
  Slot extends string,
  const Deps extends readonly ContributionDep[] = readonly [],
>(
  slot: Slot,
  def: Pick<ContributionDefinition<Slot, Deps>, "deps" | "compute">,
): void {
  notePlanted(slot);
  registerContribution({
    ...def,
    id: slotStubId(slot),
    contributes: slot,
    requires: plantedSlotDomain(slot),
    owner: PLANTED_UPLINK,
  });
}
