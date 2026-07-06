using System.Collections.Generic;
using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// C#-side tests for <see cref="Archive.Snapshot"/> / <see cref="Archive.Restore"/>
    /// — a capability with NO TS reference (added for M5b quicksave, so a
    /// delayed archive survives save/load). Unlike
    /// <see cref="ArchiveGoldenFixtureTests"/>, there is no golden fixture
    /// here: these tests build an <see cref="Archive"/> directly, drive it
    /// through reads that advance (and, in one case, FREEZE) its cursors, then
    /// prove an OBJECT-LEVEL round trip (<see cref="Archive.Snapshot"/> straight
    /// into <see cref="Archive.Restore"/>, no serialization involved — that's
    /// deliberately out of scope for <c>Sitrep.Core</c>, deferred to M5b)
    /// reproduces identical subsequent <c>ReadAtVantage</c> results —
    /// including the frozen cursor position, not merely the recorded samples.
    /// </summary>
    public class ArchiveSnapshotRestoreTests
    {
        [Fact]
        public void RestoredArchiveReproducesIdenticalReads_IncludingFrozenCursor()
        {
            var archive = new Archive();
            archive.Record("v.altitude", 100.0, 0);
            archive.Record("v.altitude", 200.0, 1);
            archive.Record("v.altitude", 300.0, 2);
            archive.Record("v.altitude", 400.0, 3);
            // A second topic that is recorded but never read through a vantage,
            // to prove pure samples (with no cursor entry at all) also survive.
            archive.Record("v.speed", "cruise", 0);

            // v1: now=5, delay=2 -> scene=3 -> validAt-3 sample.
            var v1First = archive.ReadAtVantage("v.altitude", "v1", 2, 5);
            Assert.Equal(400.0, v1First!.Value.Value);
            Assert.Equal(3.0, v1First.Value.ValidAt);

            // v1: now=6, delay=4 -> raw scene=2, BEHIND the previous scene of 3.
            // Freeze-on-recession: the cursor holds at 3, so this still reads
            // the validAt-3 sample.
            var v1Frozen = archive.ReadAtVantage("v.altitude", "v1", 4, 6);
            Assert.Equal(400.0, v1Frozen!.Value.Value);
            Assert.Equal(3.0, v1Frozen.Value.ValidAt);

            // v2: independent cursor on the same topic, at scene=0.
            var v2First = archive.ReadAtVantage("v.altitude", "v2", 5, 5);
            Assert.Equal(100.0, v2First!.Value.Value);
            Assert.Equal(0.0, v2First.Value.ValidAt);

            // Snapshot at this point (v1's cursor is FROZEN at scene 3; v2's at scene 0)
            // and restore straight from the POCO — an object-level round trip,
            // with no serialization involved (that's an M5b concern, deferred
            // out of Sitrep.Core; see ArchiveState).
            var snapshot = archive.Snapshot();
            var restored = Archive.Restore(snapshot);

            // Samples survive verbatim, for both the read-through topic and the
            // never-read one.
            AssertSamplesEqual(archive.Samples("v.altitude"), restored.Samples("v.altitude"));
            AssertSamplesEqual(archive.Samples("v.speed"), restored.Samples("v.speed"));

            // The critical proof: a subsequent read on the RESTORED archive whose
            // raw scene (nowUt - delaySeconds) would rewind far behind the frozen
            // scene must still return the frozen sample — identical to what the
            // ORIGINAL archive (continued, never snapshotted/restored) produces
            // for the exact same call. If Restore had reset cursors instead of
            // preserving them, this call's raw scene (0 - 100 = -100) would be
            // before the first sample and return null instead.
            var continuedOriginalV1 = archive.ReadAtVantage("v.altitude", "v1", 100, 0);
            var continuedRestoredV1 = restored.ReadAtVantage("v.altitude", "v1", 100, 0);
            Assert.Equal(continuedOriginalV1!.Value.Value, continuedRestoredV1!.Value.Value);
            Assert.Equal(continuedOriginalV1.Value.ValidAt, continuedRestoredV1.Value.ValidAt);
            Assert.Equal(400.0, continuedRestoredV1.Value.Value);
            Assert.Equal(3.0, continuedRestoredV1.Value.ValidAt);

            // Same proof for v2's (unfrozen, but still non-trivial) cursor: raw
            // scene 0 - 1000 = -1000 is also before the first sample, so this
            // only returns the validAt-0 sample because the restored cursor
            // clamps it to the preserved scene of 0.
            var continuedOriginalV2 = archive.ReadAtVantage("v.altitude", "v2", 1000, 0);
            var continuedRestoredV2 = restored.ReadAtVantage("v.altitude", "v2", 1000, 0);
            Assert.Equal(continuedOriginalV2!.Value.Value, continuedRestoredV2!.Value.Value);
            Assert.Equal(continuedOriginalV2.Value.ValidAt, continuedRestoredV2.Value.ValidAt);
            Assert.Equal(100.0, continuedRestoredV2.Value.Value);
            Assert.Equal(0.0, continuedRestoredV2.Value.ValidAt);

            // Negative control: an otherwise-identical archive that was NEVER
            // read through (so it has no cursor at all) returns null for the
            // same "rewind" call — proving the restored archive's non-null
            // result above really does come from the preserved cursor, not
            // from the samples alone.
            var withoutCursor = new Archive();
            withoutCursor.Record("v.altitude", 100.0, 0);
            withoutCursor.Record("v.altitude", 200.0, 1);
            withoutCursor.Record("v.altitude", 300.0, 2);
            withoutCursor.Record("v.altitude", 400.0, 3);
            Assert.Null(withoutCursor.ReadAtVantage("v.altitude", "v1", 100, 0));
        }

        [Fact]
        public void SnapshotCapturesCursorForATopicWithNoRecordedSamples()
        {
            // ReadAtVantage sets a cursor unconditionally, before checking
            // whether the topic has any samples at all — so a topic that was
            // only ever read (never recorded) still has cursor state worth
            // preserving across a save/load.
            var archive = new Archive();
            var result = archive.ReadAtVantage("never-recorded", "v1", 10, 50);
            Assert.Null(result);

            var snapshot = archive.Snapshot();
            var restored = Archive.Restore(snapshot);

            // The restored cursor (scene = 50 - 10 = 40) still clamps a
            // rewinding read, even though the topic has no samples on either
            // side of the round trip.
            var continuedOriginal = archive.ReadAtVantage("never-recorded", "v1", 1000, 0);
            var continuedRestored = restored.ReadAtVantage("never-recorded", "v1", 1000, 0);
            Assert.Null(continuedOriginal);
            Assert.Null(continuedRestored);
            Assert.Empty(restored.Samples("never-recorded"));
        }

        private static void AssertSamplesEqual(
            IReadOnlyList<ArchiveSample> expected,
            IReadOnlyList<ArchiveSample> actual)
        {
            Assert.Equal(expected.Count, actual.Count);
            for (var i = 0; i < expected.Count; i++)
            {
                Assert.Equal(expected[i].Value, actual[i].Value);
                Assert.Equal(expected[i].ValidAt, actual[i].ValidAt);
            }
        }
    }
}
