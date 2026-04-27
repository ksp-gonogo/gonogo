import { useScreen } from "@gonogo/core";
import { Switch } from "@gonogo/ui";
import styled from "styled-components";
import type { SettingDefinition } from "./registry";
import { getSettingsForScreen } from "./registry";
import { useSetting } from "./SettingsContext";

/**
 * Auto-renders every registered setting relevant to the current screen,
 * grouped by category. Add a new setting by calling `registerSetting()`
 * — it shows up here on next mount with no modal changes required.
 */
export function SettingsModal() {
  const screen = useScreen();
  const settings = getSettingsForScreen(screen);

  if (settings.length === 0) {
    return <Empty>No settings yet on the {screen} screen.</Empty>;
  }

  const byCategory = new Map<string, SettingDefinition[]>();
  for (const s of settings) {
    const bucket = byCategory.get(s.category);
    if (bucket) bucket.push(s);
    else byCategory.set(s.category, [s]);
  }

  return (
    <Wrap>
      {[...byCategory.entries()].map(([category, items]) => (
        <Section key={category}>
          <SectionTitle>{category}</SectionTitle>
          {items.map((def) => (
            <SettingRow key={def.id} def={def} />
          ))}
        </Section>
      ))}
    </Wrap>
  );
}

function SettingRow({ def }: { def: SettingDefinition }) {
  // Only boolean is defined today. Switch renders inline; its own <label>
  // wrapper supplies the accessible name, and we render the long-form
  // description alongside.
  if (def.type === "boolean") {
    return <BooleanRow def={def} />;
  }
  return null;
}

function BooleanRow({
  def,
}: {
  def: Extract<SettingDefinition, { type: "boolean" }>;
}) {
  const [value, setValue] = useSetting<boolean>(def.id, def.defaultValue);
  return (
    <Row>
      <RowText>
        <RowLabel>{def.label}</RowLabel>
        {def.description && <RowDesc>{def.description}</RowDesc>}
      </RowText>
      <Switch checked={value} onChange={setValue} />
    </Row>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 320px;
`;

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border-subtle);
  padding-bottom: 4px;
`;

const Row = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
`;

const RowText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const RowLabel = styled.span`
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
`;

const RowDesc = styled.span`
  color: var(--color-text-dim);
  font-size: var(--font-size-sm);
  max-width: 32em;
`;

const Empty = styled.div`
  color: var(--color-text-faint);
  font-size: var(--font-size-sm);
  padding: 20px;
  text-align: center;
`;
