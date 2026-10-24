import { Button } from "@ksp-gonogo/ui";
import { SectionTitle } from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import styled from "styled-components";
import type { PeerClient } from "../peer/PeerClientContext";
import type { HostLayout } from "../peer/protocol";

type Reading =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "read"; layouts: readonly HostLayout[] };

/**
 * The dashboard layouts saved on the main screen, each with a control that
 * copies it onto this station as a layout of its own. Shown on a station that
 * the main screen has approved. Used by the dashboard layouts dialog.
 */
export function HostLayoutsSection({
  client,
  onUse,
}: Readonly<{
  client: Pick<PeerClient, "requestHostLayouts">;
  onUse: (layout: HostLayout) => void;
}>) {
  const [reading, setReading] = useState<Reading>({ state: "loading" });

  useEffect(() => {
    let current = true;
    client.requestHostLayouts().then(
      (layouts) => current && setReading({ state: "read", layouts }),
      () => current && setReading({ state: "failed" }),
    );
    return () => {
      current = false;
    };
  }, [client]);

  return (
    <>
      <SectionTitle as="h3" $rule>
        Main screen layouts
      </SectionTitle>
      {reading.state === "failed" && (
        <Note>Could not read the main screen&apos;s layouts</Note>
      )}
      {reading.state === "read" && reading.layouts.length === 0 && (
        <Note>No layouts saved on the main screen</Note>
      )}
      {reading.state === "read" &&
        reading.layouts.map((layout) => (
          <LayoutRow key={layout.id}>
            <Button
              type="button"
              aria-label={`Use ${layout.name}`}
              onClick={() => onUse(layout)}
            >
              Use
            </Button>
            <Name>{layout.name}</Name>
          </LayoutRow>
        ))}
    </>
  );
}

const LayoutRow = styled.div`
  display: flex;
  gap: var(--gap-related);
  align-items: center;
`;

const Name = styled.span`
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
`;

const Note = styled.p`
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-caption);
`;
