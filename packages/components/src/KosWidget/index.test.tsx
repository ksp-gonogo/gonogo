import { clearRegistry, registerDataSource } from "@gonogo/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { KosWidgetComponent } from "./index";

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

function registerFakeComputeSource(
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

describe("KosWidget", () => {
  afterEach(() => {
    cleanup();
    clearRegistry();
  });

  it("shows the 'not configured' hint when cpu/script are missing", () => {
    render(<KosWidgetComponent config={{}} />);
    expect(screen.getByText(/Configure the CPU tagname/)).toBeInTheDocument();
  });

  it("dispatches on Run click and renders parsed key/value pairs", async () => {
    const user = userEvent.setup();
    registerFakeComputeSource(async (_cpu, _script, _args) => ({
      dv: 1234.5,
      stage: 2,
      burning: true,
    }));

    render(
      <KosWidgetComponent
        config={{
          cpu: "datastream",
          script: "deltav",
          args: [],
          mode: "command",
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => {
      expect(screen.getByText("dv")).toBeInTheDocument();
    });
    expect(screen.getByText("1234.500")).toBeInTheDocument();
    expect(screen.getByText("stage")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("burning")).toBeInTheDocument();
    expect(screen.getByText("true")).toBeInTheDocument();
  });

  it("surfaces a clickable error banner when the dispatch rejects", async () => {
    const user = userEvent.setup();
    registerFakeComputeSource(() =>
      Promise.reject(new Error("boom: script exploded")),
    );

    render(
      <KosWidgetComponent
        config={{
          cpu: "datastream",
          script: "bad",
          args: [],
          mode: "command",
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => {
      expect(screen.getByText(/Last call failed/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/boom: script exploded/)).not.toBeInTheDocument();

    // Clicking the banner toggles the detail panel.
    await user.click(screen.getByRole("button", { name: "Show last error" }));
    expect(screen.getByText(/boom: script exploded/)).toBeInTheDocument();
  });

  it("keeps last good data visible on the next failure", async () => {
    const user = userEvent.setup();
    let calls = 0;
    registerFakeComputeSource(async () => {
      calls += 1;
      if (calls === 1) return { v: 42 };
      throw new Error("second call failed");
    });

    render(
      <KosWidgetComponent
        config={{ cpu: "c", script: "s", args: [], mode: "command" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => {
      expect(screen.getByText(/Last call failed/)).toBeInTheDocument();
    });
    // 42 still visible under the error banner.
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("has no accessible violations rendering parsed key/value pairs", async () => {
    const user = userEvent.setup();
    registerFakeComputeSource(async (_cpu, _script, _args) => ({
      dv: 1234.5,
      stage: 2,
      burning: true,
    }));

    const { container } = render(
      <KosWidgetComponent
        config={{
          cpu: "datastream",
          script: "deltav",
          args: [],
          mode: "command",
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => {
      expect(screen.getByText("dv")).toBeInTheDocument();
    });

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
