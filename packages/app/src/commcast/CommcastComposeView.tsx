import {
  ComposerBar,
  Console,
  EmptyState,
  SelectableRow,
  Text,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { useState } from "react";
import { CommcastBackButton } from "./CommcastBackButton";
import {
  COMMCAST_TONE,
  Commcast__Bar,
  Commcast__BarGap,
  Commcast__RowHead,
  Commcast__RowName,
  Commcast__Rows,
  Commcast__Scroll,
} from "./commcastStyles";
import type { CommsRecipient, RecipientId } from "./types";

/**
 * Choosing who is in a group: who to open one with, or who to add to one this
 * vantage is already in. The rows toggle, and any number may be chosen.
 */
export function CommcastComposeView({
  title,
  backLabel,
  commitLabel,
  recipients,
  ready,
  indicator,
  onBack,
  onCommit,
}: {
  title: string;
  /** Where the way back leads, when that is not the inbox. */
  backLabel?: string;
  /** The commit's own verb, since this opens or grows a group rather than transmitting words. */
  commitLabel: string;
  recipients: readonly CommsRecipient[];
  /** This screen knows where it stands and what time it is, without which no change can be sent. */
  ready: boolean;
  indicator: ReactNode;
  onBack: () => void;
  onCommit: (ids: readonly RecipientId[]) => void;
}) {
  const [picked, setPicked] = useState<readonly RecipientId[]>([]);
  const toggle = (id: RecipientId) =>
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  return (
    <>
      <Commcast__Bar>
        <CommcastBackButton onClick={onBack} label={backLabel} />
        <Text size="sm" tone="default">
          {title}
        </Text>
        <Commcast__BarGap />
        {indicator}
      </Commcast__Bar>
      <Console
        tone={COMMCAST_TONE}
        composer={
          /* The bar's commit slot with its own verb, and the word rather than the send glyph. */
          <ComposerBar
            onSend={() => onCommit(picked)}
            sendDisabled={picked.length === 0 || !ready}
            sendLabel={commitLabel}
            sendVariant="text"
          >
            <Text size="xs" tone="faint">
              {pickStatus(picked.length)}
            </Text>
          </ComposerBar>
        }
      >
        <Commcast__Scroll>
          <Commcast__Rows>
            {recipients.length === 0 && (
              <EmptyState>No correspondents</EmptyState>
            )}
            {recipients.map((r) => (
              <SelectableRow
                key={r.id}
                selected={picked.includes(r.id)}
                onClick={() => toggle(r.id)}
              >
                <Commcast__RowHead>
                  <Commcast__RowName>{r.name}</Commcast__RowName>
                  {/* Still addressable; saying so before it is sent stops an unacknowledged message reading as a fault. */}
                  {!r.staffed && (
                    <Text size="xs" tone="faint">
                      unstaffed
                    </Text>
                  )}
                </Commcast__RowHead>
              </SelectableRow>
            ))}
          </Commcast__Rows>
        </Commcast__Scroll>
      </Console>
    </>
  );
}

function pickStatus(pickedCount: number): string {
  if (pickedCount > 1) return `${pickedCount} chosen`;
  if (pickedCount === 1) return "Ready";
  return "Choose a recipient";
}
