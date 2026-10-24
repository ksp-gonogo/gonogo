using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host.Recovery;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// A recovery in a save that awards nothing (Sandbox has no funds, no science and no
    /// reputation) still produces a record from what is known about the craft, and every
    /// figure the save cannot award is absent on the wire rather than 0.
    /// </summary>
    public class UnawardedRecoveryTests
    {
        private static RecoveryCapture Capture() => RecoveryPayload.Unawarded(
            capturedAtUt: 9000,
            vesselName: "Dart 1",
            vesselType: "Ship",
            recoveryLocation: "KSC",
            parts: new[]
            {
                new KeyValuePair<string, string>("mk1pod.v2", "Mk1 Command Pod"),
                new KeyValuePair<string, string>("fuelTank", "FL-T400 Fuel Tank"),
                new KeyValuePair<string, string>("fuelTank", "FL-T400 Fuel Tank"),
            },
            crew: new[]
            {
                new RecoveryCrewItem { Name = "Jebediah Kerman", Trait = "Pilot", IsTourist = false, NewLevel = 2 },
            });

        [Fact]
        public void The_figures_a_save_cannot_award_are_absent_not_zero()
        {
            var capture = Capture();

            Assert.Null(capture.FundsEarned);
            Assert.Null(capture.TotalFunds);
            Assert.Null(capture.ScienceEarned);
            Assert.Null(capture.TotalScience);
            Assert.False(capture.DisplayReputation);
        }

        [Fact]
        public void The_wire_carries_null_for_each_absent_figure()
        {
            var dict = RecoveryPayload.Build(Capture());

            foreach (var key in new[] { "fundsEarned", "totalFunds", "scienceEarned", "totalScience" })
            {
                Assert.True(dict.ContainsKey(key), key);
                Assert.Null(dict[key]);
            }

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
            var parsed = EnvelopeCodec.ParseStreamData(EnvelopeCodec.WriteStreamData(msg));
            var payload = Assert.IsType<Dictionary<string, object?>>(parsed.Payload);
            Assert.True(payload.ContainsKey("fundsEarned"));
            Assert.Null(payload["fundsEarned"]);
        }

        [Fact]
        public void Parts_of_one_kind_are_grouped_and_carry_no_value()
        {
            var capture = Capture();

            Assert.Equal(2, capture.PartBreakdown.Count);
            var tank = capture.PartBreakdown.Find(p => p.PartName == "fuelTank")!;
            Assert.Equal(2, tank.Count);
            Assert.Equal("FL-T400 Fuel Tank", tank.PartTitle);
            Assert.Null(tank.PartValue);
            Assert.Null(tank.ResourcesValue);
            Assert.Null(tank.TotalValue);
        }

        [Fact]
        public void Crew_are_listed_with_no_experience_awarded()
        {
            var capture = Capture();

            var jeb = Assert.Single(capture.CrewBreakdown);
            Assert.Equal("Jebediah Kerman", jeb.Name);
            Assert.Equal(2, jeb.NewLevel);
            Assert.Null(jeb.XpGained);
            Assert.Null(jeb.LevelsGained);
        }

        [Fact]
        public void The_craft_and_where_it_came_down_are_kept()
        {
            var capture = Capture();

            Assert.Equal("Dart 1", capture.VesselName);
            Assert.Equal("Ship", capture.VesselType);
            Assert.Equal("KSC", capture.RecoveryLocation);
            Assert.Equal(9000, capture.CapturedAtUt);
            Assert.Empty(capture.ScienceBreakdown);
            Assert.Empty(capture.ResourceBreakdown);
        }
    }
}
