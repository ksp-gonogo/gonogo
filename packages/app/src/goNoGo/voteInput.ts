import type { ActionDefinition } from "@ksp-gonogo/core";
import type { InputMappingSource, InputMappings } from "@ksp-gonogo/serial";
import { useSyncExternalStore } from "react";

/** The instance id the vote's input actions are registered and dispatched under, as a widget's are under its tile id. */
export const VOTE_INSTANCE_ID = "gonogo-vote";

/** What a key or controller button can do to this screen's part in the poll. */
export const VOTE_ACTIONS = [
  {
    id: "toggle-vote",
    label: "Toggle GO/NO-GO",
    accepts: ["button"],
    description: "Flip this station's GO/NO-GO vote.",
  },
  {
    id: "abort",
    label: "Abort",
    accepts: ["button"],
    description: "Post-launch: send the abort signal.",
  },
] as const satisfies readonly ActionDefinition[];

const EMPTY: InputMappings = {};

function storageKey(screenKey: string): string {
  return `gonogo.poll.voteInput.${screenKey}`;
}

/**
 * The inputs bound to the vote on each screen, remembered across sessions.
 * They belong to the screen rather than to any layout, so switching layouts
 * keeps them.
 */
class VoteInputs {
  private readonly listeners = new Set<() => void>();
  private readonly cache = new Map<
    string,
    { raw: string | null; value: InputMappings }
  >();

  get(screenKey: string): InputMappings {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(storageKey(screenKey));
    } catch {
      return EMPTY;
    }
    const cached = this.cache.get(screenKey);
    if (cached && cached.raw === raw) return cached.value;
    let value = EMPTY;
    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null) {
          value = parsed as InputMappings;
        }
      } catch {
        /* unreadable: nothing is bound */
      }
    }
    this.cache.set(screenKey, { raw, value });
    return value;
  }

  set(screenKey: string, mappings: InputMappings): void {
    try {
      localStorage.setItem(storageKey(screenKey), JSON.stringify(mappings));
    } catch {
      /* quota or private mode: nothing can be remembered */
    }
    for (const cb of this.listeners) cb();
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}

export const voteInputs = new VoteInputs();

/** The vote as one more source for the screen's `InputDispatcher`, beside the dashboard's tiles. */
export function voteInputSource(screenKey: string): InputMappingSource {
  return { i: VOTE_INSTANCE_ID, inputMappings: voteInputs.get(screenKey) };
}

export function useVoteInputs(screenKey: string): InputMappings {
  return useSyncExternalStore(
    (cb) => voteInputs.subscribe(cb),
    () => voteInputs.get(screenKey),
  );
}
