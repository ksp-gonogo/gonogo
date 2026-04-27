import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRegistry,
  getComponent,
  getComponents,
  getDataSources,
  getTheme,
  getThemes,
  registerComponent,
  registerDataSource,
  registerTheme,
} from "./registry";
import type { ComponentDefinition, DataSource, ThemeDefinition } from "./types";

const mockComponent: ComponentDefinition = {
  id: "test-component",
  name: "Test Component",
  category: "test",
  component: () => null,
  dataRequirements: [],
  behaviors: [],
  defaultConfig: {},
};

const mockDataSource: DataSource = {
  id: "test-source",
  name: "Test Source",
  status: "disconnected",
  connect: async () => {},
  disconnect: () => {},
  schema: () => [],
  subscribe: () => () => {},
  onStatusChange: () => () => {},
};

const mockTheme: ThemeDefinition = {
  id: "test-theme",
  name: "Test Theme",
  theme: {
    colors: {
      text: {
        primary: "#fff",
        muted: "#fff",
        dim: "#fff",
        faint: "#fff",
        inverse: "#000",
      },
      surface: {
        app: "#000",
        panel: "#000",
        raised: "#000",
        sunken: "#000",
      },
      border: { subtle: "#222", strong: "#444" },
      accent: { fg: "#0f0", bg: "#0f0" },
      status: {
        go: { fg: "#0f0", bg: "#020" },
        nogo: { fg: "#f00", bg: "#200" },
        warning: { fg: "#fa0", bg: "#210" },
        info: { fg: "#7cf", bg: "#012" },
      },
      focus: "#0f0",
    },
    typography: {
      family: { mono: "monospace" },
      size: { xs: "10px", sm: "12px", base: "14px", lg: "16px" },
      weight: { regular: 400, bold: 700 },
      letterSpacing: { label: "0.1em", body: "0" },
    },
    space: { xs: "2px", sm: "4px", md: "8px", lg: "12px", xl: "16px" },
    radii: { sm: "2px", md: "4px" },
    borders: { subtle: "1px solid #222", strong: "1px solid #444" },
  },
};

beforeEach(() => {
  clearRegistry();
});

describe("registerComponent / getComponent / getComponents", () => {
  it("retrieves a registered component by id", () => {
    registerComponent(mockComponent);
    expect(getComponent("test-component")).toBe(mockComponent);
  });

  it("returns undefined for an unregistered id", () => {
    expect(getComponent("nope")).toBeUndefined();
  });

  it("returns all registered components", () => {
    registerComponent(mockComponent);
    expect(getComponents()).toHaveLength(1);
    expect(getComponents()[0]).toBe(mockComponent);
  });

  it("overwrites a component registered with the same id", () => {
    registerComponent(mockComponent);
    const updated = { ...mockComponent, name: "Updated" };
    registerComponent(updated);
    expect(getComponent("test-component")?.name).toBe("Updated");
    expect(getComponents()).toHaveLength(1);
  });
});

describe("registerDataSource / getDataSources", () => {
  it("returns all registered data sources", () => {
    registerDataSource(mockDataSource);
    expect(getDataSources()).toHaveLength(1);
    expect(getDataSources()[0]).toBe(mockDataSource);
  });

  it("returns empty array when none are registered", () => {
    expect(getDataSources()).toHaveLength(0);
  });
});

describe("registerTheme / getTheme / getThemes", () => {
  it("retrieves a registered theme by id", () => {
    registerTheme(mockTheme);
    expect(getTheme("test-theme")).toBe(mockTheme);
  });

  it("returns undefined for an unregistered id", () => {
    expect(getTheme("nope")).toBeUndefined();
  });

  it("returns all registered themes", () => {
    registerTheme(mockTheme);
    expect(getThemes()).toHaveLength(1);
  });
});

describe("clearRegistry", () => {
  it("clears all registries", () => {
    registerComponent(mockComponent);
    registerDataSource(mockDataSource);
    registerTheme(mockTheme);

    clearRegistry();

    expect(getComponents()).toHaveLength(0);
    expect(getDataSources()).toHaveLength(0);
    expect(getThemes()).toHaveLength(0);
  });
});
