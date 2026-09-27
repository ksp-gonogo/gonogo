import "./setup";
import { getTheme } from "@ksp-gonogo/core";
import type { ReactNode } from "react";
import { ThemeProvider } from "styled-components";

/** The theme the app mounts, from the same registry the app reads it from. */
function appTheme() {
  const theme = getTheme("default-dark")?.theme;
  if (!theme) throw new Error("default-dark theme failed to register");
  return theme;
}

const theme = appTheme();

/** The app's theme around a story, on the dashboard's own surface. */
export function GonogoFrame({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <div
        style={{
          background: "var(--color-surface-app)",
          color: "var(--color-text-primary)",
          padding: "var(--inset-surface-standalone)",
          minHeight: "100%",
        }}
      >
        {children}
      </div>
    </ThemeProvider>
  );
}

/** {@link GonogoFrame} as a CSF decorator, declared on each story's own meta. */
export function withGonogoFrame(Story: () => ReactNode) {
  return (
    <GonogoFrame>
      <Story />
    </GonogoFrame>
  );
}
