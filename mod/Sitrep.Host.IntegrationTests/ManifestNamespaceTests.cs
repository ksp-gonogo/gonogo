using System;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A namespace listed in <see cref="UplinkManifest.Namespaces"/> is registered
    /// with the engine before the Uplink's <c>Register</c> runs, so how its topics
    /// are routed does not depend on game-bound code that may never finish.
    /// </summary>
    public class ManifestNamespaceTests
    {
        private const string Prefix = "manifest.cpu.";
        private const string Vessel = "craft-1";

        private static ChannelDeclaration Template() => new ChannelDeclaration
        {
            Kind = SampleKind.Event,
            Delivery = Delivery.LossyLatest,
            Delay = DelayRole.Delayed,
            PerVesselNode = true,
            VesselIdForKey = _ => Vessel,
        };

        private sealed class NamespaceUplink : ISitrepUplink
        {
            private readonly bool _registerThrows;

            public NamespaceUplink(bool registerThrows) => _registerThrows = registerThrows;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "manifest-ns",
                Version = "1.0.0",
                Namespaces = new[] { new NamespaceDeclaration { Prefix = Prefix, Template = Template() } },
            };

            public void Register(IUplinkHost host)
            {
                if (_registerThrows)
                {
                    throw new InvalidOperationException("needs a running game");
                }
                host.RegisterDynamicNamespace(Prefix, Template());
            }

            public UplinkHealth Health() => new UplinkHealth();
        }

        [Theory]
        [InlineData(false)]
        [InlineData(true)]
        public void ABareKeyUnderADeclaredNamespaceRoutesToItsVesselWhetherOrNotRegisterRuns(bool registerThrows)
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterUplink(new NamespaceUplink(registerThrows));
            engine.Start();

            Assert.Equal(ChannelEngine.FleetNodePrefix + Vessel, engine.NodeFor(Prefix + "7"));
            Assert.Equal(ChannelEngine.FleetNodePrefix + Vessel, engine.NodeFor(Prefix + "7.field"));
        }
    }
}
