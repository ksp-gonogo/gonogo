using System.Collections.Generic;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>A procedural fairing's saved sections become the ring list a part row carries, with the nose tip the game adds.</summary>
    public class FairingRingsTests
    {
        private static KeyValuePair<double, double> Section(double h, double r) => new KeyValuePair<double, double>(h, r);

        /* The stock ComSat Lx's AE-FF1 sections, as its craft file saves them, with fairingSize1.cfg's capRadius 0.2 and noseTip 0.7. */
        private static readonly KeyValuePair<double, double>[] ComSat =
        {
            Section(0, 0.625),
            Section(1.1307373, 0.519284248),
            Section(1.86900806, 0.200000003),
        };

        [Fact]
        public void AShellClosedAtCapRadiusEndsInTheGamesNoseTip()
        {
            var rings = FairingRings.Of(ComSat, 0.2f, 0.7f);

            // 1.869 + 0.2 * (0.73827 / 0.31928) * 0.7
            Assert.Equal(new[] { 0.0, 0.625, 1.1307, 0.5193, 1.869, 0.2, 2.1927, 0.0 }, rings);
        }

        [Fact]
        public void AShellOpenAtTheTopGetsNoNoseTip()
        {
            var rings = FairingRings.Of(new[] { Section(0, 0.625), Section(1.2, 0.625) }, 0.2f, 0.7f);

            Assert.Equal(new[] { 0.0, 0.625, 1.2, 0.625 }, rings);
        }

        [Fact]
        public void SectionsAreSortedByHeightAsTheModuleSortsThem()
        {
            var rings = FairingRings.Of(new[] { ComSat[2], ComSat[0], ComSat[1] }, 0.2f, 0.7f);

            Assert.Equal(FairingRings.Of(ComSat, 0.2f, 0.7f), rings);
        }

        [Fact]
        public void NoSectionsIsNoShell()
        {
            Assert.Empty(FairingRings.Of(new KeyValuePair<double, double>[0], 0.2f, 0.7f));
        }

        [Fact]
        public void ASingleSectionHasNoNoseTip()
        {
            Assert.Equal(new[] { 0.0, 0.2 }, FairingRings.Of(new[] { Section(0, 0.2) }, 0.2f, 0.7f));
        }

        [Fact]
        public void AFlatTopPanelLeavesTheNoseTipOutRatherThanAtInfinity()
        {
            var rings = FairingRings.Of(new[] { Section(0, 0.2), Section(1, 0.2) }, 0.2f, 0.7f);

            Assert.Equal(new[] { 0.0, 0.2, 1.0, 0.2 }, rings);
        }

        [Fact]
        public void ASavedSectionParsesInTheInvariantCulture()
        {
            Assert.Equal(Section(1.1307373, 0.519284248), FairingRings.Parse("1.1307373", "0.519284248"));
            Assert.Null(FairingRings.Parse("1,13", "0.5"));
            Assert.Null(FairingRings.Parse(null, "0.5"));
            Assert.Null(FairingRings.Parse("NaN", "0.5"));
        }
    }
}
