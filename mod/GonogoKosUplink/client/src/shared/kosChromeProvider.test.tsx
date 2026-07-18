import { getChromeProviders } from "@ksp-gonogo/core";
import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
// Importing the real module runs its module-load registerChromeProvider()
// call — same pattern as other self-registration tests in this repo. NOT
// cleared in afterEach: registration is a one-time module-load side effect
// (this module is only imported once per process), so a stray
// clearChromeProviders() here would leave later tests in this file (or, if
// this were the last file loaded, no one) without it re-registering.
import "./kosChromeProvider";
import { useCpuRegistryService } from "./CpuRegistryContext";
import { CpuRegistryService } from "./CpuRegistryService";

function ConsumesRegistry() {
  const svc = useCpuRegistryService();
  const tags = svc
    .list()
    .map((e) => e.tagname)
    .join(",");
  return <div>tags:{tags}</div>;
}

describe("kos chrome provider registration", () => {
  it("registers a kos-cpu-registry provider whose Provider re-supplies a CpuRegistryService", () => {
    const kosDef = getChromeProviders().find(
      (d) => d.id === "kos-cpu-registry",
    );
    expect(kosDef).toBeDefined();
    if (!kosDef) throw new Error("kos-cpu-registry provider not registered");

    const service = new CpuRegistryService("main");
    service.upsert({ tagname: "probe", label: "Probe Brain" });

    render(
      <kosDef.Provider value={service}>
        <ConsumesRegistry />
      </kosDef.Provider>,
    );
    expect(screen.getByText("tags:probe")).toBeTruthy();
  });
});
