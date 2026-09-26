import {
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  Section,
  Unit,
} from "@ksp-gonogo/ui-kit";
import {
  BodyLabel,
  CompactLabel,
  CompactReadout,
  CompactRow,
  CompactValue,
} from "./MapView.styles";
import type { MapTelemetry } from "./useMapTelemetry";

/** The map collapsed to a lat/lon readout, for a slot too small to read the canvas. */
export function CompactMapView({
  bodyLabel,
  lat,
  lon,
  altitude,
  positionNotice,
}: Readonly<{
  bodyLabel: string | undefined;
  lat: MapTelemetry["latitudeReading"];
  lon: MapTelemetry["longitudeReading"];
  /** Omitted to leave the altitude row out. */
  altitude: MapTelemetry["altitudeReading"] | undefined;
  positionNotice: string | undefined;
}>) {
  return (
    <Panel
      panelTitle="MAP VIEW"
      // The composed header renders the host-derived stream status.
      panelAside={bodyLabel ? <BodyLabel>{bodyLabel}</BodyLabel> : undefined}
      fitToSize
      sections={
        <Section full>
          <CompactReadout>
            <CompactRow>
              <CompactLabel>Lat</CompactLabel>
              <CompactValue>
                {lat.value === undefined ? (
                  NULL_DISPLAY
                ) : (
                  <Unit value={lat} decimals={2} />
                )}
              </CompactValue>
            </CompactRow>
            <CompactRow>
              <CompactLabel>Lon</CompactLabel>
              <CompactValue>
                {lon.value === undefined ? (
                  NULL_DISPLAY
                ) : (
                  <Unit value={lon} decimals={2} />
                )}
              </CompactValue>
            </CompactRow>
            {altitude !== undefined && (
              <CompactRow>
                <CompactLabel>Alt</CompactLabel>
                <CompactValue>
                  <Unit value={altitude} />
                </CompactValue>
              </CompactRow>
            )}
            {positionNotice !== undefined && (
              <CompactRow>
                <ReadoutCaption>{positionNotice}</ReadoutCaption>
              </CompactRow>
            )}
          </CompactReadout>
        </Section>
      }
    />
  );
}
