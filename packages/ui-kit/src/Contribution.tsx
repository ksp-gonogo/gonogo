import type { ComponentType } from "react";
import type {
  ComponentSlotRegistry,
  ComponentSlotSegment,
  ContributionEntry,
  ContributionSlotId,
} from "./contributions";
import { useContributions } from "./contributionsRead";

/** The slots a widget can hand a component: a standard segment of every widget, or a slot id the widget declares. */
type ContributedSlot = ComponentSlotSegment | ContributionSlotId;

/** What one entry of `Slot` carries. */
type SlotEntry<Slot extends ContributedSlot> = Slot extends ComponentSlotSegment
  ? ComponentSlotRegistry[Slot]
  : Slot extends ContributionSlotId
    ? ContributionEntry<Slot>
    : never;

/**
 * The props {@link Contribution} hands the component that draws a slot:
 * every entry contributed to it, after the filter. Useful for typing a
 * component that draws what Uplinks add to a widget, such as a list of meters.
 * Taken by {@link ContributionProps}.
 *
 * @category Extensions
 */
export interface ContributedEntries<Slot extends ContributedSlot> {
  /** The entries, in render order, each with the `id` it was contributed under. Never empty: the component is not mounted for an empty slot. */
  entries: readonly SlotEntry<Slot>[];
}

/**
 * Props for {@link Contribution}.
 * Useful for choosing the slot a widget draws and the component that draws it.
 * Taken by {@link Contribution}.
 *
 * @category Extensions
 */
export interface ContributionProps<Slot extends ContributedSlot> {
  /** The slot to draw: a segment such as `"meters"`, completed to the widget it is mounted in, or a full slot id the widget declares. */
  slot: Slot;
  /** Draws the slot. Its props are the slot's entries, so a component for another kind of entry does not compile. */
  component: ComponentType<ContributedEntries<Slot>>;
  /** Keeps only the entries this returns true for, such as those addressed to one `row`. */
  filter?: (entry: SlotEntry<Slot>) => boolean;
}

/**
 * Draws what Uplinks contribute to a slot of the widget it is mounted in, by
 * handing the entries to the component that draws them. Useful for letting an
 * Uplink add meters, chips or rows to a widget it did not write, without the
 * widget knowing what the Uplink sends. Used by the crew status roster to draw
 * the meters addressed to each kerbal.
 *
 * The component is whatever draws the slot, one entry or many: for several
 * meters it is a list of meters. It is typed from the slot, so a component
 * made for another kind of entry does not compile, and it is not mounted while
 * the slot has no entry, so an empty slot leaves nothing behind. An Uplink
 * widget can use it for a slot of its own that the widget declares with
 * `contributionSlots`.
 *
 * @example
 * ```tsx
 * function MeterList({ entries }: ContributedEntries<"meters">) {
 *   return (
 *     <MeterStack>
 *       {entries.map((entry) => (
 *         <Meter key={entry.id} label={entry.label} value={entry.value} />
 *       ))}
 *     </MeterStack>
 *   );
 * }
 *
 * <Contribution
 *   slot="meters"
 *   component={MeterList}
 *   filter={(entry) => entry.row === kerbal.name}
 * />;
 * ```
 *
 * @category Extensions
 */
export function Contribution<Slot extends ContributedSlot>({
  slot,
  component: Component,
  filter,
}: ContributionProps<Slot>) {
  const entries = useContributions(slot as never) as readonly SlotEntry<Slot>[];
  const shown = filter ? entries.filter(filter) : entries;
  return shown.length === 0 ? null : <Component entries={shown} />;
}
