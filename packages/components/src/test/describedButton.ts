import { screen, waitFor } from "@ksp-gonogo/test-utils";

/**
 * The button whose description, the tip a command control gives, matches. A
 * blocked command control keeps its own name and gives the game's reason as its
 * description, so a test finds it by the reason here and by its name elsewhere.
 */
export function getButtonDescribedBy(reason: RegExp): HTMLElement {
  const found = screen
    .queryAllByRole("button")
    .find((el) => reason.test(el.getAttribute("aria-description") ?? ""));
  if (!found) {
    throw new Error(`No button is described by ${String(reason)}`);
  }
  return found;
}

/** {@link getButtonDescribedBy}, waiting for the description to arrive. */
export function findButtonDescribedBy(reason: RegExp): Promise<HTMLElement> {
  return waitFor(() => getButtonDescribedBy(reason));
}
