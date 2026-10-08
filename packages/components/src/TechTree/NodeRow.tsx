import {
  Badge,
  Card,
  Cluster,
  type CommandButtonHandle,
  NULL_DISPLAY,
  Row,
  RowName,
  Stack,
  Text,
  Unit,
  type UnitValue,
} from "@ksp-gonogo/ui-kit";
import { type DisplayState, displayTone } from "./graph-layout";
import { NodeDescription, NodeParts, NodeRequires } from "./NodeFacts";
import { UnlockControl } from "./UnlockControl";
import type { UnlockHandlers } from "./unlock";
import type { TechNode } from "./wire";

interface NodeRowProps {
  node: TechNode;
  display: DisplayState;
  expanded: boolean;
  onToggleExpand: () => void;
  /** See `DetailPanelProps.unlockCmd`. */
  unlockCmd: CommandButtonHandle;
  unlock: UnlockHandlers;
  scienceShown: UnitValue<"science">;
  chargesScience: boolean;
}

const STATE_LABEL: Record<DisplayState, string> = {
  owned: "Owned",
  researchable: "Researchable",
  locked: "Locked",
};

function affordDataAttr(
  display: DisplayState,
  unlock: UnlockHandlers,
): "yes" | "no" | undefined {
  if (display !== "researchable" || !unlock.moneyDecides) return undefined;
  return unlock.canAfford ? "yes" : "no";
}

export function NodeRow({
  node,
  display,
  expanded,
  onToggleExpand,
  unlockCmd,
  unlock,
  scienceShown,
  chargesScience,
}: Readonly<NodeRowProps>) {
  // Researchable but unaffordable: dim the row and colour the price.
  const unaffordable =
    display === "researchable" && unlock.moneyDecides && !unlock.canAfford;

  return (
    <Card
      as="li"
      tone={unaffordable ? "neutral" : displayTone(display)}
      dimmed={display === "locked" || unaffordable}
    >
      <Row
        as="button"
        type="button"
        interactive
        wrap
        onClick={onToggleExpand}
        aria-expanded={expanded}
      >
        <RowName>
          <Text weight="semibold">{node.title}</Text>{" "}
          <Text level="faint" size="xs">
            ({node.id})
          </Text>
        </RowName>
        <Cluster gap="related" wrap>
          {display !== "owned" && (
            <Text
              tone={unaffordable ? "nogo" : undefined}
              level={display === "locked" ? "faint" : undefined}
              size="sm"
              // Exposed so the verdict can be asserted rather than read off a colour; absent where money decides nothing.
              data-afford={affordDataAttr(display, unlock)}
            >
              {node.scienceCost ?? NULL_DISPLAY}
              <Unit>science</Unit>
            </Text>
          )}
          <Badge tone={displayTone(display)} size="sm">
            {STATE_LABEL[display]}
          </Badge>
        </Cluster>
      </Row>
      {expanded && (
        <Stack gap="section">
          <NodeDescription node={node} />
          <NodeRequires node={node} />
          <NodeParts node={node} showEntryCost />
          {display === "researchable" && (
            <UnlockControl
              node={node}
              unlockCmd={unlockCmd}
              unlock={unlock}
              scienceShown={scienceShown}
              chargesScience={chargesScience}
            />
          )}
        </Stack>
      )}
    </Card>
  );
}
