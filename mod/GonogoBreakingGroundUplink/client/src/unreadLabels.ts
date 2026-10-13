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
