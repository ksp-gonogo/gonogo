using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// The stamp is a SNAPSHOT of the ledger, so the two must agree at the
    /// instant it is taken. If they can drift, a sample records a light-time
    /// nothing else in the engine believes, and every delivery timed off it is
    /// wrong in a way no delay test would notice.
    /// </summary>
    public class DelayStampTests
    {
        [Fact]
        public void AgreesWithTheLedgerOnEveryTier()
        {
            var network = new StubNetwork(delay: 3.0);
            network.SetDefaultDelay(7.0);
            network.SetNodeDelay("fleet.a", 11.0);
            network.SetDelay("centre", "fleet.a", 13.0);

            foreach (var node in new[] { "system", "fleet.a" })
            {
                var stamp = network.StampFor(node);
                foreach (var vantage in new[] { "KSC", "centre", "never-seen" })
                {
                    Assert.Equal(network.DelayTo(vantage, node), stamp.For(vantage));
                }
            }
        }

        [Fact]
        public void CarriesTheScaleTheLedgerApplies()
        {
            var network = new StubNetwork(delay: 0);
            network.SetDefaultDelay(4.0);
            network.SetDelay("centre", "system", 10.0);
            network.SetScale(0.5);

            var stamp = network.StampFor("system");
            Assert.Equal(2.0, stamp.For("KSC"));
            Assert.Equal(5.0, stamp.For("centre"));
        }

        /// <summary>
        /// A stamp is handed out by reference while the ledger holds still, and
        /// a fresh one the moment it moves. Every recorded sample asks for one,
        /// so an allocation per record would be the cost the sharing exists to
        /// avoid, and a STALE one after a reroute would reintroduce the defect
        /// the stamp was added to fix.
        /// </summary>
        [Fact]
        public void IsSharedWhileTheLedgerHoldsStillAndRebuiltWhenItMoves()
        {
            var network = new StubNetwork(delay: 0);
            network.SetDefaultDelay(4.0);

            var first = network.StampFor("system");
            Assert.Same(first, network.StampFor("system"));

            network.SetDefaultDelay(1.0);
            var second = network.StampFor("system");
            Assert.NotSame(first, second);
            Assert.Equal(4.0, first.For("KSC"));
            Assert.Equal(1.0, second.For("KSC"));
        }

        /// <summary>
        /// A stamp must survive a quicksave. Dropping it on restore would put
        /// the whole surviving backlog back on the live ledger at the exact
        /// moment a save is loaded, which is the defect, reintroduced by
        /// persistence rather than by the delay engine.
        /// </summary>
        [Fact]
        public void SurvivesAnArchiveSnapshotRoundTrip()
        {
            var network = new StubNetwork(delay: 0);
            network.SetDefaultDelay(4.0);
            network.SetDelay("centre", "system", 9.0);

            var archive = new Archive();
            archive.Record("t", "a", 100, epoch: 2, stamp: network.StampFor("system"));
            archive.Record("t", "b", 200, epoch: 2);

            var restored = Archive.Restore(archive.Snapshot());
            var samples = restored.Samples("t");

            Assert.Equal(4.0, samples[0].Stamp!.For("KSC"));
            Assert.Equal(9.0, samples[0].Stamp!.For("centre"));
            Assert.Null(samples[1].Stamp);
        }
    }
}
