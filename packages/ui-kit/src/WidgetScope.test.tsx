import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { WidgetMetaContext } from "./WidgetMetaContext";
import { useWidgetScope, WidgetScopeProvider } from "./WidgetScope";

function ScopeProbe({ host }: { host: string }) {
  const scope = useWidgetScope(host) as { resource?: string } | undefined;
  return <span>{scope?.resource ?? "no scope"}</span>;
}

function Host({
  componentId,
  scope,
  children,
}: {
  componentId: string;
  scope: Record<string, unknown>;
  children: React.ReactNode;
}) {
  return (
    <WidgetMetaContext.Provider value={{ componentId, contributionSlots: [] }}>
      <WidgetScopeProvider scope={scope}>{children}</WidgetScopeProvider>
    </WidgetMetaContext.Provider>
  );
}

describe("useWidgetScope", () => {
  it("hands an augment what the host widget is currently focused on", () => {
    render(
      <Host componentId="power-systems" scope={{ resource: "ElectricCharge" }}>
        <ScopeProbe host="power-systems" />
      </Host>,
    );

    expect(screen.getByText("ElectricCharge")).toBeInTheDocument();
  });

  it("reads nothing when the augment names a widget it is not inside", () => {
    render(
      <Host componentId="scanning" scope={{ resource: "ElectricCharge" }}>
        <ScopeProbe host="power-systems" />
      </Host>,
    );

    expect(screen.getByText("no scope")).toBeInTheDocument();
  });

  it("reads nothing outside any provider, the isolated-render case", () => {
    render(<ScopeProbe host="power-systems" />);

    expect(screen.getByText("no scope")).toBeInTheDocument();
  });
});
