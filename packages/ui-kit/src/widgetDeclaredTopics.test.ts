import { describe, expect, it } from "vitest";
import {
  widgetDeclaredTopics,
  widgetDrawnFamilies,
  widgetDrawnFields,
} from "./widgetDeclaredTopics";

const graph = {
  channelsFromConfig: (config: { keys: string[] }) => config.keys,
};

describe("widgetDeclaredTopics", () => {
  it("joins the concrete channels without duplicates", () => {
    expect(
      widgetDeclaredTopics({
        channels: ["vessel.orbit"],
        optionalChannels: ["vessel.orbit", "comms.delay"],
        dataRequirements: ["v.altitude"],
      }),
    ).toEqual(["vessel.orbit", "comms.delay", "v.altitude"]);
  });

  it("leaves families out, because blackout is per craft", () => {
    expect(
      widgetDeclaredTopics({
        channels: ["vessel.orbit"],
        channelFamilies: ["trackingStation.vessel.<vessel>.link"],
        optionalChannelFamilies: ["vessel.partActions.<flightId>"],
      }),
    ).toEqual(["vessel.orbit"]);
  });

  it("adds the Topics channelsFromConfig names for the config it is given", () => {
    const config = { keys: ["vessel.flight", "vessel.orbit"] };
    expect(widgetDeclaredTopics(graph, config)).toEqual([
      "vessel.flight",
      "vessel.orbit",
    ]);
  });

  it("names nothing from channelsFromConfig when no config is given", () => {
    expect(widgetDeclaredTopics(graph)).toEqual([]);
  });
});

describe("widgetDrawnFields", () => {
  it("falls back to the declared Topics, config Topics included", () => {
    expect(
      widgetDrawnFields(
        { ...graph, channels: ["vessel.flight"] },
        { keys: ["vessel.orbit"] },
      ),
    ).toEqual(["vessel.flight", "vessel.orbit"]);
  });

  it("adds config Topics to an explicit fields list", () => {
    expect(
      widgetDrawnFields(
        { ...graph, fields: ["vessel.flight.altitudeAsl"] },
        { keys: ["vessel.orbit"] },
      ),
    ).toEqual(["vessel.flight.altitudeAsl", "vessel.orbit"]);
  });
});

describe("widgetDrawnFamilies", () => {
  it("joins both family lists without duplicates", () => {
    expect(
      widgetDrawnFamilies({
        channelFamilies: ["trackingStation.vessel.<vessel>.link"],
        optionalChannelFamilies: [
          "trackingStation.vessel.<vessel>.link",
          "silence.<vessel>.state",
        ],
      }),
    ).toEqual([
      "trackingStation.vessel.<vessel>.link",
      "silence.<vessel>.state",
    ]);
  });

  it("is empty for an undefined definition or one with no families", () => {
    expect(widgetDrawnFamilies(undefined)).toEqual([]);
    expect(widgetDrawnFamilies({ channels: ["vessel.orbit"] })).toEqual([]);
  });
});
