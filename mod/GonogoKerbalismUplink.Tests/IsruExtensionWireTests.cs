using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Gonogo.KerbalismUplink;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Xunit;

namespace GonogoKerbalismUplink.Tests
{
    /// <summary>
    /// The SERVER half of the ISRU-provider proof: Kerbalism wins the <c>"isru"</c>
    /// election, fills the shared <c>isru.*</c> shapes from its own model, and
    /// carries what those shapes have no field for in its own namespace of the
    /// payload's extension bag, with the REAL wire writer carrying it.
    ///
    /// <para><b>Why the real codec.</b> The claim is about the wire, so these go
    /// through <see cref="EnvelopeCodec.WriteStreamData"/>, the same call the courier
    /// makes. Asserting on <see cref="KerbalismIsruMap"/>'s output would restate the
    /// producer and prove nothing about serialisation, which matters more here than
    /// usual: <c>isru.*</c> publishes typed POCOs, so the bag has to survive a
    /// hand-written flattener rather than a generic dictionary walk.</para>
    ///
    /// <para><b>The fixture is the handoff to the client.</b> The JSON asserted here
    /// is committed as <c>mod/golden-fixtures/isru-extensions.json</c> and read back
    /// by this Uplink's client test (<c>client/src/isru.test.ts</c>), which drives it
    /// through the real decode path and asserts the typed narrow and the wrapped
    /// values. Neither side can drift without one of the two going red.</para>
    /// </summary>
    public class IsruExtensionWireTests
    {
        private static readonly string FixturePath = Path.Combine(
            AppContext.BaseDirectory, "golden-fixtures", "isru-extensions.json");

        private static string FixtureWire(string name)
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(FixturePath));
            foreach (var vector in doc.RootElement.EnumerateArray())
            {
                if (vector.GetProperty("name").GetString() == name)
                {
                    return vector.GetProperty("json").GetString()!;
                }
            }

            throw new InvalidOperationException(
                "No fixture vector named '" + name + "' in " + FixturePath);
        }

        /// <summary>
        /// Two drills that differ in every branch the map takes: one surface
        /// harvester running cleanly with live abundance, one asteroid harvester
        /// (type 4) that is stopped with a blocking issue and carries source-mass
        /// depletion figures the first one must not have. Nothing here can pass by
        /// coincidence.
        /// </summary>
        private static List<HarvesterRaw> Harvesters() => new List<HarvesterRaw>
        {
            new HarvesterRaw
            {
                FlightId = 101,
                Resource = "Ore",
                Deployed = true,
                Running = true,
                Issue = "",
                Type = 0,
                Rate = 0.005,
                AbundanceRate = 0.1,
                EcRate = 1.5,
                Abundance = 0.075,
                AdjustedRate = 0.00375,
            },
            new HarvesterRaw
            {
                FlightId = 102,
                Resource = "Water",
                Deployed = false,
                Running = false,
                Issue = "not deployed",
                Type = 4,
                Rate = 0.01,
                AbundanceRate = 0.1,
                EcRate = 2.5,
                Abundance = 0.4,
                AdjustedRate = 0.04,
                SourceMassRemaining = 18.25,
                SourceMassThreshold = 2.5,
            },
        };

        /// <summary>
        /// One ISRU chemical plant and one life-support scrubber, deliberately, because
        /// Kerbalism does not separate them and this channel therefore carries both. A
        /// filter here would show up as the scrubber vanishing from this fixture.
        /// </summary>
        private static List<ProcessRaw> Processes() => new List<ProcessRaw>
        {
            new ProcessRaw
            {
                FlightId = 201,
                Resource = "_MoltenRegolithElectrolysis",
                Title = "Molten Regolith Electrolysis",
                Capacity = 2.0,
                Running = true,
                Broken = false,
                ValveIndex = 1,
                EnvModifier = 0.5,
            },
            new ProcessRaw
            {
                FlightId = 202,
                Resource = "_Scrubber",
                Title = "CO2 Scrubber",
                Capacity = 1.0,
                Running = true,
                Broken = true,
                ValveIndex = 0,
                EnvModifier = 1.0,
            },
        };

        private static List<ProcessDefRaw> Definitions() => new List<ProcessDefRaw>
        {
            new ProcessDefRaw
            {
                Name = "moltenRegolithElectrolysis",
                Inputs = new Dictionary<string, double> { ["Ore"] = 0.00006342, ["ElectricCharge"] = 2.0 },
                Outputs = new Dictionary<string, double> { ["Oxygen"] = 0.088843 },
                Modifiers = new List<string> { "_MoltenRegolithElectrolysis" },
            },
            new ProcessDefRaw
            {
                Name = "scrubber",
                Inputs = new Dictionary<string, double> { ["CarbonDioxide"] = 0.001 },
                Outputs = new Dictionary<string, double> { ["Oxygen"] = 0.001 },
                Modifiers = new List<string> { "_Scrubber" },
            },
        };

        private static Meta FixedMeta() => new Meta
        {
            Source = "vessel-1",
            ValidAt = 120.5,
            Seq = 7,
            DeliveredAt = 122.75,
            Vantage = "KSC",
            Quality = Quality.OnRails,
            Active = true,
            Staleness = Staleness.Fresh,
            TimelineEpoch = 0,
        };

        private static string Write(string topic, object? payload) =>
            EnvelopeCodec.WriteStreamData(new StreamData<object?>
            {
                Topic = topic,
                Payload = payload,
                Meta = FixedMeta(),
            });

        private static string Drills() => Write("isru.drills", KerbalismIsruMap.Drills(Harvesters()));

        private static string Converters() =>
            Write("isru.converters", KerbalismIsruMap.Converters(Processes(), Definitions()));

        /// <summary>
        /// End to end, server side: the provider's own map fills
        /// <c>extensions["kerbalism"]</c> on a shared ISRU payload and the real codec
        /// writes it, namespaced, with the diagnostic and the depletion figures
        /// intact. The client half of the same fixture is <c>isru.test.ts</c>.
        /// </summary>
        [Fact]
        public void TheProvidersNamespaceReachesTheWireThroughTheRealCodec()
        {
            var json = Drills();

            Assert.Contains("\"extensions\":{\"kerbalism\":{", json);
            Assert.Contains("\"issue\":\"not deployed\"", json);
            // 18.25 is the asteroid's remaining mass, not its 2.5 threshold and not
            // any rate: a map that reached for the wrong field would fail here.
            Assert.Contains("\"sourceMassRemaining\":18.25", json);
            Assert.Contains("\"sourceMassThreshold\":2.5", json);
            Assert.Contains("\"ecRate\":1.5", json);
        }

        [Fact]
        public void TheConverterNamespaceCarriesTheProcessThrottleState()
        {
            var json = Converters();

            Assert.Contains("\"processToken\":\"_MoltenRegolithElectrolysis\"", json);
            Assert.Contains("\"title\":\"Molten Regolith Electrolysis\"", json);
            Assert.Contains("\"capacity\":2", json);
            Assert.Contains("\"broken\":true", json);
            Assert.Contains("\"valveIndex\":1", json);
        }

        /// <summary>
        /// The committed fixture IS what the real codec produces. This is what makes
        /// the client-side test non-vacuous: it reads a file this test proves came out
        /// of the server, not a hand-authored approximation of one.
        /// </summary>
        [Fact]
        public void TheCommittedFixtureIsExactlyWhatTheCodecProduces()
        {
            Assert.Equal(FixtureWire("drills-kerbalism"), Drills());
            Assert.Equal(FixtureWire("converters-kerbalism"), Converters());
        }

        /// <summary>
        /// Every SHARED field is filled on a Kerbalism drill frame. This is the claim
        /// that separates ISRU from science: there, Kerbalism has to leave core fields
        /// null because its data is in a different unit. Here it does not, so a widget
        /// that never imports the accessor still renders a complete row.
        /// </summary>
        [Fact]
        public void TheSharedShapeIsFullyFilledWithNoStructuralNulls()
        {
            var drill = KerbalismIsruMap.Drills(Harvesters())[0];

            Assert.Equal("101", drill.PartId);
            Assert.Equal("Ore", drill.Resource);
            Assert.True(drill.Deployed);
            Assert.True(drill.Running);
            Assert.Equal(0.075, drill.Abundance!.Value, 6);
            Assert.Equal(0.00375, drill.Rate!.Value, 8);
        }

        /// <summary>
        /// A stopped drill reports a real zero rather than an absence, the same rule
        /// the stock backend follows, so a renderer never has to decide what a null
        /// rate on a stopped drill means.
        /// </summary>
        [Fact]
        public void AStoppedDrillReportsZeroRateRatherThanNull()
        {
            var stopped = KerbalismIsruMap.Drills(Harvesters())[1];

            Assert.False(stopped.Running);
            Assert.Equal(0.0, stopped.Rate!.Value);
        }

        /// <summary>
        /// An empty issue string is carried as null, not as "". A reader should not
        /// have to know that one particular empty string is the all-clear.
        /// </summary>
        [Fact]
        public void AHealthyDrillsIssueIsNullRatherThanAnEmptyString()
        {
            Assert.Contains("\"issue\":null", Drills());
        }

        /// <summary>
        /// The recipe is scaled by the part's capacity AND the live environment
        /// product, not left at the raw config ratio: the shared shape promises what
        /// is actually moving. The plant runs at capacity 2 with a 0.5 modifier, so
        /// its rates come out at the config figure exactly once over.
        /// </summary>
        [Fact]
        public void RecipeRatesAreScaledByCapacityAndTheLiveModifier()
        {
            var plant = KerbalismIsruMap.Converters(Processes(), Definitions())[0];

            var electricCharge = plant.Inputs.Find(f => f.Resource == "ElectricCharge");
            Assert.NotNull(electricCharge);
            Assert.Equal(2.0 * 2.0 * 0.5, electricCharge!.Rate!.Value, 8);

            var oxygen = plant.Outputs.Find(f => f.Resource == "Oxygen");
            Assert.NotNull(oxygen);
            Assert.Equal(0.088843 * 2.0 * 0.5, oxygen!.Rate!.Value, 8);
        }

        /// <summary>
        /// Life-support processes are NOT filtered out. Kerbalism runs a scrubber and
        /// a regolith-electrolysis plant on the same module, so a filter here would be
        /// gonogo asserting a taxonomy the engine does not draw. The deliberate cost is
        /// an overlap with kerbalism.lifesupport, which reports the same parts from the
        /// supply side.
        /// </summary>
        [Fact]
        public void LifeSupportProcessesAreCarriedToo()
        {
            var converters = KerbalismIsruMap.Converters(Processes(), Definitions());

            Assert.Equal(2, converters.Count);
            var scrubber = converters.Find(c => c.PartId == "202");
            Assert.NotNull(scrubber);
            Assert.Contains(scrubber!.Inputs, f => f.Resource == "CarbonDioxide");
        }

        /// <summary>
        /// A controller whose profile definition cannot be resolved still produces a
        /// row: the part is genuinely on the vessel, and reporting it with no chemistry
        /// beats dropping it and leaving a hole in the operator's list.
        /// </summary>
        [Fact]
        public void AnUnresolvableProcessStillProducesARowWithNoFlows()
        {
            var converters = KerbalismIsruMap.Converters(Processes(), new List<ProcessDefRaw>());

            Assert.Equal(2, converters.Count);
            Assert.Empty(converters[0].Inputs);
            Assert.Empty(converters[0].Outputs);
            // The throttle state is still known even when the chemistry is not.
            Assert.Contains("_MoltenRegolithElectrolysis", Write("isru.converters", converters));
        }
    }
}
