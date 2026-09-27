import "../../dist/stories/registrations";
import { getAugments, getComponents } from "@ksp-gonogo/core";
import { getContributions } from "@ksp-gonogo/sitrep-sdk/spine";
import { Section, Stat, StatStrip, Text } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import coverage from "../../dist/stories/coverage.json";
import { withGonogoFrame } from "../frame";

/** Ids on one side and not the other. */
function difference(from: readonly string[], to: readonly string[]): string[] {
  const other = new Set(to);
  return from.filter((id) => !other.has(id)).sort();
}

/**
 * Every widget, augment and contribution the registries hold, against what
 * the generated stories cover. Throws when a registration has no story or a
 * story names nothing registered, so the smoke check fails on either drift.
 */
function Coverage() {
  const widgets = getComponents().map((d) => d.id);
  const extensions = [
    ...getAugments().map((a) => a.id),
    ...getContributions().map((c) => c.id),
  ];
  const uncovered = [
    ...difference(widgets, coverage.widgets),
    ...difference(extensions, coverage.extensions),
  ];
  const stale = [
    ...difference(coverage.widgets, widgets),
    ...difference(coverage.extensions, extensions),
  ];
  if (uncovered.length > 0) {
    throw new Error(`Registered with no story: ${uncovered.join(", ")}`);
  }
  if (stale.length > 0) {
    throw new Error(`A story names nothing registered: ${stale.join(", ")}`);
  }
  return (
    <Section title="Story coverage">
      <StatStrip>
        <Stat label="Widgets">{widgets.length}</Stat>
        <Stat label="Extensions">{extensions.length}</Stat>
      </StatStrip>
      <Text>Every registration has a story.</Text>
    </Section>
  );
}

const meta = {
  title: "Coverage",
  component: Coverage,
  decorators: [withGonogoFrame],
} satisfies Meta<typeof Coverage>;

export default meta;

export const Registry: StoryObj<typeof meta> = {};
