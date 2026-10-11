using System;
using System.Collections.Generic;
using System.Diagnostics;
using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// <see cref="StubNetwork.Lost"/> is asked once per archived sample on every
    /// subscribe, and breaks accumulate for the whole session, so what it costs
    /// has to follow the few breaks near the send time and not the length of the
    /// session. A rails-warp run at 100000x records a break per occultation, and
    /// a subscribe that walked every break for every sample held the Courier
    /// thread, which answers every other subscribe, for minutes.
    /// </summary>
    public class StubNetworkDropLedgerTests
    {
        private const string Node = "vessel";

        [Fact]
        public void Lost_agrees_with_asking_every_recorded_break()
        {
            var random = new Random(966);
            var network = new StubNetwork();
            var brute = new List<PathDrop>();

            for (var i = 0; i < 400; i++)
            {
                var at = Math.Round(random.NextDouble() * 50_000, 1);
                var reach = random.Next(0, 4) == 0 ? 0 : random.NextDouble() * 900;
                var restored = random.Next(0, 3) == 0
                    ? double.PositiveInfinity
                    : at + random.NextDouble() * 2_000;

                network.DropPath(Node, at, reach, restored);
                if (!brute.Exists(d => d.Blinded(at)))
                {
                    brute.Add(new PathDrop(at, reach, restored));
                }
            }

            for (var i = 0; i < 5_000; i++)
            {
                var sent = random.NextDouble() * 52_000 - 1_000;
                var expected = brute.Exists(d => d.Caught(sent));
                Assert.Equal(expected, network.Lost(Node, sent));
            }
        }

        [Fact]
        public void Lost_is_not_bounded_by_how_many_breaks_the_session_has_recorded()
        {
            var network = new StubNetwork();
            const int breaks = 40_000;
            for (var i = 0; i < breaks; i++)
            {
                network.DropPath(Node, i * 600.0, 120.0, i * 600.0 + 300.0);
            }

            var caught = 0;
            var clock = Stopwatch.StartNew();
            for (var i = 0; i < breaks; i++)
            {
                if (network.Lost(Node, i * 600.0 - 60.0))
                {
                    caught++;
                }
            }
            clock.Stop();

            Assert.Equal(breaks, caught);
            Assert.True(clock.ElapsedMilliseconds < 1_000,
                "40000 queries over 40000 breaks took " + clock.ElapsedMilliseconds + " ms");
        }
    }
}
