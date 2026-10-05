using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests.Comms
{
    /// <summary>
    /// Stock CommNet's strength, as the backend states it for a command
    /// centre's believed path: a link by its range curve, a path by the product
    /// of its links.
    /// </summary>
    public class CommNetStrengthTests
    {
        [Fact]
        public void ALinkHalfWayToTheEdgeOfItsRangeIsAtHalfStrength()
        {
            Assert.Equal(0.5, CommNetStrength.For(2_000_000.0)!.FactsAt(0.0, 1_000_000.0).Strength, 9);
        }

        [Fact]
        public void APairWithNoStatedReachStatesNoStrength()
        {
            Assert.Null(CommNetStrength.For(null));
            Assert.Null(CommNetStrength.For(double.NaN));
        }

        [Fact]
        public void APairThatReachesNothingIsAtNoStrength()
        {
            Assert.Equal(0.0, CommNetStrength.For(0.0)!.FactsAt(0.0, 10.0).Strength);
        }

        [Fact]
        public void APathIsWorthItsLinksMultipliedTogether()
        {
            Assert.Equal(0.9 * 0.5, CommNetStrength.Product(new[] { 0.9, 0.5 }), 9);
            Assert.Equal(1.0, CommNetStrength.Product(new double[0]));
        }
    }
}
