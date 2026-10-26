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
            public SightSample(double ut, bool inView, double arrivesUt)
            {
                Ut = ut;
                InView = inView;
                ArrivesUt = arrivesUt;
            }

            public double Ut { get; }

            public bool InView { get; }

            public double ArrivesUt { get; }
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
        /// Courier thread: takes down what every one of <paramref name="centres"/>
        /// now knows of every craft it has heard or seen.
        /// </summary>
        /// <param name="ut">Now, universal time: when the lines in <paramref name="sight"/> hold.</param>
        /// <param name="sight">The line from each object to each centre that has one now, by node id then centre id, or null when nothing can be placed by sight.</param>
        public void Note(IEnumerable<string> centres, CentreHearing hearing, double ut, IReadOnlyDictionary<string, IReadOnlyDictionary<string, double>>? sight)
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
                    var samples = Sampled(centre, known.Id, ut, sight);
                    var everInContact = hearing.ContactAt(centre, known.Id)?.LastContactUt != null;
                    entries[known.Id.Substring(CraftStateRecorder.VesselPrefix.Length)] = new Entry(fix, sighted, sighted ? place!.Value.AsOfUt : (double?)null, samples, everInContact);
                }
                byCentre[centre] = entries;
            }
            var previous = _board;
            Volatile.Write(ref _board, new Snapshot(previous.Version + 1, ut, byCentre));
        }

        /*
         * A line of sight taken now is light that reaches the centre one delay
         * later, so each look is kept with the instant it arrives and a reader
         * asks only for the newest look that has. An instant out of view has no
         * measured delay: the last one measured stands in for it.
         */
        private List<SightSample> Sampled(string centre, string id, double ut, IReadOnlyDictionary<string, IReadOnlyDictionary<string, double>>? sight)
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
        private static bool InViewByLight(Entry entry, double ut)
        {
            SightSample? newest = null;
            foreach (var sample in entry.Samples)
            {
                if (sample.ArrivesUt <= ut && (newest == null || sample.Ut > newest.Value.Ut))
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
            // No sample was taken after the last look, so light is not counted as arrived past it.
            var lineOfSight = InViewByLight(entry, Math.Min(ut, lookUt));
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
