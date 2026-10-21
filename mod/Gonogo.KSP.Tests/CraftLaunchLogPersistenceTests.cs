using System.Linq;
using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>The save round-trip. ConfigNode is a plain data structure, so it runs headlessly against the reference DLL.</summary>
    public class CraftLaunchLogPersistenceTests
    {
        [Fact]
        public void EveryLaunchSurvivesTheRoundTrip()
        {
            var saved = new CraftLaunchLog();
            saved.RecordLaunch("VAB", "Wave v1.2", "LFV-2 Wave", 2400.125);
            saved.RecordLaunch("SPH", CraftLaunchLog.EditorLaunchFile, "Aeris 3A", 7000.5);

            var node = new ConfigNode();
            CraftLaunchLogPersistence.Save(saved, node);

            var restored = new CraftLaunchLog();
            CraftLaunchLogPersistence.Load(restored, node);

            Assert.Equal(2400.125, restored.Recorded("VAB", "Wave v1.2", "LFV-2 Wave"));
            Assert.Equal(7000.5, restored.Recorded("SPH", "Any File", "Aeris 3A"));
            Assert.Equal(2, restored.Entries.Count());
        }

        [Fact]
        public void ASaveFromBeforeTheBookExistedLeavesItEmpty()
        {
            var restored = new CraftLaunchLog();

            CraftLaunchLogPersistence.Load(restored, new ConfigNode());

            Assert.Empty(restored.Entries);
        }

        [Fact]
        public void ARowThatWillNotParseIsSkippedRatherThanThrowing()
        {
            var node = new ConfigNode();
            var root = node.AddNode("CRAFT_LAUNCHES");
            var bad = root.AddNode("LAUNCH");
            bad.AddValue("facility", "VAB");
            bad.AddValue("file", "Wave");
            bad.AddValue("ut", "not-a-number");
            var good = root.AddNode("LAUNCH");
            good.AddValue("facility", "VAB");
            good.AddValue("file", "Probe");
            good.AddValue("ut", "12");

            var restored = new CraftLaunchLog();
            CraftLaunchLogPersistence.Load(restored, node);

            var entry = Assert.Single(restored.Entries);
            Assert.Equal("Probe", entry.Name);
        }

        [Fact]
        public void LoadingMergesIntoABookThatAlreadyHoldsALaterLaunch()
        {
            var node = new ConfigNode();
            var entry = node.AddNode("CRAFT_LAUNCHES").AddNode("LAUNCH");
            entry.AddValue("facility", "VAB");
            entry.AddValue("file", "Wave");
            entry.AddValue("ut", "100");

            var book = new CraftLaunchLog();
            book.RecordLaunch("VAB", "Wave", "Wave", 900.0);
            CraftLaunchLogPersistence.Load(book, node);

            Assert.Equal(900.0, book.Recorded("VAB", "Wave", "Wave"));
        }
    }
}
