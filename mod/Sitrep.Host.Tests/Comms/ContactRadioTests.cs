using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>A craft's radio is read twice a second and said only when it says something a centre would read differently.</summary>
    public class ContactRadioTests
    {
        private static ContactRadio Radio(double strength, double? level, string band = "S", double rate = 1000.0, string to = "relay") => new ContactRadio(
            "vessel:a",
            true,
            strength,
            new CommsDegrade { ModelId = "m", ModelName = "M", Level = level },
            new[]
            {
                new RadioHop(
                    "a",
                    to,
                    true,
                    new Dictionary<string, object?> { ["ra"] = new Dictionary<string, object?> { ["band"] = band, ["rate"] = rate } }),
            });

        [Fact]
        public void AReadingThatDriftsByLessThanAHundredthSaysTheSame()
        {
            Assert.True(Radio(0.500, 0.2, rate: 1000.0).SaysTheSameAs(Radio(0.505, 0.204, rate: 1005.0)));
        }

        [Fact]
        public void AStrengthOrAGradingThatMovesIsSaidAgain()
        {
            Assert.False(Radio(0.50, 0.2).SaysTheSameAs(Radio(0.52, 0.2)));
            Assert.False(Radio(0.50, 0.2).SaysTheSameAs(Radio(0.50, 0.22)));
            Assert.False(Radio(0.50, 0.2).SaysTheSameAs(Radio(0.50, null)));
        }

        [Fact]
        public void AChangeOfPathOrOfAHopsFactsIsSaidAgain()
        {
            Assert.False(Radio(0.5, 0.2).SaysTheSameAs(Radio(0.5, 0.2, to: "other")));
            Assert.False(Radio(0.5, 0.2).SaysTheSameAs(Radio(0.5, 0.2, band: "X")));
            Assert.False(Radio(0.5, 0.2).SaysTheSameAs(Radio(0.5, 0.2, rate: 2000.0)));
        }

        [Fact]
        public void AChangeOfQuantityIsSaidAgainEvenWhereTheFigureIsTheSame()
        {
            var range = new ContactRadio("vessel:a", true, 0.5, new CommsDegrade { ModelId = "m" }, null, SignalQuantity.RangeFraction);
            var headroom = new ContactRadio("vessel:a", true, 0.5, new CommsDegrade { ModelId = "m" }, null, SignalQuantity.DataRateHeadroom);

            Assert.False(range.SaysTheSameAs(headroom));
        }

        [Fact]
        public void TheFirstReadingIsAlwaysSaid()
        {
            Assert.False(Radio(0.5, 0.2).SaysTheSameAs(null));
        }
    }
}
