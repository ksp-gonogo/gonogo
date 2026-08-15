using System.Collections.Generic;
using Sitrep.Core;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Sitrep.Host.Tests.CommandCentres
{
    /// <summary>
    /// The Plan 3 no-regression backstop: with only KSC and Plan 2's per-vessel
    /// node-default in place, the delay a KSC operator sees is byte-identical to
    /// Plan 2, because <c>DelayTo(vantage, node)</c>'s 3-tier lookup falls through
    /// the (absent) explicit (vantage, node) pair to the <c>SetNodeDelay</c>
    /// node-default. The authority pass's explicit rows override ONLY the selected
    /// vantage; every other vantage keeps the node-default untouched.
    /// </summary>
    public class KscParityGateTests
    {
        private static string FleetNode(string guid) => ChannelEngine.FleetNodePrefix + guid;

        [Fact]
        public void NoAuthorityRow_KscVantage_FallsThroughToPlan2NodeDefault()
        {
            var net = new StubNetwork();
            // Plan 2: the per-vessel downlink node-default.
            net.SetNodeDelay(FleetNode("G"), 5.0);

            // No explicit ("ksc", fleet.G) pair set -> falls through to the
            // node-default. KSC-only behaviour is exactly Plan 2.
            Assert.Equal(5.0, net.DelayTo("ksc", FleetNode("G")));
        }

        [Fact]
        public void AuthorityPass_ExplicitRow_OverridesNodeDefault_ForThatVantageOnly()
        {
            var net = new StubNetwork();
            net.SetNodeDelay(FleetNode("G"), 5.0); // Plan 2 node-default

            // The authority pass writes an explicit (ksc, fleet.G) pair via the
            // same host-hook path (SetAuthorityDelay -> SetDelay).
            new AuthorityMatrixPass().Populate(
                new ICommandCentre[] { new FakeCommandCentre("ksc") },
                new[] { "G" },
                (_, __) => 3.0,
                (vantage, node, seconds) => net.SetDelay(vantage, node, seconds));

            // ksc now sees the explicit routed delay...
            Assert.Equal(3.0, net.DelayTo("ksc", FleetNode("G")));
            // ...but any OTHER vantage still falls through to Plan 2's node-default.
            Assert.Equal(5.0, net.DelayTo("some-other-vantage", FleetNode("G")));
        }

        [Fact]
        public void CentrePairPass_AddsAnAddressableCentre_WithoutDisturbingAnyVesselRow()
        {
            var net = new StubNetwork();
            net.SetNodeDelay(FleetNode("G"), 5.0); // Plan 2 node-default

            new AuthorityMatrixPass().PopulateCentrePairs(
                new ICommandCentre[] { new FakeCommandCentre("ksc") },
                (_, __) => null,
                (vantage, node, seconds) => net.SetDelay(vantage, node, seconds));

            // The centre namespace is disjoint from the fleet one, so making a
            // centre addressable as a destination leaves every existing
            // centre -> vessel lookup exactly where it was.
            Assert.Equal(5.0, net.DelayTo("ksc", FleetNode("G")));
            Assert.Equal(0.0, net.DelayTo("ksc", AuthorityMatrixPass.CentreNode("ksc")));
        }
    }
}
