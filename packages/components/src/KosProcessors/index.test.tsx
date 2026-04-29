import { clearRegistry, registerDataSource } from "@gonogo/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { KosProcessorsComponent } from "./index";

interface FakeSource {
  id: string;
  name: string;
  status: "connected";
  affectedBySignalLoss: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  schema: () => [];
  subscribe: () => () => void;
  onStatusChange: () => () => void;
  execute: () => Promise<void>;
  configSchema: () => [];
  configure: () => void;
  getConfig: () => Record<string, unknown>;
  executeScript: (
    cpu: string,
    script: string,
    args: unknown[],
  ) => Promise<Record<string, unknown>>;
}

function registerFakeKos(
  executeScript: FakeSource["executeScript"],
): FakeSource {
  const src: FakeSource = {
    id: "kos",
    name: "kOS",
    status: "connected",
    affectedBySignalLoss: false,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe: () => () => {},
    onStatusChange: () => () => {},
    execute: async () => {},
    configSchema: () => [],
    configure: () => {},
    getConfig: () => ({}),
    executeScript,
  };
  registerDataSource(
    src as unknown as Parameters<typeof registerDataSource>[0],
  );
  return src;
}

describe("KosProcessorsComponent", () => {
  afterEach(() => {
    cleanup();
    clearRegistry();
  });

  it("shows the 'configure CPU' placeholder when not configured", () => {
    render(<KosProcessorsComponent config={{}} />);
    expect(screen.getByText(/Pick a kOS CPU/i)).toBeInTheDocument();
  });

  it("renders a row per processor and surfaces tag/mode/volume/boot", async () => {
    const user = userEvent.setup();
    registerFakeKos(async () => ({
      processors: JSON.stringify([
        {
          tag: "MainCPU",
          mode: "READY",
          volume: "boot",
          bootFile: "boot/main.ks",
          partTitle: "KAL9000 Scriptable Control System",
          partUid: "uid-1",
        },
        {
          tag: "",
          mode: "OFF",
          volume: "",
          bootFile: "",
          partTitle: "kOS CPU",
          partUid: "uid-2",
        },
      ]),
    }));

    render(<KosProcessorsComponent config={{ cpu: "MainCPU" }} />);

    // Trigger the Run button so the script "executes".
    await user.click(screen.getByRole("button", { name: /Run/i }));

    // Tagged processor — tag and metadata visible.
    expect(await screen.findByText("MainCPU")).toBeInTheDocument();
    expect(screen.getByText(/KAL9000/)).toBeInTheDocument();
    expect(screen.getByText(/vol · boot/)).toBeInTheDocument();
    expect(screen.getByText(/boot · boot\/main\.ks/)).toBeInTheDocument();

    // Untagged processor — falls back to "untagged" label and shows OFF mode.
    expect(screen.getByText(/untagged/i)).toBeInTheDocument();
    expect(screen.getByText("OFF")).toBeInTheDocument();
  });
});
