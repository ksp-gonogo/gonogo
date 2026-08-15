import type { ReactNode } from "react";
import { Fragment } from "react";
import styled from "styled-components";

export interface DataTableColumn<Row> {
  /** Stable identity for the column, and its React key. */
  key: string;
  header: ReactNode;
  render: (row: Row) => ReactNode;
  /**
   * `end` right-aligns the cell and its header. Use it for every numeric
   * column: a column of figures only becomes scannable once the digits line
   * up, which is most of the reason to reach for a table at all.
   */
  align?: "start" | "end";
  /**
   * CSS width for the column, e.g. `"1fr"` or `"9ch"`. Omitted columns size
   * to their content. A `ch` width on a numeric column keeps it from
   * twitching as values change magnitude.
   */
  width?: string;
  /**
   * Floor for the column's width. Without one, a text column in a narrow
   * panel shrinks until every cell wraps to a column of single words, which
   * costs far more height than the horizontal scroll it was avoiding. Set it
   * to the narrowest the content stays readable at and let the table scroll.
   */
  minWidth?: string;
}

/**
 * A run of rows under a heading, for a table whose rows arrive already
 * grouped (by body, by vessel, by stage).
 */
export interface DataTableSection<Row> {
  id: string;
  title: ReactNode;
  rows: Row[];
}

export interface DataTableProps<Row> {
  columns: ReadonlyArray<DataTableColumn<Row>>;
  /** Flat rows. Ignored when `sections` is given. */
  rows?: ReadonlyArray<Row>;
  /** Grouped rows. Takes precedence over `rows`. */
  sections?: ReadonlyArray<DataTableSection<Row>>;
  rowKey: (row: Row) => string;
  /**
   * Describes the table to a screen reader. Required rather than optional:
   * a table of numbers with no caption is a wall of digits to anyone who
   * cannot see the surrounding widget.
   */
  caption: string;
  /** Shown in place of the body when there is nothing to list. */
  empty?: ReactNode;
  /**
   * Extra content for a row, rendered as a full-width row directly beneath
   * it. This is where per-row controls and augment slots go: they get the
   * table's full width instead of being crushed into a cell, and the columns
   * above stay aligned.
   */
  rowDetail?: (row: Row) => ReactNode;
  className?: string;
}

/**
 * A real table for tabular readouts, in place of the per-row cluster of
 * label/value pairs that widgets otherwise grow. The difference that matters
 * is column alignment: figures in a column can be compared down the page,
 * where a cluster forces the eye to re-find each number on every row.
 *
 * Semantic `<table>` throughout, so row and column headers are announced as
 * such. Section headings are `<th scope="colgroup">` spanning the width.
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

  return (
    <DataTable__Scroller className={className}>
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
        <tbody>
          {total === 0 && empty !== undefined && (
            <tr>
              <DataTable__EmptyCell colSpan={columns.length}>
                {empty}
              </DataTable__EmptyCell>
            </tr>
          )}
          {groups.map((group) => (
            <Fragment key={group.id}>
              {group.title !== null && group.title !== undefined && (
                <tr>
                  <DataTable__SectionCell
                    scope="colgroup"
                    colSpan={columns.length}
                  >
                    {group.title}
                  </DataTable__SectionCell>
                </tr>
              )}
              {group.rows.map((row) => {
                const key = rowKey(row);
                const detail = rowDetail?.(row);
                return (
                  <Fragment key={key}>
                    <DataTable__Row>
                      {columns.map((col) => (
                        <DataTable__Cell
                          key={col.key}
                          $align={col.align ?? "start"}
                        >
                          {col.render(row)}
                        </DataTable__Cell>
                      ))}
                    </DataTable__Row>
                    {detail ? (
                      <tr>
                        <DataTable__DetailCell colSpan={columns.length}>
                          {detail}
                        </DataTable__DetailCell>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </DataTable__Table>
    </DataTable__Scroller>
  );
}

/* Wide content scrolls inside the table rather than pushing the widget's
   own layout sideways. */
const DataTable__Scroller = styled.div`
  overflow-x: auto;
  min-width: 0;
`;

const DataTable__Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
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
  /* Sticks to the top of whatever scroller the table sits in, so the columns
     stay named on a long list. */
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--color-surface-panel);
  color: var(--color-text-faint);
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
  padding: var(--space-4) var(--space-8);
  border-bottom: 1px solid var(--color-border-subtle);
`;

const DataTable__SectionCell = styled.th`
  text-align: start;
  background: var(--color-surface-raised);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: var(--space-6) var(--space-8);
  border-bottom: 1px solid var(--color-border-subtle);
`;

const DataTable__Row = styled.tr`
  &:not(:last-child) > td {
    border-bottom: 1px solid var(--color-border-subtle);
  }
`;

const DataTable__Cell = styled.td<{ $align: "start" | "end" }>`
  text-align: ${({ $align }) => $align};
  color: var(--color-text-primary);
  padding: var(--space-4) var(--space-8);
  /* Numeric columns line up digit for digit, which is the whole point of
     putting them in a column. */
  font-variant-numeric: tabular-nums;
  vertical-align: baseline;
`;

const DataTable__DetailCell = styled.td`
  padding: 0 var(--space-8) var(--space-6);
  border-bottom: 1px solid var(--color-border-subtle);
`;

const DataTable__EmptyCell = styled.td`
  color: var(--color-text-faint);
  font-style: italic;
  padding: var(--space-8);
`;
