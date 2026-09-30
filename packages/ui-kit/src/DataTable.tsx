import type { ReactNode } from "react";
import { Fragment, useState } from "react";
import styled from "styled-components";
import { InlineOverflowGlow, useInlineOverflow } from "./inlineOverflow";
import type { UnitValue } from "./readingCurrency";
import { Unit } from "./Unit";

interface DataTableColumnBase {
  /** Stable identity for the column, and its React key. */
  key: string;
  /** The column's heading, in the table head. */
  header: ReactNode;
  /**
   * This column names its row: its cells are row headers
   * (`<th scope="row">`), so a screen reader says the row's name with every
   * other cell in it. One column per table, normally the first.
   */
  rowHeader?: boolean;
  /**
   * `end` right-aligns the cell and its header. Use it for every numeric
   * column, so the digits line up.
   */
  align?: "start" | "end";
  /**
   * CSS width for the column, e.g. `"1fr"` or `"9ch"`. Omitted columns size
   * to their content. A `ch` width on a numeric column keeps it from
   * twitching as values change magnitude.
   */
  width?: string;
  /**
   * Floor for the column's width, so a text column in a narrow panel scrolls
   * instead of wrapping to single words.
   */
  minWidth?: string;
}

/**
 * One column of a {@link DataTable}: what each cell draws, from a `render` of
 * the caller's own, or from a `value` the table draws through {@link Unit}.
 * `value` takes a whole `Reading`, so a held figure keeps its mark, and a
 * `null` or `undefined` draws the null token.
 *
 * @category DataTable
 */
export type DataTableColumn<Row> = DataTableColumnBase &
  (
    | { render: (row: Row) => ReactNode; value?: never }
    | { value: (row: Row) => UnitValue | null | undefined; render?: never }
  );

/** A cell's content, from whichever of the two the column gives. */
function cellContent<Row>(col: DataTableColumn<Row>, row: Row): ReactNode {
  if (col.value !== undefined) return <Unit value={col.value(row) ?? null} />;
  return col.render(row);
}

/**
 * A run of rows under a heading, for a table whose rows arrive already
 * grouped (by body, by vessel, by stage).
 *
 * @category DataTable
 */
export interface DataTableSection<Row> {
  /** Unique within the table; the section's React key. */
  id: string;
  /** The heading drawn across the table above the section's rows. */
  title: ReactNode;
  /** The rows under this heading. */
  rows: Row[];
}

/**
 * Props for {@link DataTable}.
 *
 * @category DataTable
 */
export interface DataTableProps<Row> {
  /** The columns, left to right. */
  columns: ReadonlyArray<DataTableColumn<Row>>;
  /** Flat rows. Ignored when `sections` is given. */
  rows?: ReadonlyArray<Row>;
  /** Grouped rows. Takes precedence over `rows`. */
  sections?: ReadonlyArray<DataTableSection<Row>>;
  /** A stable, unique key for each row. */
  rowKey: (row: Row) => string;
  /**
   * Describes the table to a screen reader. It is not shown: the visible
   * heading is the widget's own.
   */
  caption: string;
  /** Shown in place of the body when there is nothing to list. */
  empty?: ReactNode;
  /**
   * Extra content for a row, rendered as a full-width row directly beneath it:
   * where per-row controls and augment slots go, so the columns stay aligned.
   */
  rowDetail?: (row: Row) => ReactNode;
  className?: string;
}

/**
 * A real table for tabular readouts, so figures in a column can be compared
 * down the page.
 *
 * Semantic `<table>` throughout. Each section is a `<tbody>` of its own,
 * headed by a `<th scope="rowgroup">` spanning the width, and a `rowHeader`
 * column makes each row's naming cell a `<th scope="row">`. A table wider than
 * its slot scrolls sideways.
 *
 * @example
 * ```tsx
 * const columns: ReadonlyArray<DataTableColumn<Subject>> = [
 *   { key: "subject", header: "Subject", rowHeader: true, width: "1fr", minWidth: "22ch", render: (s) => s.title },
 *   { key: "data", header: "Data", align: "end", width: "9ch", value: (s) => value("Mit", s.dataMits) },
 *   { key: "remaining", header: "Remaining", align: "end", width: "10ch", value: (s) => value("science", s.remaining) },
 * ];
 *
 * <DataTable
 *   caption="Science aboard the active vessel, by subject"
 *   columns={columns}
 *   rows={subjects}
 *   rowKey={(s) => s.subjectId}
 *   empty="No subject matches the filter."
 * />
 * ```
 *
 * @category DataTable
 */
export function DataTable<Row>({
  columns,
  rows,
  sections,
  rowKey,
  caption,
  empty,
  rowDetail,
  className,
}: Readonly<DataTableProps<Row>>) {
  const groups: ReadonlyArray<DataTableSection<Row>> =
    sections ?? (rows ? [{ id: "", title: null, rows: [...rows] }] : []);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const overflow = useInlineOverflow(scroller);

  return (
    <DataTable__Shell className={className}>
      <DataTable__Scroller ref={setScroller}>
        <DataTable__Table>
          <DataTable__Caption>{caption}</DataTable__Caption>
          <thead>
            <tr>
              {columns.map((col) => (
                <DataTable__HeaderCell
                  key={col.key}
                  scope="col"
                  $align={col.align ?? "start"}
                  style={{
                    width: col.width,
                    minWidth: col.minWidth,
                  }}
                >
                  {col.header}
                </DataTable__HeaderCell>
              ))}
            </tr>
          </thead>
          {total === 0 && empty !== undefined && (
            <tbody>
              <tr>
                <DataTable__EmptyCell colSpan={columns.length}>
                  {empty}
                </DataTable__EmptyCell>
              </tr>
            </tbody>
          )}
          {groups.map((group) => (
            <tbody key={group.id}>
              {group.title !== null && group.title !== undefined && (
                <tr>
                  <DataTable__SectionCell
                    scope="rowgroup"
                    colSpan={columns.length}
                  >
                    {group.title}
                  </DataTable__SectionCell>
                </tr>
              )}
              {group.rows.map((row) => {
                const key = rowKey(row);
                const detail = rowDetail?.(row);
                const hasDetail =
                  detail !== null &&
                  detail !== undefined &&
                  detail !== false &&
                  detail !== "";
                return (
                  <Fragment key={key}>
                    <DataTable__Row $hasDetail={hasDetail}>
                      {columns.map((col) => (
                        <DataTable__Cell
                          key={col.key}
                          as={col.rowHeader ? "th" : undefined}
                          scope={col.rowHeader ? "row" : undefined}
                          $align={col.align ?? "start"}
                        >
                          {cellContent(col, row)}
                        </DataTable__Cell>
                      ))}
                    </DataTable__Row>
                    {hasDetail ? (
                      <tr>
                        <DataTable__DetailCell colSpan={columns.length}>
                          {detail}
                        </DataTable__DetailCell>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          ))}
        </DataTable__Table>
      </DataTable__Scroller>
      <InlineOverflowGlow $position="left" $visible={overflow.left} />
      <InlineOverflowGlow $position="right" $visible={overflow.right} />
    </DataTable__Shell>
  );
}

/* Reaches out to the panel's edges, so a table scrolled sideways passes under a glow in the gutter rather than stopping at the padding. */
const DataTable__Shell = styled.div`
  position: relative;
  min-width: 0;
  margin-inline: calc(-1 * var(--bleed-inline));
`;

/*
 * Wide content scrolls inside the table rather than pushing the widget's
 * layout sideways. A flex box, so the end padding is part of what scrolls and
 * the last column comes to rest on the content column too.
 */
const DataTable__Scroller = styled.div`
  display: flex;
  padding-inline: var(--bleed-inline);
  overflow-x: auto;
  min-width: 0;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`;

const DataTable__Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-compact);
`;

/* Announced, not shown: the visible heading is the widget's own. */
const DataTable__Caption = styled.caption`
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
`;

const DataTable__HeaderCell = styled.th<{ $align: "start" | "end" }>`
  text-align: ${({ $align }) => $align};
  position: sticky;
  top: 0;
  /* Local sibling ordering over its own rows, not a rung on the app ladder. */
  z-index: 1;
  background: var(--color-surface-panel);
  color: var(--color-text-faint);
  font-size: var(--font-size-caption);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
  padding: var(--inset-table-cell);
  border-bottom: 1px solid var(--color-border-subtle);
`;

const DataTable__SectionCell = styled.th`
  text-align: start;
  background: var(--color-surface-raised);
  color: var(--color-text-muted);
  font-size: var(--font-size-caption);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: var(--inset-table-section);
  border-bottom: 1px solid var(--color-border-subtle);
`;

/* A row and its detail are one record, so only the bottom of the pair is ruled. */
const DataTable__Row = styled.tr<{ $hasDetail: boolean }>`
  &:not(:last-child) > td,
  &:not(:last-child) > th {
    border-bottom: ${({ $hasDetail }) =>
      $hasDetail ? "none" : "1px solid var(--color-border-subtle)"};
  }
`;

/* A row header is the same cell to the eye; only its role differs. */
const DataTable__Cell = styled.td<{ $align: "start" | "end" }>`
  text-align: ${({ $align }) => $align};
  font-weight: inherit;
  color: var(--color-text-primary);
  padding: var(--inset-table-cell);
  font-variant-numeric: tabular-nums;
  vertical-align: baseline;
`;

const DataTable__DetailCell = styled.td`
  padding: var(--inset-table-detail);
  border-bottom: 1px solid var(--color-border-subtle);
`;

const DataTable__EmptyCell = styled.td`
  color: var(--color-text-faint);
  font-style: italic;
  padding: var(--inset-table-empty);
`;
