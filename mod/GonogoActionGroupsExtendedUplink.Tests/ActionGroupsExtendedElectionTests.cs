using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.ActionGroups;
using Xunit;

namespace Gonogo.ActionGroupsExtendedUplink.Tests
{
    /// <summary>
    /// The actionGroups backend election, modelled directly on
    /// <c>Sitrep.Host.Tests.CommsElectionTests</c>
    /// (docs/superpowers/specs/2026-07-17-agx-backend-design.md §5.4/§9 Task
    /// 3): drives the REAL <see cref="Kernel"/> through a two-pass uplink
    /// discovery — a capability-owning uplink (the vessel uplink's shape)
    /// registering the stock <c>Vanilla</c> factory, and a provider-only
    /// uplink (the AGX uplink's shape, exactly
    /// <see cref="ActionGroupsExtendedUplink"/>) registering its provider
    /// behind a fake <see cref="IAgxApi"/> probe — through the three cases:
    /// AGX absent ⇒ stock vanilla; AGX present ⇒ AGX wins; and the elected
    /// instance is actually queryable as an <see cref="IActionGroupsBackend"/>.
    /// </summary>
    public class ActionGroupsExtendedElectionTests
    {
        private sealed class FakeActionGroupsBackend : IActionGroupsBackend
        {
            public FakeActionGroupsBackend(string id) => Id = id;
            public string Id { get; }
            public IList<ActionGroupState>? Groups() => new List<ActionGroupState>();
            public bool SetGroup(int index, bool state) => true;
        }

        private sealed class FakeAgxApi : IAgxApi
        {
            public FakeAgxApi(bool isAvailable) => IsAvailable = isAvailable;
            public bool IsAvailable { get; }
            public IReadOnlyList<AgxGroup>? AssignedGroups() => null;
            public bool Activate(int index, bool on) => false;
        }

        // An uplink that OWNS the "actionGroups" capability, declaring it in
        // the two-pass capability pass (IUplinkCapabilityDeclarer) — the
        // shape VesselUplink uses.
        private sealed class CapabilityOwningUplink : ISitrepUplink, IUplinkCapabilityDeclarer
        {
            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "vessel", Version = "1.0.0" };
            public void DeclareCapabilities(Kernel kernel) =>
                ActionGroupsElection.RegisterCapability(kernel, _ => new FakeActionGroupsBackend("stock"));
            public void Register(IUplinkHost host) { }
        }

        // A provider-only uplink exercising the SAME Register-time gate
        // ActionGroupsExtendedUplink uses: probe, then register a provider
        // only when available.
        private sealed class ProviderOnlyUplink : ISitrepUplink
        {
            private readonly IAgxApi _agx;
            public ProviderOnlyUplink(IAgxApi agx) => _agx = agx;
            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "actionGroupsExtended", Version = "1.0.0" };

            public void Register(IUplinkHost host)
            {
                if (!_agx.IsAvailable)
                {
                    host.SetAvailability(Availability.Unavailable("Action Groups Extended assembly not loaded"));
                    return;
                }
                ActionGroupsElection.RegisterActionGroupsExtendedProvider(
                    host.Kernel, _ => new AgxActionGroupsBackend(_agx));
            }
        }

        private static Kernel ResolvedKernel(bool agxPresent)
        {
            var kernel = new Kernel();
            ActionGroupsElection.RegisterCapability(kernel, _ => new FakeActionGroupsBackend("stock"));
            if (agxPresent)
            {
                ActionGroupsElection.RegisterActionGroupsExtendedProvider(
                    kernel, _ => new AgxActionGroupsBackend(new FakeAgxApi(isAvailable: true)));
            }
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            return kernel;
        }

        [Fact]
        public void AgxAbsent_StockVanillaWins()
        {
            var kernel = ResolvedKernel(agxPresent: false);

            var elected = ActionGroupsElection.Elected(kernel);

            Assert.NotNull(elected);
            Assert.IsType<FakeActionGroupsBackend>(elected);
            Assert.Equal("stock", ((FakeActionGroupsBackend)elected!).Id);
        }

        [Fact]
        public void AgxPresent_AgxWins()
        {
            var kernel = ResolvedKernel(agxPresent: true);

            var elected = ActionGroupsElection.Elected(kernel);

            Assert.NotNull(elected);
            Assert.IsType<AgxActionGroupsBackend>(elected);
        }

        [Fact]
        public void ExactlyOneBackendIsElected()
        {
            var kernel = ResolvedKernel(agxPresent: true);

            var active = kernel.Active(ActionGroupsElection.CapabilityId);
            Assert.Single(active);
        }

        /// <summary>
        /// The adversarial ordering the happy-path tests above miss: the
        /// AGX provider uplink is discovered BEFORE the capability-owning
        /// (vessel) uplink. The two-pass RegisterDiscoveredUplinks declares
        /// every capability first, so AGX still wins regardless of discovery
        /// order — same regression guard as
        /// CommsElectionTests.ProviderDiscoveredBeforeCapability_RaStillWins.
        /// </summary>
        [Fact]
        public void ProviderDiscoveredBeforeCapability_AgxStillWins()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0");

            engine.RegisterDiscoveredUplinks(new List<UplinkDiscovery.DiscoveredUplink>
            {
                new UplinkDiscovery.DiscoveredUplink(
                    new ProviderOnlyUplink(new FakeAgxApi(isAvailable: true)),
                    ContractVersion.Major, ContractVersion.Minor),
                new UplinkDiscovery.DiscoveredUplink(
                    new CapabilityOwningUplink(),
                    ContractVersion.Major, ContractVersion.Minor),
            });
            engine.Start();

            engine.ResolveCapabilities();

            Assert.True(engine.AvailabilityOf("actionGroupsExtended").IsAvailable);
            var elected = ActionGroupsElection.Elected(engine.Kernel);
            Assert.NotNull(elected);
            Assert.IsType<AgxActionGroupsBackend>(elected);
        }

        /// <summary>
        /// When AGX's probe reports unavailable, the uplink calls
        /// SetAvailability(Unavailable) and registers no provider — stock
        /// stays elected, and the uplink's own availability reflects the
        /// absence (mirroring RealAntennasUplink's inert path).
        /// </summary>
        [Fact]
        public void ProbeUnavailable_UplinkGoesInert_StockStillWins()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0");

            engine.RegisterDiscoveredUplinks(new List<UplinkDiscovery.DiscoveredUplink>
            {
                new UplinkDiscovery.DiscoveredUplink(
                    new CapabilityOwningUplink(),
                    ContractVersion.Major, ContractVersion.Minor),
                new UplinkDiscovery.DiscoveredUplink(
                    new ProviderOnlyUplink(new FakeAgxApi(isAvailable: false)),
                    ContractVersion.Major, ContractVersion.Minor),
            });
            engine.Start();

            engine.ResolveCapabilities();

            Assert.False(engine.AvailabilityOf("actionGroupsExtended").IsAvailable);
            var elected = ActionGroupsElection.Elected(engine.Kernel);
            Assert.NotNull(elected);
            Assert.IsType<FakeActionGroupsBackend>(elected);
        }

        [Fact]
        public void ElectedBackend_ExposesTheSharedReadouts()
        {
            var kernel = ResolvedKernel(agxPresent: false);
            var backend = ActionGroupsElection.Elected(kernel)!;

            Assert.NotNull(backend.Groups());
            Assert.True(backend.SetGroup(1, true));
        }

        [Fact]
        public void Uplink_DeclaresNoChannelsOrCommands()
        {
            var uplink = new ActionGroupsExtendedUplink();

            Assert.Empty(uplink.Manifest.Channels);
            Assert.Empty(uplink.Manifest.Commands);
        }
    }
}
