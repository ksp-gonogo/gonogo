using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Science;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The science-backend election, driven through the REAL <see cref="Kernel"/>:
    /// the same three cases <see cref="CommsElectionTests"/> covers for comms,
    /// because science is now the same kind of capability. Provider absent ⇒
    /// stock vanilla; provider present ⇒ provider wins; and the elected instance
    /// is genuinely queryable as an <see cref="IScienceBackend"/>.
    ///
    /// <para>The fourth case is the one that only a two-pass registration gets
    /// right: a provider uplink discovered BEFORE the capability owner. That is
    /// the registration-order hazard <see cref="IUplinkCapabilityDeclarer"/>
    /// exists to close, and it is the failure a stock-only dev box would never
    /// see.</para>
    /// </summary>
    public class ScienceElectionTests
    {
        /// <summary>A provider standing in for a science-modelling mod (Kerbalism in production).</summary>
        private sealed class FakeBackend : IScienceBackend
        {
            public FakeBackend(string id) => BackendId = id;
            public string BackendId { get; }
            public object? Experiments(KspSnapshot? snapshot) => new List<object?>();
            public object? Instruments(KspSnapshot? snapshot) => null;
            public object? Sensors(KspSnapshot? snapshot) => null;
            public object? Lab(KspSnapshot? snapshot) => null;
            public object? ExperimentBreakdown(KspSnapshot? snapshot) => null;
            public CommandResult DeployExperiment(ExperimentActionArgs args) => CommandResult.Ok();
            public CommandResult TransmitExperiment(ExperimentActionArgs args) => CommandResult.Ok();
        }

        private const double ProviderPriority = 1.0;

        private static Kernel ResolvedKernel(bool providerPresent)
        {
            var kernel = new Kernel();
            ScienceElection.RegisterCapability(kernel, new FakeScienceActuator());
            if (providerPresent)
            {
                kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = ScienceElection.CapabilityId,
                    Id = "fake-science-mod",
                    Priority = ProviderPriority,
                    Factory = _ => new FakeBackend("fake-science-mod"),
                });
            }
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            return kernel;
        }

        // An uplink that OWNS the "science" capability, declaring it in the
        // two-pass capability pass rather than in Register: the shape
        // Gonogo.KSP.ScienceCoreUplink uses.
        private sealed class CapabilityOwningUplink : ISitrepUplink, IUplinkCapabilityDeclarer
        {
            // Mandatory health floor (test double).
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "science", Version = "1.0.0" };
            public void DeclareCapabilities(Kernel kernel) =>
                ScienceElection.RegisterCapability(kernel, new FakeScienceActuator());
            public void Register(IUplinkHost host) { }
        }

        // A provider-only uplink (the Kerbalism shape): registers a "science"
        // PROVIDER in Register and declares no capability of its own.
        private sealed class ProviderOnlyUplink : ISitrepUplink
        {
            // Mandatory health floor (test double).
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "fake-science-mod", Version = "1.0.0" };
            public void Register(IUplinkHost host) =>
                host.Kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = ScienceElection.CapabilityId,
                    Id = "fake-science-mod",
                    Priority = ProviderPriority,
                    Factory = _ => new FakeBackend("fake-science-mod"),
                });
        }

        [Fact]
        public void ProviderAbsent_StockVanillaWins()
        {
            var elected = ScienceElection.Elected(ResolvedKernel(providerPresent: false));

            Assert.NotNull(elected);
            Assert.Equal("stock", elected!.BackendId);
            Assert.IsType<StockScienceBackend>(elected);
        }

        [Fact]
        public void ProviderPresent_ProviderWins()
        {
            var elected = ScienceElection.Elected(ResolvedKernel(providerPresent: true));

            Assert.NotNull(elected);
            Assert.Equal("fake-science-mod", elected!.BackendId);
        }

        /// <summary>
        /// The adversarial ordering: the PROVIDER uplink is discovered BEFORE the
        /// capability-owning uplink. Single-pass registration would run the
        /// provider's Register (its Kernel.RegisterProvider) while the "science"
        /// capability did not yet exist, the registration would throw, the
        /// provider would be dropped, and stock would wrongly win with the mod
        /// installed. The two-pass RegisterDiscoveredUplinks declares every
        /// capability first.
        /// </summary>
        [Fact]
        public void ProviderDiscoveredBeforeCapability_ProviderStillWins()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0");

            engine.RegisterDiscoveredUplinks(new List<UplinkDiscovery.DiscoveredUplink>
            {
                new UplinkDiscovery.DiscoveredUplink(new ProviderOnlyUplink(), ContractVersion.Major, ContractVersion.Minor),
                new UplinkDiscovery.DiscoveredUplink(new CapabilityOwningUplink(), ContractVersion.Major, ContractVersion.Minor),
            });
            engine.Start();

            engine.ResolveCapabilities();

            var elected = ScienceElection.Elected(engine.Kernel);
            Assert.NotNull(elected);
            Assert.Equal("fake-science-mod", elected!.BackendId);
        }

        /// <summary>
        /// Science is not SpineCritical: an unresolved/unregistered capability is
        /// a null, never a throw, so the registrar can fall back to stock rather
        /// than take the uplink down.
        /// </summary>
        [Fact]
        public void UnregisteredCapabilityResolvesToNullRatherThanThrowing()
        {
            var kernel = new Kernel();
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });

            Assert.Null(ScienceElection.Elected(kernel));
        }
    }
}
