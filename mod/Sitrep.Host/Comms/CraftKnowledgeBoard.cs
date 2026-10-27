using System;
using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// What each command centre knows of where each craft is, as the
    /// <c>craftKnowledge</c> capability answers it: written by the courier after
    /// each look at the game, read from any thread off the board last swapped in.
    /// </summary>
    public sealed class CraftKnowledgeBoard : IBulkCraftKnowledge
    {
        private readonly struct Entry
        {
            public Entry(CraftFix fix, bool sighted, double? sightedUt, List<SightSample> samples, bool everInContact)
            {
                Fix = fix;
                Sighted = sighted;
                SightedUt = sightedUt;
                Samples = samples;
                EverInContact = everInContact;
            }

            public CraftFix Fix { get; }

            /// <summary>The centre's newest place for the craft is a sighting that has reached it.</summary>
            public bool Sighted { get; }

            /// <summary>The instant that sighting was true at.</summary>
            public double? SightedUt { get; }

            public List<SightSample> Samples { get; }

            public bool EverInContact { get; }
        }

        /// <summary>
        /// Whether a ground line to the craft existed at <see cref="Ut"/>, and the
        /// instant the light of that moment reaches the centre.
        /// </summary>
        private readonly struct SightSample
        {
            public SightSample(double ut, bool inView, double arrivesUt, bool solved = false)
            {
                Ut = ut;
                InView = inView;
                ArrivesUt = arrivesUt;
                Solved = solved;
            }

            public double Ut { get; }

            public bool InView { get; }

            public double ArrivesUt { get; }

            /// <summary>The instant is where the line was solved to have changed, not the look that noticed it, so its light counts as arrived whenever it does.</summary>
            public bool Solved { get; }
        }

        private readonly Dictionary<(string Centre, string Id), List<SightSample>> _samples = new Dictionary<(string, string), List<SightSample>>();
        private readonly Dictionary<(string Centre, string Id), double> _lastDelay = new Dictionary<(string, string), double>();

        /*
         * Everything a reader needs from one look, built whole by the courier and
         * swapped in as one reference, so a reader on any other thread holds a
         * consistent board that nothing writes to again.
         */
        private sealed class Snapshot
        {
            public Snapshot(long version, double lookUt, Dictionary<string, Dictionary<string, Entry>> byCentre)
            {
                Version = version;
                LookUt = lookUt;
                ByCentre = byCentre;
            }

            public long Version { get; }

            public double LookUt { get; }

            public Dictionary<string, Dictionary<string, Entry>> ByCentre { get; }
        }

        private Snapshot _board = new Snapshot(0, double.NegativeInfinity, new Dictionary<string, Dictionary<string, Entry>>(StringComparer.Ordinal));

        public long Version => Volatile.Read(ref _board).Version;

        public string ProviderId => "gonogo-craft-knowledge";

        /// <summary>
        /// When a craft's line to a centre closed (<paramref name="closing"/>) or
        /// opened, strictly between two looks, or null when that cannot be told.
        /// </summary>
        /// <param name="objectId">The craft's node id.</param>
        /// <param name="centreId">The centre's id.</param>
        public delegate double? LineCrossing(string objectId, string centreId, double fromUt, double toUt, bool closing);

        /// <summary>
        /// Courier thread: takes down what every one of <paramref name="centres"/>
        /// now knows of every craft it has heard or seen.
        /// </summary>
        /// <param name="ut">Now, universal time: when the lines in <paramref name="sight"/> hold.</param>
        /// <param name="sight">The line from each object to each centre that has one now, by node id then centre id, or null when nothing can be placed by sight.</param>
        /// <param name="crossing">Where a line that changed since the previous look changed, or null to take the change at this look.</param>
        public void Note(IEnumerable<string> centres, CentreHearing hearing, double ut, IReadOnlyDictionary<string, IReadOnlyDictionary<string, double>>? sight, LineCrossing? crossing = null) =>
            Build(centres, hearing, (centre, id) => Sampled(centre, id, ut, sight, crossing), ut, false);

        /// <summary>
        /// Courier thread: takes down again what every one of <paramref name="centres"/>
        /// now knows from what has reached it, which moves between looks, keeping
        /// the lines of sight the last look took.
        /// </summary>
        public void Refresh(IEnumerable<string> centres, CentreHearing hearing) =>
            Build(centres, hearing, (centre, id) => _samples.TryGetValue((centre, id), out var kept) ? new List<SightSample>(kept) : new List<SightSample>(), null, true);

        private void Build(IEnumerable<string> centres, CentreHearing hearing, Func<string, string, List<SightSample>> samplesOf, double? lookUt, bool onlyIfChanged)
        {
            var byCentre = new Dictionary<string, Dictionary<string, Entry>>(StringComparer.Ordinal);
            foreach (var centre in centres)
            {
                var entries = new Dictionary<string, Entry>(StringComparer.Ordinal);
                foreach (var known in hearing.HeardAt(centre))
                {
                    if (!known.Id.StartsWith(CraftStateRecorder.VesselPrefix, StringComparison.Ordinal))
                    {
                        continue;
                    }
                    var fix = hearing.FixAt(centre, known.Id);
                    if (fix == null)
                    {
                        continue;
                    }
                    var place = hearing.PlaceAt(centre, known.Id);
                    var sighted = place?.Source == RosterPlaceSource.Seen;
                    var samples = samplesOf(centre, known.Id);
                    var everInContact = hearing.ContactAt(centre, known.Id)?.LastContactUt != null;
                    entries[known.Id.Substring(CraftStateRecorder.VesselPrefix.Length)] = new Entry(fix, sighted, sighted ? place!.Value.AsOfUt : (double?)null, samples, everInContact);
                }
                byCentre[centre] = entries;
            }
            var previous = _board;
            if (onlyIfChanged && SameKnowledge(previous.ByCentre, byCentre))
            {
                return;
            }
            Volatile.Write(ref _board, new Snapshot(previous.Version + 1, lookUt ?? previous.LookUt, byCentre));
        }

        private static bool SameKnowledge(Dictionary<string, Dictionary<string, Entry>> was, Dictionary<string, Dictionary<string, Entry>> now)
        {
            if (was.Count != now.Count)
            {
                return false;
            }
            foreach (var centre in now)
            {
                if (!was.TryGetValue(centre.Key, out var before) || before.Count != centre.Value.Count)
                {
                    return false;
                }
                foreach (var craft in centre.Value)
                {
                    if (!before.TryGetValue(craft.Key, out var a))
                    {
                        return false;
                    }
                    var b = craft.Value;
                    if (a.Fix.InContact != b.Fix.InContact || a.Fix.LastKnownUt != b.Fix.LastKnownUt || !ReferenceEquals(a.Fix.Known, b.Fix.Known)
                        || a.Sighted != b.Sighted || a.SightedUt != b.SightedUt || a.EverInContact != b.EverInContact)
                    {
                        return false;
                    }
                }
            }
            return true;
        }

        /*
         * A line of sight taken now is light that reaches the centre one delay
         * later, so each look is kept with the instant it arrives and a reader
         * asks only for the newest look that has. An instant out of view has no
         * measured delay: the last one measured stands in for it.
         *
         * Looks are spaced by wall time, so under warp a line can have changed
         * anywhere in the span since the previous one. The instant it changed
         * is taken from the crossing when it can be solved, and each look then
         * carries it, so the light of the change arrives one delay after the
         * change and not one delay after the look that noticed it.
         */
        private List<SightSample> Sampled(string centre, string id, double ut, IReadOnlyDictionary<string, IReadOnlyDictionary<string, double>>? sight, LineCrossing? crossing)
        {
            var key = (centre, id);
            if (!_samples.TryGetValue(key, out var samples))
            {
                samples = new List<SightSample>();
                _samples[key] = samples;
            }
            if (samples.Count > 0 && samples[samples.Count - 1].Ut > ut)
            {
                samples.Clear();
            }
            var inView = false;
            double delay;
            _lastDelay.TryGetValue(key, out delay);
            if (sight != null && sight.TryGetValue(id, out var row) && row.TryGetValue(centre, out var measured))
            {
                inView = true;
                delay = measured;
                _lastDelay[key] = measured;
            }
            if (crossing != null && samples.Count > 0 && samples[samples.Count - 1].InView != inView)
            {
                var previous = samples[samples.Count - 1];
                var changed = crossing(id, centre, previous.Ut, ut, !inView);
                if (changed is double at && at > previous.Ut && at < ut)
                {
                    samples.Add(new SightSample(at, inView, at + delay, true));
                }
            }
            samples.Add(new SightSample(ut, inView, ut + delay));
            // Looks that have already arrived are superseded by the newest one that has.
            var newestArrived = -1;
            for (var i = 0; i < samples.Count; i++)
            {
                if (samples[i].ArrivesUt <= ut)
                {
                    newestArrived = i;
                }
            }
            if (newestArrived > 0)
            {
                samples.RemoveRange(0, newestArrived);
            }
            return new List<SightSample>(samples);
        }

        /// <summary>Whether the newest light to have reached the centre by <paramref name="ut"/> shows the craft in view.</summary>
        private static bool InViewByLight(Entry entry, double ut, double lookUt)
        {
            SightSample? newest = null;
            foreach (var sample in entry.Samples)
            {
                if (sample.ArrivesUt <= (sample.Solved ? ut : Math.Min(ut, lookUt)) && (newest == null || sample.Ut > newest.Value.Ut))
                {
                    newest = sample;
                }
            }
            // The sighting the centre holds proves the craft was in view when it was taken.
            if (entry.SightedUt is double taken && (newest == null || taken >= newest.Value.Ut))
            {
                return true;
            }
            return newest?.InView ?? false;
        }

        public CraftKnowledgeReading KnowledgeAt(string centreId, string vesselId, double ut)
        {
            var board = Volatile.Read(ref _board);
            if (centreId == null || vesselId == null
                || !board.ByCentre.TryGetValue(centreId, out var entries)
                || !entries.TryGetValue(vesselId, out var entry))
            {
                return CraftKnowledgeReading.Unknown;
            }
            var sample = Sample(vesselId, entry, board.LookUt, ut);
            return new CraftKnowledgeReading(sample.State, sample.HeldGrade, sample.LastKnownUt, sample.UncertaintyM, sample.LineOfSight);
        }

        public int ReadCentre(string centreId, double ut, CraftKnowledgeSample[] buffer, out long version)
        {
            var board = Volatile.Read(ref _board);
            version = board.Version;
            if (centreId == null || !board.ByCentre.TryGetValue(centreId, out var entries))
            {
                return 0;
            }
            var filled = 0;
            foreach (var pair in entries)
            {
                if (filled < buffer.Length)
                {
                    buffer[filled] = Sample(pair.Key, pair.Value, board.LookUt, ut);
                }
                filled++;
            }
            return filled;
        }

        private static CraftKnowledgeSample Sample(string vesselId, Entry entry, double lookUt, double ut)
        {
            var fix = entry.Fix;
            var uncertainty = fix.UncertaintyMAt(ut);
            // No sample was taken after the last look, so light is not counted as arrived past it, except from a change the look solved the instant of.
            var lineOfSight = InViewByLight(entry, ut, lookUt);
            if (fix.InContact)
            {
                return new CraftKnowledgeSample(vesselId, CraftKnowledgeState.Heard, null, fix.LastKnownUt, uncertainty, lineOfSight);
            }
            if (entry.Sighted && lineOfSight)
            {
                return new CraftKnowledgeSample(vesselId, CraftKnowledgeState.Seen, null, fix.LastKnownUt, uncertainty, lineOfSight);
            }
            if (Reckonable(fix.Known))
            {
                return new CraftKnowledgeSample(vesselId, CraftKnowledgeState.Modelled, null, fix.LastKnownUt, uncertainty, lineOfSight);
            }
            var grade = entry.EverInContact ? HeldGrade.LastBeforeBlackout : HeldGrade.Held;
            return new CraftKnowledgeSample(vesselId, CraftKnowledgeState.Held, grade, fix.LastKnownUt, uncertainty, lineOfSight);
        }

        /// <summary>A craft that was holding its course above every atmosphere, or standing on the ground, when last known: its place can be carried forward.</summary>
        private static bool Reckonable(CraftState known) =>
            known.Settled && (known.Surface != null || (known.Orbit != null && known.Capability?.AirspeedMs == null));
    }
}
