/** A relative stepper's accessible name, carrying why it is disabled when the figure it steps from was never read. */
export const stepperLabel = (action: string, from: number | null): string =>
  from === null ? `${action} (unavailable, not reported)` : action;

/** The same, for a toggle whose `enabled` is the inverse of an unread flag. */
export const flagLabel = (
  action: string,
  from: boolean | null,
): string | undefined =>
  from === null ? `${action} (unavailable, not reported)` : undefined;

/** A motor toggle's state word; an unread flag is "unknown", never off. */
export function motorStateText(engaged: boolean | null): string {
  if (engaged === null) return "unknown";
  return engaged ? "on" : "off";
}

/** A lock toggle's text; an unread flag is "Lock unknown", never unlocked. */
export function lockStateText(locked: boolean | null): string {
  if (locked === null) return "Lock unknown";
  return locked ? "Locked" : "Unlocked";
}
