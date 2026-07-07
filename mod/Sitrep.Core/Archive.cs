using System;
using System.Collections.Generic;

namespace Sitrep.Core
{
    /// <summary>
    /// One recorded, SCET-stamped sample: <c>value</c> valid as of
    /// <c>ValidAt</c> (UT seconds). Returned from <see cref="Archive.Samples"/>
    /// and <see cref="Archive.ReadAtVantage"/>.
    /// </summary>
    public readonly struct ArchiveSample
    {
        public object? Value { get; }
        public double ValidAt { get; }

        /// <summary>
        /// The timeline epoch this sample was recorded under (see
        /// <see cref="Meta.TimelineEpoch"/>) — carried on every stored point,
        /// not just the envelope, so a late subscriber's catch-up/in-flight
        /// replay of an already-archived sample stamps the epoch it was
        /// ACTUALLY recorded on, not whatever epoch happens to be current at
        /// delivery time. Defaults to 0 so every pre-existing 2-arg call
        /// site (golden-fixture conformance tests against the TS reference,
        /// which has no epoch concept) keeps compiling and behaving
        /// identically.
        /// </summary>
        public int Epoch { get; }

        public ArchiveSample(object? value, double validAt, int epoch = 0)
        {
            Value = value;
            ValidAt = validAt;
            Epoch = epoch;
        }
    }

    /// <summary>
    /// C# port of <c>mod/sitrep-server/src/archive.ts</c>'s READ behavior
    /// (<see cref="Record"/>, <see cref="ReadAtVantage"/>, <see cref="Samples"/>).
    /// Semantics MUST stay byte-for-byte identical to the TS reference —
    /// conformance is asserted by <c>Sitrep.Core.Tests</c> against the shared
    /// golden fixtures in <c>mod/golden-fixtures/archive.json</c>, not by
    /// re-deriving semantics here. If you touch the read path, regenerate the
    /// fixture from the TS side
    /// (`pnpm --filter @gonogo/sitrep-server gen:golden-fixtures`) and re-run
    /// `dotnet test` to confirm the two still agree.
    ///
    /// <see cref="Snapshot"/> / <see cref="Restore"/> are a C#-ONLY addition —
    /// the TS reference has no equivalent. They exist so the delayed archive
    /// (samples AND per-(topic, vantage) cursor positions) can survive a
    /// quicksave/quickload round trip (M5b); see
    /// <c>Sitrep.Core.Tests/ArchiveSnapshotRestoreTests.cs</c> for the
    /// round-trip proof, including that a frozen (receded) cursor position
    /// survives restore rather than resetting.
    ///
    /// Archive is the single per-vessel SCET-stamped history the Courier reads
    /// through. There is ONE archive per vessel (per topic within it); each
    /// Vantage (observer) is a monotonic read-cursor into that archive at its
    /// own delay offset. That split — one shared history, many independent
    /// cursors — is what makes delay honest (every vantage sees its own
    /// light-lagged scene of the same underlying truth) and what powers
    /// "freeze-on-recession": if a vantage's delay grows faster than time
    /// advances (the observer recedes), the cursor holds its last position
    /// rather than rewinding to an earlier sample.
    /// </summary>
    public sealed class Archive
    {
        private sealed class Sample
        {
            public object? Value;
            public double ValidAt;
            public int Epoch;
        }

        // topic -> samples, kept ascending by validAt.
        private readonly Dictionary<string, List<Sample>> _samplesByTopic =
            new Dictionary<string, List<Sample>>();

        // topic -> vantage -> last clamped sceneUt used for that cursor.
        private readonly Dictionary<string, Dictionary<string, double>> _cursors =
            new Dictionary<string, Dictionary<string, double>>();

        /// <summary>
        /// Ascending per-topic sample list (by ValidAt). Returns a fresh copy
        /// (not a reference to internal state), so callers can't mutate
        /// archive state through it. Empty list for a topic with no recorded
        /// samples.
        /// </summary>
        public IReadOnlyList<ArchiveSample> Samples(string topic)
        {
            if (!_samplesByTopic.TryGetValue(topic, out var list))
            {
                return Array.Empty<ArchiveSample>();
            }

            var copy = new ArchiveSample[list.Count];
            for (var i = 0; i < list.Count; i++)
            {
                copy[i] = new ArchiveSample(list[i].Value, list[i].ValidAt, list[i].Epoch);
            }
            return copy;
        }

        /// <summary>
        /// Record a SCET-stamped sample for <paramref name="topic"/>, valid as
        /// of <paramref name="validAtUt"/>, tagged with <paramref name="epoch"/>
        /// (<see cref="Meta.TimelineEpoch"/> — defaults to 0 for every
        /// pre-existing call site, i.e. the golden-fixture conformance tests
        /// that replay the TS reference, which has no epoch concept at all).
        /// </summary>
        public void Record(string topic, object? value, double validAtUt, int epoch = 0)
        {
            if (!_samplesByTopic.TryGetValue(topic, out var list))
            {
                list = new List<Sample>();
                _samplesByTopic[topic] = list;
            }

            var sample = new Sample { Value = value, ValidAt = validAtUt, Epoch = epoch };

            // Common case: appended in ascending order already.
            if (list.Count == 0 || validAtUt >= list[list.Count - 1].ValidAt)
            {
                list.Add(sample);
                return;
            }

            // Out-of-order record: insert to keep the list ascending by ValidAt.
            var insertAt = list.Count;
            while (insertAt > 0 && list[insertAt - 1].ValidAt > validAtUt)
            {
                insertAt--;
            }
            list.Insert(insertAt, sample);
        }

        /// <summary>
        /// Read <paramref name="topic"/> through <paramref name="vantage"/>'s
        /// cursor. sceneUt = nowUt - delaySeconds, clamped to be monotonic
        /// non-decreasing per (topic, vantage) so the scene never rewinds even
        /// if delaySeconds grows faster than nowUt advances
        /// (freeze-on-recession). Returns the latest sample with
        /// ValidAt &lt;= scene, or null if nothing has "arrived" yet at that
        /// vantage.
        /// </summary>
        public ArchiveSample? ReadAtVantage(string topic, string vantage, double delaySeconds, double nowUt)
        {
            var rawScene = nowUt - delaySeconds;

            if (!_cursors.TryGetValue(topic, out var byVantage))
            {
                byVantage = new Dictionary<string, double>();
                _cursors[topic] = byVantage;
            }

            var scene = byVantage.TryGetValue(vantage, out var lastScene)
                ? Math.Max(rawScene, lastScene)
                : rawScene;
            byVantage[vantage] = scene;

            if (!_samplesByTopic.TryGetValue(topic, out var list) || list.Count == 0)
            {
                return null;
            }

            Sample? found = null;
            foreach (var sample in list)
            {
                if (sample.ValidAt > scene)
                {
                    break;
                }
                found = sample;
            }

            return found == null ? (ArchiveSample?)null : new ArchiveSample(found.Value, found.ValidAt, found.Epoch);
        }

        /// <summary>
        /// C#-ONLY addition, for the timeline-reset (quickload/rewind) fix —
        /// see <see cref="Courier.ResetTimeline"/>'s call site, which invokes
        /// this for EVERY node's archive right before resetting the clock.
        ///
        /// Drops every sample recorded ahead of the new timeline
        /// (<c>ValidAt &gt; ut</c>), for EVERY topic, and clears every
        /// (topic, vantage) cursor outright. Both are necessary:
        ///
        /// <list type="bullet">
        /// <item><description>Without dropping future samples, a subscriber
        /// reading through <see cref="ReadAtVantage"/> after the reset can
        /// still find (and keep re-returning) the abandoned pre-reset
        /// timeline's LATEST sample — the "stale ghost data" defect: with
        /// zero delay, a vantage's cursor gets pinned to the old timeline's
        /// peak UT, and every read after a rewind to a lower UT clamps back
        /// up to that stale peak (<c>Math.Max(rawScene, lastScene)</c>) and
        /// finds the old high-ValidAt sample instead of anything freshly
        /// recorded on the new timeline.</description></item>
        /// <item><description>Dropping samples alone is not enough: the
        /// cursor clamp itself must also be cleared, because
        /// <see cref="ReadAtVantage"/>'s monotonic "never rewinds" guarantee
        /// is only a valid invariant WITHIN one timeline. A cursor value
        /// computed against the abandoned timeline (e.g. pinned to UT 100)
        /// would otherwise keep clamping every post-reset read at UT 20 back
        /// up to 100 even though no sample above 20 still exists after the
        /// prune above — silently freezing the vantage forever instead of
        /// merely serving stale data once.</description></item>
        /// </list>
        ///
        /// Deliberately archive-wide (every topic, every vantage) rather than
        /// scoped to one topic: a quickload abandons the WHOLE timeline, not
        /// one channel's slice of it, and <see cref="Courier.ResetTimeline"/>
        /// already resets its OWN unrelated state (pending commands, the
        /// clock) unconditionally for the same reason.
        /// </summary>
        public void ResetTimeline(double ut)
        {
            foreach (var list in _samplesByTopic.Values)
            {
                list.RemoveAll(s => s.ValidAt > ut);
            }

            _cursors.Clear();
        }

        /// <summary>
        /// C#-ONLY addition, for the M2 "archive-derived birth" rewind fix —
        /// see <c>Sitrep.Host.ChannelEngine</c>'s <c>_born</c> field and its
        /// rewind branch in <c>ProcessTick</c>. Whether <paramref name="topic"/>
        /// currently has ANY surviving sample at all (post-prune, i.e. call
        /// this AFTER <see cref="ResetTimeline"/> has already dropped
        /// everything ahead of the new timeline) — a real value OR a
        /// tombstone (null <c>Value</c>) both count.
        ///
        /// This is what lets <c>ChannelEngine</c> recompute its per-topic
        /// "has this channel ever emitted a sample" birth-guard directly
        /// from ground truth (the archive) rather than blanket-clearing it
        /// on every rewind: a topic whose surviving tail is a real value
        /// stays "born" so the NEXT null mapper result still flows into
        /// <c>Decide</c> and corrects the stale archived value with a
        /// tombstone; a topic whose surviving tail is ALREADY a tombstone
        /// ALSO stays "born" — otherwise a continuously-connected subscriber
        /// who was never actually delivered that tombstone (e.g. its
        /// delivery was still in flight and got dropped by the rewind, see
        /// <c>Sitrep.Core.Courier.ResetTimeline</c>) would never be told of
        /// the absence: no cadence/reset keyframe would ever re-announce it,
        /// contradicting the streaming-delay design's keyframe-re-emits-on-
        /// cadence rule. Only a topic with NO surviving sample at all (never
        /// recorded, or everything recorded got pruned by the rewind) is NOT
        /// born, so a null mapper result keeps being skipped rather than
        /// emitting a spurious tombstone for a subject that never had this
        /// data in the first place.
        /// </summary>
        public bool HasAnyTail(string topic)
        {
            return _samplesByTopic.TryGetValue(topic, out var list) && list.Count > 0;
        }

        /// <summary>
        /// Capture the FULL archive state — every topic's samples plus every
        /// (topic, vantage) cursor's clamped scene — as a plain <see cref="ArchiveState"/>
        /// POCO (BCL types only; no serialization happens here). Turning this
        /// into the ScenarioModule blob persisted across quicksave/quickload
        /// is an M5b concern (generated Contract serializers), deliberately
        /// out of scope for <c>Sitrep.Core</c>. Cursor entries are captured
        /// even for a topic with no recorded samples: <see cref="ReadAtVantage"/>
        /// sets a cursor unconditionally, before checking whether the topic
        /// has any samples, so an "arrived nothing yet" read still has cursor
        /// state worth preserving.
        /// </summary>
        public ArchiveState Snapshot()
        {
            var topics = new HashSet<string>(_samplesByTopic.Keys);
            topics.UnionWith(_cursors.Keys);

            var state = new ArchiveState();
            foreach (var topic in topics)
            {
                var topicState = new ArchiveTopicState { Topic = topic };

                if (_samplesByTopic.TryGetValue(topic, out var list))
                {
                    foreach (var sample in list)
                    {
                        topicState.Samples.Add(new ArchiveSampleState
                        {
                            Value = sample.Value,
                            ValidAt = sample.ValidAt,
                            Epoch = sample.Epoch,
                        });
                    }
                }

                if (_cursors.TryGetValue(topic, out var byVantage))
                {
                    foreach (var pair in byVantage)
                    {
                        topicState.Cursors.Add(new ArchiveCursorState
                        {
                            Vantage = pair.Key,
                            Scene = pair.Value,
                        });
                    }
                }

                state.Topics.Add(topicState);
            }

            return state;
        }

        /// <summary>
        /// Reconstruct an <see cref="Archive"/> from a previously-captured
        /// <see cref="Snapshot"/>, identical in both samples and cursor
        /// positions — including a frozen (receded) cursor, which is restored
        /// as-is rather than reset, so a subsequent <see cref="ReadAtVantage"/>
        /// call on the restored archive reproduces exactly what the original
        /// archive would have returned.
        /// </summary>
        public static Archive Restore(ArchiveState state)
        {
            var archive = new Archive();

            foreach (var topicState in state.Topics)
            {
                if (topicState.Samples.Count > 0)
                {
                    var list = new List<Sample>(topicState.Samples.Count);
                    foreach (var sampleState in topicState.Samples)
                    {
                        list.Add(new Sample { Value = sampleState.Value, ValidAt = sampleState.ValidAt, Epoch = sampleState.Epoch });
                    }
                    archive._samplesByTopic[topicState.Topic] = list;
                }

                if (topicState.Cursors.Count > 0)
                {
                    var byVantage = new Dictionary<string, double>(topicState.Cursors.Count);
                    foreach (var cursorState in topicState.Cursors)
                    {
                        byVantage[cursorState.Vantage] = cursorState.Scene;
                    }
                    archive._cursors[topicState.Topic] = byVantage;
                }
            }

            return archive;
        }
    }

    /// <summary>
    /// Plain BCL-only POCO snapshot of an <see cref="Archive"/>'s full state
    /// (all topics' samples + all (topic, vantage) cursor positions). See
    /// <see cref="Archive.Snapshot"/> / <see cref="Archive.Restore"/>.
    ///
    /// Deliberately NOT serialization-aware: <c>Sitrep.Core</c> has ZERO
    /// external dependencies (BCL-only, netstandard2.0), so this type carries
    /// no JSON attributes and no converter. Turning it into a persisted blob
    /// (e.g. for a quicksave/quickload ScenarioModule) is an M5b concern,
    /// done with the generated Contract serializers, outside this project.
    /// Because no serialization happens here, each sample's <c>object?</c>
    /// <see cref="ArchiveSampleState.Value"/> is copied as-is by
    /// <see cref="Archive.Snapshot"/> / <see cref="Archive.Restore"/>, so its
    /// original CLR type (double / string / bool / null) is preserved
    /// trivially.
    /// </summary>
    public sealed class ArchiveState
    {
        public List<ArchiveTopicState> Topics { get; set; } = new List<ArchiveTopicState>();
    }

    /// <summary>One topic's samples and cursor positions within an <see cref="ArchiveState"/>.</summary>
    public sealed class ArchiveTopicState
    {
        public string Topic { get; set; } = string.Empty;
        public List<ArchiveSampleState> Samples { get; set; } = new List<ArchiveSampleState>();
        public List<ArchiveCursorState> Cursors { get; set; } = new List<ArchiveCursorState>();
    }

    /// <summary>One recorded sample within an <see cref="ArchiveTopicState"/>.</summary>
    public sealed class ArchiveSampleState
    {
        public object? Value { get; set; }
        public double ValidAt { get; set; }
        public int Epoch { get; set; }
    }

    /// <summary>One vantage's clamped cursor scene within an <see cref="ArchiveTopicState"/>.</summary>
    public sealed class ArchiveCursorState
    {
        public string Vantage { get; set; } = string.Empty;
        public double Scene { get; set; }
    }
}
