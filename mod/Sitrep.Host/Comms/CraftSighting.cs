using System;
using System.Collections.Generic;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// Where an object was seen to be at one instant: its orbit or its place,
    /// its situation and its body, with the name and kind it is tracked under.
    ///
    /// <para>An object is tracked by looking at it, radio or none, in contact
    /// or out. So a sighting crosses to each command centre in a straight
    /// line at light speed, through no relay, and reaches it after the
    /// distance between them and no sooner. It carries nothing a telescope
    /// could not tell: not crew, not a link, not resources, not whether the
    /// craft is a command centre. Those are the craft's to say by radio.</para>
    ///
    /// <para>A craft with a radio is therefore known in two ways, and its
    /// location is as fresh as the newer of the two: see
    /// <see cref="Known"/>.</para>
    /// </summary>
    public sealed class CraftSighting
    {
        /// <summary>The keys of a <c>system.vessels</c> entry that say where the craft is.</summary>
        public static readonly string[] LocationFacts = { "situation", "bodyIndex", "orbit" };

        /// <summary>The keys of a <c>system.vessels</c> entry it is tracked under.</summary>
        public static readonly string[] IdentityFacts = { "vesselId", "name", "vesselType" };

        private CraftSighting(string id, double capturedUt, bool exists, IReadOnlyDictionary<string, object?>? listed, CraftState? place)
        {
            Id = id;
            CapturedUt = capturedUt;
            Exists = exists;
            Listed = listed;
            Place = place;
        }

        /// <summary>The object's node id, <c>"vessel:&lt;guid&gt;"</c>.</summary>
        public string Id { get; }

        /// <summary>When it was seen.</summary>
        public double CapturedUt { get; }

        /// <summary>False for the last sighting of an object: that it is no longer there.</summary>
        public bool Exists { get; }

        /// <summary>The location and identity facts of the object's <c>system.vessels</c> entry as it was seen, or null when the game listed none.</summary>
        public IReadOnlyDictionary<string, object?>? Listed { get; }

        /// <summary>Where the craft is going, as a contact plan carries it, for a craft whose orbit was read with the sighting. Null for one that was only listed.</summary>
        public CraftState? Place { get; }

        /// <summary>An object seen at <paramref name="capturedUt"/>.</summary>
        /// <param name="listed">Its whole <c>system.vessels</c> entry, of which only what can be seen is kept.</param>
        /// <param name="place">Its state as read for a plan, of which only where it is going is kept.</param>
        public static CraftSighting Of(string id, double capturedUt, IReadOnlyDictionary<string, object?>? listed, CraftState? place = null) =>
            new CraftSighting(id, capturedUt, true, Seen(listed), place);

        /// <summary>The object is no longer there.</summary>
        public static CraftSighting Gone(string id, double capturedUt) => new CraftSighting(id, capturedUt, false, null, null);

        /// <summary>What of an entry a telescope can tell: where the object is, and what it is tracked as.</summary>
        private static IReadOnlyDictionary<string, object?>? Seen(IReadOnlyDictionary<string, object?>? listed)
        {
            if (listed == null)
            {
                return null;
            }
            var seen = new Dictionary<string, object?>(StringComparer.Ordinal);
            foreach (var key in IdentityFacts)
            {
                if (listed.TryGetValue(key, out var value))
                {
                    seen[key] = value;
                }
            }
            foreach (var key in LocationFacts)
            {
                if (listed.TryGetValue(key, out var value))
                {
                    seen[key] = value;
                }
            }
            return seen;
        }

        /// <summary>
        /// What a centre knows of a craft from the newest state it has heard
        /// and the newest sighting it has had, either of which may be missing.
        ///
        /// <para>Whichever is newer says where the craft is. Everything else
        /// is as it was last heard: a sighting never changes a craft's crew,
        /// its links or whether it is a command centre. A craft that has only
        /// ever been seen is known by where it is and what it is tracked as,
        /// and is left out of every contact plan, since nothing has said it
        /// has a radio.</para>
        /// </summary>
        public static CraftState? Known(CraftState? heard, CraftSighting? seen)
        {
            if (seen == null || (heard != null && heard.CapturedUt >= seen.CapturedUt))
            {
                return heard;
            }
            if (!seen.Exists)
            {
                return CraftState.Gone(seen.Id, seen.CapturedUt);
            }
            if (heard == null || !heard.Exists)
            {
                return seen.Listed == null ? null : CraftState.WithoutARadio(seen.Id, seen.CapturedUt, SeenOnly(seen.Listed));
            }
            return heard.SeenAt(seen.CapturedUt, seen.Place, Relisted(heard.Roster, seen.Listed));
        }

        /// <summary>An entry for an object that has only been seen: what was seen, and nothing said for the rest.</summary>
        private static IReadOnlyDictionary<string, object?> SeenOnly(IReadOnlyDictionary<string, object?> seen)
        {
            var entry = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["crewCount"] = null,
                ["crewCapacity"] = null,
                ["commsConnected"] = null,
                ["commsControlSource"] = null,
                ["orbit"] = null,
            };
            foreach (var fact in seen)
            {
                entry[fact.Key] = fact.Value;
            }
            return entry;
        }

        /// <summary>The entry as it was heard, with where the craft is as it was seen.</summary>
        private static IReadOnlyDictionary<string, object?>? Relisted(
            IReadOnlyDictionary<string, object?>? heard, IReadOnlyDictionary<string, object?>? seen)
        {
            if (heard == null || seen == null)
            {
                return heard;
            }
            var entry = new Dictionary<string, object?>(StringComparer.Ordinal);
            foreach (var fact in heard)
            {
                entry[fact.Key] = fact.Value;
            }
            foreach (var key in LocationFacts)
            {
                if (seen.TryGetValue(key, out var value))
                {
                    entry[key] = value;
                }
            }
            return entry;
        }

        /// <summary>Whether two sightings place the object in the same situation, round the same body, on the same orbit to within a part in a million.</summary>
        public static bool SamePlace(IReadOnlyDictionary<string, object?>? a, IReadOnlyDictionary<string, object?>? b)
        {
            if (a == null || b == null)
            {
                return a == null && b == null;
            }
            foreach (var key in IdentityFacts)
            {
                a.TryGetValue(key, out var x);
                b.TryGetValue(key, out var y);
                if (!Equals(x, y))
                {
                    return false;
                }
            }
            foreach (var key in LocationFacts)
            {
                a.TryGetValue(key, out var x);
                b.TryGetValue(key, out var y);
                if (!SameFact(x, y))
                {
                    return false;
                }
            }
            return true;
        }

        private static bool SameFact(object? a, object? b)
        {
            if (a is IReadOnlyDictionary<string, object?> bagA && b is IReadOnlyDictionary<string, object?> bagB)
            {
                if (bagA.Count != bagB.Count)
                {
                    return false;
                }
                foreach (var fact in bagA)
                {
                    if (!bagB.TryGetValue(fact.Key, out var other) || !SameFact(fact.Value, other))
                    {
                        return false;
                    }
                }
                return true;
            }
            if (a is double x && b is double y)
            {
                return x == y || Math.Abs(x - y) <= 1e-6 * Math.Max(Math.Abs(x), Math.Abs(y));
            }
            return Equals(a, b);
        }
    }
}
