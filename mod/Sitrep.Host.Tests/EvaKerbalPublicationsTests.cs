using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// What goes onto each <c>eva.kerbal.&lt;vessel id&gt;.state</c> topic. Every kerbal outside
    /// has a topic of its own.
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
        public void TheHelmetAndThePackAreCarriedAndAnUnreadPackIsNullNotEmpty()
        {
            var read = new Dictionary<string, object?>
            {
                ["kerbalVesselId"] = "k1",
                ["helmetOn"] = true,
                ["slots"] = 6,
                ["slotsUsed"] = 1,
                ["carrying"] = new List<object?>
                {
                    new Dictionary<string, object?> { ["name"] = "evaRepairKit", ["title"] = "Repair Kit", ["quantity"] = 2 },
                },
            };
            var unread = new Dictionary<string, object?> { ["kerbalVesselId"] = "k2" };
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?> { ["evaCrew"] = new List<object?> { read, unread } },
            };

            var kerbals = VesselViewProvider.BuildEvaKerbals(snapshot)!;

            Assert.True(kerbals[0].HelmetOn);
            Assert.Equal(6, kerbals[0].Slots);
            Assert.Equal(1, kerbals[0].SlotsUsed);
            var item = Assert.Single(kerbals[0].Carrying!);
            Assert.Equal("evaRepairKit", item.Name);
            Assert.Equal(2, item.Quantity);
            Assert.Null(kerbals[1].HelmetOn);
            Assert.Null(kerbals[1].Carrying);
            Assert.Null(kerbals[1].Slots);
        }

        [Fact]
        public void TheHelmetAndThePackReachTheWireOnTheKerbalsTopic()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["evaCrew"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["kerbalVesselId"] = "k1",
                            ["helmetOn"] = true,
                            ["slots"] = 6,
                            ["slotsUsed"] = 1,
                            ["carrying"] = new List<object?>
                            {
                                new Dictionary<string, object?> { ["name"] = "evaRepairKit", ["title"] = "Repair Kit", ["quantity"] = 2 },
                            },
                        },
                        new Dictionary<string, object?> { ["kerbalVesselId"] = "k2" },
                    },
                },
            };

            var publications = new EvaKerbalPublications().Next(snapshot);

            var read = Assert.IsAssignableFrom<IDictionary<string, object?>>(publications[0].Payload);
            Assert.Equal(true, read["helmetOn"]);
            Assert.Equal(6, read["slots"]);
            Assert.Equal(1, read["slotsUsed"]);
            var items = Assert.IsAssignableFrom<IList<object?>>(read["carrying"]);
            var item = Assert.IsAssignableFrom<IDictionary<string, object?>>(Assert.Single(items));
            Assert.Equal("evaRepairKit", item["name"]);
            Assert.Equal(2, item["quantity"]);
            var unread = Assert.IsAssignableFrom<IDictionary<string, object?>>(publications[1].Payload);
            Assert.True(unread.ContainsKey("helmetOn"));
            Assert.Null(unread["helmetOn"]);
            Assert.Null(unread["carrying"]);
        }

        [Fact]
        public void EveryFieldOfTheKerbalContractIsWrittenToTheWire()
        {
            var publications = new EvaKerbalPublications().Next(SnapshotWith("k1"));
            var wire = Assert.IsAssignableFrom<IDictionary<string, object?>>(publications[0].Payload);

            foreach (var property in typeof(EvaKerbal).GetProperties())
            {
                var key = char.ToLowerInvariant(property.Name[0]) + property.Name.Substring(1);
                Assert.True(wire.ContainsKey(key), "the wire drops " + key);
            }
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

        private static KspSnapshot SnapshotWithUnloaded(string[] loaded, params string[] unloaded)
        {
            var snapshot = SnapshotWith(loaded);
            var entries = new List<object?>();
            foreach (var id in unloaded)
            {
                entries.Add(new Dictionary<string, object?> { ["kerbalVesselId"] = id, ["name"] = "Bill Kerman" });
            }
            snapshot.Values![VesselViewProvider.EvaUnloadedKey] = entries;
            return snapshot;
        }

        [Fact]
        public void AKerbalWhoUnloadsIsNeitherWithdrawnNorRepublishedSoWhatWasHeardIsKept()
        {
            var publications = new EvaKerbalPublications();
            publications.Next(SnapshotWith("k1"));

            var unloaded = publications.Next(SnapshotWithUnloaded(new string[0], "k1"));

            Assert.Empty(unloaded);
            Assert.Empty(publications.Next(SnapshotWithUnloaded(new string[0], "k1")));
        }

        [Fact]
        public void AnUnloadedKerbalWhoLaterGoesBackAboardIsWithdrawnOnce()
        {
            var publications = new EvaKerbalPublications();
            publications.Next(SnapshotWith("k1"));
            publications.Next(SnapshotWithUnloaded(new string[0], "k1"));

            var next = publications.Next(SnapshotWith());

            var withdrawal = Assert.Single(next);
            Assert.Equal("k1.state", withdrawal.SubTopic);
            Assert.Null(withdrawal.Payload);
        }

        [Fact]
        public void AnUnloadedKerbalWhoLoadsAgainIsPublishedWithItsSuit()
        {
            var publications = new EvaKerbalPublications();
            publications.Next(SnapshotWith("k1"));
            publications.Next(SnapshotWithUnloaded(new string[0], "k1"));

            var next = publications.Next(SnapshotWith("k1"));

            Assert.Equal(3.5, Assert.IsAssignableFrom<IDictionary<string, object?>>(Assert.Single(next).Payload)["propellantAmount"]);
        }
    }
}
