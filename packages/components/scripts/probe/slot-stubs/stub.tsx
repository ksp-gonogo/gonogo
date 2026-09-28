import {
  type AugmentDefinition,
  registerAugment,
  registerBarePrimitiveTopic,
} from "@ksp-gonogo/sitrep-sdk";
import type { ComponentType, ReactNode } from "react";
import { PLANTED_UPLINK } from "../plantedUplink";

/**
 * The Domain every slot stub requires, so a stub renders only in a scene that
 * emits {@link PLANTED_SLOTS_AVAILABLE_TOPIC} and every other render of its host
 * widget stays as it is.
 */
export const PLANTED_SLOTS_DOMAIN = "planted-slots";

export const PLANTED_SLOTS_AVAILABLE_TOPIC = `${PLANTED_SLOTS_DOMAIN}.available`;

registerBarePrimitiveTopic(PLANTED_SLOTS_AVAILABLE_TOPIC);

/** The augment id a slot's stub registers under. */
export function slotStubId(slot: string): string {
  return `planted-slot:${slot}`;
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
 * naming the slot otherwise.
 */
export function plantSlot<Slot extends string>(
  slot: Slot,
  component?: AugmentDefinition<Slot>["component"],
): void {
  registerAugment({
    id: slotStubId(slot),
    augments: slot,
    requires: PLANTED_SLOTS_DOMAIN,
    owner: PLANTED_UPLINK,
    component:
      component ??
      ((() => <SlotStub slot={slot} />) as unknown as ComponentType<never>),
  } as AugmentDefinition<Slot>);
}
