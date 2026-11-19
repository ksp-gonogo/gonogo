export const MAX_SUBJECT: number;
export const TABLE_VERSION: number;
export type RewordOp =
  | { op: "drop" }
  | { op: "reword"; subject: string }
  | { op: "absorb"; into: string; subject?: string }
  | { op: "split"; lines: string[] };
export interface RewordTable {
  version: number;
  release: string;
  ops: Record<string, RewordOp>;
}
export interface Parser {
  re: RegExp;
  group?: string;
  skip: boolean;
}
export interface ContextCommit {
  id: string;
  [key: string]: unknown;
}
export interface ContextRelease {
  commits: ContextCommit[];
  [key: string]: unknown;
}
export function subjectProblems(subject: unknown): string[];
export function readParsers(tomlText: string): Parser[];
export function groupOf(subject: string, parsers: Parser[]): string | null;
export function readTable(path: string): RewordTable;
export function checkTableShape(table: unknown): RewordTable;
export function applyTable(
  releases: ContextRelease[],
  table: RewordTable,
  rangeShas: string[],
  parsers: Parser[],
  names?: string[],
): ContextRelease[];
export function widgetNames(root?: string): string[];
export function articleProblems(subject: string, names: string[]): string[];
