import type { MeterEntry } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  clearContributions,
  registerContribution,
} from "@ksp-gonogo/sitrep-sdk/spine";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { type ContributedEntries, Contribution } from "./Contribution";
import { ContributionsProvider } from "./contributionsRuntime";
import { Meter, MeterStack } from "./Meter";
import { WidgetMetaContext } from "./WidgetMetaContext";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface ContributionRegistry {
    "items-host.notes": { entry: { text: string } };
  }
}

// beforeEach, never afterEach: clearing while the previous tree is mounted would notify a subscriber outside act().
beforeEach(() => {
  clearContributions();
});

function mounted(children: ReactNode, contributionSlots: string[] = []) {
  return render(
    <WidgetMetaContext.Provider
      value={{
        componentId: "items-host",
        contributionSlots: contributionSlots as never,
      }}
    >
      <ContributionsProvider>{children}</ContributionsProvider>
    </WidgetMetaContext.Provider>,
  );
}

function contributeMeters() {
  registerContribution({
    id: "items-meters",
    contributes: "items-host.meters" as never,
    compute: () =>
      [
        {
          id: "rad",
          label: "Radiation",
          value: value("ratio", 0.4),
          row: "Valentina",
          valueLabel: "40 %",
        },
        {
          id: "o2",
          label: "Oxygen",
          value: value("ratio", 0.9),
          row: "Bill",
          valueLabel: "90 %",
        },
        { id: "bat", label: "Battery", value: value("ratio", 0.5) },
      ] as never,
  });
}

function MeterList({ entries }: ContributedEntries<"meters">) {
  return (
    <MeterStack role="group" aria-label="meters">
      {entries.map((entry: MeterEntry) => (
        <Meter
          key={entry.id}
          label={entry.label}
          value={entry.value}
          valueLabel={entry.valueLabel}
        />
      ))}
    </MeterStack>
  );
}

describe("Contribution", () => {
  it("hands the component every contributed entry", () => {
    contributeMeters();
    mounted(<Contribution slot="meters" component={MeterList} />);
    expect(screen.getByText("Radiation")).toBeInTheDocument();
    expect(screen.getByText("Oxygen")).toBeInTheDocument();
    expect(screen.getByText("Battery")).toBeInTheDocument();
    expect(screen.getByText("40 %")).toBeInTheDocument();
  });

  it("keeps only the entries the filter accepts", () => {
    contributeMeters();
    mounted(
      <Contribution
        slot="meters"
        component={MeterList}
        filter={(entry) => entry.row === "Valentina"}
      />,
    );
    expect(screen.getByText("Radiation")).toBeInTheDocument();
    expect(screen.queryByText("Oxygen")).not.toBeInTheDocument();
  });

  it("does not mount the component while no entry survives the filter", () => {
    contributeMeters();
    mounted(
      <Contribution
        slot="meters"
        component={MeterList}
        filter={(entry) => entry.row === "Nobody"}
      />,
    );
    expect(screen.queryByRole("group", { name: "meters" })).toBeNull();
  });

  it("renders nothing for a slot nothing contributes to", () => {
    const { container } = mounted(
      <Contribution slot="meters" component={MeterList} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("draws a component that takes one entry as well as one that takes a list", () => {
    contributeMeters();
    const First = ({ entries }: ContributedEntries<"meters">) => (
      <span>{entries[0].label}</span>
    );
    mounted(<Contribution slot="meters" component={First} />);
    expect(screen.getByText("Radiation")).toBeInTheDocument();
    expect(screen.queryByText("Oxygen")).not.toBeInTheDocument();
  });

  it("draws a slot the widget declares for itself, typed from that slot's own entry", () => {
    registerContribution({
      id: "items-notes",
      contributes: "items-host.notes",
      compute: () => [{ text: "first note" }, { text: "second note" }],
    });
    function NoteList({ entries }: ContributedEntries<"items-host.notes">) {
      return (
        <ul>
          {entries.map((entry) => (
            <li key={entry.text}>{entry.text}</li>
          ))}
        </ul>
      );
    }
    mounted(<Contribution slot="items-host.notes" component={NoteList} />, [
      "items-host.notes",
    ]);
    expect(screen.getByText("first note")).toBeInTheDocument();
    expect(screen.getByText("second note")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    contributeMeters();
    const { container } = mounted(
      <Contribution slot="meters" component={MeterList} />,
    );
    await expectNoA11yViolations(container);
  });
});
