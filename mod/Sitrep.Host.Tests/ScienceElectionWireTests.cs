using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Sitrep.Host.Science;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The correctness criterion for making <c>science</c> a Kernel-elected
    /// capability, stated as BYTES: with no provider registered, the elected
    /// vanilla backend puts on the wire exactly what the direct
    /// <see cref="ScienceViewProvider"/> wiring put there before the election
    /// existed. The election is indirection only, so nothing a client already
    /// subscribed to can shift under it.
    ///
    /// <para><b>Why the real codec and not an assertion on the mapper's
    /// dictionary.</b> The claim is about the wire, so these go through
    /// <see cref="EnvelopeCodec.WriteStreamData"/>, the same call the courier
    /// makes: the same discipline
    /// <c>GonogoKerbalismUplink.Tests.ReliabilityExtensionWireTests</c> used to
    /// prove the provider-extension bag.</para>
    ///
    /// <para>Two assertions per claim, deliberately. The elected-vs-direct
    /// comparison would still pass if BOTH sides had drifted together, so one
    /// frame is also pinned against a literal written out in full.</para>
    /// </summary>
    public class ScienceElectionWireTests
    {
        /// <summary>
        /// A vessel carrying something in every one of the five sub-groups, with
        /// values that differ from each other field by field: a mapper that
        /// crossed two fields, or a sub-group that read another's list, cannot
        /// pass by coincidence.
        /// </summary>
        private static KspSnapshot Snapshot() => new KspSnapshot
        {
            Ut = 55.0,
            Values = new Dictionary<string, object?>
            {
                ["science"] = new Dictionary<string, object?>
                {
                    ["experiments"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["partName"] = "Mystery Goo Containment Pod",
                            ["location"] = "experiment",
                            ["experimentId"] = "mysteryGoo",
                            ["subjectId"] = "mysteryGoo@KerbinSrfLandedLaunchPad",
                            ["title"] = "Mystery Goo Observation",
                            ["dataAmount"] = 5.0,
                            ["scienceValueRatio"] = 0.75,
                            ["baseTransmitValue"] = 0.3,
                            ["transmitBonus"] = 1.0,
                            ["labValue"] = 1.25,
                            ["deployed"] = true,
                            ["inoperable"] = false,
                            ["situation"] = "SrfLanded",
                        },
                    },
                    ["instruments"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["partId"] = "12345",
                            ["partName"] = "SC-9001 Science Jr.",
                            ["experimentId"] = "mysteryGoo",
                            ["title"] = "Mystery Goo Observation",
                            ["deployed"] = false,
                            ["inoperable"] = false,
                            ["rerunnable"] = true,
                            ["resettable"] = false,
                            ["dataIsCollectable"] = true,
                        },
                    },
                    ["sensors"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["partId"] = "67890",
                            ["partName"] = "2HOT Thermometer",
                            ["type"] = "TEMP",
                            ["readout"] = "293.1K",
                            ["active"] = true,
                        },
                    },
                    ["lab"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["partName"] = "Mobile Processing Lab MPL-LG-2",
                            ["dataStored"] = 12.5,
                            ["dataStorage"] = 750.0,
                            ["storedScience"] = 40.0,
                            ["processingData"] = true,
                            ["statusText"] = "Researching",
                            ["scientistCount"] = 2,
                            ["scienceRate"] = 1.5,
                            ["isOperational"] = true,
                        },
                    },
                    ["experimentBreakdown"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["subjectId"] = "mysteryGoo@KerbinSrfLandedLaunchPad",
                            ["biome"] = "LaunchPad",
                            ["situation"] = "SrfLanded",
                            ["expTitle"] = "Mystery Goo Observation",
                            ["dataMits"] = 5.0,
                            ["remainingPotential"] = 7.5,
                        },
                    },
                },
            },
        };

        private static Meta FixedMeta() => new Meta
        {
            Source = "vessel-1",
            ValidAt = 55.0,
            Seq = 3,
            DeliveredAt = 55.0,
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

        /// <summary>
        /// The elected backend with no provider registered: stock, resolved
        /// through the REAL <see cref="Kernel"/> rather than constructed
        /// directly, so this exercises the vanilla factory the election actually
        /// installs.
        /// </summary>
        private static IScienceBackend ElectedVanilla(IScienceActuator actuator)
        {
            var kernel = new Kernel();
            ScienceElection.RegisterCapability(kernel, actuator);
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            var elected = ScienceElection.Elected(kernel);
            Assert.NotNull(elected);
            return elected!;
        }

        /// <summary>
        /// Every one of the five channels, byte for byte: what the elected
        /// vanilla backend produces IS what the pre-election channel source
        /// (<see cref="ScienceViewProvider"/> called directly) produced.
        /// </summary>
        [Fact]
        public void EveryElectedVanillaChannelIsByteIdenticalToTheDirectViewProviderWire()
        {
            var snapshot = Snapshot();
            var backend = ElectedVanilla(new FakeScienceActuator());

            Assert.Equal(
                Write(ScienceViewProvider.ExperimentsTopic, ScienceViewProvider.BuildExperiments(snapshot)),
                Write(ScienceViewProvider.ExperimentsTopic, backend.Experiments(snapshot)));
            Assert.Equal(
                Write(ScienceViewProvider.InstrumentsTopic, ScienceViewProvider.BuildInstruments(snapshot)),
                Write(ScienceViewProvider.InstrumentsTopic, backend.Instruments(snapshot)));
            Assert.Equal(
                Write(ScienceViewProvider.SensorsTopic, ScienceViewProvider.BuildSensors(snapshot)),
                Write(ScienceViewProvider.SensorsTopic, backend.Sensors(snapshot)));
            Assert.Equal(
                Write(ScienceViewProvider.LabTopic, ScienceViewProvider.BuildLab(snapshot)),
                Write(ScienceViewProvider.LabTopic, backend.Lab(snapshot)));
            Assert.Equal(
                Write(ScienceViewProvider.ExperimentBreakdownTopic, ScienceViewProvider.BuildExperimentBreakdown(snapshot)),
                Write(ScienceViewProvider.ExperimentBreakdownTopic, backend.ExperimentBreakdown(snapshot)));
        }

        /// <summary>
        /// The same claim against a literal, so it cannot be satisfied by both
        /// sides drifting together: this is the exact <c>science.experiments</c>
        /// frame the wire carried before the capability existed, spelled out.
        /// A field order change, a renamed key, a dropped null, or a wrapped
        /// number would all show up here.
        /// </summary>
        [Fact]
        public void TheElectedExperimentsFrameIsTheLiteralPreElectionWire()
        {
            var backend = ElectedVanilla(new FakeScienceActuator());

            var json = Write(ScienceViewProvider.ExperimentsTopic, backend.Experiments(Snapshot()));

            Assert.Equal(
                "{\"type\":\"stream-data\",\"topic\":\"science.experiments\"," +
                "\"payload\":[{\"partName\":\"Mystery Goo Containment Pod\",\"location\":\"experiment\"," +
                "\"experimentId\":\"mysteryGoo\",\"subjectId\":\"mysteryGoo@KerbinSrfLandedLaunchPad\"," +
                "\"title\":\"Mystery Goo Observation\",\"dataAmount\":5,\"scienceValueRatio\":0.75," +
                "\"baseTransmitValue\":0.3,\"transmitBonus\":1,\"labValue\":1.25,\"deployed\":true," +
                "\"inoperable\":false,\"situation\":\"SrfLanded\"}]," +
                "\"meta\":{\"source\":\"vessel-1\",\"validAt\":55,\"seq\":3,\"deliveredAt\":55," +
                "\"vantage\":\"KSC\",\"quality\":0,\"active\":true,\"staleness\":0,\"timelineEpoch\":0}}",
                json);
        }

        /// <summary>
        /// The null contract survives the election, which is load-bearing rather
        /// than cosmetic: a channel whose mapper has never returned a non-null
        /// value is never "born" and emits NOTHING (see
        /// <c>ChannelEngine</c>'s <c>_born</c> doc comment). A backend that
        /// returned an empty list for "no lab onboard" would turn that silence
        /// into a stream of empty frames.
        /// </summary>
        [Fact]
        public void NothingToSayStaysNullThroughTheElection()
        {
            var backend = ElectedVanilla(new FakeScienceActuator());
            var noVessel = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(backend.Experiments(noVessel));
            Assert.Null(backend.Instruments(noVessel));
            Assert.Null(backend.Sensors(noVessel));
            Assert.Null(backend.Lab(noVessel));
            Assert.Null(backend.ExperimentBreakdown(noVessel));
            Assert.Null(backend.Experiments(null));
        }

        /// <summary>
        /// A sub-group KspHost could not build is absent, not empty, and stays
        /// absent through the election independently of its siblings: this
        /// snapshot carries experiments but no lab.
        /// </summary>
        [Fact]
        public void AnAbsentSubGroupIsNullWhileItsSiblingsStillPublish()
        {
            var backend = ElectedVanilla(new FakeScienceActuator());
            var snapshot = new KspSnapshot
            {
                Ut = 10.0,
                Values = new Dictionary<string, object?>
                {
                    ["science"] = new Dictionary<string, object?>
                    {
                        ["experiments"] = new List<object?>
                        {
                            new Dictionary<string, object?> { ["experimentId"] = "mysteryGoo" },
                        },
                    },
                },
            };

            Assert.NotNull(backend.Experiments(snapshot));
            Assert.Null(backend.Lab(snapshot));
            Assert.Null(backend.Sensors(snapshot));
        }

        /// <summary>
        /// The command half of the capability: the elected vanilla backend
        /// reaches the actuator with the typed partId, and its
        /// <see cref="ScienceCommandProvider"/> fail-fasts are intact behind the
        /// interface (an empty partId never reaches the actuator at all).
        /// </summary>
        [Fact]
        public void ElectedVanillaCommandsStillRunTheSameActuatorPath()
        {
            var actuator = new FakeScienceActuator();
            var backend = ElectedVanilla(actuator);

            Assert.True(backend.DeployExperiment(new ExperimentActionArgs { PartId = "12345" }).Success);
            Assert.Equal("12345", actuator.LastDeployPartId);

            Assert.True(backend.TransmitExperiment(new ExperimentActionArgs { PartId = "67890" }).Success);
            Assert.Equal("67890", actuator.LastTransmitPartId);

            var empty = new FakeScienceActuator();
            var strict = ElectedVanilla(empty);
            var refused = strict.DeployExperiment(new ExperimentActionArgs { PartId = "" });
            Assert.False(refused.Success);
            Assert.Equal(CommandErrorCode.NotFound, refused.ErrorCode);
            Assert.Null(empty.LastDeployPartId);
        }
    }
}
