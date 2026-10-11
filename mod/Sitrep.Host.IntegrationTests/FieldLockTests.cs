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
    /// A payload field a <see cref="SitrepRequiresAttribute"/> gates arrives as
    /// the <see cref="LockedValue"/> naming what the save is missing while its
    /// requirement fails, and as its own value once it passes. The rest of the
    /// channel is untouched either way: <c>vessel.orbit</c>'s elements stay
    /// readable while its <c>encounter</c> is locked.
    /// </summary>
    public class FieldLockTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        [Fact]
        public async Task ALockedFieldNamesTheUnlockItIsMissing()
        {
            var payload = await SampleOrbit(new OrbitProbeUplink { PatchedConics = false });

            Assert.Equal(700000.0, payload["sma"]);
            var encounter = Assert.IsType<Dictionary<string, object?>>(payload["encounter"]);
            var missing = Assert.Single(Assert.IsType<List<object?>>(encounter["locked"]).Cast<Dictionary<string, object?>>());
            Assert.Equal((double)(int)UnlockKind.Facility, missing["kind"]);
            Assert.Equal("TrackingStation", missing["id"]);
            Assert.Equal(2.0, missing["tier"]);
        }

        [Fact]
        public async Task AnUnlockedFieldArrivesAsItsOwnValue()
        {
            var payload = await SampleOrbit(new OrbitProbeUplink { PatchedConics = true });

            Assert.Null(payload["encounter"]);
        }

        private static async Task<Dictionary<string, object?>> SampleOrbit(OrbitProbeUplink uplink)
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", executeCommandsOnMainThread: true);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, OrbitProbeUplink.Topic, Timeout);

                engine.SampleCommandGates();
                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);

                var delivered = await ReceiveStreamDataAsync(client, Timeout);
                return Assert.IsType<Dictionary<string, object?>>(delivered.Payload);
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class OrbitProbeUplink : ISitrepUplink
        {
            public const string Topic = "vessel.orbit";

            public bool PatchedConics { get; set; }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest => new UplinkManifest
            {
                Id = "orbit-probe",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Delay = DelayRole.TrueNow,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                        Requires = Requirement.None,
                    },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddGateEvaluator(new OrbitDisplayProbe(this));
                host.AddChannelSource(Topic, _ => new Dictionary<string, object?>
                {
                    ["sma"] = 700000.0,
                    ["encounter"] = null,
                });
            }

            private sealed class OrbitDisplayProbe : ICommandGateEvaluator
            {
                private readonly OrbitProbeUplink _owner;

                public OrbitDisplayProbe(OrbitProbeUplink owner) => _owner = owner;

                public string Kind => "orbit-display";

                public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments) =>
                    _owner.PatchedConics
                        ? GateVerdict.Pass()
                        : GateVerdict.NotUnlocked(
                            "the Tracking Station does not show this yet",
                            new MissingUnlock
                            {
                                Kind = UnlockKind.Facility,
                                Id = "TrackingStation",
                                Name = "Tracking Station",
                                Tier = 2,
                            });
            }
        }
    }
}
