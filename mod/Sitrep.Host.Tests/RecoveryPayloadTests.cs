using System.Collections.Generic;
using Sitrep.Core.Serialization;
using Sitrep.Contract;
using Sitrep.Host.Recovery;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The KSP-free recovery-record logic: the source-side debris filter and
    /// the wire-dictionary assembly, plus a check that the assembled payload
    /// survives the real stream-data wire path (the "subscribed but no
    /// stream-data" bug class). Mirrors <c>CrashPayloadTests</c>.
    /// </summary>
    public class RecoveryPayloadTests
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
            Assert.Equal(expected, RecoveryPayload.ShouldPublish(vesselType));
        }

        [Fact]
        public void ShouldPublish_TreatsNullAsPublishable()
        {
            Assert.True(RecoveryPayload.ShouldPublish(null));
        }

        [Fact]
        public void Build_ProducesTheFixtureShapeFieldForField()
        {
            var capture = new RecoveryCapture
            {
                CapturedAtUt = 41520.75,
                VesselName = "career-orbital-test",
                VesselType = "Ship",
                RecoveryLocation = "KSC",
                RecoveryFactor = "100%",
                ScienceEarned = 12.5,
                TotalScience = 340.25,
                FundsEarned = 18500,
                TotalFunds = 289848,
                ReputationEarned = 4.2,
                TotalReputation = 88.6,
                DisplayReputation = true,
                ScienceBreakdown = new List<RecoveryScienceItem>
                {
                    new RecoveryScienceItem
                    {
                        SubjectId = "crewReport@KerbinSrfLandedKSC",
                        SubjectTitle = "Crew Report from KSC",
                        DataGathered = 5,
                        ScienceAmount = 2.5,
                    },
                },
                PartBreakdown = new List<RecoveryPartItem>
                {
                    new RecoveryPartItem
                    {
                        PartName = "mk1pod.v2",
                        PartTitle = "Mk1 Command Pod",
                        Count = 1,
                        PartValue = 600,
                        ResourcesValue = 0,
                        TotalValue = 600,
                    },
                },
                ResourceBreakdown = new List<RecoveryResourceItem>
                {
                    new RecoveryResourceItem
                    {
                        ResourceName = "LiquidFuel",
                        Amount = 10.5,
                        UnitValue = 0.8,
                        TotalValue = 8.4,
                    },
                },
                CrewBreakdown = new List<RecoveryCrewItem>
                {
                    new RecoveryCrewItem
                    {
                        Name = "Bill Kerman",
                        Trait = "Pilot",
                        IsTourist = false,
                        XpGained = 1.2,
                        LevelsGained = 1,
                        NewLevel = 2,
                    },
                },
            };

            var dict = RecoveryPayload.Build(capture);

            Assert.Equal(41520.75, dict["capturedAtUT"]);
            Assert.Equal("career-orbital-test", dict["vesselName"]);
            Assert.Equal("KSC", dict["recoveryLocation"]);
            Assert.Equal("100%", dict["recoveryFactor"]);
            Assert.Equal(12.5, dict["scienceEarned"]);
            Assert.Equal(340.25, dict["totalScience"]);
            Assert.Equal(18500d, dict["fundsEarned"]);
            Assert.Equal(289848d, dict["totalFunds"]);
            Assert.Equal(4.2, dict["reputationEarned"]);
            Assert.Equal(88.6, dict["totalReputation"]);
            Assert.Equal(true, dict["displayReputation"]);

            var science = Assert.IsType<List<object?>>(dict["scienceBreakdown"]);
            var scienceEntry = Assert.IsType<Dictionary<string, object?>>(Assert.Single(science));
            Assert.Equal("crewReport@KerbinSrfLandedKSC", scienceEntry["subjectId"]);
            Assert.Equal("Crew Report from KSC", scienceEntry["subjectTitle"]);
            Assert.Equal(2.5, scienceEntry["scienceAmount"]);

            var parts = Assert.IsType<List<object?>>(dict["partBreakdown"]);
            var partEntry = Assert.IsType<Dictionary<string, object?>>(Assert.Single(parts));
            Assert.Equal("mk1pod.v2", partEntry["partName"]);
            Assert.Equal("Mk1 Command Pod", partEntry["partTitle"]);
            Assert.Equal(1, partEntry["count"]);
            Assert.Equal(600d, partEntry["totalValue"]);

            var resources = Assert.IsType<List<object?>>(dict["resourceBreakdown"]);
            var resourceEntry = Assert.IsType<Dictionary<string, object?>>(Assert.Single(resources));
            Assert.Equal("LiquidFuel", resourceEntry["resourceName"]);
            Assert.Equal(10.5, resourceEntry["amount"]);

            var crew = Assert.IsType<List<object?>>(dict["crewBreakdown"]);
            var crewEntry = Assert.IsType<Dictionary<string, object?>>(Assert.Single(crew));
            Assert.Equal("Bill Kerman", crewEntry["name"]);
            Assert.Equal("Pilot", crewEntry["trait"]);
            Assert.Equal(false, crewEntry["isTourist"]);
            Assert.Equal(2, crewEntry["newLevel"]);
        }

        [Fact]
        public void Build_ProducedPayloadSerializesThroughTheRealWirePath()
        {
            var dict = RecoveryPayload.Build(new RecoveryCapture
            {
                VesselName = "solo-probe",
                VesselType = "Probe",
                RecoveryLocation = "Water",
                RecoveryFactor = "78%",
            });

            var msg = new StreamData<object?>
            {
                Type = "stream-data",
                Topic = RecoveryTopics.LastSummaryTopic,
                Payload = dict,
                Meta = new Meta
                {
                    Source = "s", ValidAt = 0, Seq = 1, DeliveredAt = 0, Vantage = "v",
                    Quality = Quality.OnRails, Active = true, Staleness = Staleness.Fresh, TimelineEpoch = 0,
                },
            };

            // Round-trips without hitting JsonWriter's default-throw, then
            // parses back to a dictionary carrying the recovery keys.
            var json = EnvelopeCodec.WriteStreamData(msg);
            var parsed = EnvelopeCodec.ParseStreamData(json);
            var payload = Assert.IsType<Dictionary<string, object?>>(parsed.Payload);
            Assert.Equal("solo-probe", payload["vesselName"]);
            Assert.Equal("Water", payload["recoveryLocation"]);
        }

        [Fact]
        public void Build_EmptyBreakdownsProduceEmptyListsNotNulls()
        {
            var dict = RecoveryPayload.Build(new RecoveryCapture());

            Assert.Empty(Assert.IsType<List<object?>>(dict["scienceBreakdown"]));
            Assert.Empty(Assert.IsType<List<object?>>(dict["partBreakdown"]));
            Assert.Empty(Assert.IsType<List<object?>>(dict["resourceBreakdown"]));
            Assert.Empty(Assert.IsType<List<object?>>(dict["crewBreakdown"]));
        }
    }
}
