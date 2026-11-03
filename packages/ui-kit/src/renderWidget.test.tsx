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

function OwnTinyForm() {
  return <p>draws its own tiny form</p>;
}

registerComponent({
  id: "render-widget-stays-mounted",
  name: "Stays mounted probe",
  description: "Draws its own tiny form.",
  tags: ["test"],
  component: OwnTinyForm,
  minSize: { w: 4, h: 3 },
  tiny: {
    title: "PROBE",
    staysMounted: true,
    useEssentials: () => [{ label: "Kit", value: null }],
  },
});

describe("renderWidget", () => {
  it("leaves a widget that stays mounted to draw its own tiny form", () => {
    renderWidget("render-widget-stays-mounted", { w: 2, h: 2 });
    expect(screen.getByText("draws its own tiny form")).toBeInTheDocument();
  });

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
