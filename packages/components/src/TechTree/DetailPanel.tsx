import {
  CloseIcon,
  type CommandButtonHandle,
  IconButton,
  NULL_DISPLAY,
  Stack,
  SubjectHeading,
  Text,
  Unit,
  type UnitValue,
} from "@ksp-gonogo/ui-kit";
import { NodeDescription, NodeParts, NodeRequires } from "./NodeFacts";
import { UnlockControl } from "./UnlockControl";
import type { UnlockHandlers } from "./unlock";
import type { TechNode } from "./wire";

/** The most parts the pane lists before collapsing the rest into a count. */
const PARTS_LISTED = 6;

interface DetailPanelProps {
  node: TechNode;
  onClose: () => void;
  unlockCmd: CommandButtonHandle;
  unlock: UnlockHandlers;
  scienceShown: UnitValue<"science">;
  chargesScience: boolean;
}

/** The selected node's facts, for `Panel`'s sidebar. */
export function DetailPanel({
  node,
  onClose,
  unlockCmd,
  unlock,
  scienceShown,
  chargesScience,
}: Readonly<DetailPanelProps>) {
  return (
    <Stack as="section" aria-label={`${node.title} details`}>
      <SubjectHeading
        status={
          <IconButton
            type="button"
            onClick={onClose}
            aria-label="Close details"
          >
            <CloseIcon size={14} aria-hidden="true" />
          </IconButton>
        }
      >
        <Text weight="semibold">{node.title}</Text>
        <Text level="faint" size="xs">
          ({node.id})
        </Text>
      </SubjectHeading>
      <NodeDescription node={node} />
      {node.state !== "Available" && !unlock.isResearchable && (
        <Text level="muted" size="sm">
          {node.scienceCost ?? NULL_DISPLAY}
          <Unit>science</Unit>
        </Text>
      )}
      <NodeRequires node={node} />
      <NodeParts node={node} limit={PARTS_LISTED} />
      {unlock.isResearchable && (
        <UnlockControl
          node={node}
          unlockCmd={unlockCmd}
          unlock={unlock}
          scienceShown={scienceShown}
          chargesScience={chargesScience}
        />
      )}
    </Stack>
  );
}
