import { CommandBlock } from "@ksp-gonogo/ui";
import { Disclosure, Kbd, SectionTitle, Stack, Text } from "@ksp-gonogo/ui-kit";
import { Fragment } from "react";
import styled from "styled-components";
import { DocLink } from "../firstRun/steps/StepParts";
import { HELP_TOPICS, type HelpBlock, type Shortcut } from "./helpTopics";

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
    case "shortcuts":
      return <ShortcutTable heading={block.heading} rows={block.rows} />;
  }
}

function ShortcutTable({
  heading,
  rows,
}: Readonly<{ heading?: string; rows: readonly Shortcut[] }>) {
  return (
    <Stack gap="related">
      {heading && (
        <Text level="muted" size="sm">
          {heading}
        </Text>
      )}
      <ShortcutGrid>
        {rows.map((row) => (
          <Fragment key={row.action}>
            <dt>
              {row.keys.map((combo, index) => (
                <Fragment key={combo.join("+")}>
                  {index > 0 && <Joiner>/</Joiner>}
                  <Combo>
                    {combo.map((key, keyIndex) => (
                      <Fragment key={key}>
                        {keyIndex > 0 && <Joiner>+</Joiner>}
                        <Kbd>{key}</Kbd>
                      </Fragment>
                    ))}
                  </Combo>
                </Fragment>
              ))}
            </dt>
            <dd>
              <Text level="muted" size="sm">
                {row.action}
              </Text>
            </dd>
          </Fragment>
        ))}
      </ShortcutGrid>
    </Stack>
  );
}

const HelpList = styled.ul`
  margin: 0;
  padding-left: 1.2em;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const ShortcutGrid = styled.dl`
  display: grid;
  grid-template-columns: fit-content(50%) 1fr;
  align-items: baseline;
  gap: var(--gap-related) var(--gap-related-comfortable);
  margin: 0;

  dt {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--gap-glyph);
  }

  dd {
    margin: 0;
  }
`;

const Combo = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: var(--gap-glyph);
  white-space: nowrap;
`;

const Joiner = styled.span`
  color: var(--color-text-dim);
  font-size: var(--font-size-caption);
`;
