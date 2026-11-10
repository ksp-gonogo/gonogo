import { createContext, type ReactNode, useContext } from "react";
import type { JoinSeat } from "../screens/seatChoice";

/** The game a screen joined from the join page: its code and the seat taken. */
export interface JoinedGame {
  code: string;
  seat: JoinSeat;
}

const JoinedGameContext = createContext<JoinedGame | null>(null);

/** Marks the screen below as one that joined `game` by its code, which limits its settings to its seat. */
export function JoinedGameProvider({
  game,
  children,
}: {
  game: JoinedGame;
  children: ReactNode;
}) {
  return (
    <JoinedGameContext.Provider value={game}>
      {children}
    </JoinedGameContext.Provider>
  );
}

/** The game this screen joined by code, or null on a screen that reads the game itself. */
export function useJoinedGame(): JoinedGame | null {
  return useContext(JoinedGameContext);
}
