import { render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DataKeyMultiPicker } from "./DataKeyMultiPicker";
import type { KeyOption } from "./DataKeyPicker";

const KEYS: KeyOption[] = [
  { key: "v.altitude", label: "Altitude", unit: "m", group: "Position" },
  { key: "v.lat", label: "Latitude", unit: "°", group: "Position" },
  {
    key: "v.surfaceSpeed",
    label: "Surface speed",
    unit: "m/s",
    group: "Velocity",
  },
  { key: "v.mach", label: "Mach", group: "Velocity" },
];

describe("DataKeyMultiPicker", () => {
  it("renders all keys grouped alphabetically", () => {
    render(
      <DataKeyMultiPicker keys={KEYS} value={new Set()} onChange={() => {}} />,
    );
    expect(screen.getByText("Position")).toBeInTheDocument();
    expect(screen.getByText("Velocity")).toBeInTheDocument();
    expect(screen.getByText("Altitude")).toBeInTheDocument();
    expect(screen.getByText("Mach")).toBeInTheDocument();
  });

  it("shows checked state for keys in the value set", () => {
    render(
      <DataKeyMultiPicker
        keys={KEYS}
        value={new Set(["v.altitude", "v.mach"])}
        onChange={() => {}}
      />,
    );
    expect(
      (document.getElementById("dkmp-v.altitude") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (document.getElementById("dkmp-v.mach") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (document.getElementById("dkmp-v.lat") as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("filters by label and key when typing in search", async () => {
    const user = userEvent.setup();
    render(
      <DataKeyMultiPicker keys={KEYS} value={new Set()} onChange={() => {}} />,
    );
    await user.type(screen.getByPlaceholderText("Search..."), "alt");
    expect(screen.getByText("Altitude")).toBeInTheDocument();
    expect(screen.queryByText("Mach")).not.toBeInTheDocument();
    expect(screen.queryByText("Latitude")).not.toBeInTheDocument();
  });

  it("toggling a row emits a new set with that key added", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DataKeyMultiPicker
        keys={KEYS}
        value={new Set(["v.lat"])}
        onChange={onChange}
      />,
    );
    // Real users click the row label, not the visually-hidden checkbox
    // (pointer-events: none) — the <label htmlFor> delegates the click.
    await user.click(screen.getByText("Altitude"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as Set<string>;
    expect(Array.from(next).sort()).toEqual(["v.altitude", "v.lat"]);
  });

  it("toggling an already-checked row removes that key from the set", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DataKeyMultiPicker
        keys={KEYS}
        value={new Set(["v.lat", "v.altitude"])}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByText("Latitude"));
    const next = onChange.mock.calls[0][0] as Set<string>;
    expect(Array.from(next)).toEqual(["v.altitude"]);
  });

  it("shows the empty hint when search matches nothing", async () => {
    const user = userEvent.setup();
    render(
      <DataKeyMultiPicker
        keys={KEYS}
        value={new Set()}
        onChange={() => {}}
        emptyHint="No keys found"
      />,
    );
    await user.type(screen.getByPlaceholderText("Search..."), "xyzzy");
    expect(screen.getByText("No keys found")).toBeInTheDocument();
  });
});
