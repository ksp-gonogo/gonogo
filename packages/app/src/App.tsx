import { DomainAvailabilityProvider } from "@ksp-gonogo/ui-kit";
import { InjectedRadioBackend } from "./commcast/radio/InjectedRadioBackend";
import { HostedLanding } from "./screens/HostedLanding";
import { currentRoute } from "./screens/isStationRoute";
import { LocalScreen } from "./screens/LocalScreen";
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
  if (route === "pilot-station") return <PilotScreen />;

  /*
   * A local screen reaches the Gonogo mod over insecure ws://, which a page
   * served over HTTPS cannot open to another machine. The hosted build's front
   * door says so and points at local setup; a pilot there waits for the game
   * and says the same once it has waited long enough.
   */
  if (route === "main" && globalThis.location.protocol === "https:") {
    return <HostedLanding />;
  }

  return <LocalScreen seat={route} />;
}
