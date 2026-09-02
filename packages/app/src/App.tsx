import { DomainAvailabilityProvider } from "@ksp-gonogo/ui-kit";
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
      <AppRoute />
    </DomainAvailabilityProvider>
  );
}

function AppRoute() {
  const route = currentRoute();
  if (route === "station") return <StationScreen />;

  // The main screen and a pilot page BOTH reach the Gonogo mod over insecure
  // ws://, which a secure-origin (HTTPS) page can't do (mixed content), so a
  // hosted build can run neither. Over HTTPS, show the front-door landing that
  // points at local setup; over http:// (local container / dev) render the real
  // screen. Stations are unaffected, they peer over wss.
  if (globalThis.location.protocol === "https:") return <HostedLanding />;

  // A pilot is a peer CLIENT on the coordination plane, never a host: one host
  // owns the thread and the roster, and it is the machine mission control is
  // sitting at. So the pilot route deliberately renders OUTSIDE
  // `PeerHostProvider` and inside a peer client provider of its own.
  if (route === "pilot") return <PilotScreen />;

  return (
    <PeerHostProvider>
      <MainScreen />
    </PeerHostProvider>
  );
}
