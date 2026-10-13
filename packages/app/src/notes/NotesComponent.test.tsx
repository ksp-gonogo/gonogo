import { ScreenProvider } from "@ksp-gonogo/core";
import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { NotesComponent } from "./NotesComponent";
import { NotesHostProvider } from "./NotesHostContext";
import { NotesHostService } from "./NotesHostService";

describe("NotesComponent on the main screen", () => {
  it("says the host is unavailable when no notes host is mounted", () => {
    render(
      <ScreenProvider value="main">
        <NotesComponent id="notes-1" />
      </ScreenProvider>,
    );

    expect(screen.getByText("Notes host unavailable")).toBeTruthy();
  });

  it("lists the host's notes when one is mounted", () => {
    const host = new NotesHostService({
      load: () => [
        { id: "n1", body: "check fuel", order: 0, createdAt: 0, updatedAt: 0 },
      ],
    });
    render(
      <ScreenProvider value="main">
        <NotesHostProvider service={host}>
          <NotesComponent id="notes-1" />
        </NotesHostProvider>
      </ScreenProvider>,
    );

    expect(screen.getByText("check fuel")).toBeTruthy();
  });
});
