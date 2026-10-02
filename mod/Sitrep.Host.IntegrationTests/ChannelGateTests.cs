using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A channel that declares what the save must have unlocked is sampled
    /// beside the gated commands and published in the channel half of
    /// <c>system.uplink.gates</c>, with the refusal naming the missing unlock,
    /// so a client can say "Missing tech: Flight Control" instead of drawing
    /// an empty value.
    /// </summary>
    public class ChannelGateTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        [Fact]
        public async Task ALockedChannelIsPublishedWithTheUnlockItIsMissing()
        {
            var channels = await SampleChannels(new ChannelGateProbeUplink());

            var entry = Assert.Single(channels, c => (string?)c["topic"] == ChannelGateProbeUplink.LockedTopic);
            var verdict = Assert.IsType<Dictionary<string, object?>>(entry["verdict"]);
            Assert.Equal((double)(int)GateOutcome.Fail, verdict["outcome"]);
            Assert.Equal("notUnlocked", verdict["errorCode"]);

            var missing = Assert.Single(Assert.IsType<List<object?>>(verdict["missing"]).Cast<Dictionary<string, object?>>());
            Assert.Equal((double)(int)UnlockKind.Tech, missing["kind"]);
            Assert.Equal("flightControl", missing["id"]);
            Assert.Equal("Flight Control", missing["name"]);
            Assert.Equal(45.0, missing["scienceCost"]);
            Assert.False(missing.ContainsKey("tier"));
        }

        /// <summary>
        /// A channel stating <see cref="Requirement.None"/>, and one an older
        /// Uplink declared with no Requires at all, have nothing to publish:
        /// absence from the channel half is what "nothing gates this" looks like.
        /// </summary>
        [Fact]
        public async Task AnUngatedChannelHasNoEntry()
        {
            var channels = await SampleChannels(new ChannelGateProbeUplink());

            Assert.DoesNotContain(channels, c => (string?)c["topic"] == ChannelGateProbeUplink.UngatedTopic);
            Assert.DoesNotContain(channels, c => (string?)c["topic"] == ChannelGateProbeUplink.UnstatedTopic);
        }

        [Fact]
        public void AChannelRequirementThatNeedsArgumentsIsRefusedAtStartup()
        {
            // Not disposed: Start refuses before it starts a thread, and Stop joins threads that never ran.
            var engine = new ChannelEngine("ws://127.0.0.1:0", executeCommandsOnMainThread: true);
            engine.RegisterUplink(new ChannelGateProbeUplink { NeedsAnArgument = true });
            var thrown = Assert.Throws<InvalidOperationException>(() => engine.Start());
            Assert.Contains("which a channel never has", thrown.Message);
        }

        private static async Task<List<Dictionary<string, object?>>> SampleChannels(ChannelGateProbeUplink uplink)
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", executeCommandsOnMainThread: true);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkGatesTopic, Timeout);

                engine.SampleCommandGates();
                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);

                var delivered = await ReceiveStreamDataAsync(client, Timeout);
                var payload = Assert.IsType<Dictionary<string, object?>>(delivered.Payload);
                return Assert.IsType<List<object?>>(payload["channels"]).Cast<Dictionary<string, object?>>().ToList();
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class ChannelGateProbeUplink : ISitrepUplink
        {
            public const string LockedTopic = "probe.locked";
            public const string UngatedTopic = "probe.ungated";
            public const string UnstatedTopic = "probe.unstated";
            public const string TechKind = "probe-tech";

            public bool NeedsAnArgument { get; set; }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest => new UplinkManifest
            {
                Id = "channel-gate-probe",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    Declare(LockedTopic, new[]
                    {
                        new CommandRequirement
                        {
                            Kind = TechKind,
                            Needs = NeedsAnArgument ? new[] { "partId" } : new string[0],
                        },
                    }),
                    Declare(UngatedTopic, Requirement.None),
                    Declare(UnstatedTopic, null),
                },
            };

            private static ChannelDeclaration Declare(string topic, CommandRequirement[]? requires) => new ChannelDeclaration
            {
                Topic = topic,
                Delivery = Delivery.LossyLatest,
                Delay = DelayRole.TrueNow,
                Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                Requires = requires,
            };

            public void Register(IUplinkHost host)
            {
                host.AddGateEvaluator(new TechGate());
                host.AddChannelSource(LockedTopic, _ => null);
                host.AddChannelSource(UngatedTopic, _ => null);
                host.AddChannelSource(UnstatedTopic, _ => null);
            }

            private sealed class TechGate : ICommandGateEvaluator
            {
                public string Kind => TechKind;

                public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments) =>
                    GateVerdict.NotUnlocked(
                        "Flight Control has not been researched",
                        new MissingUnlock
                        {
                            Kind = UnlockKind.Tech,
                            Id = "flightControl",
                            Name = "Flight Control",
                            ScienceCost = 45,
                        });
            }
        }
    }
}
