import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  CommandButton,
  type CommandButtonHandle,
  ExpandableText,
  NULL_DISPLAY,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { DisplayState } from "./graph-layout";
import {
  Cost,
  Description,
  NodeBody,
  NodeHeader,
  NodeId,
  NodeMeta,
  NodeRowWrap,
  NodeTitle,
  NodeTitleText,
  ParentChip,
  Parents,
  ParentsLabel,
  ParentsList,
  PartCategory,
  PartCost,
  PartMeta,
  PartPurchased,
  PartRow,
  Parts,
  PartsLabel,
  PartsList,
  PartTitle,
  StateBadge,
  UnlockRow,
} from "./styles";
import type { TechNode } from "./wire";

interface NodeRowProps {
  node: TechNode;
  display: DisplayState;
  expanded: boolean;
  onToggleExpand: () => void;
  /** See `DetailPanelProps.unlockCmd`. */
  unlockCmd: CommandButtonHandle;
  canUnlock: boolean;
  canAfford: boolean;
  /** Whether the balance decides this unlock at all; false where the command is refused outright or nothing charges science. */
  moneyDecides: boolean;
  affordTooltip?: string;
}

function stateBadge(display: DisplayState): {
  tone: "go" | "accent" | "muted";
  label: string;
} {
  if (display === "owned") return { tone: "go", label: "Owned" };
  if (display === "researchable")
    return { tone: "accent", label: "Researchable" };
  return { tone: "muted", label: "Locked" };
}

function affordDataAttr(
  display: DisplayState,
  moneyDecides: boolean,
  canAfford: boolean,
): "yes" | "no" | undefined {
  if (display !== "researchable" || !moneyDecides) return undefined;
  return canAfford ? "yes" : "no";
}

export function NodeRow({
  node,
  display,
  expanded,
  onToggleExpand,
  unlockCmd,
  canUnlock,
  canAfford,
  moneyDecides,
  affordTooltip,
}: Readonly<NodeRowProps>) {
  const { tone: stateBadgeTone, label: badgeLabel } = stateBadge(display);
  // Researchable but unaffordable: grey the row and recolour the cost.
  const unaffordable = display === "researchable" && moneyDecides && !canAfford;

  return (
    <NodeRowWrap $display={display} $unaffordable={unaffordable}>
      <NodeHeader
        type="button"
        onClick={onToggleExpand}
        aria-expanded={expanded}
      >
        <NodeTitle>
          <NodeTitleText>{node.title}</NodeTitleText>
          <NodeId>({node.id})</NodeId>
        </NodeTitle>
        <NodeMeta>
          {display !== "owned" && (
            <Cost
              $insufficient={unaffordable}
              // Exposed so the verdict can be asserted rather than read off a colour; absent where money decides nothing.
              data-afford={affordDataAttr(display, moneyDecides, canAfford)}
            >
              {node.scienceCost ?? NULL_DISPLAY}
              <Unit>science</Unit>
            </Cost>
          )}
          <StateBadge $tone={stateBadgeTone}>{badgeLabel}</StateBadge>
        </NodeMeta>
      </NodeHeader>
      {expanded && (
        <NodeBody>
          {node.description && (
            <Description>
              <ExpandableText subject={node.title}>
                {node.description}
              </ExpandableText>
            </Description>
          )}
          {node.parents.length > 0 && (
            <Parents>
              <ParentsLabel>Requires</ParentsLabel>
              <ParentsList>
                {node.parents.map((p) => (
                  <ParentChip key={p}>{p}</ParentChip>
                ))}
              </ParentsList>
            </Parents>
          )}
          {node.parts.length > 0 && (
            <Parts>
              <PartsLabel>Parts ({node.parts.length})</PartsLabel>
              <PartsList>
                {node.parts.map((p) => (
                  <PartRow key={p.name} $purchased={p.purchased}>
                    <PartTitle title={p.manufacturer || undefined}>
                      {p.title}
                    </PartTitle>
                    <PartMeta>
                      {p.category && <PartCategory>{p.category}</PartCategory>}
                      {p.entryCost > 0 && !p.purchased && (
                        <PartCost>
                          <Unit value={value("funds", p.entryCost)} />
                        </PartCost>
                      )}
                      {p.purchased && <PartPurchased>✓</PartPurchased>}
                    </PartMeta>
                  </PartRow>
                ))}
              </PartsList>
            </Parts>
          )}
          {display === "researchable" && (
            <UnlockRow>
              <CommandButton
                handle={unlockCmd}
                args={{ techId: node.id }}
                commandLabel={`Unlock ${node.title}`}
                size="sm"
                label="Unlock"
                confirmLabel={
                  <>
                    Confirm unlock: {node.scienceCost ?? NULL_DISPLAY}
                    <Unit>science</Unit>
                  </>
                }
                pendingLabel="Unlocking..."
                disabled={!canUnlock}
                title={affordTooltip}
              />
            </UnlockRow>
          )}
        </NodeBody>
      )}
    </NodeRowWrap>
  );
}
