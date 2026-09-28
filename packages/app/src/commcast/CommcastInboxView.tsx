import {
  Button,
  Console,
  EmptyState,
  PlusIcon,
  SelectableRow,
  SettingsIcon,
  Text,
  ToggleButton,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import {
  COMMCAST_TONE,
  Commcast__Bar,
  Commcast__BarGap,
  Commcast__Preview,
  Commcast__RowHead,
  Commcast__RowName,
  Commcast__Rows,
  Commcast__Scroll,
  ThreadMarker,
} from "./commcastStyles";
import { namesOf } from "./groups";
import { RadioInput } from "./radio/RadioInput";
import type { RadioControl } from "./radio/useRadio";
import type { CommcastThread } from "./threads";
import type { RecipientId } from "./types";

/**
 * The correspondences this vantage holds, and the way into a new one. A drop
 * at the cap is reported here, because it happened off the front of the whole
 * log rather than inside any one conversation.
 */
export function CommcastInboxView({
  threads,
  dropped,
  nameFor,
  canCompose,
  radio,
  indicator,
  onOpen,
  onCompose,
}: {
  threads: readonly CommcastThread[];
  dropped: number;
  nameFor: (id: RecipientId) => string;
  canCompose: boolean;
  /** The widget's radio; the microphone is chosen here because the choice belongs to this console, not to a correspondent. */
  radio: RadioControl;
  /** The transmission light, drawn in every view's bar. */
  indicator: ReactNode;
  onOpen: (thread: CommcastThread) => void;
  onCompose: () => void;
}) {
  const [inputOpen, setInputOpen] = useState(false);
  const inputPanelId = useId();
  return (
    <>
      <Commcast__Bar>
        {threads.length > 0 && (
          <Text size="xs" level="muted">
            {threads.length} conversation{threads.length === 1 ? "" : "s"}
          </Text>
        )}
        <Commcast__BarGap />
        {/* A disclosure rather than details: webkit ignores CSS on that element's open state. */}
        <ToggleButton
          type="button"
          size="sm"
          active={inputOpen}
          aria-expanded={inputOpen}
          aria-controls={inputPanelId}
          onClick={() => setInputOpen((open) => !open)}
        >
          <SettingsIcon size={14} aria-hidden="true" />
          Microphone
        </ToggleButton>
        <Button type="button" onClick={onCompose} disabled={!canCompose}>
          <PlusIcon size={14} />
          New message
        </Button>
        {indicator}
      </Commcast__Bar>
      {inputOpen && (
        <RadioInput
          id={inputPanelId}
          deviceId={radio.inputDeviceId}
          onChoose={radio.setInputDevice}
        />
      )}
      {/* No composer, since there is nothing to type at an inbox; the same console otherwise, so the tile keeps its shape. */}
      <Console tone={COMMCAST_TONE}>
        <Commcast__Scroll>
          <Commcast__Rows>
            {dropped > 0 && (
              <ThreadMarker>
                {dropped} earlier message{dropped === 1 ? "" : "s"} dropped at
                the cap
              </ThreadMarker>
            )}
            {threads.length === 0 && (
              <EmptyState>
                {canCompose
                  ? "No conversations"
                  : "No conversations, and no correspondents"}
              </EmptyState>
            )}
            {threads.map((thread) => (
              <SelectableRow
                key={thread.key}
                selected={false}
                onClick={() => onOpen(thread)}
              >
                <Commcast__RowHead>
                  <Commcast__RowName>
                    {namesOf(thread.with, nameFor)}
                  </Commcast__RowName>
                  {/* The one state an inbox row needs: something is still crossing in there. */}
                  {thread.outbound.length > 0 && (
                    <Text size="xs" tone="info">
                      {thread.outbound.length} out
                    </Text>
                  )}
                </Commcast__RowHead>
                <Commcast__Preview>{thread.preview}</Commcast__Preview>
              </SelectableRow>
            ))}
          </Commcast__Rows>
        </Commcast__Scroll>
      </Console>
    </>
  );
}
