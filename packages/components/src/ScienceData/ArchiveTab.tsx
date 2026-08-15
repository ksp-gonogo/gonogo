import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  DataTable,
  type DataTableColumn,
  type DataTableSection,
  EmptyState,
  NULL_DISPLAY,
  ScrollArea,
  Stack,
  Unit,
  Value,
} from "@ksp-gonogo/ui-kit";
import type { ArchiveBodyGroup, ArchiveSubject } from "./parsers";

export interface ArchiveTabProps {
  archive: ArchiveSubject[] | null;
  groups: ArchiveBodyGroup[];
}

/**
 * Deliberately the same column shape as Aboard's, so the two tabs read as
 * one table at two scopes rather than two widgets sharing a panel. What
 * differs is the row identity: Aboard names a subject on this vessel,
 * Archive names a situation-and-biome the career has visited.
 */
const COLUMNS: ReadonlyArray<DataTableColumn<ArchiveSubject>> = [
  {
    key: "situation",
    header: "Situation",
    width: "1fr",
    minWidth: "14ch",
    render: (r) => r.situation || NULL_DISPLAY,
  },
  {
    key: "biome",
    header: "Biome",
    render: (r) => r.biome || <Value tone="muted">{NULL_DISPLAY}</Value>,
  },
  {
    key: "science",
    header: "Banked",
    align: "end",
    width: "9ch",
    render: (r) => <Unit value={value("science", r.science)} />,
  },
  {
    key: "remaining",
    header: "Remaining",
    align: "end",
    width: "10ch",
    render: (r) =>
      r.remainingPotential > 0 ? (
        <Unit value={value("science", r.remainingPotential)} />
      ) : (
        <Value tone="muted">complete</Value>
      ),
  },
];

/**
 * Flattens body → experiment → rows into the table's one level of section,
 * because a heading per body AND per experiment pushed every row two indents
 * off the left edge and cost more width than the figures did. "Kerbin ·
 * Crew Report" says the same thing on one line.
 */
function sectionsOf(
  groups: ArchiveBodyGroup[],
): DataTableSection<ArchiveSubject>[] {
  const out: DataTableSection<ArchiveSubject>[] = [];
  for (const body of groups) {
    for (const exp of body.experiments) {
      out.push({
        id: `${body.body}/${exp.expId}`,
        title: `${body.body || "(unknown)"} · ${exp.expTitle || "(unknown)"}`,
        rows: exp.rows,
      });
    }
  }
  return out;
}

/** The career-wide R&D archive: every subject ever recovered, any vessel. */
export function ArchiveTab({ archive, groups }: Readonly<ArchiveTabProps>) {
  if (archive === null) {
    return (
      <EmptyState>
        No R&D archive in this save, Sandbox mode banks no career science.
      </EmptyState>
    );
  }
  if (archive.length === 0) {
    return <EmptyState>No science collected yet this career.</EmptyState>;
  }

  return (
    <Stack gap="sm" fill>
      <ScrollArea>
        <DataTable
          caption="Career science archive, by body and experiment"
          columns={COLUMNS}
          sections={sectionsOf(groups)}
          rowKey={(r) => r.subjectId}
        />
      </ScrollArea>
    </Stack>
  );
}
