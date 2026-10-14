import {
  CatalogContact,
  type CatalogEntry,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { contactPhase, overdueSeconds } from "./catalog";

type Contact = Pick<
  CatalogEntry,
  "contact" | "expectedReturnUt" | "overdueAfterUt"
>;

const silent = (over: Partial<Contact> = {}): Contact => ({
  contact: CatalogContact.Silent,
  expectedReturnUt: value("ut", 2_000),
  overdueAfterUt: value("ut", 2_300),
  ...over,
});

describe("contactPhase", () => {
  it("is nominal while the centre is in contact", () => {
    expect(contactPhase({ contact: CatalogContact.InContact }, 1_500)).toBe(
      "nominal",
    );
  });

  it("is expected while a silent craft is not yet due back", () => {
    expect(contactPhase(silent(), 1_500)).toBe("expected");
  });

  it("stays expected through the allowance past the expected return", () => {
    expect(contactPhase(silent(), 2_200)).toBe("expected");
  });

  it("goes overdue on the view clock once the allowance has passed", () => {
    expect(contactPhase(silent(), 2_301)).toBe("overdue");
  });

  it("is overdue when the catalog says so", () => {
    expect(
      contactPhase(silent({ contact: CatalogContact.Overdue }), 1_000),
    ).toBe("overdue");
  });

  it("is lost once home's declaration has reached the centre", () => {
    expect(contactPhase(silent({ contact: CatalogContact.Lost }), 1_500)).toBe(
      "lost",
    );
  });

  /** A missing expected return means none was made: the craft is quiet with nothing having promised it would be back, which is never overdue. */
  it("is waiting, never overdue, when no return is expected", () => {
    expect(
      contactPhase(
        silent({ expectedReturnUt: null, overdueAfterUt: null }),
        999_999,
      ),
    ).toBe("waiting");
  });

  it("is undefined where no word of a route has reached the centre", () => {
    expect(contactPhase({ contact: null }, 1_500)).toBeUndefined();
    expect(contactPhase(undefined, 1_500)).toBeUndefined();
  });
});

describe("overdueSeconds", () => {
  it("counts from the expected return, not from the end of the allowance", () => {
    expect(overdueSeconds(silent(), 2_500)).toBe(500);
  });

  it("is undefined for a craft that is not overdue", () => {
    expect(overdueSeconds(silent(), 1_500)).toBeUndefined();
  });
});
