import { createMemoryProgram, type TypeScript } from "./program";
import { scanClient } from "./scan";
import type { ClientScan } from "./types";

export const CLIENT = "/client";

const HOOKS = `
export declare function useTelemetry(topic: string): unknown;
export declare function useStream(topic: string): unknown;
export declare function useStreamOptional(topic: string): unknown;
export declare function useCommand(command: string): unknown;
export declare function registerComponent(def: object): void;
export declare function registerAugment(def: object): void;
`;

/** Scans `files` (paths relative to /client/src) as one client, with the read hooks declared. */
export function scanFiles(
  ts: TypeScript,
  files: Readonly<Record<string, string>>,
  options: { topicIds?: readonly string[] } = {},
): ClientScan {
  const absolute: Record<string, string> = {
    [`${CLIENT}/src/hooks.ts`]: HOOKS,
  };
  for (const [name, text] of Object.entries(files)) {
    absolute[`${CLIENT}/src/${name}`] = text;
  }
  return scanClient(ts, createMemoryProgram(ts, absolute), {
    clientDir: CLIENT,
    ...options,
  });
}
