using System.Collections.Generic;
using System.Linq;
using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class CraftLaunchLogTests
    {
        [Fact]
        public void ALaunchFromAFileIsRecordedAgainstThatFile()
        {
            var log = new CraftLaunchLog();
            log.RecordLaunch("VAB", "Wave v2", "LFV-2 Wave", 2400.0);

            Assert.Equal(2400.0, log.Recorded("VAB", "Wave v2", "LFV-2 Wave"));
            // The same ship name in another file is another craft.
            Assert.Null(log.Recorded("VAB", "Wave v1", "LFV-2 Wave"));
        }

        [Fact]
        public void TheEditorsLaunchButtonCreditsEveryFileCarryingThatShipName()
        {
            var log = new CraftLaunchLog();
            log.RecordLaunch("VAB", CraftLaunchLog.EditorLaunchFile, "LFV-2 Wave", 3000.0);

            Assert.Equal(3000.0, log.Recorded("VAB", "Wave v1", "LFV-2 Wave"));
            Assert.Equal(3000.0, log.Recorded("VAB", "Wave v2", "LFV-2 Wave"));
            Assert.Null(log.Recorded("VAB", "Other", "Other Craft"));
        }

        [Fact]
        public void TheFacilityKeepsAVabAndAnSphFileOfOneNameApart()
        {
            var log = new CraftLaunchLog();
            log.RecordLaunch("SPH", "Probe", "Probe", 10.0);

            Assert.Equal(10.0, log.Recorded("SPH", "Probe", "Probe"));
            Assert.Null(log.Recorded("VAB", "Probe", "Probe"));
        }

        [Fact]
        public void OnlyTheLatestLaunchIsKept()
        {
            var log = new CraftLaunchLog();
            log.RecordLaunch("VAB", "Wave", "Wave", 500.0);
            log.RecordLaunch("VAB", "Wave", "Wave", 100.0);
            log.RecordLaunch("VAB", "Wave", "Wave", 900.0);

            Assert.Equal(900.0, log.Recorded("VAB", "Wave", "Wave"));
            Assert.Single(log.Entries);
        }

        [Fact]
        public void TheLaterOfAFileLaunchAndAnEditorLaunchWins()
        {
            var log = new CraftLaunchLog();
            log.RecordLaunch("VAB", "Wave", "Wave", 500.0);
            log.RecordLaunch("VAB", CraftLaunchLog.EditorLaunchFile, "Wave", 800.0);

            Assert.Equal(800.0, log.Recorded("VAB", "Wave", "Wave"));
        }

        [Fact]
        public void ANonFiniteTimeIsNotRecorded()
        {
            var log = new CraftLaunchLog();
            log.RecordLaunch("VAB", "Wave", "Wave", double.NaN);
            log.RecordLaunch("VAB", "Wave", "Wave", double.PositiveInfinity);

            Assert.Empty(log.Entries);
        }

        [Fact]
        public void RestoringEntriesRebuildsTheBook()
        {
            var source = new CraftLaunchLog();
            source.RecordLaunch("VAB", "Wave", "Wave", 5.0);
            source.RecordLaunch("SPH", CraftLaunchLog.EditorLaunchFile, "Aeris", 7.0);

            var restored = new CraftLaunchLog();
            foreach (var entry in source.Entries)
            {
                restored.Restore(entry);
            }

            Assert.Equal(5.0, restored.Recorded("VAB", "Wave", "Wave"));
            Assert.Equal(7.0, restored.Recorded("SPH", "Aeris File", "Aeris"));
        }

        [Fact]
        public void TheNewestVesselOfThatNameAnswersForACraftNeverRecorded()
        {
            var vessels = new List<KeyValuePair<string, double>>
            {
                new KeyValuePair<string, double>("LFV-2 Wave", 1000.0),
                new KeyValuePair<string, double>("LFV-2 Wave", 1900.0),
                new KeyValuePair<string, double>("Other", 5000.0),
            };

            Assert.Equal(1900.0, CraftLaunchLog.NewestVesselLaunch(vessels, "LFV-2 Wave"));
            Assert.Null(CraftLaunchLog.NewestVesselLaunch(vessels, "Never Flown"));
            Assert.Null(CraftLaunchLog.NewestVesselLaunch(Enumerable.Empty<KeyValuePair<string, double>>(), "LFV-2 Wave"));
        }

        [Fact]
        public void ALaunchOnATimelineThatAnotherLoadLeftBehindIsForgotten()
        {
            var log = new CraftLaunchLog();
            log.Adopt(new object());
            log.RecordLaunch("VAB", "Wave", "Wave", 500.0);

            // A quickload or an older save of the same folder is a different game.
            log.Adopt(new object());
            log.Restore(new CraftLaunchLog.LaunchEntry("VAB", "Wave", true, 100.0));

            Assert.Equal(100.0, log.Recorded("VAB", "Wave", "Wave"));
        }

        [Fact]
        public void ALoadWhoseSaveHoldsNoLaunchLeavesNoneBehind()
        {
            var log = new CraftLaunchLog();
            log.Adopt(new object());
            log.RecordLaunch("VAB", "Wave", "Wave", 500.0);

            log.Adopt(new object());

            Assert.Null(log.Recorded("VAB", "Wave", "Wave"));
            Assert.Empty(log.Entries);
        }

        [Fact]
        public void ASceneChangeWithinOneGameKeepsTheLaunchesRecorded()
        {
            var log = new CraftLaunchLog();
            var game = new object();
            log.Adopt(game);
            log.RecordLaunch("VAB", "Wave", "Wave", 500.0);

            log.Adopt(game);
            log.Restore(new CraftLaunchLog.LaunchEntry("VAB", "Wave", true, 400.0));

            Assert.Equal(500.0, log.Recorded("VAB", "Wave", "Wave"));
        }

        [Fact]
        public void AVesselStillOnItsPadHasNoLaunchTimeBecauseKspKeepsItAtTheClock()
        {
            Assert.Null(CraftLaunchLog.VesselLaunchTime(stillOnItsPad: true, launchTime: 89132.84));
            Assert.Equal(88954.58, CraftLaunchLog.VesselLaunchTime(stillOnItsPad: false, launchTime: 88954.58));
            Assert.Null(CraftLaunchLog.VesselLaunchTime(stillOnItsPad: false, launchTime: double.NaN));
        }
    }
}
