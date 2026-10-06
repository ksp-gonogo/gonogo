import { plantContribution, plantedSlots, plantSlot } from "./stub";

/** A small dashed chip naming the slot, for the panel header where a block would not fit. */
function ActionStub({ slot }: { slot: string }) {
  return (
    <span
      data-slot-stub={slot}
      style={{
        border: "1px dashed var(--color-info-mark)",
        borderRadius: 4,
        padding: "0 6px",
        color: "var(--color-info-text)",
        fontSize: 11,
        whiteSpace: "nowrap",
      }}
    >
      {slot}
    </span>
  );
}

/**
 * Plants a stub on each standard extension point of every widget named:
 * `sections` and `actions`, which a widget's panel mounts, and `badges`, which
 * every widget carries. A point a widget's own stubs already cover keeps its
 * own.
 */
export function plantStandardSlots(widgetIds: readonly string[]): void {
  for (const widgetId of widgetIds) {
    const sections = `${widgetId}.sections`;
    const actions = `${widgetId}.actions`;
    const badges = `${widgetId}.badges`;
    if (!plantedSlots().includes(sections)) plantSlot(sections);
    if (!plantedSlots().includes(actions)) {
      plantSlot(actions, (() => <ActionStub slot={actions} />) as never);
    }
    if (!plantedSlots().includes(badges)) {
      plantContribution(badges, {
        compute: () => [{ id: "stub", label: badges, tone: "info" as const }],
      });
    }
  }
}
