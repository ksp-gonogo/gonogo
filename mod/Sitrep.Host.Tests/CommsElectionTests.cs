using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The comms backend election (comms-uplink-design.md §2) — the sharpest
    /// correctness risk the U2 brief flagged. Drives the REAL <see cref="Kernel"/>
    /// (byte-for-byte the TS reference port, golden-fixture-conformed) through
    /// the three cases: RA absent ⇒ CommNet vanilla; RA present ⇒ RA wins;
    /// and the elected instance is actually queryable as an
    /// <see cref="ICommsBackend"/>.
    /// </summary>
    public class CommsElectionTests
    {
        private sealed class FakeBackend : ICommsBackend
        {
            public FakeBackend(string id) => BackendId = id;
            public string BackendId { get; }
            public CommsConnectivity Connectivity() => new CommsConnectivity();
            public CommsSignalStrength SignalStrength() => new CommsSignalStrength();
            public CommsControlState ControlState() => new CommsControlState();
            public CommsPath Path() => new CommsPath();
            public CommsNetwork Network() => new CommsNetwork();
        }

        private static Kernel ResolvedKernel(bool raPresent)
        {
            var kernel = new Kernel();
            CommsElection.RegisterCapability(kernel, _ => new FakeBackend("commnet"));
            if (raPresent)
            {
                CommsElection.RegisterRealAntennasProvider(kernel, _ => new FakeBackend("realantennas"));
            }
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            return kernel;
        }

        // An uplink that OWNS the "comms" capability, declaring it in the
        // two-pass capability pass (IUplinkCapabilityDeclarer) rather than in
        // Register — the shape CommsCoreUplink now uses.
        private sealed class CapabilityOwningUplink : ISitrepUplink, IUplinkCapabilityDeclarer
        {
            // Mandatory health floor (test double).
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "comms", Version = "1.0.0" };
            public void DeclareCapabilities(Kernel kernel) =>
                CommsElection.RegisterCapability(kernel, _ => new FakeBackend("commnet"));
            public void Register(IUplinkHost host) { }
        }

        // A provider-only uplink (the RealAntennas shape): it registers a
        // "comms" PROVIDER in Register and declares no capability of its own.
        private sealed class ProviderOnlyUplink : ISitrepUplink
        {
            // Mandatory health floor (test double).
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "realantennas", Version = "1.0.0" };
            public void Register(IUplinkHost host) =>
                host.Kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = CommsElection.CapabilityId,
                    Id = CommsElection.RealAntennasProviderId,
                    Priority = CommsElection.RealAntennasPriority,
                    Factory = _ => new FakeBackend("realantennas"),
                });
        }

        /// <summary>
        /// The adversarial ordering the happy-path tests above miss: the
        /// PROVIDER uplink is discovered BEFORE the capability-owning uplink.
        /// Single-pass registration would run the provider's Register (its
        /// Kernel.RegisterProvider) before the "comms" capability existed —
        /// RegisterProvider would throw, RA would be dropped, and CommNet would
        /// wrongly win even though RA is present. The two-pass
        /// RegisterDiscoveredUplinks declares every capability first, so RA still
        /// wins regardless of discovery order.
        /// </summary>
        [Fact]
        public void ProviderDiscoveredBeforeCapability_RaStillWins()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0");

            // Adverse order: RA provider FIRST, capability owner SECOND.
            engine.RegisterDiscoveredUplinks(new List<UplinkDiscovery.DiscoveredUplink>
            {
                new UplinkDiscovery.DiscoveredUplink(new ProviderOnlyUplink(), ContractVersion.Major, ContractVersion.Minor),
                new UplinkDiscovery.DiscoveredUplink(new CapabilityOwningUplink(), ContractVersion.Major, ContractVersion.Minor),
            });
            engine.Start();

            engine.ResolveCapabilities();

            Assert.True(engine.AvailabilityOf("realantennas").IsAvailable);
            var elected = CommsElection.Elected(engine.Kernel);
            Assert.NotNull(elected);
            Assert.Equal("realantennas", elected!.BackendId);
        }

        [Fact]
        public void RaAbsent_CommNetVanillaWins()
        {
            var kernel = ResolvedKernel(raPresent: false);

            var elected = CommsElection.Elected(kernel);

            Assert.NotNull(elected);
            Assert.Equal("commnet", elected!.BackendId);
        }

        [Fact]
        public void RaPresent_RealAntennasWins()
        {
            var kernel = ResolvedKernel(raPresent: true);

            var elected = CommsElection.Elected(kernel);

            Assert.NotNull(elected);
            Assert.Equal("realantennas", elected!.BackendId);
        }

        [Fact]
        public void RaAbsent_ResolutionRecordsVanillaFallbackNotice()
        {
            var kernel = new Kernel();
            CommsElection.RegisterCapability(kernel, _ => new FakeBackend("commnet"));

            var result = kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });

            Assert.Contains(result.Notices, n =>
                n.Capability == CommsElection.CapabilityId && n.Kind == "vanilla-fallback");
        }

        [Fact]
        public void ExactlyOneBackendIsElected()
        {
            var kernel = ResolvedKernel(raPresent: true);

            // Query throws unless the exclusive capability resolves to exactly
            // one active instance — the "at most one backend" invariant.
            var active = kernel.Active(CommsElection.CapabilityId);
            Assert.Single(active);
        }

        [Fact]
        public void ElectedBackend_ExposesTheSharedReadouts()
        {
            var kernel = ResolvedKernel(raPresent: false);
            var backend = CommsElection.Elected(kernel)!;

            // The minimal ICommsBackend shape both backends honour (§6): the
            // shared core comms registration reads exactly these.
            Assert.NotNull(backend.Connectivity());
            Assert.NotNull(backend.SignalStrength());
            Assert.NotNull(backend.ControlState());
            Assert.NotNull(backend.Path());
            Assert.NotNull(backend.Network());
        }
    }
}
