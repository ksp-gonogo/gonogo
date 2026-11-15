using System.Collections.Generic;
using System.Globalization;
using Xunit;
using Sitrep.Core;

using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// What <see cref="Courier.ReissueRetainedAfterReset"/> sends and what it says
    /// about the topics it sent nothing for, on a fleet-sized subscription set.
    /// </summary>
    public class CourierResetReissueSummaryTests
    {
        private const int Craft = 18;
        private static readonly string[] Fields = { "craft", "link", "radio", "reach", "report", "seen" };
        private static readonly string[] Vantages = { "KSC", "far" };

        private sealed class Fleet
        {
            public ManualClock Clock = new ManualClock();
            public Courier Courier = null!;
            public List<string> Delivered = new List<string>();
        }

        private static string Topic(int craft, string field) =>
            "craftstate." + craft.ToString("D2", CultureInfo.InvariantCulture) + "." + field;

        /// <summary>
        /// Every craft's topics subscribed from a centre with no delay and one five
        /// seconds away. Even craft were heard from before the save at UT 8; odd
        /// craft spoke only after it, on the timeline the reset abandons.
        /// </summary>
        private static Fleet Build(double resetUt)
        {
            var fleet = new Fleet();
            var network = new StubNetwork();
            network.SetDelay("far", "system", 5);
            fleet.Courier = new Courier(fleet.Clock, network);
            for (var craft = 0; craft < Craft; craft++)
            {
                foreach (var field in Fields)
                {
                    var topic = Topic(craft, field);
                    foreach (var vantage in Vantages)
                    {
                        fleet.Courier.SubscribeStream("system", topic, vantage, data => fleet.Delivered.Add(Line(vantage, data)));
                    }
                }
            }
            for (var craft = 0; craft < Craft; craft += 2)
            {
                foreach (var field in Fields)
                {
                    fleet.Courier.Record("system", Topic(craft, field), "saved " + craft, 1 + craft * 0.25);
                }
            }
            fleet.Clock.AdvanceTo(10);
            for (var craft = 1; craft < Craft; craft += 2)
            {
                foreach (var field in Fields)
                {
                    fleet.Courier.Record("system", Topic(craft, field), "abandoned " + craft, 10);
                }
            }
            fleet.Delivered.Clear();
            fleet.Courier.ResetTimeline(resetUt);
            return fleet;
        }

        private static string Line(string vantage, StreamData data) =>
            Line(vantage, data.Topic, data.Payload, data.Meta.ValidAt, data.Meta.DeliveredAt);

        private static string Line(string vantage, string topic, object? payload, double validAt, double deliveredAt) =>
            vantage + " " + topic + " " + payload
            + " valid " + validAt.ToString("R", CultureInfo.InvariantCulture)
            + " delivered " + deliveredAt.ToString("R", CultureInfo.InvariantCulture);

        /// <summary>
        /// What each vantage is owed after a reset to UT 8: the reading every even
        /// craft made before the save, at once where it had arrived by then and
        /// otherwise when its five seconds are up.
        /// </summary>
        private static List<string> Owed()
        {
            var owed = new List<string>();
            for (var craft = 0; craft < Craft; craft += 2)
            {
                var validAt = 1 + craft * 0.25;
                foreach (var field in Fields)
                {
                    owed.Add(Line("KSC", Topic(craft, field), "saved " + craft, validAt, 8));
                    owed.Add(Line("far", Topic(craft, field), "saved " + craft, validAt, System.Math.Max(8, validAt + 5)));
                }
            }
            owed.Sort(string.CompareOrdinal);
            return owed;
        }

        private static List<string> Sorted(List<string> lines)
        {
            var sorted = new List<string>(lines);
            sorted.Sort(string.CompareOrdinal);
            return sorted;
        }

        [Theory]
        [InlineData(false)]
        [InlineData(true)]
        public void EveryVantageIsSentTheSameReadingsWhetherOrNotAnyoneListensForSkips(bool listening)
        {
            var fleet = Build(8);
            if (listening)
            {
                fleet.Courier.ReissueSkipped = _ => { };
            }

            fleet.Courier.ReissueRetainedAfterReset();
            fleet.Clock.AdvanceTo(20);

            Assert.Equal(Owed(), Sorted(fleet.Delivered));
        }

        [Fact]
        public void ARewindSaysOnceHowManyPairsItSentNothingTo()
        {
            var fleet = Build(8);
            var told = new List<Courier.ReissueSkips>();
            fleet.Courier.ReissueSkipped = told.Add;

            fleet.Courier.ReissueRetainedAfterReset();

            var skips = Assert.Single(told);
            // Nine odd craft from both centres, and the four even craft whose reading had not crossed to the far one.
            Assert.Equal(9 * Fields.Length * 2 + 4 * Fields.Length, skips.Pairs);
            Assert.Equal(13 * Fields.Length, skips.Topics);
            Assert.Equal(2, skips.Vantages);
            var reason = Assert.Single(skips.ByReason);
            Assert.Equal("no reading had reached that vantage by the reset", reason.Key);
            Assert.Equal(skips.Pairs, reason.Value);
            Assert.Equal(Courier.ReissueSkips.ExampleLimit, skips.Examples.Count);
            Assert.StartsWith("132 topic and vantage pairs across 78 topics and 2 vantages (132 no reading", skips.Describe());
        }

        [Fact]
        public void AResetThatDropsTheWholeHistorySaysNothingAboutPairsNobodyCouldHaveHeard()
        {
            var fleet = Build(double.NegativeInfinity);
            var told = new List<Courier.ReissueSkips>();
            fleet.Courier.ReissueSkipped = told.Add;

            fleet.Courier.ReissueRetainedAfterReset();
            fleet.Clock.AdvanceTo(20);

            Assert.Empty(told);
            Assert.Empty(fleet.Delivered);
        }
    }
}
