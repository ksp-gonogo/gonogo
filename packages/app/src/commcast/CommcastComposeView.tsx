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
 * Choosing who a new conversation is with. The rows toggle, because the
 * envelope carries a list; group delivery is not carried, so a second name is
 * refused here, where the operator can see why, rather than sent mis-timed.
 */
export function CommcastComposeView({
  recipients,
  indicator,
  onBack,
  onOpen,
}: {
  recipients: readonly CommsRecipient[];
  indicator: ReactNode;
  onBack: () => void;
  onOpen: (ids: readonly RecipientId[]) => void;
}) {
  const [picked, setPicked] = useState<readonly RecipientId[]>([]);
  const toggle = (id: RecipientId) =>
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  const group = picked.length > 1;
  return (
    <>
      <Commcast__Bar>
        <CommcastBackButton onClick={onBack} />
        <Text size="sm" tone="default">
          New message
        </Text>
        <Commcast__BarGap />
        {indicator}
      </Commcast__Bar>
      <Console
        tone={COMMCAST_TONE}
        composer={
          /* The bar's commit slot with its own verb, and the word rather than the send glyph: this opens a thread rather than transmitting. */
          <ComposerBar
            blocked={group}
            {...(group ? { flag: "ONE AT A TIME" } : {})}
            onSend={() => onOpen(picked)}
            sendDisabled={picked.length !== 1}
            sendLabel="Open"
            sendVariant="text"
          >
            <Text size="xs" tone={group ? "nogo" : "faint"}>
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
  if (pickedCount > 1) return "Group delivery is not carried yet";
  if (pickedCount === 1) return "Ready";
  return "Choose a recipient";
}
