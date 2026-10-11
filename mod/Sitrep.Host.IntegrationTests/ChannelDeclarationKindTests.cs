using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A channel whose kind is not one the contract defines says nothing a reader
    /// can act on, so the Uplink declaring it is refused rather than served with
    /// a guess.
    /// </summary>
    public class ChannelDeclarationKindTests
    {
        [Fact]
        public void AnUndefinedKindRefusesTheUplink()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var uplink = new KindTestUplink((SampleKind)42, dynamicKind: SampleKind.Continuous);
            engine.RegisterUplink(uplink);

            var availability = engine.AvailabilityOf(uplink.Manifest.Id);
            Assert.False(availability.IsAvailable);
            Assert.Contains(KindTestUplink.StaticTopic, availability.Reason!);
        }

        [Fact]
        public void AnUndefinedKindOnANamespaceRefusesTheUplink()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var uplink = new KindTestUplink(SampleKind.Discrete, dynamicKind: (SampleKind)42);
            engine.RegisterUplink(uplink);

            var availability = engine.AvailabilityOf(uplink.Manifest.Id);
            Assert.False(availability.IsAvailable);
            Assert.Contains(KindTestUplink.Prefix, availability.Reason!);
        }

        [Fact]
        public void EveryDefinedKindIsAccepted()
        {
            foreach (SampleKind kind in Enum.GetValues(typeof(SampleKind)))
            {
                var engine = new ChannelEngine("ws://127.0.0.1:0");
                var uplink = new KindTestUplink(kind, dynamicKind: kind);
                engine.RegisterUplink(uplink);
                Assert.True(engine.AvailabilityOf(uplink.Manifest.Id).IsAvailable, kind.ToString());
            }
        }

        private sealed class KindTestUplink : ISitrepUplink
        {
            public const string StaticTopic = "kindtest.static";
            public const string Prefix = "kindtest.dynamic.";

            private readonly SampleKind _dynamicKind;

            public KindTestUplink(SampleKind kind, SampleKind dynamicKind)
            {
                _dynamicKind = dynamicKind;
                Manifest = new UplinkManifest
                {
                    Id = "kind-test",
                    Version = "1.0.0",
                    Channels = new List<ChannelDeclaration>
                    {
                        new ChannelDeclaration
                        {
                            Kind = kind,
                            Requires = Requirement.None,
                            Topic = StaticTopic,
                            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                        },
                    },
                };
            }

            public UplinkManifest Manifest { get; }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
                host.RegisterDynamicNamespace(Prefix, new ChannelDeclaration
                {
                    Kind = _dynamicKind,
                    Requires = Requirement.None,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                });
            }
        }
    }
}
