import { CommandBlock } from "@ksp-gonogo/ui";
import { Disclosure, SectionTitle, Stack, Text } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { DocLink } from "../firstRun/steps/StepParts";
import { HELP_TOPICS, type HelpBlock } from "./helpTopics";

/**
 * The Help tab: how to install the Gonogo mod and its Uplinks, point this app
 * at the game, tell whether telemetry is arriving, and what an empty widget
 * means. Each topic opens on its own so a long page does not bury the one the
 * operator came for.
 */
export function HelpSettings() {
  return (
    <Stack as="section" gap="related-comfortable">
      <SectionTitle as="h3" $rule>
        Help
      </SectionTitle>
      {HELP_TOPICS.map((topic) => (
        <Disclosure
          key={topic.id}
          variant="inline"
          panelHeight="auto"
          label={topic.title}
        >
          <Stack gap="related">
            {topic.blocks.map((block, index) => (
              // Blocks are static data in a fixed order.
              // biome-ignore lint/suspicious/noArrayIndexKey: static, never reordered
              <HelpBlockView key={index} block={block} />
            ))}
          </Stack>
        </Disclosure>
      ))}
    </Stack>
  );
}

function HelpBlockView({ block }: Readonly<{ block: HelpBlock }>) {
  switch (block.kind) {
    case "text":
      return (
        <Text level="muted" size="sm">
          {block.text}
        </Text>
      );
    case "list":
      return (
        <HelpList>
          {block.items.map((item) => (
            <li key={item}>
              <Text level="muted" size="sm">
                {item}
              </Text>
            </li>
          ))}
        </HelpList>
      );
    case "link":
      return <DocLink href={block.href}>{block.label}</DocLink>;
    case "command":
      return <CommandBlock command={block.command} label={block.label} />;
  }
}

const HelpList = styled.ul`
  margin: 0;
  padding-left: 1.2em;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;
