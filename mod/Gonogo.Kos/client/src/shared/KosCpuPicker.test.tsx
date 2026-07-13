import { CpuRegistryProvider, CpuRegistryService } from "@ksp-gonogo/data";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { KosCpuPicker } from "./KosCpuPicker";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

function Wrapper({
  service,
  children,
}: {
  service: CpuRegistryService;
  children: ReactNode;
}) {
  return (
    <CpuRegistryProvider service={service}>{children}</CpuRegistryProvider>
  );
}

function ControlledPicker({
  service,
  initial = "",
}: {
  service: CpuRegistryService;
  initial?: string;
}) {
  const [v, setV] = useState(initial);
  return (
    <Wrapper service={service}>
      <KosCpuPicker value={v} onChange={setV} placeholder="Pick a CPU" />
      <output data-testid="value">{v}</output>
    </Wrapper>
  );
}

describe("KosCpuPicker", () => {
  let service: CpuRegistryService;
  beforeEach(() => {
    service = new CpuRegistryService("main", new MemoryStorage());
  });

  afterEach(() => {
    cleanup();
  });

  it("lists existing entries when opened", async () => {
    service.upsert({ tagname: "lander", label: "Lander Computer" });
    service.upsert({ tagname: "orbital", description: "Bus" });
    const user = userEvent.setup();

    render(<ControlledPicker service={service} />);
    await user.click(screen.getByRole("combobox"));

    expect(screen.getByText("Lander Computer")).toBeDefined();
    expect(screen.getByText("orbital")).toBeDefined();
    expect(screen.getByText("Bus")).toBeDefined();
  });

  it("selecting an entry calls onChange and closes the dropdown", async () => {
    service.upsert({ tagname: "flight", label: "Flight" });
    const user = userEvent.setup();

    render(<ControlledPicker service={service} />);
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByText("Flight"));

    expect(screen.getByTestId("value").textContent).toBe("flight");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("typing offers a quick-add suggestion when no match exists", async () => {
    const user = userEvent.setup();
    render(<ControlledPicker service={service} />);

    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "newcpu");

    const suggestion = screen.getByText(/Save .* as a new CPU tagname/);
    expect(suggestion.textContent).toContain("newcpu");
    await user.click(suggestion);

    expect(screen.getByTestId("value").textContent).toBe("newcpu");
    expect(service.get("newcpu")).toBeDefined();
  });

  it("clicking + Add CPU... opens the inline form (not closes the dropdown)", async () => {
    // Regression: the "+ Add CPU..." button switches mode → unmounts itself
    // mid-event. The document outside-click handler then sees a detached
    // target and used to call closePicker(), snapping the dropdown shut
    // before the form could render.
    const user = userEvent.setup();
    render(<ControlledPicker service={service} />);

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("button", { name: /Add CPU/i }));

    // The Add form should now be visible — its Tagname field is the
    // canonical witness that the picker stayed open.
    expect(screen.getByLabelText("Tagname")).toBeDefined();
  });

  it("Add CPU form persists tagname + label + description", async () => {
    const user = userEvent.setup();
    render(<ControlledPicker service={service} />);

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("button", { name: /Add CPU/i }));

    await user.type(screen.getByLabelText("Tagname"), "probe");
    await user.type(screen.getByLabelText(/Label/), "Probe Brain");
    await user.type(
      screen.getByLabelText(/Description/),
      "Long-range science probe",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByTestId("value").textContent).toBe("probe");
    const stored = service.get("probe");
    expect(stored?.label).toBe("Probe Brain");
    expect(stored?.description).toBe("Long-range science probe");
  });

  it("displays a non-registry value as the selected display", () => {
    render(<ControlledPicker service={service} initial="legacy-cpu" />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input.value).toBe("legacy-cpu");
  });

  it("Manage view edits an entry's label and description", async () => {
    service.upsert({ tagname: "lander", label: "Lander", description: "old" });
    const user = userEvent.setup();

    render(<ControlledPicker service={service} />);
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("button", { name: /Manage CPUs/i }));
    await user.click(screen.getByRole("button", { name: "Edit" }));

    const labelInput = screen.getByLabelText("Label") as HTMLInputElement;
    await user.clear(labelInput);
    await user.type(labelInput, "Mun Lander");
    const descInput = screen.getByLabelText(
      "Description",
    ) as HTMLTextAreaElement;
    await user.clear(descInput);
    await user.type(descInput, "Suicide-burn computer");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const stored = service.get("lander");
    expect(stored?.label).toBe("Mun Lander");
    expect(stored?.description).toBe("Suicide-burn computer");
  });

  it("Manage view delete needs a second click to confirm", async () => {
    service.upsert({ tagname: "probe" });
    const user = userEvent.setup();

    render(<ControlledPicker service={service} />);
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("button", { name: /Manage CPUs/i }));

    const deleteBtn = screen.getByRole("button", { name: "Delete" });
    await user.click(deleteBtn);
    expect(service.get("probe")).toBeDefined(); // first click only arms it
    await user.click(screen.getByRole("button", { name: "Confirm?" }));
    expect(service.get("probe")).toBeUndefined();
  });

  it("Manage button is hidden when the registry is empty", async () => {
    const user = userEvent.setup();
    render(<ControlledPicker service={service} />);
    await user.click(screen.getByRole("combobox"));
    expect(screen.queryByRole("button", { name: /Manage CPUs/i })).toBeNull();
  });

  it("filters entries by query", async () => {
    service.upsert({ tagname: "lander", label: "Lander" });
    service.upsert({ tagname: "orbital", label: "Orbital" });
    const user = userEvent.setup();

    render(<ControlledPicker service={service} />);
    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "land");

    expect(screen.getByText("Lander")).toBeDefined();
    expect(screen.queryByText("Orbital")).toBeNull();
  });

  it("has no accessible violations with the dropdown open", async () => {
    service.upsert({ tagname: "lander", label: "Lander Computer" });
    service.upsert({ tagname: "orbital", description: "Bus" });
    const user = userEvent.setup();

    const { container } = render(<ControlledPicker service={service} />);
    await user.click(screen.getByRole("combobox"));

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
