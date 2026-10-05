using System;
using System.Collections.Generic;
using System.Text;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Propagation.Visibility;

namespace Sitrep.Host.Comms
{
    /// <summary>What one command centre has heard, for saving with the game.</summary>
    public sealed class HeardAtCentre
    {
        public HeardAtCentre(string centre, IReadOnlyList<CraftState> states, IReadOnlyDictionary<string, bool> links)
        {
            Centre = centre;
            States = states;
            Links = links;
        }

        public string Centre { get; }

        /// <summary>The newest state the centre has received of each craft, gone ones included.</summary>
        public IReadOnlyList<CraftState> States { get; }

        /// <summary>Whether each craft's radio answers, as the centre last heard, by node id.</summary>
        public IReadOnlyDictionary<string, bool> Links { get; }
    }

    /// <summary>
    /// What every command centre has heard of every craft at one instant. Saved
    /// with the game so that a load leaves each centre knowing exactly what it
    /// knew when the game was saved: no more, since what was still on its way
    /// then is on its way again from the load, and no less, or every centre
    /// would be blind to a craft for one light-time after every load.
    /// </summary>
    public sealed class HeardSnapshot
    {
        public HeardSnapshot(IReadOnlyList<HeardAtCentre> centres) => Centres = centres;

        public IReadOnlyList<HeardAtCentre> Centres { get; }
    }

    /// <summary>
    /// Writes a <see cref="HeardSnapshot"/> to one string for a save, and reads
    /// it back. JSON inside, base64 outside, as the delivery snapshot is.
    ///
    /// <para>A craft's link models are the comms backend's code and are not
    /// written. A state read back plans each of its pairs on geometry and the
    /// range that was heard, until the centre next hears from the craft and
    /// has the backend's model again.</para>
    /// </summary>
    public static class HeardSnapshotCodec
    {
        private const int FormatVersion = 1;

        /// <summary>The roster facts that are whole numbers, which a JSON number does not remember being.</summary>
        private static readonly HashSet<string> WholeNumbers = new HashSet<string>(StringComparer.Ordinal)
        {
            "vesselType", "situation", "bodyIndex", "crewCount", "crewCapacity", "commsControlSource",
        };

        public static string Encode(HeardSnapshot snapshot)
        {
            var centres = new List<object?>();
            foreach (var centre in snapshot.Centres)
            {
                var states = new List<object?>();
                foreach (var state in centre.States)
                {
                    states.Add(State(state));
                }
                var links = new Dictionary<string, object?>(StringComparer.Ordinal);
                foreach (var link in centre.Links)
                {
                    links[link.Key] = link.Value;
                }
                centres.Add(new Dictionary<string, object?> { ["centre"] = centre.Centre, ["states"] = states, ["links"] = links });
            }
            var root = new Dictionary<string, object?> { ["version"] = (double)FormatVersion, ["centres"] = centres };
            var sb = new StringBuilder();
            JsonWriter.AppendValue(sb, root);
            return Convert.ToBase64String(Encoding.UTF8.GetBytes(sb.ToString()));
        }

        /// <summary>The snapshot a save carried, or null when it carried none or one this build cannot read.</summary>
        public static HeardSnapshot? Decode(string? encoded)
        {
            if (string.IsNullOrEmpty(encoded))
            {
                return null;
            }
            try
            {
                var root = (Dictionary<string, object?>)JsonReader.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(encoded)))!;
                if (!(Get(root, "version") is double version) || (int)version != FormatVersion)
                {
                    return null;
                }
                var centres = new List<HeardAtCentre>();
                foreach (var item in List(root, "centres"))
                {
                    var centre = (Dictionary<string, object?>)item!;
                    var states = new List<CraftState>();
                    foreach (var state in List(centre, "states"))
                    {
                        states.Add(StateFrom((Dictionary<string, object?>)state!));
                    }
                    var links = new Dictionary<string, bool>(StringComparer.Ordinal);
                    if (Get(centre, "links") is Dictionary<string, object?> heardLinks)
                    {
                        foreach (var link in heardLinks)
                        {
                            if (link.Value is bool connected)
                            {
                                links[link.Key] = connected;
                            }
                        }
                    }
                    centres.Add(new HeardAtCentre((string)centre["centre"]!, states, links));
                }
                return new HeardSnapshot(centres);
            }
            catch (Exception)
            {
                // A save this build cannot read is a save that carried nothing: every centre starts from what it hears next.
                return null;
            }
        }

        private static Dictionary<string, object?> State(CraftState state)
        {
            var links = new Dictionary<string, object?>(StringComparer.Ordinal);
            foreach (var link in state.Links)
            {
                links[link.Key] = link.Value.MaxRangeMeters;
            }
            return new Dictionary<string, object?>
            {
                ["id"] = state.Id,
                ["capturedUt"] = state.CapturedUt,
                ["exists"] = state.Exists,
                ["bodyIndex"] = (double)state.BodyIndex,
                ["orbit"] = state.Orbit == null ? null : Orbit(state.Orbit.Value),
                ["surface"] = state.Surface == null ? null : Surface(state.Surface.Value),
                ["secular"] = state.Secular == null ? null : Secular(state.Secular.Value),
                ["validUntilUt"] = state.ValidUntilUt,
                ["plannable"] = state.Plannable,
                ["settled"] = state.Settled,
                ["name"] = state.Name,
                ["roster"] = state.Roster == null ? null : new Dictionary<string, object?>(Copy(state.Roster)),
                ["links"] = links,
            };
        }

        private static CraftState StateFrom(Dictionary<string, object?> map)
        {
            var id = (string)map["id"]!;
            var capturedUt = (double)map["capturedUt"]!;
            if (!(Get(map, "exists") is bool exists) || !exists)
            {
                return CraftState.Gone(id, capturedUt);
            }
            var links = new Dictionary<string, CraftLink>(StringComparer.Ordinal);
            if (Get(map, "links") is Dictionary<string, object?> heard)
            {
                foreach (var link in heard)
                {
                    links[link.Key] = new CraftLink(link.Value as double?, null);
                }
            }
            var roster = Get(map, "roster") is Dictionary<string, object?> listed ? Listed(listed) : null;
            var name = Get(map, "name") as string;
            var bodyIndex = (int)(double)map["bodyIndex"]!;
            var plannable = Get(map, "plannable") is bool p && p;
            var settled = !(Get(map, "settled") is bool s) || s;

            CraftState state;
            if (Get(map, "surface") is Dictionary<string, object?> surface)
            {
                state = CraftState.Landed(id, capturedUt, bodyIndex, SurfaceFrom(surface), links);
            }
            else if (Get(map, "orbit") is Dictionary<string, object?> orbit)
            {
                state = CraftState.Orbiting(
                    id,
                    capturedUt,
                    bodyIndex,
                    OrbitFrom(orbit),
                    Get(map, "secular") is Dictionary<string, object?> secular ? SecularFrom(secular) : (SecularOrbit?)null,
                    Get(map, "validUntilUt") as double?,
                    plannable,
                    links,
                    settled);
            }
            else
            {
                state = CraftState.WithoutARadio(id, capturedUt, roster);
            }
            return state.Named(name).Listed(roster);
        }

        private static IDictionary<string, object?> Copy(IReadOnlyDictionary<string, object?> roster)
        {
            var copy = new Dictionary<string, object?>(StringComparer.Ordinal);
            foreach (var fact in roster)
            {
                copy[fact.Key] = fact.Value is int whole ? (double)whole : fact.Value;
            }
            return copy;
        }

        private static IReadOnlyDictionary<string, object?> Listed(Dictionary<string, object?> saved)
        {
            var listed = new Dictionary<string, object?>(StringComparer.Ordinal);
            foreach (var fact in saved)
            {
                listed[fact.Key] = fact.Value is double number && WholeNumbers.Contains(fact.Key) ? (int)number : fact.Value;
            }
            return listed;
        }

        private static Dictionary<string, object?> Orbit(OrbitElements o) => new Dictionary<string, object?>
        {
            ["sma"] = o.Sma,
            ["ecc"] = o.Ecc,
            ["inc"] = o.Inc,
            ["lan"] = o.Lan,
            ["argPe"] = o.ArgPe,
            ["meanAnomalyAtEpoch"] = o.MeanAnomalyAtEpoch,
            ["epoch"] = o.Epoch,
            ["mu"] = o.Mu,
        };

        private static OrbitElements OrbitFrom(Dictionary<string, object?> o) => new OrbitElements(
            (double)o["sma"]!,
            (double)o["ecc"]!,
            (double)o["inc"]!,
            (double)o["lan"]!,
            (double)o["argPe"]!,
            (double)o["meanAnomalyAtEpoch"]!,
            (double)o["epoch"]!,
            (double)o["mu"]!);

        private static Dictionary<string, object?> Secular(SecularOrbit s) => new Dictionary<string, object?>
        {
            ["anchor"] = Orbit(s.Anchor),
            ["nodeRate"] = s.NodeRate,
            ["periapsisRate"] = s.PeriapsisRate,
            ["meanAnomalyRate"] = s.MeanAnomalyRate,
            ["validUntilUt"] = s.ValidUntilUt,
            ["basis"] = (double)(int)s.Basis,
        };

        private static SecularOrbit SecularFrom(Dictionary<string, object?> s) => new SecularOrbit(
            OrbitFrom((Dictionary<string, object?>)s["anchor"]!),
            (double)s["nodeRate"]!,
            (double)s["periapsisRate"]!,
            (double)s["meanAnomalyRate"]!,
            Get(s, "validUntilUt") as double?,
            (SecularBasis)(int)(double)s["basis"]!);

        private static Dictionary<string, object?> Surface(RotatingGroundStation station) => new Dictionary<string, object?>
        {
            ["x"] = station.NormalAtReference.X,
            ["y"] = station.NormalAtReference.Y,
            ["z"] = station.NormalAtReference.Z,
            ["referenceUt"] = station.ReferenceUt,
            ["rotationPeriodSeconds"] = station.RotationPeriodSeconds,
            ["distanceFromCentreMeters"] = station.DistanceFromCentreMeters,
        };

        private static RotatingGroundStation SurfaceFrom(Dictionary<string, object?> s) => new RotatingGroundStation(
            new Vector3d((double)s["x"]!, (double)s["y"]!, (double)s["z"]!),
            (double)s["referenceUt"]!,
            (double)s["rotationPeriodSeconds"]!,
            (double)s["distanceFromCentreMeters"]!,
            0.0);

        private static object? Get(Dictionary<string, object?> map, string key) => map.TryGetValue(key, out var value) ? value : null;

        private static List<object?> List(Dictionary<string, object?> map, string key) =>
            Get(map, key) as List<object?> ?? new List<object?>();
    }
}
