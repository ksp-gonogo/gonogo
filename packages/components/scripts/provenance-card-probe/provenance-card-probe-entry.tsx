/**
 * Standalone probe for the add-widget picker's provenance UI: a widget card
 * showing the base description plus the `+ <Uplink>` addition lines
 * (`uplinkAdditions`) and the derived search tags (`effectiveSearchTags`).
 *
 * `ComponentOverlay` itself starts closed and is provider + search-state heavy,
 * so this renders a token-faithful copy of its list-item card (same
 * `--font-size-xs` / `--color-text-faint` description and `--color-accent-fg`
 * addition line) driven by the REAL core provenance functions against a live
 * registry: a Kerbalism-like Uplink that augments AND contributes to one
 * widget, and a plain widget for contrast. So the screenshot shows exactly what
 * the picker draws, and it moves if the derivation does.
 */
import {
  type ComponentDefinition,
  clearAugments,
  clearContributions,
  clearRegistry,
  defineUplinkClient,
  effectiveSearchTags,
  registerAugment,
  registerComponent,
  registerContribution,
  uplinkAdditions,
} from "@ksp-gonogo/core";
import { createRoot, type Root } from "react-dom/client";
import styled from "styled-components";

let activeRoot: Root | null = null;

function seedRegistry(): ComponentDefinition[] {
  clearRegistry();
  clearAugments();
  clearContributions();

  const KERBALISM = defineUplinkClient({
    id: "kerbalism",
    version: "0.0.0-dev",
    name: "Kerbalism",
  });

  const augmented: ComponentDefinition = {
    id: "crew-manifest",
    name: "Crew Manifest",
    description: "The vessel's crew, roles, and status.",
    tags: ["telemetry", "crew"],
    component: () => null,
    augmentSlots: ["crew-manifest.rows"],
  };
  const plain: ComponentDefinition = {
    id: "altitude-gauge",
    name: "Altitude Gauge",
    description: "Current altitude above the surface and sea level.",
    tags: ["telemetry"],
    component: () => null,
  };

  registerComponent(augmented);
  registerComponent(plain);
  // Kerbalism augments the crew list, and drops a badge via the auto slot.
  KERBALISM.registerContribution?.({
    id: "kerbalism-crew-badge",
    contributes: "crew-manifest.badges",
    compute: () => [],
  });
  registerAugment({
    id: "kerbalism-crew-rows",
    augments: "crew-manifest.rows",
    owner: KERBALISM,
    component: () => null,
  });

  return [augmented, plain];
}

function WidgetCard({ def }: { def: ComponentDefinition }) {
  return (
    <ListItem>
      <ItemName>{def.name}</ItemName>
      <ItemDesc>{def.description}</ItemDesc>
      {uplinkAdditions(def).map((u) => (
        <UplinkAddLine key={u.id}>+ {u.name}</UplinkAddLine>
      ))}
      <TagRow>
        {effectiveSearchTags(def).map((t) => (
          <Tag key={t}>{t}</Tag>
        ))}
      </TagRow>
    </ListItem>
  );
}

async function renderProvenanceCard(payload: {
  pxW: number;
  pxH: number;
}): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Provenance-card probe: #root missing");
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  root.style.width = `${payload.pxW}px`;
  root.style.height = `${payload.pxH}px`;
  root.innerHTML = "";
  const defs = seedRegistry();
  activeRoot = createRoot(root);
  activeRoot.render(
    <CardList>
      {defs.map((def) => (
        <WidgetCard key={def.id} def={def} />
      ))}
    </CardList>,
  );
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => setTimeout(r, 200));
}

declare global {
  interface Window {
    __renderProvenanceCard: (payload: {
      pxW: number;
      pxH: number;
    }) => Promise<void>;
  }
}

window.__renderProvenanceCard = renderProvenanceCard;

const CardList = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-12);
`;

const ListItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-8) var(--space-12);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
`;

const ItemName = styled.span`
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  font-weight: 600;
`;

const ItemDesc = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  line-height: var(--line-height-body);
`;

const UplinkAddLine = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-accent-fg);
  line-height: var(--line-height-body);
`;

const TagRow = styled.div`
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-top: var(--space-2);
`;

const Tag = styled.span`
  font-size: var(--font-size-2xs);
  color: var(--color-text-muted);
  background: var(--color-surface-raised);
  border-radius: var(--radius-xs);
  padding: var(--space-hair) var(--space-6);
`;
