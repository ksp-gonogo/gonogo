using System;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// An Uplink the host constructs itself reaches the kernel through
    /// <see cref="ChannelEngine.RegisterBundledUplink"/>, which declares its
    /// capabilities the way the discovery pass does for the rest.
    /// </summary>
    public class BundledUplinkCapabilityTests
    {
        private const string CapabilityId = "plantedBundled";

        [Fact]
        public void ABundledUplinksCapabilityResolvesThroughTheKernel()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var uplink = new Planted(declareThrows: false);

            engine.RegisterBundledUplink(uplink);
            engine.ResolveCapabilities();

            Assert.Equal(1, uplink.Declared);
            Assert.Equal(1, uplink.Registered);
            Assert.Same(uplink.Provider, engine.Kernel.Query<Provider>(CapabilityId));
        }

        [Fact]
        public void ABundledUplinkWhoseDeclarationThrowsIsUnavailableAndNeverRegisters()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var uplink = new Planted(declareThrows: true);

            engine.RegisterBundledUplink(uplink);

            Assert.Equal(0, uplink.Registered);
            Assert.False(engine.IsUplinkRunning(uplink.Manifest.Id));
        }

        [Fact]
        public void RegisteringDirectlyDeclaresNothing()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var uplink = new Planted(declareThrows: false);

            engine.RegisterUplink(uplink);

            Assert.Equal(0, uplink.Declared);
            Assert.Throws<InvalidOperationException>(() => engine.Kernel.Query<Provider>(CapabilityId));
        }

        private sealed class Provider : ISitrepProvider
        {
            public string ProviderId => "planted-bundled";
        }

        private sealed class Planted : ISitrepUplink, IUplinkCapabilityDeclarer
        {
            private readonly bool _declareThrows;

            public Planted(bool declareThrows)
            {
                _declareThrows = declareThrows;
            }

            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "planted.bundled", Version = "1.0.0" };

            public Provider Provider { get; } = new Provider();

            public int Declared { get; private set; }

            public int Registered { get; private set; }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void DeclareCapabilities(Kernel kernel)
            {
                Declared++;
                if (_declareThrows)
                {
                    throw new InvalidOperationException("planted");
                }
                kernel.RegisterCapability(new CapabilityDescriptor
                {
                    Id = CapabilityId,
                    Exclusive = true,
                    Vanilla = _ => Provider,
                });
            }

            public void Register(IUplinkHost host)
            {
                Registered++;
            }
        }
    }
}
