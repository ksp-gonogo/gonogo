import { ScreenProvider } from "@ksp-gonogo/core";
import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { NotesComponent } from "./NotesComponent";
import { NotesHostProvider } from "./NotesHostContext";
import { NotesHostService } from "./NotesHostService";

const HOME = "ground:home";
const CREW = "vessel:abc";

const notesOf = (body: string) => [
  { id: body, body, order: 0, version: 1, createdAt: 0, updatedAt: 0 },
];

function mainScreen(host: NotesHostService | null, centreId: string | null) {
  const tree = (
    <ScreenProvider value="main">
      <NotesComponent id="notes-1" />
    </ScreenProvider>
  );
  return host ? (
    <NotesHostProvider service={host} centreId={centreId}>
      {tree}
    </NotesHostProvider>
  ) : (
    tree
  );
}

describe("NotesComponent on the main screen", () => {
  it("says the host is unavailable when no notes host is mounted", () => {
    render(mainScreen(null, null));

    expect(screen.getByText("Notes host unavailable")).toBeTruthy();
  });

  it("lists the notes of the centre the screen stands at", () => {
    const host = new NotesHostService({
      load: () => ({ [HOME]: notesOf("check fuel") }),
    });
    render(mainScreen(host, HOME));

    expect(screen.getByText("check fuel")).toBeTruthy();
  });

  it("shows another centre's list when the screen changes centre", () => {
    const host = new NotesHostService({
      load: () => ({
        [HOME]: notesOf("home note"),
        [CREW]: notesOf("crew note"),
      }),
    });
    const { rerender } = render(mainScreen(host, HOME));
    expect(screen.getByText("home note")).toBeTruthy();
    expect(screen.queryByText("crew note")).toBeNull();

    rerender(mainScreen(host, CREW));

    expect(screen.getByText("crew note")).toBeTruthy();
    expect(screen.queryByText("home note")).toBeNull();
  });

  it("shows no notes and takes none before a centre is chosen", () => {
    const host = new NotesHostService({
      load: () => ({ [HOME]: notesOf("home note") }),
    });
    render(mainScreen(host, null));

    expect(screen.queryByText("home note")).toBeNull();
    expect(
      screen.getByLabelText(/New note body/).hasAttribute("readonly"),
    ).toBe(true);
  });
});
