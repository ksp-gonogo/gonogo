using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// What goes onto each <c>eva.kerbal.&lt;vessel id&gt;.state</c> topic. Every kerbal outside
    /// has a topic of its own so that it is held or revealed by its own link, never by
    /// the link of the craft it left.
    /// </summary>
    public class EvaKerbalPublicationsTests
    {
        private static KspSnapshot SnapshotWith(params string[] kerbalIds)
        {
            var entries = new List<object?>();
            foreach (var id in kerbalIds)
            {
                entries.Add(new Dictionary<string, object?>
                {
                    ["kerbalVesselId"] = id,
                    ["parentVesselId"] = "craft-1",
                    ["name"] = "Jebediah Kerman",
                    ["propellantAmount"] = 3.5,
                });
            }
            return new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?> { ["evaCrew"] = entries },
            };
        }

        [Fact]
        public void EachKerbalOutsideIsPublishedOnItsOwnTopicWithItsSuitState()
        {
            var publications = new EvaKerbalPublications().Next(SnapshotWith("k1", "k2"));

            Assert.Equal(new[] { "k1.state", "k2.state" }, publications.ConvertAll(p => p.SubTopic));
            var wire = Assert.IsAssignableFrom<IDictionary<string, object?>>(publications[0].Payload);
            Assert.Equal(3.5, wire["propellantAmount"]);
            Assert.Equal("k1", wire["kerbalVesselId"]);
        }

        [Fact]
        public void AKerbalWhoHasGoneBackAboardIsWithdrawnOnceAndThenLeftAlone()
        {
            var publications = new EvaKerbalPublications();
            publications.Next(SnapshotWith("k1", "k2"));

            var next = publications.Next(SnapshotWith("k2"));

            Assert.Contains(next, p => p.SubTopic == "k1.state" && p.Payload == null);
            Assert.DoesNotContain(publications.Next(SnapshotWith("k2")), p => p.SubTopic == "k1.state");
        }

        [Fact]
        public void ASnapshotWithNoRosterWithdrawsNothing()
        {
            var publications = new EvaKerbalPublications();
            publications.Next(SnapshotWith("k1"));

            var bare = new KspSnapshot { Ut = 1.0, Values = new Dictionary<string, object?>() };

            Assert.Empty(publications.Next(bare));
        }
    }
}
