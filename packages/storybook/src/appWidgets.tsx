/*
 * The widgets the app registers itself rather than through
 * `@ksp-gonogo/components`, the way `packages/app/src/main.tsx` registers them.
 */
import "./setup";
import "../../app/src/commcast/CommcastComponent";
import "../../app/src/goNoGo/GoNoGoComponent";
import "../../app/src/notes/NotesComponent";
import type { ReactNode } from "react";
import { NotesHostProvider } from "../../app/src/notes/NotesHostContext";
import { NotesHostService } from "../../app/src/notes/NotesHostService";
import type { Note } from "../../app/src/notes/types";

const AT = 1_700_000_000_000;

const NOTES: Note[] = [
  {
    id: "n1",
    body: "Circularise at {{vessel.orbit.apoapsis}} before the Mun transfer",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "n2",
    body: "Jeb on EVA after the burn",
    order: 1,
    createdAt: AT,
    updatedAt: AT,
  },
];

/**
 * The app-shell providers an app widget reads, which the dashboard mounts
 * above every widget and the render probe does not. Keyed by widget id.
 */
export const APP_WIDGET_WRAPS: Record<string, (tree: ReactNode) => ReactNode> =
  {
    notes: (tree) => (
      <NotesHostProvider service={new NotesHostService({ load: () => NOTES })}>
        {tree}
      </NotesHostProvider>
    ),
  };
