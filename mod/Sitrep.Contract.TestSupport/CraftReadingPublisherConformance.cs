using System;
using System.Threading.Tasks;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// What <see cref="ICraftReadingPublisher"/> promises, for a host author to run
    /// against the publisher their host returns for a channel declared with
    /// <see cref="ChannelDeclaration.FollowsActiveCraft"/>.
    /// </summary>
    public static class CraftReadingPublisherConformance
    {
        private static readonly TimeSpan OffMainLimit = TimeSpan.FromSeconds(5);

        /// <summary>
        /// Offers readings for a craft the host has never seen, the same craft again,
        /// a second craft, a <c>null</c> reading and an empty craft id, first from
        /// the calling thread and then from a thread-pool thread, as the
        /// off-main-thread half of a sampled source calls it.
        ///
        /// <para>Fails when any call throws, or when the off-main-thread calls do
        /// not return within five seconds. An Uplink reads every craft in turn
        /// and has no way to know which ones the host already keeps, so every
        /// craft id is one the publisher must take. An empty id names no craft,
        /// so the publisher keeps nothing for it and returns.</para>
        /// </summary>
        /// <param name="publisher">The publisher under test, as the host returned it for a following channel.</param>
        /// <param name="reading">A reading in that channel's own shape.</param>
        public static void AssertAcceptsEveryCraftsReading(ICraftReadingPublisher publisher, object reading)
        {
            Assert.NotNull(publisher);
            var name = publisher.GetType().Name;

            Offer(publisher, name, 100.0, reading, "the calling thread");

            Exception? thrown = null;
            var finished = Task.Run(() =>
            {
                try
                {
                    Offer(publisher, name, 200.0, reading, "a thread-pool thread");
                }
                catch (Exception ex)
                {
                    thrown = ex;
                }
            }).Wait(OffMainLimit);

            Assert.True(
                finished,
                name + ".PublishFor did not return within " + OffMainLimit.TotalSeconds + " s when called off the main thread. "
                + "A sampled source publishes from its off-main-thread half, which this call must not block.");
            if (thrown != null)
            {
                throw thrown;
            }
        }

        private static void Offer(ICraftReadingPublisher publisher, string name, double ut, object reading, string thread)
        {
            var first = Guid.NewGuid().ToString();
            var second = Guid.NewGuid().ToString();
            var calls = new (string Craft, object? Reading, string Case)[]
            {
                (first, reading, "a craft it has not seen"),
                (first, reading, "the same craft again"),
                (second, reading, "a second craft"),
                (second, null, "a null reading"),
                ("", reading, "an empty craft id"),
            };

            for (var i = 0; i < calls.Length; i++)
            {
                Exception? thrown = null;
                try
                {
                    publisher.PublishFor(calls[i].Craft, calls[i].Reading, ut + i);
                }
                catch (Exception ex)
                {
                    thrown = ex;
                }
                Assert.True(
                    thrown == null,
                    name + ".PublishFor threw " + (thrown?.GetType().Name ?? "") + " for " + calls[i].Case + " from " + thread + ": "
                    + (thrown?.Message ?? "") + ". An Uplink reads every craft in turn, so a throw stops its reading of the craft after it.");
            }
        }
    }
}
