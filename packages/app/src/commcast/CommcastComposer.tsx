import { ComposerBar, VisuallyHidden } from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import type { useLocalParticipant } from "./CommcastContext";
import type { CommcastLog } from "./CommcastLog";
import { Commcast__Input } from "./commcastStyles";
import type { Vantage } from "./reveal";
import type { RecipientId } from "./types";

export function CommcastComposer({
  log,
  me,
  local,
  utNow,
  groupId,
  members,
  noPath,
  separationSeconds,
}: {
  log: CommcastLog;
  me: Vantage;
  local: ReturnType<typeof useLocalParticipant>;
  utNow: number | undefined;
  /** The thread's group, which the message is addressed to. */
  groupId: string;
  /** The group's members as this vantage can see them now, its own included. */
  members: readonly RecipientId[];
  /** No path to any member; resolved once by the thread view, so the composer and the delay reading cannot disagree. */
  noPath: boolean;
  separationSeconds: number | null;
}) {
  const [draft, setDraft] = useState("");
  const ready =
    draft.trim().length > 0 &&
    utNow !== undefined &&
    me.vantageId !== undefined;
  const submit = () => {
    if (!ready || utNow === undefined) return;
    if (me.vantageId === undefined) return;
    log.send(
      {
        stationKey: local.stationKey,
        name: local.name,
        seat: local.seat,
        vantageId: me.vantageId,
      },
      {
        kind: "text",
        body: draft.trim(),
        groupId,
        to: members,
        // The sender's own present, not the confirmed edge, which is already a light-time behind.
        sentUt: utNow,
        // Frozen here and never re-read: a changing separation must not un-deliver something already promised.
        separationSeconds,
      },
    );
    setDraft("");
  };
  return (
    /* With no path the bar turns error-toned while the operator is still typing, and the flag says why. */
    <ComposerBar
      blocked={noPath}
      prompt="❯"
      {...(noPath ? { flag: "NO PATH" } : {})}
      onSend={submit}
      sendDisabled={!ready}
    >
      <label htmlFor="commcast-draft">
        <VisuallyHidden>Message</VisuallyHidden>
      </label>
      <Commcast__Input
        id="commcast-draft"
        value={draft}
        placeholder={utNow === undefined ? "No clock yet" : "Message"}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey) return;
          e.preventDefault();
          submit();
        }}
      />
    </ComposerBar>
  );
}
