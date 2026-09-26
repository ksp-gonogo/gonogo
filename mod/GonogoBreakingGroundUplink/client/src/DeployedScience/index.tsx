import type { ComponentProps } from "@ksp-gonogo/sitrep-sdk";
import {
  registerComponent,
  stillTrue,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import { EmptyState, Panel, Section } from "@ksp-gonogo/ui-kit";
import { BREAKING_GROUND } from "../uplink";
import { DeployedBaseCard } from "./DeployedBaseCard";
import { type DeployedBase, parseBases } from "./parseBases";

export type { DeployedBase, DeployedExperiment } from "./parseBases";
export { parseBases } from "./parseBases";
export type { DeployedExperimentContext } from "./slots";

/**
 * Every deployed Breaking Ground surface base on every body, loaded or not, with its power balance and per-experiment science progress.
 * Read-only: deployed science auto-transmits and background bases cannot be actioned remotely.
 */
type DeployedScienceConfig = Record<string, never>;

function emptySentence(
  available: boolean | undefined,
  bases: DeployedBase[] | null,
): string {
  if (available === false) return "Breaking Ground not installed";
  if (bases === null) return "Waiting for the deployed-base roster";
  return "No deployed bases";
}

function DeployedScienceComponent(
  _: Readonly<ComponentProps<DeployedScienceConfig>>,
) {
  // The roster is a fact, held through stale; the reading stays named so each progress figure can carry its currency.
  const basesReading = useTelemetry("deployed.bases");
  const available = stillTrue(
    useTelemetry("game.dlc"),
    undefined,
  )?.breakingGround;

  // Null is "could not read", never "no deployed bases".
  const bases = parseBases(stillTrue(basesReading, undefined));

  if (bases === null || bases.length === 0) {
    return (
      <Panel
        panelTitle="DEPLOYED SCIENCE"
        compactTitle={["DEPLOYED SCI", "DEPLOYED"]}
        sections={
          <Section>
            <EmptyState role="status">
              {emptySentence(available, bases)}
            </EmptyState>
          </Section>
        }
      />
    );
  }

  return (
    <Panel
      panelTitle="DEPLOYED SCIENCE"
      compactTitle={["DEPLOYED SCI", "DEPLOYED"]}
      /* One section per base, so a landscape tile runs the cards side by side. */
      sections={bases.map((base) => (
        <Section key={base.id}>
          <DeployedBaseCard base={base} basesReading={basesReading} />
        </Section>
      ))}
    />
  );
}

registerComponent<DeployedScienceConfig>({
  id: "deployed-science",
  name: "Deployed Science",
  description:
    "Power balance and per-experiment science progress for Breaking Ground deployed surface bases on every body, reported even while you fly something else. Read-only.",
  tags: ["telemetry", "science"],
  defaultSize: { w: 5, h: 9 },
  // At four rows the overflow glow covers the last line of the empty state.
  minSize: { w: 4, h: 5 },
  component: DeployedScienceComponent,
  dataRequirements: ["deployed.bases", "game.dlc.breakingGround"],
  defaultConfig: {},
  actions: [],
  augmentSlots: ["deployed-science.experiment"],
  pushable: true,
  owner: BREAKING_GROUND,
});

export { DeployedScienceComponent };
