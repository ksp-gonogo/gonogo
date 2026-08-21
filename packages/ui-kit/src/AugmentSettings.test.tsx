import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AugmentSettingsProvider, useAugmentSettings } from "./AugmentSettings";

function LayerToggle({ id }: { id: string }) {
  const { values, set } = useAugmentSettings(id);
  const show = values.show !== false;
  return (
    <button type="button" onClick={() => set("show", !show)}>
      {show ? "Hide" : "Show"}
    </button>
  );
}

describe("useAugmentSettings", () => {
  it("hands an augment its own namespace, not the whole map", () => {
    function Probe() {
      const { values } = useAugmentSettings("mine");
      return <span>{JSON.stringify(values)}</span>;
    }

    render(
      <AugmentSettingsProvider
        settings={{ mine: { show: false }, theirs: { show: true } }}
        setAugmentSetting={() => {}}
      >
        <Probe />
      </AugmentSettingsProvider>,
    );

    expect(screen.getByText('{"show":false}')).toBeInTheDocument();
  });

  it("writes back under the augment's own id", async () => {
    const setAugmentSetting = vi.fn();
    render(
      <AugmentSettingsProvider
        settings={{ altimetry: { show: true } }}
        setAugmentSetting={setAugmentSetting}
      >
        <LayerToggle id="altimetry" />
      </AugmentSettingsProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Hide" }));

    expect(setAugmentSetting).toHaveBeenCalledWith("altimetry", "show", false);
  });

  it("reads empty and writes nowhere with no provider, the isolated-render case", async () => {
    render(<LayerToggle id="altimetry" />);

    // Nothing saved reads as the augment's own default, here `show` on.
    const button = screen.getByRole("button", { name: "Hide" });
    await userEvent.click(button);

    // Still mounted, still on: the no-op writer must not throw.
    expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
  });
});
