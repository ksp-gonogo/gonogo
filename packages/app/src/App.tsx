import { DomainAvailabilityProvider } from "@ksp-gonogo/ui-kit";
import { InjectedRadioBackend } from "./commcast/radio/InjectedRadioBackend";
import { PeerHostProvider } from "./peer/PeerHostProvider";
import { HostedLanding } from "./screens/HostedLanding";
import { currentRoute } from "./screens/isStationRoute";
import { MainScreen } from "./screens/MainScreen";
import { PilotScreen } from "./screens/PilotScreen";
import { StationScreen } from "./screens/StationScreen";
import "./styles/fonts.css";
import "./styles/global.css";

export default function App() {
  // Owns the ui-kit domain-availability store both screens' AugmentSlots read;
  // each screen's telemetry-fed `AugmentAvailabilityFeeder` writes into it. The
  // store lives above the screen split so a route change never remounts it.
  return (
    <DomainAvailabilityProvider>
      {/* Above the route split, because every screen carries a radio and the
          backend must not change identity when the route does. */}
      <InjectedRadioBackend>
        <AppRoute />
      </InjectedRadioBackend>
    </DomainAvailabilityProvider>
  );
}

function AppRoute() {
  const route = currentRoute();
  if (route === "station") return <StationScreen />;

  /*
   * A pilot is a peer CLIENT on the coordination plane, never a host: one host
   * owns the thread and the roster, and it is the machine mission control is
   * sitting at. So the pilot route deliberately renders OUTSIDE
   * `PeerHostProvider` and inside a peer client provider of its own.
   *
   * Ahead of the HTTPS gate below, and only since the host learned to serve a
   * peer from a session at its own vantage: a hosted pilot reads its telemetry
   * over the peer link (`PeerTransport`, wss) rather than the insecure ws://
   * this gate exists to refuse, so there is nothing left for it to protect the
   * pilot from. `PilotScreen` picks the transport by the same protocol test.
   */
  if (route === "pilot") return <PilotScreen />;

  // The MAIN screen still reaches the Gonogo mod over insecure ws://, which a
  // secure-origin (HTTPS) page can't do (mixed content), so a hosted build
  // cannot run one. Over HTTPS, show the front-door landing that points at
  // local setup; over http:// (local container / dev) render the real screen.
  // Stations are unaffected, they peer over wss, and so is the pilot above.
  if (globalThis.location.protocol === "https:") return <HostedLanding />;

  return (
    <PeerHostProvider>
      <MainScreen />
    </PeerHostProvider>
  );
}
