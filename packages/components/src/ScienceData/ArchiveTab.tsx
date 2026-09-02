import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  DataTable,
  type DataTableColumn,
  type DataTableSection,
  EmptyState,
  NULL_DISPLAY,
  ScrollArea,
  Stack,
  Text,
  Unit,
  useRowFilter,
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
    render: (r) => r.biome || <Text tone="muted">{NULL_DISPLAY}</Text>,
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
        <Text tone="muted">complete</Text>
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
  matches: (searchText: string) => boolean,
): DataTableSection<ArchiveSubject>[] {
  const out: DataTableSection<ArchiveSubject>[] = [];
  for (const body of groups) {
    for (const exp of body.experiments) {
      const title = `${body.body || "(unknown)"} · ${exp.expTitle || "(unknown)"}`;
      // A career archive is the longest list in the app, so the heading text
      // counts as searchable: typing a body name keeps that whole group
      // rather than making the operator match every row individually.
      const rows = exp.rows.filter((r) =>
        matches(`${title} ${r.situation} ${r.biome}`),
      );
      if (rows.length === 0) continue;
      out.push({ id: `${body.body}/${exp.expId}`, title, rows });
    }
  }
  return out;
}

/** The career-wide R&D archive: every subject ever recovered, any vessel. */
export function ArchiveTab({ archive, groups }: Readonly<ArchiveTabProps>) {
  const filter = useRowFilter({ placeholder: "Filter by body, biome..." });
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
          sections={sectionsOf(groups, filter.matches)}
          rowKey={(r) => r.subjectId}
          empty="No subject matches the filter."
        />
      </ScrollArea>
      {filter.control}
    </Stack>
  );
}
