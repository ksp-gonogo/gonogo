using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The order of one part window's reads in the samples after a client subscribes, with another mod
    /// (a watch over a part's name tag module) that switches a module on once it has seen the subscription, after the
    /// window producers have read in the same sample. The model repeats VesselUplink's capture: the
    /// windows just subscribed to first, then the sweep.
    /// </summary>
    public class PartWindowSampleOrderTests
    {
        private const string Part = "7";

        private static PartWindowItem Row(string name) => new PartWindowItem { Kind = "label", Name = name, Label = name, Text = "x" };

        /// <summary>The frames published, as the row count each carried, after a subscription with an idle sweep.</summary>
        private static List<int> Run(bool sweepLeavesPendingWindows)
        {
            var actuator = new FakePartActionActuator();
            var tagOn = false;
            var fresh = new PartWindowFresh();
            var sweep = new PartActionsSweep(500);
            var cache = new PartActionsPublicationCache();
            var published = new List<int>();
            long now = 100000;

            // The subscription: the window is queued for its first read and the sweep has been idle.
            fresh.Add(Part);

            for (var sample = 0; sample < 4; sample++)
            {
                now += 20;
                actuator.WindowByPartId[Part] = tagOn
                    ? new List<PartWindowItem> { Row("always"), Row("nameTag") }
                    : new List<PartWindowItem> { Row("always") };

                var publications = new List<PartActionsViewProvider.Publication>();
                foreach (var (id, publish) in fresh.Take(() => 0, 1000, _ => true))
                {
                    if (publish)
                    {
                        publications.AddRange(PartActionsViewProvider.Build(actuator, new[] { id }, "v"));
                    }
                }

                var swept = PartActionsViewProvider.Tick(actuator, sweep, () => new List<string> { Part }, () => "v", now, () => false, out _);
                if (sweepLeavesPendingWindows)
                {
                    swept.RemoveAll(p => fresh.IsPending(p.SubTopic));
                }

                publications.AddRange(swept);
                foreach (var p in cache.Changed(publications, null, prune: false))
                {
                    published.Add(p.Source!.Window.Count);
                }

                // The watch runs after the producers in the same sample, and switches the tag on at its first sight of the subscription.
                tagOn = true;
            }

            return published;
        }

        [Fact]
        public void AnIdleSweepPublishesTheWindowBeforeTheModuleIsOnWhenItDoesNotLeaveItToTheQueue()
        {
            var published = Run(sweepLeavesPendingWindows: false);

            // The first frame lacks the row and the next has it: the order seen on the Deck.
            Assert.Equal(1, published.First());
            Assert.Contains(2, published);
        }

        [Fact]
        public void TheSweepLeavingPendingWindowsToTheQueueNeverPublishesAFrameWithoutTheRow()
        {
            var published = Run(sweepLeavesPendingWindows: true);

            Assert.NotEmpty(published);
            Assert.All(published, rows => Assert.Equal(2, rows));
        }

        [Fact]
        public void AFreshWindowIsWalkedOnceAndNotOnceForEachStep()
        {
            var actuator = new FakePartActionActuator();
            actuator.WindowByPartId[Part] = new List<PartWindowItem> { Row("always") };
            var fresh = new PartWindowFresh();
            fresh.Add(Part);

            for (var sample = 0; sample < 3; sample++)
            {
                foreach (var (id, publish) in fresh.Take(() => 0, 1000, _ => true))
                {
                    if (publish)
                    {
                        PartActionsViewProvider.Build(actuator, new[] { id }, "v");
                    }
                }
            }

            Assert.Single(actuator.ListedPartIds);
        }
    }
}
