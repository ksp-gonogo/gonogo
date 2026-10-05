import type { KeyboardEvent } from "react";

/** Enter and Space activate, as they do a native button. */
export function activateOnKey(activate: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    activate();
  };
}
