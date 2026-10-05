/**
 * The copy tables the review sheet lists as prose items and `prose-apply`
 * writes back to. A table is one exported object literal of plain string
 * literals, which is the shape a script can rewrite in place.
 */

export interface ProseSource {
  /** Prefixes each of the table's keys into an item id: `wizard:welcome.heading`. */
  id: string;
  /** What the sheet calls the table. */
  title: string;
  /** The module holding the table, from the repo root. */
  file: string;
  /** The exported `const` that is the table. */
  exportName: string;
  /** The Storybook title whose stories show the table's strings. */
  storyTitle: string;
}

export const PROSE_SOURCES: readonly ProseSource[] = [
  {
    id: "wizard",
    title: "Setup wizard",
    file: "packages/app/src/firstRun/copy.ts",
    exportName: "WIZARD_COPY",
    storyTitle: "App/First-run setup",
  },
];
