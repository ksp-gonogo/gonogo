using System.Collections.Generic;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// A craft KSP cannot build makes it log "Could not locate root part" on
    /// every read, and the saved-ships scan reads every craft on every rescan.
    /// The memo is what lets the second scan of an unchanged file skip KSP.
    /// </summary>
    public class SavedShipParseMemoTests
    {
        private static readonly string[] Parts = { "mk1pod", "kxRadiator" };

        [Fact]
        public void AnUnchangedFileIsRecalledSoKspIsNotAskedAgain()
        {
            var memo = new SavedShipParseMemo();
            memo.Remember("Ships/VAB/a.craft", 10, new Dictionary<string, object?> { ["name"] = "A" }, Parts);

            var recalled = memo.Recall("Ships/VAB/a.craft", 10);

            Assert.NotNull(recalled);
            Assert.Equal("A", recalled!.Fields["name"]);
            Assert.Equal(Parts, recalled.PartNames);
        }

        [Fact]
        public void AFileWrittenSinceIsReadAgain()
        {
            var memo = new SavedShipParseMemo();
            memo.Remember("Ships/VAB/a.craft", 10, new Dictionary<string, object?>(), Parts);

            Assert.Null(memo.Recall("Ships/VAB/a.craft", 11));
        }

        [Fact]
        public void AFileNeverSeenIsNotRecalled()
        {
            Assert.Null(new SavedShipParseMemo().Recall("Ships/VAB/a.craft", 10));
        }

        [Fact]
        public void ACraftTheLatestScanDidNotSeeIsForgotten()
        {
            var memo = new SavedShipParseMemo();
            memo.Remember("Ships/VAB/a.craft", 10, new Dictionary<string, object?>(), Parts);
            memo.Remember("Ships/VAB/b.craft", 10, new Dictionary<string, object?>(), Parts);

            memo.Retain(new HashSet<string> { "Ships/VAB/b.craft" });

            Assert.Null(memo.Recall("Ships/VAB/a.craft", 10));
            Assert.NotNull(memo.Recall("Ships/VAB/b.craft", 10));
        }
    }
}
