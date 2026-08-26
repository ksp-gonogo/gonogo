using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Sitrep.Host.ActionGroups;
using Xunit;

namespace Gonogo.ActionGroupsExtendedUplink.Tests
{
    /// <summary>
    /// The <c>"actionGroups"</c> capability is EXCLUSIVE, so when this uplink wins
    /// it the stock backend does not answer underneath. It must therefore answer
    /// under the subscriptions a real session holds, and for this uplink the honest
    /// case is the harshest one: no subscriptions and no ticks at all.
    ///
    /// <para><b>What this exists to catch.</b> A subscription-gated capture is
    /// skipped entirely on any tick where nothing under its declared prefixes is
    /// subscribed, so an exclusive capability whose provider is fed by one goes
    /// stale and stays stale with nothing anywhere saying so. This uplink is not in
    /// that shape today: it takes no captures and its backend reads live AGX
    /// through the reflection seam. Pinned anyway, because "it does not need a tick"
    /// is exactly the claim that stops being true the moment somebody feeds the
    /// backend from a gated reading, and this is where that has to fail rather than
    /// on an operator's rig.</para>
    ///
    /// <para>Registration is driven through the real <c>Register</c>, with AGX
    /// supplied through the uplink's seam. A copy of Register written into the test
    /// would keep passing while the real one changed.</para>
    /// </summary>
    public class ActionGroupsStarvationTests
    {
        [Fact]
        public void The_action_groups_backend_answers_with_nothing_subscribed()
        {
            var host = Registered();

            host.DriveTicks(3, new KspSnapshot());

            var elected = ActionGroupsElection.Elected(host.Kernel);
            Assert.NotNull(elected);
            Assert.Equal(ActionGroupsExtendedUplink.ProviderId, elected!.ProviderId);
            Assert.NotNull(elected.Groups());
        }

        /// <summary>
        /// The stronger form of the case above: with no tick driven at all. This
        /// uplink registers no capture, so nothing about its answer can depend on
        /// one, and that is the property worth pinning rather than the count of
        /// registrations.
        /// </summary>
        [Fact]
        public void The_action_groups_backend_answers_before_any_tick_is_driven()
        {
            var host = Registered();

            var elected = ActionGroupsElection.Elected(host.Kernel);
            Assert.NotNull(elected);
            Assert.Equal(ActionGroupsExtendedUplink.ProviderId, elected!.ProviderId);
            Assert.NotNull(elected.Groups());
        }

        /// <summary>
        /// The capability declared the way core declares it, the real uplink
        /// registered against a present AGX, the election run.
        /// </summary>
        private static StarvationProbeHost Registered()
        {
            var kernel = new Kernel();
            ActionGroupsElection.RegisterCapability(kernel, _ => new StockStandIn());
            var host = new StarvationProbeHost(kernel);
            new ActionGroupsExtendedUplink(new PresentAgx()).Register(host);
            host.Resolve();
            return host;
        }

        /// <summary>AGX present, with one assigned group so a read has something to find.</summary>
        private sealed class PresentAgx : IAgxApi
        {
            public bool IsAvailable => true;

            public IReadOnlyList<AgxGroup>? AssignedGroups() =>
                new List<AgxGroup> { new AgxGroup(1, "Solar", true) };

            public bool Activate(int index, bool on) => true;
        }

        /// <summary>
        /// The stock vanilla, present so the election has something to fall back to.
        /// It answers with its own provider id, which is how the cases above tell an
        /// AGX win from a silent fallback: a starved exclusive provider that lost the
        /// election reads as stock, not as null.
        /// </summary>
        private sealed class StockStandIn : IActionGroupsBackend
        {
            public string ProviderId => "stock";

            public IList<ActionGroupState>? Groups() => new List<ActionGroupState>();

            public bool SetGroup(int index, bool state) => false;
        }
    }
}
