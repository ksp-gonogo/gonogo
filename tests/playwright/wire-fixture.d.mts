export interface WireRow {
  t: number;
  frame: {
    type: string;
    topic?: string;
    name?: string;
    payload?: unknown;
    meta?: { deliveredAt?: number; [key: string]: unknown };
    [key: string]: unknown;
  };
}

export function readWireFixture(path: string): WireRow[];
export function deliveredAt(
  frame: WireRow["frame"],
  at: number,
): WireRow["frame"];
export function trimWireFixture(
  rows: WireRow[],
  range: { fromMs: number; toMs: number },
): WireRow[];
export function dedupeWireFixture(rows: WireRow[]): WireRow[];
export function scrubWireFixture(rows: WireRow[]): WireRow[];
export function assertNoHomePaths(rows: WireRow[]): void;
export function writeWireFixture(path: string, rows: WireRow[]): void;
