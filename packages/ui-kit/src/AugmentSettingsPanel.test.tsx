import { fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { NamespacedAugmentSettings } from "./AugmentSettingsPanel";
import { AugmentSettingsPanel } from "./AugmentSettingsPanel";

// Generic fixture ids — never a real mod name (uplink-boundary ratchet scans
// shared-package fixtures for literal mod tokens, see feedback_telemachus_artifact_vs_uplink_domain).
const SETTINGS: NamespacedAugmentSettings[] = [
  {
    augmentId: "example-augment",
    namespace: "example-augment",
    fields: [
      {
        key: "show",
        type: "boolean",
        label: "Show example overlay",
        default: true,
      },
    ],
  },
  {
    augmentId: "some-provider",
    namespace: "some-provider",
    fields: [
      { key: "label", type: "text", label: "Overlay label", default: "" },
    ],
  },
];

describe("AugmentSettingsPanel", () => {
  it("renders a field per augment's settings block", () => {
    render(
      <AugmentSettingsPanel
        settings={SETTINGS}
        values={undefined}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: "Show example overlay" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Overlay label" }),
    ).toBeInTheDocument();
  });

  it("defaults a boolean field's checked state from the field's own default when no value is stored", () => {
    render(
      <AugmentSettingsPanel
        settings={SETTINGS}
        values={undefined}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: "Show example overlay" }),
    ).toBeChecked();
  });

  it("a stored value under the namespaced key overrides the field default", () => {
    render(
      <AugmentSettingsPanel
        settings={SETTINGS}
        values={{ "example-augment": { show: false } }}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: "Show example overlay" }),
    ).not.toBeChecked();
  });

  it("toggling a boolean field fires onChange with the (namespace, key, value) triple", () => {
    const onChange = vi.fn();
    render(
      <AugmentSettingsPanel
        settings={SETTINGS}
        values={undefined}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show example overlay" }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("example-augment", "show", false);
  });

  it("editing a text field fires onChange with the namespace, key and raw string", () => {
    const onChange = vi.fn();
    render(
      <AugmentSettingsPanel
        settings={SETTINGS}
        values={undefined}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Overlay label" }), {
      target: { value: "hi" },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("some-provider", "label", "hi");
  });

  it("a number field fires onChange with a parsed number", () => {
    const onChange = vi.fn();
    render(
      <AugmentSettingsPanel
        settings={[
          {
            augmentId: "example-augment",
            namespace: "example-augment",
            fields: [
              { key: "count", type: "number", label: "Count", default: 1 },
            ],
          },
        ]}
        values={undefined}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "Count" }), {
      target: { value: "5" },
    });
    expect(onChange).toHaveBeenCalledWith("example-augment", "count", 5);
  });

  it("renders nothing when settings is empty", () => {
    const { container } = render(
      <AugmentSettingsPanel
        settings={[]}
        values={undefined}
        onChange={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
