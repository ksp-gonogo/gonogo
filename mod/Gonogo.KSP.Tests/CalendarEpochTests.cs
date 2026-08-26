using System;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The epoch read that makes every <c>ut</c> field on the wire renderable
    /// as a real date, exercised against stand-in formatters rather than KSP's
    /// own: the point of carving the rule out of <c>KspHost</c> is that the
    /// shapes it has to cope with are ordinary CLR types.
    ///
    /// <para>The shapes are RP-1's, member for member, because
    /// <c>RP0DTUtils.TryGetEpoch</c> is the only prior art for reading this
    /// and a formatter author who satisfied it should satisfy us.</para>
    /// </summary>
    public class CalendarEpochTests
    {
        /// <summary>Stock's shape: durations, no anchor.</summary>
        private sealed class StockishFormatter
        {
            public int Minute = 60;
            public int Hour = 3600;
            public int Day = 21_600;
            public int Year = 9_201_600;
        }

        /// <summary>RSSTimeFormatter's shape: the anchor, named <c>epoch</c>.</summary>
        private sealed class RealCalendarFormatter
        {
            private readonly DateTime epoch = new DateTime(1951, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            public int Day = 86_400;

            public DateTime Declared => epoch;
        }

        private sealed class UnnamedSingleAnchorFormatter
        {
            private readonly DateTime _start = new DateTime(1957, 3, 14, 6, 7, 8, DateTimeKind.Unspecified);

            public DateTime Declared => _start;
        }

        private sealed class TwoAnchorFormatter
        {
            private readonly DateTime _start = new DateTime(1951, 1, 1);
            private readonly DateTime _end = new DateTime(1999, 1, 1);

            public DateTime First => _start;
            public DateTime Second => _end;
        }

        private sealed class LocalKindFormatter
        {
            private readonly DateTime epoch = new DateTime(1951, 1, 1, 0, 0, 0, DateTimeKind.Local);

            public DateTime Declared => epoch;
        }

        [Fact]
        public void StockFormatterHasNoEpoch()
        {
            Assert.Null(CalendarEpoch.Read(new StockishFormatter()));
        }

        [Fact]
        public void NoFormatterAtAllHasNoEpoch()
        {
            Assert.Null(CalendarEpoch.Read(null));
        }

        [Fact]
        public void ReadsTheFieldNamedEpoch()
        {
            Assert.Equal("1951-01-01T00:00:00Z", CalendarEpoch.Read(new RealCalendarFormatter()));
        }

        [Fact]
        public void ReadsALoneDateTimeFieldUnderAnyName()
        {
            Assert.Equal("1957-03-14T06:07:08Z", CalendarEpoch.Read(new UnnamedSingleAnchorFormatter()));
        }

        /// <summary>
        /// Two candidates and no name to choose by: refusing is the whole point.
        /// A guessed anchor renders every date on the board wrong while still
        /// looking like a date, which is worse than showing no date at all.
        /// </summary>
        [Fact]
        public void RefusesToGuessBetweenTwoDateTimeFields()
        {
            Assert.Null(CalendarEpoch.Read(new TwoAnchorFormatter()));
        }

        /// <summary>
        /// An epoch is the same instant on every operator's desk. A formatter
        /// that stamped its anchor Local must not reach the wire carrying the
        /// author's own offset.
        /// </summary>
        [Fact]
        public void StatesTheEpochInUtcWhateverKindTheFormatterUsed()
        {
            Assert.Equal("1951-01-01T00:00:00Z", CalendarEpoch.Read(new LocalKindFormatter()));
        }
    }
}
