import styled from "styled-components";
import type { HostUplinkFailure, UplinkLoadFailure } from "./loadFailures";

type Props =
  | Readonly<{ audience: "main"; failures: readonly UplinkLoadFailure[] }>
  | Readonly<{
      audience: "station";
      failures: readonly HostUplinkFailure[];
    }>;

/**
 * The page shown in place of the dashboard while an installed Uplink has
 * failed to load, naming each failing Uplink, why in plain words and what fixes
 * it. It has no way past it: the operator fixes the install and restarts KSP,
 * and the page clears when the Gonogo mod's stream reconnects and the Uplink
 * loads. On a station it names the same Uplinks and says the main screen is the
 * one that needs fixing. Used by the main screen's start gate and by the
 * station screen while its main screen is in this state.
 */
export function UplinkLoadFailureScreen(props: Props) {
  const { audience, failures } = props;
  const count = failures.length;
  const noun = count === 1 ? "Uplink" : "Uplinks";
  return (
    <Wrap
      aria-label={
        audience === "main" ? "Uplink load failure" : "Main screen needs fixing"
      }
    >
      <Frame role="alert">
        <Title>
          {audience === "main"
            ? `${count} installed ${noun} failed to load`
            : "The main screen needs fixing"}
        </Title>
        <Lede>
          {audience === "main"
            ? "Gonogo does not open until every installed Uplink loads, because the dashboard cannot run the way it was set up."
            : `${count === 1 ? "An installed Uplink" : `${count} installed Uplinks`} failed to load on the main screen, so it is not showing its dashboard. This station reconnects on its own once the main screen is fixed.`}
        </Lede>
        <List>
          {props.audience === "main"
            ? props.failures.map((f) => (
                <Item key={f.id}>
                  <ItemName>
                    {f.name}
                    {f.name === f.id ? "" : <Id> {f.id}</Id>}
                  </ItemName>
                  <ItemWhy>{f.why}</ItemWhy>
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
        {audience === "main" && (
          <Fix>
            <FixTitle>To fix it</FixTitle>
            <FixText>
              Update the Uplink or the Gonogo mod so they match, or remove the
              Uplink from the GameData folder. Then restart KSP. This page
              clears when the mod reconnects and every Uplink loads.
            </FixText>
          </Fix>
        )}
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

const Lede = styled.p`
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-base);
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

const ItemWhy = styled.span`
  font-size: var(--font-size-base);
  overflow-wrap: anywhere;
`;

const Fix = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-caption);
`;

const FixTitle = styled.h2`
  margin: 0;
  font-size: var(--font-size-base);
`;

const FixText = styled.p`
  margin: 0;
  font-size: var(--font-size-base);
`;
