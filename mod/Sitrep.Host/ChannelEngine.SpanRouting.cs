using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Core.StoreAndForward;

namespace Sitrep.Host
{
    /// <summary>
    /// Telemetry a craft took while it had no path to a command centre, carried to
    /// each centre as spans: a craft hands its recording to the next node by the
    /// plan, a relay holds it until its own link onward is up, and the centre
    /// receives it when it lands. Courier-thread state throughout.
    /// </summary>
    public sealed partial class ChannelEngine
    {
        /// <summary>
        /// How old, in game seconds, the oldest sample of a craft's recording may
        /// be before the recording is handed to the network as spans. A span is a
        /// message with a route, so handing over every sample as it is taken would
        /// make a message per sample per topic; waiting this long makes it one per
        /// topic per craft per centre.
        /// </summary>
        internal const double SpanBatchSeconds = 10.0;

        /// <summary>
        /// The same wait while the craft has a link to something: a window may
        /// close before a longer wait is over, and what was not handed on by then
        /// stays aboard until the next one.
        /// </summary>
        internal const double SpanLinkedBatchSeconds = 2.0;

        /// <summary>How many samples a craft may hold before they are handed over whatever their age.</summary>
        internal const int SpanBatchSamples = 256;

        // Samples a span delivered to a command centre that have not yet gone to its screens, by
        // (centre, topic), oldest first. Waiting here is only the release's pacing.
        private readonly Dictionary<(string Centre, string Topic), Recording> _inbound =
            new Dictionary<(string Centre, string Topic), Recording>();

        // Heap held by payloads that spans carry or an inbound run waits with, each once
        // however many centres it is going to.
        private long _payloadBytes;

        // The newest instant of each (centre, topic) a span delivered to that centre, the left edge of a hole the next lump states.
        private readonly Dictionary<(string Centre, string Topic), double> _lastDeliveredUt =
            new Dictionary<(string Centre, string Topic), double>();

        // (centre, topic) pairs whose next delivered sample must state a hole before it.
        private readonly HashSet<(string Centre, string Topic)> _holeAhead = new HashSet<(string, string)>();

        private double _spanLogAtSec = double.NaN;

        /// <summary>Whether a craft's recording is routed by the plan, which needs a plan for the centres to route by.</summary>
        private bool SpanRoutingOn => _delivery != null && SenderPlans.Reckons;

        /// <summary>Everything held for a link: still aboard a craft, in a span at a node, and arrived but not yet released.</summary>
        private long HeldTotalBytes => _recordedBytes + _payloadBytes;

        /// <summary>The command centres a craft's history is carried to: home, and every centre with a screen open.</summary>
        private HashSet<string> SpanCentres()
        {
            var centres = new HashSet<string>(StringComparer.Ordinal);
            var home = HomeCentre();
            if (!string.IsNullOrEmpty(home))
            {
                centres.Add(home);
            }
            foreach (var id in _activeCentreIds)
            {
                centres.Add(id);
            }
            return centres;
        }

        /// <summary>
        /// Hand the recording of every dark craft that has waited long enough to
        /// the network as spans, one per topic per centre. With
        /// <paramref name="only"/> set, that craft's whole recording goes, whatever
        /// its age: it has its link back.
        /// </summary>
        private void OffloadRecordings(double ut, string? only)
        {
            if (!SpanRoutingOn || _recordings.Count == 0)
            {
                return;
            }

            var byNode = new Dictionary<string, List<KeyValuePair<string, Recording>>>(StringComparer.Ordinal);
            foreach (var kv in _recordings)
            {
                if (kv.Value.Count == 0)
                {
                    continue;
                }
                var node = NodeFor(kv.Key);
                if (only != null && !string.Equals(node, only, StringComparison.Ordinal))
                {
                    continue;
                }
                if (!byNode.TryGetValue(node, out var list))
                {
                    list = new List<KeyValuePair<string, Recording>>();
                    byNode[node] = list;
                }
                list.Add(kv);
            }
            if (byNode.Count == 0)
            {
                return;
            }

            var centres = SpanCentres();
            if (centres.Count == 0)
            {
                return;
            }

            foreach (var entry in byNode)
            {
                var craft = CraftIdFor(entry.Key);
                if (craft == null)
                {
                    continue;
                }

                var oldestUt = double.PositiveInfinity;
                var held = 0;
                foreach (var run in entry.Value)
                {
                    oldestUt = Math.Min(oldestUt, run.Value.HeadUt);
                    held += run.Value.Count;
                }
                var wait = _deliveryInputs.Links.HasLink(craft) ? SpanLinkedBatchSeconds : SpanBatchSeconds;
                if (only == null && ut - oldestUt < wait && held < SpanBatchSamples)
                {
                    continue;
                }

                var offloaded = 0;
                var offloadedBytes = 0L;
                foreach (var run in entry.Value)
                {
                    var topic = run.Key;
                    var spans = new List<SpanMessage>();
                    foreach (var centre in centres)
                    {
                        spans.Add(new SpanMessage { Craft = craft, Centre = centre, Topic = topic });
                    }
                    if (_pendingGapSinceUt.Remove(topic))
                    {
                        foreach (var span in spans)
                        {
                            span.StartsAfterAHole = true;
                        }
                    }

                    while (run.Value.Count > 0)
                    {
                        var sample = run.Value.TakeHead();
                        _recordedBytes -= sample.Bytes;
                        _payloadBytes += sample.Bytes;
                        offloaded++;
                        offloadedBytes += sample.Bytes;
                        var payload = new SpanPayload { Held = sample, Bytes = sample.Bytes, ReleaseCost = sample.ReleaseCost, Carriers = spans.Count };
                        foreach (var span in spans)
                        {
                            span.Samples.Add(new SpanSample(sample.Ut, payload));
                        }
                    }
                    _recordings.Remove(topic);
                    foreach (var span in spans)
                    {
                        _delivery.AddSpan(craft, span);
                    }
                }
                NoteOffloaded(entry.Key, offloaded, offloadedBytes, centres.Count);
            }
        }

        private void NoteOffloaded(string node, int samples, long bytes, int centres)
        {
            var now = _nowRealSec();
            if (!double.IsNaN(_spanLogAtSec) && now - _spanLogAtSec < 60.0)
            {
                return;
            }
            _spanLogAtSec = now;
            LogHost(
                "recorder: " + node + " handed " + samples + " samples (" + FormatBytes(bytes) + ") to the network for "
                + centres + " centres; " + FormatBytes(HeldTotalBytes) + " of " + FormatBytes(_recorderBudgetBytes) + " held");
        }

        /// <summary>A span reached its command centre: its samples wait for the release to hand them to the centre's screens.</summary>
        private void OnSpanDelivered(SpanMessage span, double atUt)
        {
            var key = (span.Centre, span.Topic);
            if (!_inbound.TryGetValue(key, out var run))
            {
                run = new Recording();
                _inbound[key] = run;
            }
            if (span.StartsAfterAHole)
            {
                _holeAhead.Add(key);
            }
            foreach (var sample in span.Samples)
            {
                var held = (RecordedSample)sample.Payload.Held!;
                run.AddSorted(new RecordedSample(sample.Ut, held.Value, held.Packed, 0, sample.Payload.ReleaseCost, sample.Payload));
            }
            ContinueInbound(atUt);
        }

        /// <summary>
        /// Hand the screens of every command centre the next lump of what has
        /// reached it, oldest first across its topics, as far as the release's
        /// allowance reaches.
        /// </summary>
        private void ContinueInbound(double ut)
        {
            if (_inbound.Count == 0)
            {
                return;
            }
            RefillReleaseCredit();

            var runs = new List<KeyValuePair<(string Centre, string Topic), Recording>>();
            foreach (var kv in _inbound)
            {
                if (kv.Value.Count > 0)
                {
                    runs.Add(kv);
                }
            }
            var lumps = TakeOldestFirst(runs, sample => ReleasePayload(sample.Payload!));

            var released = 0;
            foreach (var kv in lumps)
            {
                var key = kv.Key;
                var lump = kv.Value;
                released += lump.Count;

                double? gap = null;
                var knownDelivered = _lastDeliveredUt.TryGetValue(key, out var delivered) ? delivered : double.NegativeInfinity;
                var edge = _lastRecordedUt.TryGetValue(key.Topic, out var live) ? Math.Max(live, knownDelivered) : knownDelivered;
                if (_holeAhead.Remove(key) && !double.IsNegativeInfinity(edge))
                {
                    gap = edge;
                }
                _lastDeliveredUt[key] = Math.Max(knownDelivered, lump[lump.Count - 1].ValidAt);

                _courier.ReplayRecordedTo(NodeFor(key.Topic), key.Topic, key.Centre, lump, ut, gap);
            }
            if (released > 0)
            {
                _blackoutReplayBudget?.Record(released, ut);
            }
            foreach (var kv in runs)
            {
                if (kv.Value.Count == 0)
                {
                    _inbound.Remove(kv.Key);
                }
            }
        }

        /// <summary>
        /// Take samples from the runs, oldest first across all of them, until the
        /// release's allowance is spent, and return them grouped by run in the
        /// order taken. A sample is always taken while any allowance remains, so
        /// one bigger than the allowance still goes. Each run is oldest first.
        /// </summary>
        private Dictionary<TKey, List<ArchiveSample>> TakeOldestFirst<TKey>(
            IList<KeyValuePair<TKey, Recording>> runs, Action<RecordedSample> onTaken)
            where TKey : notnull
        {
            var lumps = new Dictionary<TKey, List<ArchiveSample>>();
            var epoch = _courier.CurrentEpoch;
            while (_releaseBytesCredit > 0 && _releaseSamplesCredit > 0)
            {
                var next = -1;
                var nextUt = double.PositiveInfinity;
                var runnerUpUt = double.PositiveInfinity;
                for (var i = 0; i < runs.Count; i++)
                {
                    if (runs[i].Value.Count == 0)
                    {
                        continue;
                    }
                    var headUt = runs[i].Value.HeadUt;
                    if (headUt < nextUt)
                    {
                        runnerUpUt = nextUt;
                        nextUt = headUt;
                        next = i;
                        continue;
                    }
                    runnerUpUt = Math.Min(runnerUpUt, headUt);
                }
                if (next < 0)
                {
                    break;
                }

                var key = runs[next].Key;
                var run = runs[next].Value;
                if (!lumps.TryGetValue(key, out var lump))
                {
                    lump = new List<ArchiveSample>();
                    lumps[key] = lump;
                }
                do
                {
                    var sample = run.TakeHead();
                    _recordedBytes -= sample.Bytes;
                    _releaseBytesCredit -= sample.ReleaseCost;
                    _releaseSamplesCredit -= 1;
                    onTaken(sample);
                    lump.Add(new ArchiveSample(sample.Packed != null ? _heldSampleCodec.Unpack(sample.Packed) : sample.Value, sample.Ut, epoch));
                }
                while (run.Count > 0 && run.HeadUt <= runnerUpUt && _releaseBytesCredit > 0 && _releaseSamplesCredit > 0);
            }
            return lumps;
        }

        /// <summary>A carrier of <paramref name="payload"/> has let go of it; the last to do so frees what it held.</summary>
        private void ReleasePayload(SpanPayload payload)
        {
            payload.Carriers--;
            if (payload.Carriers <= 0)
            {
                _payloadBytes -= payload.Bytes;
            }
        }

        /// <summary>Drop the oldest sample of the spans held at nodes, freeing its payload when the last span carrying it lets go, and say what went.</summary>
        private (string Craft, string Topic, double Ut, long Bytes)? ShedOldestSpanSample()
        {
            var shed = _delivery.ShedSpans(1);
            if (shed.Count == 0)
            {
                return null;
            }
            long freed = 0;
            foreach (var sample in shed)
            {
                _holeAhead.Add((sample.Centre, sample.Topic));
                if (sample.Payload.Carriers <= 0)
                {
                    _payloadBytes -= sample.Payload.Bytes;
                    freed += sample.Payload.Bytes;
                }
            }
            var first = shed[0];
            return (first.Craft, first.Topic, first.Ut, freed);
        }

        /// <summary>A craft that no longer exists takes the history it held with it: its spans go, and what it had already handed on stays where it is.</summary>
        private void DiscardSpansOf(string node)
        {
            var craft = CraftIdFor(node);
            if (craft == null || _delivery == null)
            {
                return;
            }
            foreach (var payload in _delivery.DiscardSpansHeldAt(craft))
            {
                if (payload.Carriers <= 0)
                {
                    _payloadBytes -= payload.Bytes;
                }
            }
        }

        private void ResetSpanState()
        {
            _inbound.Clear();
            _holeAhead.Clear();
            _lastDeliveredUt.Clear();
            _payloadBytes = 0;
        }
    }
}
