using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.ActionGroupsExtendedUplink.Tests
{
    /// <summary>
    /// The actionGroups backend election from the PROVIDER's side: AGX absent ⇒
    /// stock vanilla; AGX present ⇒ AGX wins; the elected instance is queryable as
    /// an <see cref="IActionGroupsBackend"/>; and the inert path leaves stock in
    /// place and says so.
    ///
    /// <para>Everything here is driven through <see cref="Kernel"/> and
    /// <see cref="RecordingUplinkHost"/>, both reached through
    /// <c>Sitrep.Contract</c> alone, because that is the whole of what this
    /// Uplink's author can install. The cases that needed core's
    /// <c>ChannelEngine</c> and its two-pass discovery were about CORE's ordering
    /// guarantee rather than about AGX, and they were already driving a
    /// hand-written double of this uplink rather than the uplink: they live in
    /// <c>Sitrep.Host.Tests.ActionGroupsElectionTests</c> now, where the engine may
    /// be named. What is left is driven by the REAL
    /// <see cref="ActionGroupsExtendedUplink.Register"/>.</para>
    /// </summary>
    public class ActionGroupsExtendedElectionTests
    {
        private sealed class FakeActionGroupsBackend : IActionGroupsBackend
        {
            public FakeActionGroupsBackend(string id) => ProviderId = id;
            public string ProviderId { get; }
            public IList<ActionGroupState>? Groups() => new List<ActionGroupState>();
            public bool SetGroup(int index, bool state) => true;
        }

        private sealed class FakeAgxApi : IAgxApi
        {
            public FakeAgxApi(bool isAvailable) => IsAvailable = isAvailable;
            public bool IsAvailable { get; }
            public IReadOnlyList<AgxGroup>? AssignedGroups() => new List<AgxGroup>();
            public bool Activate(int index, bool on) => false;
        }

        /// <summary>
        /// A host with the capability declared and the REAL uplink registered into
        /// it against an AGX that is either there or not, resolved.
        /// </summary>
        private static RecordingUplinkHost Registered(bool agxPresent)
        {
            var host = new RecordingUplinkHost(_ => new FakeActionGroupsBackend("stock"));
            new ActionGroupsExtendedUplink(new FakeAgxApi(agxPresent)).Register(host);
            host.Resolve();
            return host;
        }

        [Fact]
        public void AgxAbsent_StockVanillaWins()
        {
            var elected = Registered(agxPresent: false).ElectedBackend();

            Assert.NotNull(elected);
            Assert.Equal("stock", elected!.ProviderId);
        }

        [Fact]
        public void AgxPresent_AgxWins()
        {
            var elected = Registered(agxPresent: true).ElectedBackend();

            Assert.NotNull(elected);
            Assert.IsType<AgxActionGroupsBackend>(elected);
            Assert.Equal(ActionGroupsExtendedUplink.ProviderId, elected!.ProviderId);
        }

        /// <summary>
        /// The capability is exclusive, so AGX winning it means stock is NOT also
        /// answering underneath: two active instances would make
        /// <c>Kernel.Query</c> throw rather than pick, which is a failure the
        /// election exists to prevent rather than to report.
        /// </summary>
        [Fact]
        public void ExactlyOneBackendIsElected()
        {
            var host = Registered(agxPresent: true);

            Assert.Single(host.Kernel.Active(ActionGroupsCapability.Id));
        }

        [Fact]
        public void ElectedBackend_ExposesTheSharedReadouts()
        {
            var backend = Registered(agxPresent: false).ElectedBackend()!;

            Assert.NotNull(backend.Groups());
            Assert.True(backend.SetGroup(1, true));
        }

        /// <summary>
        /// When AGX's probe reports unavailable, the uplink declares itself
        /// unavailable and registers NO provider, so stock stays elected. The
        /// absence has to be visible: an uplink that went quietly inert and left
        /// stock answering looks identical to a correct stock install, which is
        /// exactly the state a player who installed AGX would never think to
        /// question.
        /// </summary>
        [Fact]
        public void ProbeUnavailable_UplinkGoesInert_StockStillWins()
        {
            var host = Registered(agxPresent: false);

            Assert.NotNull(host.Availability);
            Assert.False(host.Availability!.Value.IsAvailable);

            var elected = host.ElectedBackend();
            Assert.NotNull(elected);
            Assert.Equal("stock", elected!.ProviderId);
        }

        /// <summary>
        /// <see cref="ActionGroupsExtendedUplink.Health"/> reports the same absence
        /// the availability does, from the cached Register-time probe rather than a
        /// second one: this uplink probes for a loaded ASSEMBLY, and re-probing per
        /// health poll would answer a question about the AppDomain on whatever
        /// thread the poll arrived on.
        /// </summary>
        [Fact]
        public void Health_MirrorsWhetherTheProbeFoundAgx()
        {
            var present = new ActionGroupsExtendedUplink(new FakeAgxApi(isAvailable: true));
            present.Register(new RecordingUplinkHost(_ => new FakeActionGroupsBackend("stock")));
            Assert.Equal(UplinkHealthState.Healthy, present.Health().State);

            var absent = new ActionGroupsExtendedUplink(new FakeAgxApi(isAvailable: false));
            absent.Register(new RecordingUplinkHost(_ => new FakeActionGroupsBackend("stock")));
            Assert.Equal(UplinkHealthState.Unavailable, absent.Health().State);
        }

        /// <summary>
        /// Registering the provider is the WHOLE of what this uplink does to the
        /// host: it declares no channel, sources no topic, handles no command and
        /// takes no capture, because <c>vessel.control</c> is the vessel uplink's
        /// and AGX changes only which backend answers it. Every other seam on
        /// <see cref="RecordingUplinkHost"/> throws, so this passing means nothing
        /// else was touched, not that nothing else was counted.
        /// </summary>
        [Fact]
        public void Register_AddsTheProviderAndTouchesNoOtherSeam()
        {
            var host = Registered(agxPresent: true);

            Assert.Empty(host.SampledSources);
            Assert.Empty(host.Samplers);
            Assert.Null(host.Availability);
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
