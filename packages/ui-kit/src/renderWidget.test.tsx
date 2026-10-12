import { registerComponent } from "@ksp-gonogo/sitrep-sdk";
import { screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { renderWidget } from "./renderWidget";

function ConfigEcho({ config }: { config?: { label?: string } }) {
  return <p>{config?.label ?? "no config"}</p>;
}

registerComponent({
  id: "render-widget-default-config",
  name: "Default config probe",
  description: "Echoes its config.",
  tags: ["test"],
  component: ConfigEcho,
  defaultConfig: { label: "from the registry" },
});

describe("renderWidget", () => {
  it("gives a widget its registered defaultConfig, as the dashboard does", () => {
    renderWidget("render-widget-default-config");
    expect(screen.getByText("from the registry")).toBeInTheDocument();
  });

  it("lets a test's own config replace the default", () => {
    renderWidget("render-widget-default-config", {
      config: { label: "from the test" },
    });
    expect(screen.getByText("from the test")).toBeInTheDocument();
  });
});
