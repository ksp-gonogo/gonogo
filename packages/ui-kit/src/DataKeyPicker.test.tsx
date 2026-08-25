import { fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import type { KeyOption } from "./DataKeyPicker";
import { DataKeyPicker } from "./DataKeyPicker";

const KEYS: KeyOption[] = [
  { key: "v.altitude", label: "Altitude", unit: "m", group: "Position" },
  {
    key: "v.surfaceSpeed",
    label: "Surface speed",
    unit: "m/s",
    group: "Velocity",
  },
  { key: "v.mach", label: "Mach", unit: "raw", group: "Velocity" },
  { key: "v.lat", label: "Latitude", unit: "°", group: "Position" },
];

function openDropdown(input: HTMLElement) {
  fireEvent.focus(input);
}

describe("DataKeyPicker", () => {
  it("shows placeholder when no value selected", () => {
    render(
      <DataKeyPicker
        keys={KEYS}
        value={null}
        onChange={() => undefined}
        placeholder="Pick..."
      />,
    );
    expect(screen.getByPlaceholderText("Pick...")).toBeInTheDocument();
  });

  it("displays selected label when closed", () => {
    render(
      <DataKeyPicker
        keys={KEYS}
        value="v.altitude"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByDisplayValue("Altitude")).toBeInTheDocument();
  });

  it("opens dropdown on focus and shows groups", () => {
    render(
      <DataKeyPicker keys={KEYS} value={null} onChange={() => undefined} />,
    );
    openDropdown(screen.getByRole("combobox"));
    expect(screen.getByText("Position")).toBeInTheDocument();
    expect(screen.getByText("Velocity")).toBeInTheDocument();
  });

  it("typing filters the list", () => {
    render(
      <DataKeyPicker keys={KEYS} value={null} onChange={() => undefined} />,
    );
    const input = screen.getByRole("combobox");
    openDropdown(input);
    fireEvent.change(input, { target: { value: "alt" } });
    expect(screen.getByText("Altitude")).toBeInTheDocument();
    expect(screen.queryByText("Surface speed")).not.toBeInTheDocument();
  });

  it("Enter with no arrow navigation selects first filtered result", () => {
    const onChange = vi.fn();
    render(<DataKeyPicker keys={KEYS} value={null} onChange={onChange} />);
    const input = screen.getByRole("combobox");
    openDropdown(input);
    fireEvent.change(input, { target: { value: "alt" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("v.altitude");
  });

  it("ArrowDown + Enter selects the highlighted item", () => {
    const onChange = vi.fn();
    render(<DataKeyPicker keys={KEYS} value={null} onChange={onChange} />);
    const input = screen.getByRole("combobox");
    openDropdown(input);
    // First item in flat sorted order: Position group = Altitude, Latitude; Velocity = Mach, Surface speed
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    // second item in flat order (Position: Altitude[0], Latitude[1])
    expect(onChange).toHaveBeenCalledWith("v.lat");
  });

  it("Escape closes the dropdown", () => {
    render(
      <DataKeyPicker keys={KEYS} value={null} onChange={() => undefined} />,
    );
    const input = screen.getByRole("combobox");
    openDropdown(input);
    expect(screen.getByText("Position")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByText("Position")).not.toBeInTheDocument();
  });

  it("clicking an item calls onChange once with the key", () => {
    const onChange = vi.fn();
    render(<DataKeyPicker keys={KEYS} value={null} onChange={onChange} />);
    openDropdown(screen.getByRole("combobox"));
    fireEvent.pointerDown(screen.getByText("Altitude"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("v.altitude");
  });

  it("clearable × button calls onChange(null)", () => {
    const onChange = vi.fn();
    render(
      <DataKeyPicker
        keys={KEYS}
        value="v.altitude"
        onChange={onChange}
        clearable
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows No matches when query has no results", () => {
    render(
      <DataKeyPicker keys={KEYS} value={null} onChange={() => undefined} />,
    );
    const input = screen.getByRole("combobox");
    openDropdown(input);
    fireEvent.change(input, { target: { value: "xyzzy" } });
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("initially closed: aria-expanded=false and no listbox in DOM", () => {
    render(
      <DataKeyPicker keys={KEYS} value={null} onChange={() => undefined} />,
    );
    const input = screen.getByRole("combobox");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opening sets aria-expanded=true and mounts the listbox", () => {
    render(
      <DataKeyPicker keys={KEYS} value={null} onChange={() => undefined} />,
    );
    const input = screen.getByRole("combobox");
    openDropdown(input);
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("ArrowDown sets aria-activedescendant to the highlighted option", () => {
    render(
      <DataKeyPicker keys={KEYS} value={null} onChange={() => undefined} />,
    );
    const input = screen.getByRole("combobox");
    openDropdown(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const active = input.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    const opt = document.getElementById(active ?? "");
    expect(opt?.getAttribute("role")).toBe("option");
    expect(opt?.getAttribute("aria-selected")).toBe("true");
  });
});

describe("DataKeyPicker: a saved key that is no longer offered", () => {
  it("says so, rather than rendering the key as a valid selection", () => {
    render(
      <DataKeyPicker
        keys={KEYS}
        value="v.retiredLongAgo"
        onChange={() => undefined}
      />,
    );
    // The failure this prevents: the raw key rendered as the display value,
    // indistinguishable from a real label, while the read behind it returned
    // nothing. A graph drew a flat line and an alarm never fired, and both
    // read as a measurement of zero.
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
  });

  it("marks the control invalid and points at the explanation", () => {
    render(
      <DataKeyPicker
        keys={KEYS}
        value="v.retiredLongAgo"
        onChange={() => undefined}
      />,
    );
    const input = screen.getByRole("combobox");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      /no longer available/i,
    );
  });

  it("still shows WHICH key went missing, so it can be replaced", () => {
    render(
      <DataKeyPicker
        keys={KEYS}
        value="v.retiredLongAgo"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByDisplayValue("v.retiredLongAgo")).toBeInTheDocument();
  });

  it("names the subject when the caller gives it one", () => {
    render(
      <DataKeyPicker
        keys={KEYS}
        value="v.retiredLongAgo"
        onChange={() => undefined}
        subjectNoun="alarm subject"
      />,
    );
    expect(
      screen.getByText(/this alarm subject no longer available/i),
    ).toBeInTheDocument();
  });

  it("says nothing for a key that IS offered", () => {
    render(
      <DataKeyPicker
        keys={KEYS}
        value="v.altitude"
        onChange={() => undefined}
      />,
    );
    expect(screen.queryByText(/no longer available/i)).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).not.toHaveAttribute("aria-invalid");
  });

  it("says nothing while the vocabulary has not arrived", () => {
    // An empty key list is a catalogue that has not loaded, not a retired key.
    // Judging it as retired would report every widget broken on mount.
    render(
      <DataKeyPicker keys={[]} value="v.altitude" onChange={() => undefined} />,
    );
    expect(screen.queryByText(/no longer available/i)).not.toBeInTheDocument();
  });

  it("says nothing when nothing is picked yet", () => {
    render(
      <DataKeyPicker keys={KEYS} value={null} onChange={() => undefined} />,
    );
    expect(screen.queryByText(/no longer available/i)).not.toBeInTheDocument();
  });
});
