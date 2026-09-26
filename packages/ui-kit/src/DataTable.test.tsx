import { render, screen, within } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { DataTable } from "./DataTable";

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
    const heading = screen.getByRole("rowheader", { name: "Kerbin" });
    expect(heading).toHaveAttribute("colspan", "2");
    expect(heading).toHaveAttribute("scope", "rowgroup");
    expect(screen.getByText("Mystery Goo")).toBeInTheDocument();
  });

  it("puts each section in a row group of its own, so its heading heads only its rows", () => {
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
    const kerbin = screen
      .getByRole("rowheader", { name: "Kerbin" })
      .closest("tbody") as HTMLElement;
    expect(within(kerbin).getByText("Crew Report")).toBeInTheDocument();
    expect(within(kerbin).queryByText("Mystery Goo")).toBeNull();
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
    await expectNoA11yViolations(flat.container);

    const grouped = render(
      <DataTable
        caption="Archive"
        columns={COLUMNS}
        sections={[{ id: "kerbin", title: "Kerbin", rows: ROWS }]}
        rowKey={key}
      />,
    );
    await expectNoA11yViolations(grouped.container);
  });
});

describe("DataTable row detail", () => {
  it("draws a detail that is a falsy number on its own row, like any other detail", () => {
    render(
      <DataTable
        caption="Archive"
        columns={COLUMNS}
        rows={[ROWS[0]]}
        rowKey={key}
        rowDetail={() => 0}
      />,
    );
    const body = screen.getAllByRole("rowgroup")[1] as HTMLElement;
    expect(within(body).getAllByRole("row")).toHaveLength(2);
  });
});
