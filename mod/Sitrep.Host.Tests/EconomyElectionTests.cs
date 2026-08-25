using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Economy;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The economy-backend election, driven through the REAL <see cref="Kernel"/>,
    /// and the wire shape either answer produces.
    ///
    /// <para>The case that matters most here is the one an election usually does
    /// not have: what the VANILLA says. Stock is not a fallback that shrugs, it
    /// is a model with a real answer, and the answer is that career money does
    /// not decay, is not subsidised and costs nothing to hold. These tests pin
    /// that answer, and pin the one thing stock does NOT claim, a per-source
    /// breakdown it has no concept of.</para>
    ///
    /// <para>Unlike the ISRU and action-group elections beside it, the vanilla
    /// factory is not passed in and no fake stands in for it: stock's answer
    /// about money needs no game, so the real <see cref="StockEconomyBackend"/>
    /// runs here.</para>
    /// </summary>
    public class EconomyElectionTests
    {
        private const double ProviderPriority = 10.0;

        /// <summary>An overhaul's backend, standing in for whichever mod is installed.</summary>
        private sealed class FakeOverhaulBackend : IEconomyBackend
        {
            public string ProviderId => "fake-overhaul";

            public EconomyReading? Interpret(double ut, double? reputation) => new EconomyReading
            {
                ReputationDecayPerDay = reputation * 0.01,
                SubsidyPerDay = 500.0,
                SubsidyMinPerDay = 100.0,
                SubsidyMaxPerDay = 900.0,
                UpkeepPerDay = 750.0,
                UpkeepBreakdown = new EconomyUpkeepBreakdown { Facilities = 750.0 },
            };
        }

        private sealed class CapabilityOwningUplink : ISitrepUplink, IUplinkCapabilityDeclarer
        {
            public UplinkHealth Health() => UplinkHealth.Healthy;
            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "career", Version = "1.0.0" };
            public void DeclareCapabilities(Kernel kernel) => EconomyElection.RegisterCapability(kernel);
            public void Register(IUplinkHost host) { }
        }

        private sealed class ProviderOnlyUplink : ISitrepUplink
        {
            public UplinkHealth Health() => UplinkHealth.Healthy;
            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "fake-overhaul", Version = "1.0.0" };
            public void Register(IUplinkHost host) =>
                host.Kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = EconomyElection.CapabilityId,
                    Id = "fake-overhaul",
                    Priority = ProviderPriority,
                    Factory = _ => new FakeOverhaulBackend(),
                });
        }

        private static Kernel ResolvedKernel(bool providerPresent)
        {
            var kernel = new Kernel();
            EconomyElection.RegisterCapability(kernel);
            if (providerPresent)
            {
                kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = EconomyElection.CapabilityId,
                    Id = "fake-overhaul",
                    Priority = ProviderPriority,
                    Factory = _ => new FakeOverhaulBackend(),
                });
            }
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            return kernel;
        }

        [Fact]
        public void ProviderAbsent_StockVanillaWins()
        {
            var elected = EconomyElection.Elected(ResolvedKernel(providerPresent: false));

            Assert.NotNull(elected);
            Assert.Equal("stock", elected!.ProviderId);
        }

        [Fact]
        public void ProviderPresent_ProviderWins()
        {
            var elected = EconomyElection.Elected(ResolvedKernel(providerPresent: true));

            Assert.NotNull(elected);
            Assert.Equal("fake-overhaul", elected!.ProviderId);
        }

        /// <summary>
        /// The adversarial ordering a two-pass registration exists for: the
        /// provider uplink is discovered BEFORE the capability owner. On a
        /// stock-only box the ordering never bites, and with an overhaul
        /// installed it would silently hand the interpretation back to stock,
        /// which reads as "your career costs nothing" on a save that is draining.
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

            var elected = EconomyElection.Elected(engine.Kernel);
            Assert.NotNull(elected);
            Assert.Equal("fake-overhaul", elected!.ProviderId);
        }

        /// <summary>
        /// Not SpineCritical: an unregistered capability is a null rather than a
        /// throw, and the career group then publishes reputation bare, which is
        /// exactly what it did before the capability existed.
        /// </summary>
        [Fact]
        public void UnregisteredCapabilityResolvesToNullRatherThanThrowing()
        {
            var kernel = new Kernel();
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });

            Assert.Null(EconomyElection.Elected(kernel));
        }

        [Fact]
        public void StockSaysMoneyDoesNotDecayIsNotSubsidisedAndCostsNothingToHold()
        {
            var reading = new StockEconomyBackend().Interpret(ut: 1_000_000.0, reputation: 250.0);

            Assert.NotNull(reading);
            Assert.Equal(0.0, reading!.ReputationDecayPerDay);
            Assert.Equal(0.0, reading.SubsidyPerDay);
            Assert.Equal(0.0, reading.SubsidyMinPerDay);
            Assert.Equal(0.0, reading.SubsidyMaxPerDay);
            Assert.Equal(0.0, reading.UpkeepPerDay);
        }

        /// <summary>
        /// Stock's zeros are a statement and its ABSENT breakdown is the other
        /// half of the same statement: seven zeros would claim stock levies seven
        /// kinds of nothing, where the truth is that it has none of the concepts.
        /// </summary>
        [Fact]
        public void StockClaimsNoPerSourceBreakdownRatherThanSevenZeros()
        {
            Assert.Null(new StockEconomyBackend().Interpret(ut: 0.0, reputation: 0.0)!.UpkeepBreakdown);
        }

        /// <summary>
        /// Stock does not need a reputation to answer, because none of its
        /// answers depend on one.
        /// </summary>
        [Fact]
        public void StockAnswersEvenWhenTheReputationCouldNotBeRead()
        {
            var reading = new StockEconomyBackend().Interpret(ut: 0.0, reputation: null);

            Assert.NotNull(reading);
            Assert.Equal(0.0, reading!.UpkeepPerDay);
        }
    }
}
