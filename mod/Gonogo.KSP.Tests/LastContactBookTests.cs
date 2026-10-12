using System;
using System.Collections.Generic;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The last contact the fleet topics publish belongs to one game and one timeline, and
    /// must never sit in the future of the clock it is read against.
    /// </summary>
    public class LastContactBookTests
    {
        [Fact]
        public void a_contact_is_kept_until_the_next_one()
        {
            var book = new LastContactBook();
            book.BeginPass("a#1", 100);
            book.Observe("probe", connected: true, 100);
            book.BeginPass("a#1", 200);
            book.Observe("probe", connected: false, 200);

            Assert.Equal(100, book.Of("probe"));
        }

        [Fact]
        public void a_craft_never_connected_has_no_last_contact()
        {
            var book = new LastContactBook();
            book.BeginPass("a#1", 100);
            book.Observe("probe", connected: false, 100);

            Assert.Null(book.Of("probe"));
        }

        [Fact]
        public void loading_an_earlier_save_drops_contact_from_its_future()
        {
            var book = new LastContactBook();
            book.BeginPass("a#1", 10_000);
            book.Observe("early", connected: true, 10_000);
            book.BeginPass("a#1", 50_000);
            book.Observe("late", connected: true, 50_000);

            book.BeginPass("a#1", 20_000);

            Assert.Equal(10_000, book.Of("early"));
            Assert.Null(book.Of("late"));
        }

        [Fact]
        public void another_game_drops_every_contact()
        {
            var book = new LastContactBook();
            book.BeginPass("a#1", 100);
            book.Observe("probe", connected: true, 100);

            book.BeginPass("b#2", 900);

            Assert.Null(book.Of("probe"));
        }

        [Fact]
        public void a_craft_gone_from_the_world_is_forgotten()
        {
            var book = new LastContactBook();
            book.BeginPass("a#1", 100);
            book.Observe("debris", connected: true, 100);
            book.Observe("probe", connected: true, 100);

            book.Keep(new HashSet<string> { "probe" });

            Assert.Equal(1, book.Count);
            Assert.Null(book.Of("debris"));
        }

        /// <summary>
        /// The silence tracker restores each craft's last contact from the save, so the
        /// fleet topic falls back to it rather than starting every session at null.
        /// Source text: the capture reads live KSP.
        /// </summary>
        [Fact]
        public void the_fleet_topic_falls_back_to_the_saved_last_contact()
        {
            var source = CurrencyDelaySourceText.ReadRelative("FleetChannels.cs");

            Assert.Contains(
                "LastContactUt = _lastContact.Of(id)\n                        ?? SilenceTracking.SilenceTrackerSink.Current?.TryGetState(id)?.LastContactUt,",
                source,
                StringComparison.Ordinal);
        }
    }
}
