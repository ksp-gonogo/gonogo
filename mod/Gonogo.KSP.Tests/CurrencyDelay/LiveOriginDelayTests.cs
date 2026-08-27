using System;
using System.Collections.Generic;
using Gonogo.KSP.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests.CurrencyDelay
{
    /// <summary>
    /// The roster walk that turns an away event's vessel id into a measured
    /// delay: the step that was missing, so a craft with a working link home was
    /// held for the silence deadline instead of its light-time.
    ///
    /// <para>The live roster and the CommNet read are both scene-bound and cannot
    /// be entered here, so they arrive as a sequence and a function. What is left
    /// is the whole of the decision that went wrong.</para>
    /// </summary>
    public class LiveOriginDelayTests
    {
        private sealed class Candidate
        {
            public Candidate(string? id, KscDelay delay)
            {
                Id = id;
                Delay = delay;
            }

            public string? Id { get; }
            public KscDelay Delay { get; }
        }

        private static KscDelay Resolve(string? vesselId, IEnumerable<Candidate>? roster) =>
            LiveOriginDelay.Resolve(vesselId, roster, c => c.Id, c => c.Delay);

        [Fact]
        public void a_vessel_in_the_roster_is_measured_not_declared_silent()
        {
            var delay = Resolve("v-1", new[]
            {
                new Candidate("v-0", KscDelay.Routed(999.0)),
                new Candidate("v-1", KscDelay.Routed(12.8)),
            });

            Assert.Equal(KscDelayKind.Routed, delay.Kind);
            Assert.Equal(12.8, delay.Seconds);
        }

        [Fact]
        public void an_id_nothing_in_the_roster_carries_is_unroutable()
        {
            var delay = Resolve("v-1", new[] { new Candidate("v-0", KscDelay.Routed(12.8)) });

            Assert.True(delay.IsUnroutable);
        }

        [Fact]
        public void an_empty_roster_is_unroutable()
        {
            Assert.True(Resolve("v-1", Array.Empty<Candidate>()).IsUnroutable);
        }

        [Fact]
        public void no_roster_at_all_is_unroutable()
        {
            Assert.True(Resolve("v-1", null).IsUnroutable);
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        public void an_event_that_names_no_vessel_is_unroutable(string? vesselId)
        {
            // And specifically does not match a torn-down entry that also has no
            // name: two things nobody can name are not the same thing, and a
            // credit attributed that way would reveal on a stranger's geometry.
            var delay = Resolve(vesselId, new[]
            {
                new Candidate(null, KscDelay.Routed(12.8)),
                new Candidate("", KscDelay.Routed(12.8)),
            });

            Assert.True(delay.IsUnroutable);
        }

        [Fact]
        public void an_unreadable_entry_is_skipped_rather_than_ending_the_walk()
        {
            var delay = Resolve("v-1", new[]
            {
                new Candidate(null, KscDelay.Routed(999.0)),
                new Candidate("v-1", KscDelay.Routed(12.8)),
            });

            Assert.Equal(12.8, delay.Seconds);
        }

        [Fact]
        public void a_matched_vessel_with_no_route_home_stays_unroutable()
        {
            // Found is not the same as reachable. A craft on the far side of a
            // body is in the roster and has no path home, and this is the case
            // the silence deadline exists for.
            var delay = Resolve("v-1", new[] { new Candidate("v-1", KscDelay.Unroutable) });

            Assert.True(delay.IsUnroutable);
        }

        [Fact]
        public void only_the_matching_vessel_is_measured()
        {
            // The route read walks a solved CommNet path. Running it for every
            // vessel in the game to answer a question about one of them is a
            // per-science-increment cost, and this arm fires per increment.
            var measured = new List<string?>();
            var roster = new[]
            {
                new Candidate("v-0", KscDelay.Routed(999.0)),
                new Candidate("v-1", KscDelay.Routed(12.8)),
                new Candidate("v-2", KscDelay.Routed(999.0)),
            };

            LiveOriginDelay.Resolve(
                "v-1",
                roster,
                c => c.Id,
                c =>
                {
                    measured.Add(c.Id);
                    return c.Delay;
                });

            Assert.Equal(new string?[] { "v-1" }, measured);
        }
    }
}
