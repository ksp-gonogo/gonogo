using System.Collections.Generic;
using Sitrep.Core.Serialization;
using Sitrep.Contract;
using Sitrep.Host.Crash;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The KSP-free crash-record logic: the source-side debris filter, the
    /// wire-dictionary assembly, the per-flight stats tracker, and a check that
    /// the assembled payload survives the real stream-data wire path (the
    /// "subscribed but no stream-data" bug class).
    /// </summary>
    public class CrashPayloadTests
    {
        [Theory]
        [InlineData("Ship", true)]
        [InlineData("Probe", true)]
        [InlineData("Station", true)]
        [InlineData("EVA", true)]
        [InlineData("Debris", false)]
        [InlineData("Flag", false)]
        [InlineData("Unknown", false)]
        public void ShouldPublish_FiltersDebrisFlagAndUnknownAtSource(string vesselType, bool expected)
        {
            Assert.Equal(expected, CrashPayload.ShouldPublish(vesselType));
        }

        [Fact]
        public void ShouldPublish_TreatsNullAsPublishable()
        {
            // A null type is not one of the three excluded names, so it is not
            // filtered here — the producer only ever passes a real enum name.
            Assert.True(CrashPayload.ShouldPublish(null));
        }

        [Fact]
        public void Build_ProducesTheFixtureShapeFieldForField()
        {
            var capture = new CrashCapture
            {
                VesselId = "022457fa-6160-432d-a827-b73fc2ab5810",
                EventKind = "CrashSplashdown",
                What = "an unidentified object",
                VesselType = "Ship",
                Msg = "",
                Latitude = -0.1127,
                Longitude = -74.3385,
                PartsLost = new List<LostPart>
                {
                    new LostPart { PartId = 960720133, PartName = "mk1pod.v2", PartTitle = "Mk1 Command Pod", Msg = "" },
                },
                Body = "Kerbin",
                FlightStats = new FlightStats
                {
                    KerbalsKilled = 0,
                    PartsLost = 1,
                    FlightEndMode = "CATASTROPHIC_FAILURE",
                    HighestSpeedOverLand = 290.707,
                    MissionEnd = true,
                    HighestGee = 11.9903,
                    HighestAltitude = 1195.6304,
                    TotalDistance = 7367.4313,
                    MissionTime = 21.34,
                    HighestSpeed = 368.1807,
                    GroundDistance = 4929.9439,
                    LiftOff = true,
                },
                VesselName = "career-orbital-test",
                Events = new List<string> { "[00:00:00]: Liftoff!!" },
                KerbalsKilled = new List<string> { "Bill Kerman" },
                Situation = "FLYING",
                CrewAboard = new List<string> { "Bill Kerman" },
                Altitude = -0.5283,
                Ut = 41486.3595,
            };

            var dict = CrashPayload.Build(capture);

            Assert.Equal("022457fa-6160-432d-a827-b73fc2ab5810", dict["vesselId"]);
            Assert.Equal("CrashSplashdown", dict["eventKind"]);
            Assert.Equal("an unidentified object", dict["what"]);
            Assert.Equal("Ship", dict["vesselType"]);
            Assert.Equal("Kerbin", dict["body"]);
            Assert.Equal("career-orbital-test", dict["vesselName"]);
            Assert.Equal("FLYING", dict["situation"]);
            Assert.Equal(-0.5283, dict["altitude"]);
            Assert.Equal(41486.3595, dict["ut"]);

            var parts = Assert.IsType<List<object?>>(dict["partsLost"]);
            var part = Assert.IsType<Dictionary<string, object?>>(Assert.Single(parts));
            Assert.Equal(960720133L, part["partId"]);
            Assert.Equal("mk1pod.v2", part["partName"]);
            Assert.Equal("Mk1 Command Pod", part["partTitle"]);

            var stats = Assert.IsType<Dictionary<string, object?>>(dict["flightStats"]);
            Assert.Equal("CATASTROPHIC_FAILURE", stats["flightEndMode"]);
            Assert.Equal(true, stats["missionEnd"]);
            Assert.Equal(true, stats["liftOff"]);
            Assert.Equal(1195.6304, stats["highestAltitude"]);
            Assert.Equal(21.34, stats["missionTime"]);

            var events = Assert.IsType<List<object?>>(dict["events"]);
            Assert.Equal("[00:00:00]: Liftoff!!", Assert.Single(events));

            var crew = Assert.IsType<List<object?>>(dict["crewAboard"]);
            Assert.Equal("Bill Kerman", Assert.Single(crew));
        }

        [Fact]
        public void Build_ProducedPayloadSerializesThroughTheRealWirePath()
        {
            var dict = CrashPayload.Build(new CrashCapture
            {
                VesselId = "abc",
                EventKind = "Destroyed",
                VesselType = "Ship",
                PartsLost = new List<LostPart>(),
                FlightStats = new FlightStats { FlightEndMode = "CATASTROPHIC_FAILURE", MissionEnd = true },
                Events = new List<string> { "[00:00:00]: Liftoff!!" },
                KerbalsKilled = new List<string> { "Lodfred Kerman" },
                CrewAboard = new List<string> { "Lodfred Kerman" },
            });

            var msg = new StreamData<object?>
            {
                Type = "stream-data",
                Topic = CrashTopics.LastCrash,
                Payload = dict,
                Meta = new Meta
                {
                    Source = "s", ValidAt = 0, Seq = 1, DeliveredAt = 0, Vantage = "v",
                    Quality = Quality.OnRails, Active = true, Staleness = Staleness.Fresh, TimelineEpoch = 0,
                },
            };

            // Round-trips without hitting JsonWriter's default-throw, then parses
            // back to a dictionary carrying the crash keys.
            var json = EnvelopeCodec.WriteStreamData(msg);
            var parsed = EnvelopeCodec.ParseStreamData(json);
            var payload = Assert.IsType<Dictionary<string, object?>>(parsed.Payload);
            Assert.Equal("Destroyed", payload["eventKind"]);
            Assert.Equal("Ship", payload["vesselType"]);
        }

        [Fact]
        public void Tracker_AccumulatesMaximaMissionTimeAndDistance()
        {
            var tracker = new FlightStatsTracker();
            const string id = "v1";

            // Two samples 2 UT apart: distance integrates speed over the gap.
            tracker.Sample(id, ut: 100, altitude: 500, srfSpeed: 100, horizontalSrfSpeed: 80, missionTime: 10, geeForce: 3, splashed: false);
            tracker.Sample(id, ut: 102, altitude: 1200, srfSpeed: 200, horizontalSrfSpeed: 150, missionTime: 12, geeForce: 5, splashed: false);

            var stats = tracker.Snapshot(id);
            Assert.Equal(1200, stats.HighestAltitude);
            Assert.Equal(200, stats.HighestSpeed);
            Assert.Equal(200, stats.HighestSpeedOverLand);
            Assert.Equal(5, stats.HighestGee);
            Assert.Equal(12, stats.MissionTime);
            Assert.True(stats.LiftOff);
            // Second sample integrated over dt=2: 200 m/s * 2s = 400 m surface,
            // 150 * 2 = 300 m ground.
            Assert.Equal(400, stats.TotalDistance);
            Assert.Equal(300, stats.GroundDistance);
            // Crash-context defaults.
            Assert.True(stats.MissionEnd);
            Assert.Equal("CATASTROPHIC_FAILURE", stats.FlightEndMode);
        }

        [Fact]
        public void Tracker_SplashedSampleExcludedFromHighestSpeedOverLand()
        {
            var tracker = new FlightStatsTracker();
            const string id = "v1";
            tracker.Sample(id, ut: 1, altitude: 0, srfSpeed: 90, horizontalSrfSpeed: 0, missionTime: 5, geeForce: 12, splashed: true);

            var stats = tracker.Snapshot(id);
            Assert.Equal(90, stats.HighestSpeed);
            Assert.Equal(0, stats.HighestSpeedOverLand);
        }

        [Fact]
        public void Tracker_DoesNotIntegrateAcrossALargeUtJump()
        {
            var tracker = new FlightStatsTracker();
            const string id = "v1";
            tracker.Sample(id, ut: 100, altitude: 0, srfSpeed: 100, horizontalSrfSpeed: 100, missionTime: 1, geeForce: 1, splashed: false);
            // A 1000 UT jump (warp / quickload) must not integrate a spurious
            // 100 km distance.
            tracker.Sample(id, ut: 1100, altitude: 0, srfSpeed: 100, horizontalSrfSpeed: 100, missionTime: 2, geeForce: 1, splashed: false);

            var stats = tracker.Snapshot(id);
            Assert.Equal(0, stats.TotalDistance);
            Assert.Equal(0, stats.GroundDistance);
        }

        [Fact]
        public void Tracker_RecordsTimestampedEventsAndCountsPartsLost()
        {
            var tracker = new FlightStatsTracker();
            const string id = "v1";
            tracker.RecordEvent(id, 0, "Liftoff!!");
            tracker.RecordEvent(id, 21, "Mk1 Command Pod splashed down hard and was destroyed.");
            tracker.RecordPartsLost(id, 3);
            tracker.RecordPartsLost(id);

            var events = tracker.Events(id);
            Assert.Equal(2, events.Count);
            Assert.Equal("[00:00:00]: Liftoff!!", events[0]);
            Assert.Equal("[00:00:21]: Mk1 Command Pod splashed down hard and was destroyed.", events[1]);
            Assert.Equal(4, tracker.Snapshot(id).PartsLost);
        }

        [Fact]
        public void Tracker_ForgetDropsAccumulatedState()
        {
            var tracker = new FlightStatsTracker();
            const string id = "v1";
            tracker.Sample(id, ut: 1, altitude: 900, srfSpeed: 50, horizontalSrfSpeed: 50, missionTime: 3, geeForce: 2, splashed: false);
            tracker.Forget(id);

            var stats = tracker.Snapshot(id);
            Assert.Equal(0, stats.HighestAltitude);
            Assert.False(stats.LiftOff);
        }

        [Theory]
        [InlineData(0, "00:00:00")]
        [InlineData(21, "00:00:21")]
        [InlineData(75, "00:01:15")]
        [InlineData(3661, "01:01:01")]
        public void FormatMissionClock_FormatsHhMmSs(double seconds, string expected)
        {
            Assert.Equal(expected, FlightStatsTracker.FormatMissionClock(seconds));
        }
    }
}
