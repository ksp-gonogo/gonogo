import { Switch } from "@gonogo/ui";
import { useSyncExternalStore } from "react";
import styled from "styled-components";
import type { KerbcamDataSource } from "../KerbcamDataSource";

/*
 * Settings tab content for the kerbcam connection.
 * Structured to grow: additional global controls slot in as new sections.
 */

interface KerbcamSettingsProps {
  source: KerbcamDataSource;
}

export function KerbcamSettings({ source }: KerbcamSettingsProps) {
  return (
    <SectionStack>
      <Section>
        <SectionTitle>Performance</SectionTitle>
        <ThrottleRow source={source} />
      </Section>
    </SectionStack>
  );
}

function ThrottleRow({ source }: { source: KerbcamDataSource }) {
  const enabled = useSyncExternalStore(
    (cb) => source.onThrottleChange(cb),
    () => source.getThrottleMainScreen(),
  );
  return (
    <Row>
      <RowText>
        <RowLabel>Throttle KSP main render</RowLabel>
        <RowDesc>
          Disables the main KSP flight cameras to free GPU headroom for kerbcam
          streams. Persists across saves.
        </RowDesc>
      </RowText>
      <Switch
        checked={enabled}
        onChange={(next) => {
          void source.setThrottleMainScreen(next);
        }}
      />
    </Row>
  );
}

const SectionStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  min-height: 0;
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
