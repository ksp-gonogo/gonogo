import { screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";

/** Selects the named strategies tab and returns the panel it opens. */
export async function openTab(name: string): Promise<HTMLElement> {
  const tab = await screen.findByRole("tab", { name });
  if (tab.getAttribute("aria-selected") !== "true") {
    await userEvent.setup().click(tab);
  }
  return screen.findByRole("tabpanel");
}
