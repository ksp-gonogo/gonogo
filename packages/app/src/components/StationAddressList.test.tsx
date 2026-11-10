import { render, screen, within } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { StationAddressList } from "./StationAddressList";
import { stationAddresses } from "./stationAddresses";

function listFor(origin: string) {
  const { addresses, qr } = stationAddresses({
    code: "ABC123",
    origin,
    baseUrl: "/",
    channel: "app",
  });
  return render(<StationAddressList addresses={addresses} qr={qr} />);
}

describe("StationAddressList", () => {
  it("draws the QR code inside the row of the link it encodes", () => {
    listFor("http://localhost:5173");
    const qr = screen.getByTitle("QR code for Public build");
    const row = qr.closest("[data-address]") as HTMLElement;
    expect(row).toHaveAttribute("data-address", "public");
    expect(
      within(row).getByRole("link", { name: /ksp-gonogo\.github\.io/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByTitle(/QR code for/)).toHaveLength(1);
  });

  it("lists the address the QR code opens first", () => {
    listFor("http://localhost:5173");
    const rows = document.querySelectorAll("[data-address]");
    expect(rows[0]).toHaveAttribute("data-address", "public");
    expect(rows[1]).toHaveAttribute("data-address", "local");
  });

  it("draws one row and one QR code when there is one address", () => {
    listFor("https://gonogo.example");
    expect(document.querySelectorAll("[data-address]")).toHaveLength(1);
    expect(screen.getAllByTitle(/QR code for/)).toHaveLength(1);
  });
});
