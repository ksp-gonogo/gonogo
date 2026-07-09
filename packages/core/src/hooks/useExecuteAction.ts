import { useCommand } from "./useCommand";

/**
 * @deprecated Renamed to `useCommand` — the canonical command hook of the
 * Uplink architecture (spec §3.3). This alias re-exports it unchanged so
 * existing call sites keep working; a later phase's codemod removes it. New
 * code should import `useCommand`.
 */
export const useExecuteAction: typeof useCommand = useCommand;
