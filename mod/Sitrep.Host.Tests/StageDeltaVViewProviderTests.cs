using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Headless test for the P1b slice 2 <see cref="StageDeltaVViewProvider"/>:
    /// a fake <see cref="KspSnapshot"/> carrying the raw
    /// <c>Values["vessel"]["deltaV"]</c> encoding
    /// (<c>Gonogo.KSP.KspHost.BuildDeltaV</c>'s shape — a <c>stages</c> list of
    /// per-stage dicts plus a <c>summary</c> dict) is mapped to the
    /// <c>dv.stages</c> (bare array) and <c>dv.summary</c> (wrapper object)
    /// payloads and asserted against every rule in the provider doc: null when
    /// the sim isn't ready (no <c>deltaV</c> group), per-stage order and field
    /// mapping, the R1/F-1 non-finite-is-absent rule (a <c>NaN</c> ΔV → null,
    /// never a sentinel), the summary totals round-tripping, and the payloads
    /// serializing cleanly through the REAL production path
    /// (<c>EnvelopeCodec.WriteStreamData</c>/<c>ParseStreamData</c>). The live
    /// stock <c>VesselDeltaV</c> read itself is exercised only in-game.
    /// </summary>
    public class StageDeltaVViewProviderTests
    {
        // ----------------------------------------------------------------
        // Absence — "sim not ready" is a null payload, distinct from "zero
        // stages" (an empty list).
        // ----------------------------------------------------------------

        [Fact]
        public void BuildStagesReturnsNullWhenSnapshotHasNoValuesYet()
        {
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(StageDeltaVViewProvider.BuildStages(snapshot));
            Assert.Null(StageDeltaVViewProvider.BuildSummary(snapshot));
        }

        [Fact]
        public void BuildStagesReturnsNullWhenVesselHasNoDeltaVGroup()
        {
            // Active vessel present, but the stock sim wasn't ready this tick so
            // KspHost omitted the deltaV group — the provider must surface that
            // as null (not an empty list), so a widget tells "sim warming up"
            // apart from "genuinely zero ΔV stages".
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["vessel"] = new Dictionary<string, object?>
                    {
                        ["identity"] = new Dictionary<string, object?> { ["id"] = "abc" },
                    },
                },
            };

            Assert.Null(StageDeltaVViewProvider.BuildStages(snapshot));
            Assert.Null(StageDeltaVViewProvider.BuildSummary(snapshot));
        }

        // ----------------------------------------------------------------
        // Mapping — multi-stage, in order, every per-stage field.
        // ----------------------------------------------------------------

        [Fact]
        public void BuildStagesMapsEveryStageInOrderWithEveryField()
        {
            var snapshot = DeltaVSnapshot(
                stages: new List<object?>
                {
                    new Dictionary<string, object?>
                    {
                        ["stage"] = 0,
                        ["dvVac"] = 3200.0,
                        ["dvAsl"] = 2800.0,
                        ["dvActual"] = 3100.0,
                        ["burnTime"] = 120.0,
                        ["twrVac"] = 1.8,
                        ["twrAsl"] = 1.5,
                        ["twrActual"] = 1.7,
                        ["thrustVac"] = 215.0,
                        ["thrustAsl"] = 167.0,
                        ["thrustActual"] = 205.0,
                        ["startMass"] = 18.0,
                        ["endMass"] = 9.0,
                        ["dryMass"] = 6.5,
                        ["fuelMass"] = 9.0,
                    },
                    new Dictionary<string, object?>
                    {
                        ["stage"] = 1,
                        ["dvVac"] = 1500.0,
                        ["dvAsl"] = 1400.0,
                        ["dvActual"] = 1480.0,
                        ["burnTime"] = 60.0,
                        ["twrVac"] = 2.4,
                        ["twrAsl"] = 2.0,
                        ["twrActual"] = 2.3,
                        ["thrustVac"] = 60.0,
                        ["thrustAsl"] = 50.0,
                        ["thrustActual"] = 58.0,
                        ["startMass"] = 4.0,
                        ["endMass"] = 2.0,
                        ["dryMass"] = 1.5,
                        ["fuelMass"] = 2.0,
                    },
                },
                summary: BasicSummary());

            var stages = Assert.IsType<List<object?>>(StageDeltaVViewProvider.BuildStages(snapshot));
            Assert.Equal(2, stages.Count);

            var first = Assert.IsType<Dictionary<string, object?>>(stages[0]);
            Assert.Equal(0, first["stage"]);
            Assert.Equal(3200.0, first["dvVac"]);
            Assert.Equal(2800.0, first["dvAsl"]);
            Assert.Equal(3100.0, first["dvActual"]);
            Assert.Equal(120.0, first["burnTime"]);
            Assert.Equal(1.8, first["twrVac"]);
            Assert.Equal(1.5, first["twrAsl"]);
            Assert.Equal(1.7, first["twrActual"]);
            Assert.Equal(215.0, first["thrustVac"]);
            Assert.Equal(167.0, first["thrustAsl"]);
            Assert.Equal(205.0, first["thrustActual"]);
            Assert.Equal(18.0, first["startMass"]);
            Assert.Equal(9.0, first["endMass"]);
            Assert.Equal(6.5, first["dryMass"]);
            Assert.Equal(9.0, first["fuelMass"]);

            var second = Assert.IsType<Dictionary<string, object?>>(stages[1]);
            Assert.Equal(1, second["stage"]); // order preserved
            Assert.Equal(1500.0, second["dvVac"]);
            Assert.Equal(2.0, second["twrAsl"]);
        }

        // ----------------------------------------------------------------
        // R1/F-1 — a NaN/Infinity ΔV the sim reports maps to null, never a
        // sentinel on the wire.
        // ----------------------------------------------------------------

        [Fact]
        public void BuildStagesTreatsNonFiniteFieldsAsAbsentNotAsNaNOnTheWire()
        {
            var snapshot = DeltaVSnapshot(
                stages: new List<object?>
                {
                    new Dictionary<string, object?>
                    {
                        ["stage"] = 0,
                        ["dvVac"] = double.NaN,
                        ["twrVac"] = double.PositiveInfinity,
                        ["thrustVac"] = 100.0,
                    },
                },
                summary: BasicSummary());

            var stages = Assert.IsType<List<object?>>(StageDeltaVViewProvider.BuildStages(snapshot));
            var stage = Assert.IsType<Dictionary<string, object?>>(stages[0]);
            Assert.Null(stage["dvVac"]);   // NaN -> null
            Assert.Null(stage["twrVac"]);  // Infinity -> null
            Assert.Equal(100.0, stage["thrustVac"]); // finite field unaffected
            Assert.Null(stage["dvAsl"]);   // absent raw field -> null, not 0

            // Serializes cleanly through the REAL production path — no NaN /
            // Infinity token ever reaches the wire.
            var json = SerializeThroughWire(StageDeltaVViewProvider.StagesTopic, stages);
            Assert.DoesNotContain("NaN", json);
            Assert.DoesNotContain("Infinity", json);
        }

        // ----------------------------------------------------------------
        // Summary — key set + totals round-trip.
        // ----------------------------------------------------------------

        [Fact]
        public void BuildSummaryMapsStageCountAndTotalsAndRoundTripsThroughTheWire()
        {
            var snapshot = DeltaVSnapshot(
                stages: new List<object?> { new Dictionary<string, object?> { ["stage"] = 0 } },
                summary: new Dictionary<string, object?>
                {
                    ["stageCount"] = 2,
                    ["totalDvVac"] = 6400.0,
                    ["totalDvAsl"] = 5600.0,
                    ["totalDvActual"] = 6200.0,
                    ["totalBurnTime"] = 240.0,
                });

            var root = Assert.IsType<Dictionary<string, object?>>(StageDeltaVViewProvider.BuildSummary(snapshot));
            Assert.Equal(2, root["stageCount"]);
            Assert.Equal(6400.0, root["totalDvVac"]);
            Assert.Equal(5600.0, root["totalDvAsl"]);
            Assert.Equal(6200.0, root["totalDvActual"]);
            Assert.Equal(240.0, root["totalBurnTime"]);

            var json = SerializeThroughWire(StageDeltaVViewProvider.SummaryTopic, root);
            var parsed = EnvelopeCodec.ParseStreamData(json);
            Assert.Equal(StageDeltaVViewProvider.SummaryTopic, parsed.Topic);
            var parsedRoot = Assert.IsType<Dictionary<string, object?>>(parsed.Payload);
            Assert.Equal(6400.0, parsedRoot["totalDvVac"]);
            Assert.Equal(240.0, parsedRoot["totalBurnTime"]);
        }

        [Fact]
        public void BuildSummaryTreatsNonFiniteTotalAsAbsentNotAsNaN()
        {
            var snapshot = DeltaVSnapshot(
                stages: new List<object?> { new Dictionary<string, object?> { ["stage"] = 0 } },
                summary: new Dictionary<string, object?>
                {
                    ["stageCount"] = 1,
                    ["totalDvVac"] = double.NaN,
                    ["totalBurnTime"] = 60.0,
                });

            var root = Assert.IsType<Dictionary<string, object?>>(StageDeltaVViewProvider.BuildSummary(snapshot));
            Assert.Null(root["totalDvVac"]);
            Assert.Equal(60.0, root["totalBurnTime"]);
        }

        // ----------------------------------------------------------------
        // Helpers.
        // ----------------------------------------------------------------

        private static Dictionary<string, object?> BasicSummary() => new Dictionary<string, object?>
        {
            ["stageCount"] = 1,
            ["totalDvVac"] = 3200.0,
            ["totalDvAsl"] = 2800.0,
            ["totalDvActual"] = 3100.0,
            ["totalBurnTime"] = 120.0,
        };

        private static KspSnapshot DeltaVSnapshot(List<object?> stages, Dictionary<string, object?> summary)
        {
            return new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["vessel"] = new Dictionary<string, object?>
                    {
                        ["deltaV"] = new Dictionary<string, object?>
                        {
                            ["stages"] = stages,
                            ["summary"] = summary,
                        },
                    },
                },
            };
        }

        private static string SerializeThroughWire(string topic, object? payload)
        {
            var streamData = new StreamData<object?>
            {
                Topic = topic,
                Payload = payload,
                Meta = new Meta
                {
                    Source = "vessel",
                    ValidAt = 0,
                    Vantage = "host",
                    Quality = Quality.OnRails,
                    Active = true,
                    Staleness = Staleness.Fresh,
                },
            };
            return EnvelopeCodec.WriteStreamData(streamData);
        }
    }
}
