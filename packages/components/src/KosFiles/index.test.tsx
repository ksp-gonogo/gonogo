import { clearRegistry, registerDataSource } from "@gonogo/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { KosFilesComponent } from "./index";

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

describe("KosFilesComponent", () => {
  afterEach(() => {
    cleanup();
    clearRegistry();
  });

  it("shows the configure-CPU placeholder when not configured", () => {
    render(<KosFilesComponent config={{}} />);
    expect(
      screen.getByText(/Configure a kOS CPU tagname/i),
    ).toBeInTheDocument();
  });

  it("renders the volume listing on dispatch and lets the user open a file", async () => {
    const user = userEvent.setup();
    let callCount = 0;
    registerFakeKos(async (_cpu, _script, args) => {
      callCount += 1;
      const op = args[0];
      const target = args[1];
      if (op === "list") {
        return {
          op: "list",
          volume: String(target),
          listing: JSON.stringify([
            { name: "shipmap.ks", size: 1234 },
            { name: "boot.ks", size: 256 },
          ]),
        };
      }
      // op === "read" — JSON.stringify wraps the string in quotes, which is
      // the contract the script-side bulk REPLACE produces.
      return {
        op: "read",
        path: String(target),
        contents: JSON.stringify('print "hello".\n'),
      };
    });

    render(<KosFilesComponent config={{ cpu: "MainCPU", volume: "0:" }} />);

    // The widget auto-dispatches once on mount because its view changes
    // from undefined → list. Wait for the listing to render.
    expect(await screen.findByText("shipmap.ks")).toBeInTheDocument();
    expect(screen.getByText("boot.ks")).toBeInTheDocument();
    expect(callCount).toBeGreaterThanOrEqual(1);

    // Click a file → switches to viewer mode and re-dispatches with op=read.
    await user.click(screen.getByText("shipmap.ks"));

    expect(await screen.findByText(/print "hello"\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back/i })).toBeInTheDocument();

    // Back returns to listing without losing the previous payload entirely.
    await user.click(screen.getByRole("button", { name: /Back/i }));
    expect(await screen.findByText("shipmap.ks")).toBeInTheDocument();
  });

  it("surfaces a payload-side error when the script reports not-found", async () => {
    const user = userEvent.setup();
    registerFakeKos(async (_cpu, _script, args) => {
      const op = args[0];
      if (op === "list") {
        return {
          op: "list",
          volume: "0:",
          listing: JSON.stringify([{ name: "ghost.ks", size: 0 }]),
        };
      }
      return { op: "read", path: String(args[1]), error: "not-found" };
    });

    render(<KosFilesComponent config={{ cpu: "MainCPU", volume: "0:" }} />);

    expect(await screen.findByText("ghost.ks")).toBeInTheDocument();
    await user.click(screen.getByText("ghost.ks"));

    // Error path renders the KosScriptFrame's error banner. The exact
    // affordance is "Show error detail" via aria-label.
    expect(
      await screen.findByRole("button", { name: /Show error detail/i }),
    ).toBeInTheDocument();
  });
});
