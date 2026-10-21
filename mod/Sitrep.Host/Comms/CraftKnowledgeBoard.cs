using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// What each command centre knows of where each craft is, as the
    /// <c>craftKnowledge</c> capability answers it: written by the courier after
    /// each look at the game, read from any thread under its own lock.
    /// </summary>
    public sealed class CraftKnowledgeBoard : ICraftKnowledge
    {
        private readonly struct Entry
        {
            public Entry(CraftFix fix, bool seen, bool lineOfSight, bool everInContact)
            {
                Fix = fix;
                Seen = seen;
                LineOfSight = lineOfSight;
                EverInContact = everInContact;
            }

            public CraftFix Fix { get; }

            /// <summary>In view now, and the centre's newest place for it is a sighting.</summary>
            public bool Seen { get; }

            public bool LineOfSight { get; }

            public bool EverInContact { get; }
        }

        private Dictionary<string, Dictionary<string, Entry>> _byCentre = new Dictionary<string, Dictionary<string, Entry>>(StringComparer.Ordinal);
        private readonly object _gate = new object();

        public string ProviderId => "gonogo-craft-knowledge";

        /// <summary>
        /// Courier thread: takes down what every one of <paramref name="centres"/>
        /// now knows of every craft it has heard or seen.
        /// </summary>
        /// <param name="sight">The line from each object to each centre that has one now, by node id then centre id, or null when nothing can be placed by sight.</param>
        public void Note(IEnumerable<string> centres, CentreHearing hearing, IReadOnlyDictionary<string, IReadOnlyDictionary<string, double>>? sight)
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
                    var lineOfSight = sight != null && sight.TryGetValue(known.Id, out var row) && row.ContainsKey(centre);
                    var seen = lineOfSight && hearing.PlaceAt(centre, known.Id)?.Source == RosterPlaceSource.Seen;
                    var everInContact = hearing.ContactAt(centre, known.Id)?.LastContactUt != null;
                    entries[known.Id.Substring(CraftStateRecorder.VesselPrefix.Length)] = new Entry(fix, seen, lineOfSight, everInContact);
                }
                byCentre[centre] = entries;
            }
            lock (_gate)
            {
                _byCentre = byCentre;
            }
        }

        public CraftKnowledgeReading KnowledgeAt(string centreId, string vesselId, double ut)
        {
            Entry entry;
            lock (_gate)
            {
                if (centreId == null || vesselId == null
                    || !_byCentre.TryGetValue(centreId, out var entries)
                    || !entries.TryGetValue(vesselId, out entry))
                {
                    return CraftKnowledgeReading.Unknown;
                }
            }
            var fix = entry.Fix;
            var uncertainty = fix.UncertaintyMAt(ut);
            if (fix.InContact)
            {
                return new CraftKnowledgeReading(CraftKnowledgeState.Heard, null, fix.LastKnownUt, uncertainty, entry.LineOfSight);
            }
            if (entry.Seen)
            {
                return new CraftKnowledgeReading(CraftKnowledgeState.Seen, null, fix.LastKnownUt, uncertainty, entry.LineOfSight);
            }
            if (Reckonable(fix.Known))
            {
                return new CraftKnowledgeReading(CraftKnowledgeState.Modelled, null, fix.LastKnownUt, uncertainty, entry.LineOfSight);
            }
            var grade = entry.EverInContact ? HeldGrade.LastBeforeBlackout : HeldGrade.Held;
            return new CraftKnowledgeReading(CraftKnowledgeState.Held, grade, fix.LastKnownUt, uncertainty, entry.LineOfSight);
        }

        /// <summary>A craft that was holding its course above every atmosphere, or standing on the ground, when last known: its place can be carried forward.</summary>
        private static bool Reckonable(CraftState known) =>
            known.Settled && (known.Surface != null || (known.Orbit != null && known.Capability?.AirspeedMs == null));
    }
}
