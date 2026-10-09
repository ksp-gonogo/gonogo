import { fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Fab } from "./Fab";
import { FabClusterProvider } from "./FabCluster";

function stubPointer(coarse: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (
      query: string,
    ): Pick<
      MediaQueryList,
      "matches" | "media" | "addEventListener" | "removeEventListener"
    > => ({
      matches: coarse && query === "(pointer: coarse)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  );
}

function renderCluster() {
  render(
    <FabClusterProvider>
      <Fab bottom={84} aria-label="Settings">
        s
      </Fab>
    </FabClusterProvider>,
  );
  return screen.getByRole("button", { name: "Settings" });
}

describe("FabCluster", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps secondaries hidden until hover on a fine pointer", () => {
    stubPointer(false);
    const button = renderCluster();
    expect(button).toHaveAttribute("tabindex", "-1");
    fireEvent.mouseEnter(button.parentElement as HTMLElement);
    expect(button).toHaveAttribute("tabindex", "0");
  });

  it("shows secondaries and their names without any hover on a coarse pointer", () => {
    stubPointer(true);
    const button = renderCluster();
    expect(button).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("Settings", { selector: "span" })).toBeVisible();
  });
});
