import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  CheckIcon,
  Cluster,
  ExpandableText,
  Row,
  RowName,
  Stack,
  Text,
  Tooltip,
  Unit,
  VisuallyHidden,
} from "@ksp-gonogo/ui-kit";
import type { TechNode } from "./wire";

export function NodeDescription({ node }: Readonly<{ node: TechNode }>) {
  if (!node.description) return null;
  return (
    <Text level="muted" size="sm">
      <ExpandableText subject={node.title}>{node.description}</ExpandableText>
    </Text>
  );
}

export function NodeRequires({ node }: Readonly<{ node: TechNode }>) {
  if (node.parents.length === 0) return null;
  return (
    <Cluster justify="start" gap="related" wrap>
      <Text level="faint" size="xs">
        Requires
      </Text>
      {node.parents.map((p) => (
        <Badge key={p} size="sm">
          {p}
        </Badge>
      ))}
    </Cluster>
  );
}

interface NodePartsProps {
  node: TechNode;
  /** Parts drawn before a "+N more" line; every part when absent. */
  limit?: number;
  /** Whether an unbought part shows its funds entry cost. */
  showEntryCost?: boolean;
}

export function NodeParts({
  node,
  limit,
  showEntryCost = false,
}: Readonly<NodePartsProps>) {
  if (node.parts.length === 0) return null;
  const shown = limit === undefined ? node.parts : node.parts.slice(0, limit);
  const hidden = node.parts.length - shown.length;
  return (
    <Stack gap="related-packed">
      <Text level="faint" size="xs">
        Parts ({node.parts.length})
      </Text>
      <Stack as="ul" gap="related-dense">
        {shown.map((p) => (
          <Row key={p.name}>
            <Tooltip text={p.manufacturer || undefined} focusable>
              <RowName>
                <Text level={p.purchased ? "faint" : undefined}>{p.title}</Text>
              </RowName>
            </Tooltip>
            <Cluster gap="related" align="baseline">
              {p.category && (
                <Text level="faint" size="xs">
                  {p.category}
                </Text>
              )}
              {showEntryCost && p.entryCost > 0 && !p.purchased && (
                <Text tone="info">
                  <Unit value={value("funds", p.entryCost)} />
                </Text>
              )}
              {p.purchased && (
                <Text tone="go">
                  <CheckIcon size={12} aria-hidden="true" />
                  <VisuallyHidden>Purchased</VisuallyHidden>
                </Text>
              )}
            </Cluster>
          </Row>
        ))}
        {hidden > 0 && (
          <Row>
            <RowName>
              <Text level="faint">+{hidden} more...</Text>
            </RowName>
          </Row>
        )}
      </Stack>
    </Stack>
  );
}
