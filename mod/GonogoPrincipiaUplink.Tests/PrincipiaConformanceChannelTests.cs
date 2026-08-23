using System;
using System.Linq;
using GonogoPrincipiaUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// The wiring, not the gate. Every other conformance test calls the gate
    /// directly, so all of them pass whether or not anything in the Uplink ever
    /// invokes it, which is how a gate ships inert.
    /// </summary>
    public class PrincipiaConformanceChannelTests
    {
        [Fact]
        public void TheUplinkDeclaresAChannelForItsConformanceVerdict()
        {
            // Without a declaration nothing is published, however well the gate
            // works: the operator's only view of whether their Principia is vetted
            // is this channel existing.
            var uplink = new PrincipiaUplink();

            var conformance = uplink.Manifest.Channels.FirstOrDefault(
                c => c.Topic == PrincipiaUplink.ConformanceTopic);

            Assert.NotNull(conformance);
        }

        [Fact]
        public void TheVerdictIsTrueNowRatherThanDelayed()
        {
            // Which files are on the operator's own machine is a ground-side fact.
            // Delaying it would mean someone who just installed Principia could not
            // be told their build was unvetted until light-time had passed.
            var uplink = new PrincipiaUplink();

            var conformance = uplink.Manifest.Channels.FirstOrDefault(
                c => c.Topic == PrincipiaUplink.ConformanceTopic);

            Assert.Equal(DelayRole.TrueNow, conformance!.Delay);
        }

        [Fact]
        public void CapturingSaysNothingUntilThereIsAVerdictToGive()
        {
            // A read taken while Principia is still loading finds nothing mapped, and
            // that is not a verdict about the install. Returning a report here would
            // latch "Principia is not loaded" about a game that is about to load it,
            // and the cache would make it permanent.
            var uplink = new PrincipiaUplink();

            var captured = uplink.CaptureConformanceOnMain(null);

            Assert.Null(captured);
        }

        [Fact]
        public void ThePublisherIsNotFedSomethingThatIsNotAReport()
        {
            // The courier hands back whatever the capture returned, including null on
            // a tick that had nothing to say.
            var uplink = new PrincipiaUplink();

            uplink.HandleConformanceOnCourier(null);
            uplink.HandleConformanceOnCourier("not a report");
        }
    }
}
