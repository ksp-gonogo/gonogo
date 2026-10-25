import styled from "styled-components";
import type { HostUplinkFailure, UplinkLoadFailure } from "./loadFailures";

type Props =
  | Readonly<{ audience: "main"; failures: readonly UplinkLoadFailure[] }>
  | Readonly<{
      audience: "station";
      failures: readonly HostUplinkFailure[];
    }>;

/**
 * The page shown in place of the dashboard while an installed Uplink stops
 * Gonogo starting, naming each Uplink with why and the one thing that fixes it.
 * It has no way past it. On a station it names the same Uplinks and says the
 * main screen is the one that cannot start. Used by the main screen's start gate and by the
 * station screen while its main screen is in this state.
 */
export function UplinkLoadFailureScreen(props: Props) {
  const { audience } = props;
  return (
    <Wrap
      aria-label={
        audience === "main" ? "Uplink problems" : "Main screen needs fixing"
      }
    >
      <Frame role="alert">
        <Title>
          {audience === "main"
            ? "Gonogo can't start"
            : "The main screen can't start"}
        </Title>
        <List>
          {props.audience === "main"
            ? props.failures.map((f) => (
                <Item key={f.id}>
                  <ItemName>
                    {f.name}
                    {f.name === f.id ? "" : <Id> {f.id}</Id>}
                  </ItemName>
                  <ItemWhy>{f.why}</ItemWhy>
                  {f.fix && <ItemFix>{f.fix}</ItemFix>}
                </Item>
              ))
            : props.failures.map((f) => (
                <Item key={f.id}>
                  <ItemName>
                    {f.name}
                    {f.name === f.id ? "" : <Id> {f.id}</Id>}
                  </ItemName>
                </Item>
              ))}
        </List>
      </Frame>
    </Wrap>
  );
}

const Wrap = styled.main`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--gutter-screen);
  background: var(--color-surface-app);
  color: var(--color-text-primary);
`;

const Frame = styled.section`
  width: 100%;
  max-width: 40rem;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related-comfortable);
  padding: var(--inset-surface-standalone);
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-nogo-status);
  border-radius: var(--radius-regular);
`;

const Title = styled.h1`
  margin: 0;
  font-size: var(--font-size-lg);
`;

const List = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related-comfortable);
`;

const Item = styled.li`
  display: flex;
  flex-direction: column;
  gap: var(--gap-caption);
  padding: var(--inset-surface-standalone);
  background: var(--color-surface-raised);
  border-radius: var(--radius-regular);
`;

const ItemName = styled.span`
  font-weight: 600;
  overflow-wrap: anywhere;
`;

const Id = styled.span`
  color: var(--color-text-muted);
  font-weight: 400;
  font-size: var(--font-size-sm);
`;

const ItemFix = styled.span`
  color: var(--color-text-muted);
  font-size: var(--font-size-base);
  overflow-wrap: anywhere;
`;

const ItemWhy = styled.span`
  font-size: var(--font-size-base);
  overflow-wrap: anywhere;
`;
