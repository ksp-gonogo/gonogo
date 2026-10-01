import {
  CommandButton,
  type CommandButtonHandle,
  ExpandableText,
  NULL_DISPLAY,
  Unit,
} from "@ksp-gonogo/ui-kit";
import {
  CloseBtn,
  Cost,
  Description,
  Detail,
  DetailHead,
  DetailMeta,
  DetailTitle,
  NodeId,
  ParentChip,
  ParentsInline,
  PartCategory,
  PartMeta,
  PartPurchased,
  PartRow,
  Parts,
  PartsLabel,
  PartsList,
  PartTitle,
  UnlockRow,
} from "./styles";
import type { UnlockHandlers } from "./unlock";
import type { TechNode } from "./wire";

interface DetailPanelProps {
  node: TechNode | null;
  onClose: () => void;
  /**
   * The shared unlock handle. The control's own `CommandButton` holds its arm
   * and in-flight state, so no armed-id or pending-id travels down here.
   */
  unlockCmd: CommandButtonHandle;
  unlock: UnlockHandlers | null;
}

export function DetailPanel({
  node,
  onClose,
  unlockCmd,
  unlock,
}: Readonly<DetailPanelProps>) {
  if (!node) return null;
  return (
    <Detail role="dialog" aria-label={`${node.title} details`}>
      <DetailHead>
        <DetailTitle>
          {node.title}
          <NodeId>({node.id})</NodeId>
        </DetailTitle>
        <CloseBtn type="button" onClick={onClose} aria-label="Close details">
          ✕
        </CloseBtn>
      </DetailHead>
      {node.description && (
        <Description>
          <ExpandableText subject={node.title}>
            {node.description}
          </ExpandableText>
        </Description>
      )}
      <DetailMeta>
        {node.state !== "Available" && (
          <Cost>
            {node.scienceCost ?? NULL_DISPLAY}
            <Unit>science</Unit>
          </Cost>
        )}
        {node.parents.length > 0 && (
          <ParentsInline>
            requires{" "}
            {node.parents.map((p, i) => (
              <span key={p}>
                {i > 0 && ", "}
                <ParentChip>{p}</ParentChip>
              </span>
            ))}
          </ParentsInline>
        )}
      </DetailMeta>
      {node.parts.length > 0 && (
        <Parts>
          <PartsLabel>Parts ({node.parts.length})</PartsLabel>
          <PartsList>
            {node.parts.slice(0, 6).map((p) => (
              <PartRow key={p.name} $purchased={p.purchased}>
                <PartTitle title={p.manufacturer || undefined}>
                  {p.title}
                </PartTitle>
                <PartMeta>
                  {p.category && <PartCategory>{p.category}</PartCategory>}
                  {p.purchased && <PartPurchased>✓</PartPurchased>}
                </PartMeta>
              </PartRow>
            ))}
            {node.parts.length > 6 && (
              <PartRow $purchased={false}>
                <PartTitle>+{node.parts.length - 6} more...</PartTitle>
                <PartMeta />
              </PartRow>
            )}
          </PartsList>
        </Parts>
      )}
      {unlock?.isResearchable && (
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
          />
        </UnlockRow>
      )}
    </Detail>
  );
}
