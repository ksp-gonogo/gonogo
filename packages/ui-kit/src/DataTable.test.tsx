import { render, screen, within } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { DataTable } from "./DataTable";
import { axe } from "./test/axe";

interface Sample {
  id: string;
  subject: string;
  science: number;
}

const COLUMNS = [
  {
    key: "subject",
    header: "Subject",
    render: (r: Sample) => r.subject,
  },
  {
    key: "science",
    header: "Science",
    align: "end" as const,
    render: (r: Sample) => r.science,
  },
];

const ROWS: Sample[] = [
  { id: "a", subject: "Crew Report", science: 8 },
  { id: "b", subject: "Mystery Goo", science: 13 },
];

const key = (r: Sample) => r.id;

describe("DataTable", () => {
  it("renders one row per entry, under named columns", () => {
    render(
      <DataTable
        caption="Science aboard"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={key}
      />,
    );
    expect(
      screen.getByRole("columnheader", { name: "Subject" }),
    ).toBeInTheDocument();
    // Two data rows plus the header row.
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(
      within(screen.getByRole("row", { name: /Mystery Goo/ })).getByText("13"),
    ).toBeInTheDocument();
  });

  it("names the table for a screen reader without showing the caption", () => {
    render(
      <DataTable
        caption="Science aboard"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={key}
      />,
    );
    expect(
      screen.getByRole("table", { name: "Science aboard" }),
    ).toBeInTheDocument();
  });

  it("groups rows under section headings that span the columns", () => {
    render(
      <DataTable
        caption="Archive"
        columns={COLUMNS}
        sections={[
          { id: "kerbin", title: "Kerbin", rows: [ROWS[0]] },
          { id: "mun", title: "Mun", rows: [ROWS[1]] },
        ]}
        rowKey={key}
      />,
    );
    const heading = screen.getByRole("columnheader", { name: "Kerbin" });
    expect(heading).toHaveAttribute("colspan", "2");
    expect(screen.getByText("Mystery Goo")).toBeInTheDocument();
  });

  it("shows the empty state instead of a bare header when there is nothing to list", () => {
    render(
      <DataTable
        caption="Archive"
        columns={COLUMNS}
        rows={[]}
        rowKey={key}
        empty="No science recovered yet"
      />,
    );
    expect(screen.getByText("No science recovered yet")).toBeInTheDocument();
  });

  it("puts row detail on its own full-width row, leaving the columns aligned", () => {
    // The per-row controls case: rendering them inside a cell would widen one
    // column and break the alignment the table exists for.
    render(
      <DataTable
        caption="Science aboard"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={key}
        rowDetail={(r) =>
          r.id === "a" ? <button type="button">Transmit</button> : null
        }
      />,
    );
    const detail = screen.getByRole("button", { name: "Transmit" });
    expect(detail.closest("td")).toHaveAttribute("colspan", "2");
    // Only the row that asked for detail gets a detail row.
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });

  it("has no axe violations, flat or grouped", async () => {
    const flat = render(
      <DataTable
        caption="Science aboard"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={key}
      />,
    );
    expect(await axe(flat.container)).toHaveNoViolations();

    const grouped = render(
      <DataTable
        caption="Archive"
        columns={COLUMNS}
        sections={[{ id: "kerbin", title: "Kerbin", rows: ROWS }]}
        rowKey={key}
      />,
    );
    expect(await axe(grouped.container)).toHaveNoViolations();
  });
});
