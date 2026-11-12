using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Xunit;

namespace Sitrep.Core.Tests
{
    public class TimelineResetKeptThroughTests
    {
        private static EventMsg Reset(double? keptThroughUt) => new EventMsg
        {
            Topic = "vessel.flight",
            Name = "timeline-reset",
            Meta = new Meta(),
            KeptThroughUt = keptThroughUt,
        };

        [Fact]
        public void AResetThatKeptHistoryCarriesTheUtItKeptThrough()
        {
            var json = EnvelopeCodec.WriteEventMsg(Reset(1234.5));

            Assert.Contains("\"keptThroughUt\":1234.5", json);
            Assert.Equal(1234.5, EnvelopeCodec.ParseEventMsg(json).KeptThroughUt);
        }

        [Fact]
        public void AResetThatKeptNoHistoryLeavesTheFieldOut()
        {
            var json = EnvelopeCodec.WriteEventMsg(Reset(null));

            Assert.DoesNotContain("keptThroughUt", json);
            Assert.Null(EnvelopeCodec.ParseEventMsg(json).KeptThroughUt);
        }
    }
}
