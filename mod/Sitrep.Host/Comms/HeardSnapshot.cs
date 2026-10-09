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
        private static readonly IReadOnlyList<ContactRadio> NoRadios = new ContactRadio[0];

        public HeardAtCentre(
            string centre,
            IReadOnlyList<CraftState> states,
            IReadOnlyDictionary<string, bool> links,
            IReadOnlyList<ContactRadio>? radios = null,
            IReadOnlyList<CraftSighting>? sightings = null)
        {
            Centre = centre;
            States = states;
            Links = links;
            Radios = radios ?? NoRadios;
            Sightings = sightings ?? NoSightings;
        }

        private static readonly IReadOnlyList<CraftSighting> NoSightings = new CraftSighting[0];

        /// <summary>The newest sighting of each object to have reached the centre: where each was last seen to be.</summary>
        public IReadOnlyList<CraftSighting> Sightings { get; }

        public string Centre { get; }

        /// <summary>The newest state the centre has received of each craft, gone ones included.</summary>
        public IReadOnlyList<CraftState> States { get; }

        /// <summary>Whether each craft's radio answers, as the centre last heard, by node id.</summary>
        public IReadOnlyDictionary<string, bool> Links { get; }

        /// <summary>The newest reading of each craft's radio to have reached the centre: what its signal and grading are made from.</summary>
        public IReadOnlyList<ContactRadio> Radios { get; }
    }

    /// <summary>
    /// The values a snapshot's strength models have in common, written once. A
    /// model's description names the antennas of both its ends, and the same
    /// craft's antennas appear in every link it has, in every centre's copy of its
    /// state, so written out each time a save grows with craft times centres times
    /// links and with this it grows with craft.
    /// </summary>
    internal sealed class SharedValues
    {
        private const string Key = "$shared";

        private readonly Dictionary<string, int> _index = new Dictionary<string, int>(StringComparer.Ordinal);

        public List<object?> Values { get; } = new List<object?>();

        /// <summary>The description with each nested dictionary or list that stands as one of its entries replaced by a reference to the shared copy.</summary>
        public Dictionary<string, object?> Compact(Dictionary<string, object?> described)
        {
            var compact = new Dictionary<string, object?>(described.Count, StringComparer.Ordinal);
            foreach (var entry in described)
            {
                if (entry.Value is System.Collections.IDictionary || entry.Value is System.Collections.IList)
                {
                    var sb = new StringBuilder();
                    JsonWriter.AppendValue(sb, entry.Value);
                    var text = sb.ToString();
                    if (!_index.TryGetValue(text, out var at))
                    {
                        at = Values.Count;
                        _index[text] = at;
                        Values.Add(entry.Value);
                    }
                    compact[entry.Key] = new Dictionary<string, object?> { [Key] = (double)at };
                }
                else
                {
                    compact[entry.Key] = entry.Value;
                }
            }
            return compact;
        }

        /// <summary>The description as it was before <see cref="Compact"/>, or what it was given where a reference does not resolve.</summary>
        public static Dictionary<string, object?> Expand(Dictionary<string, object?> compact, List<object?> shared)
        {
            var described = new Dictionary<string, object?>(compact.Count, StringComparer.Ordinal);
            foreach (var entry in compact)
            {
                described[entry.Key] = entry.Value is Dictionary<string, object?> reference
                    && reference.Count == 1
                    && reference.TryGetValue(Key, out var at)
                    && at is double index
                    && index >= 0 && index < shared.Count
                        ? shared[(int)index]
                        : entry.Value;
            }
            return described;
        }
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
        private const int FormatVersion = 2;

        /// <summary>The roster facts that are whole numbers, which a JSON number does not remember being.</summary>
        private static readonly HashSet<string> WholeNumbers = new HashSet<string>(StringComparer.Ordinal)
        {
            "vesselType", "situation", "bodyIndex", "crewCount", "crewCapacity", "commsControlSource",
        };

        public static string Encode(HeardSnapshot snapshot)
        {
            var pool = new SharedValues();
            var centres = new List<object?>();
            foreach (var centre in snapshot.Centres)
            {
                var states = new List<object?>();
                foreach (var state in centre.States)
                {
                    states.Add(State(state, pool));
                }
                var links = new Dictionary<string, object?>(StringComparer.Ordinal);
                foreach (var link in centre.Links)
                {
                    links[link.Key] = link.Value;
                }
                var radios = new List<object?>();
                foreach (var radio in centre.Radios)
                {
                    radios.Add(RadioOf(radio));
                }
                var sightings = new List<object?>();
                foreach (var sighting in centre.Sightings)
                {
                    sightings.Add(new Dictionary<string, object?>
                    {
                        ["id"] = sighting.Id,
                        ["capturedUt"] = sighting.CapturedUt,
                        ["exists"] = sighting.Exists,
                        ["listed"] = sighting.Listed == null ? null : new Dictionary<string, object?>(Copy(sighting.Listed)),
                    });
                }
                centres.Add(new Dictionary<string, object?>
                {
                    ["centre"] = centre.Centre, ["states"] = states, ["links"] = links, ["radios"] = radios, ["sightings"] = sightings,
                });
            }
            var root = new Dictionary<string, object?> { ["version"] = (double)FormatVersion, ["centres"] = centres };
            if (pool.Values.Count > 0)
            {
                root["shared"] = pool.Values;
            }
            var sb = new StringBuilder();
            JsonWriter.AppendValue(sb, root);
            return Convert.ToBase64String(Encoding.UTF8.GetBytes(sb.ToString()));
        }

        /// <summary>The snapshot a save carried, or null when it carried none or one this build cannot read.</summary>
        public static HeardSnapshot? Decode(string? encoded, Func<string, IReadOnlyDictionary<string, object?>, IContactLinkStrength?>? restoreStrength = null)
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
                var shared = Get(root, "shared") as List<object?> ?? new List<object?>();
                var centres = new List<HeardAtCentre>();
                foreach (var item in List(root, "centres"))
                {
                    var centre = (Dictionary<string, object?>)item!;
                    var states = new List<CraftState>();
                    foreach (var state in List(centre, "states"))
                    {
                        states.Add(StateFrom((Dictionary<string, object?>)state!, restoreStrength, shared));
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
                    var radios = new List<ContactRadio>();
                    foreach (var radio in List(centre, "radios"))
                    {
                        radios.Add(RadioFrom((Dictionary<string, object?>)radio!));
                    }
                    var sightings = new List<CraftSighting>();
                    foreach (var item2 in List(centre, "sightings"))
                    {
                        var seen = (Dictionary<string, object?>)item2!;
                        var seenId = (string)seen["id"]!;
                        var seenUt = (double)seen["capturedUt"]!;
                        // Where the craft was going is not saved with a sighting: the heard state's own orbit stands until it is seen again.
                        sightings.Add(Get(seen, "exists") is bool there && there
                            ? CraftSighting.Of(seenId, seenUt, Get(seen, "listed") is Dictionary<string, object?> listing ? Listed(listing) : null)
                            : CraftSighting.Gone(seenId, seenUt));
                    }
                    centres.Add(new HeardAtCentre((string)centre["centre"]!, states, links, radios, sightings));
                }
                return new HeardSnapshot(centres);
            }
            catch (Exception)
            {
                // A save this build cannot read is a save that carried nothing: every centre starts from what it hears next.
                return null;
            }
        }

        /// <summary>The strength model a save kept for one link, built again by the backend that described it, or null when none was kept or the backend cannot.</summary>
        private static IContactLinkStrength? StrengthOf(
            Dictionary<string, object?> map,
            string other,
            Func<string, IReadOnlyDictionary<string, object?>, IContactLinkStrength?>? restore,
            List<object?> shared)
        {
            if (restore == null
                || !(Get(map, "strengths") is Dictionary<string, object?> kept)
                || !kept.TryGetValue(other, out var entry)
                || !(entry is Dictionary<string, object?> described)
                || !(Get(described, "model") is string model)
                || !(Get(described, "data") is Dictionary<string, object?> data))
            {
                return null;
            }
            try
            {
                return restore(model, SharedValues.Expand(data, shared));
            }
            catch (Exception)
            {
                // A backend that cannot read what it once wrote leaves the pair without a strength, as before the load.
                return null;
            }
        }

        private static Dictionary<string, object?> State(CraftState state, SharedValues pool)
        {
            var links = new Dictionary<string, object?>(StringComparer.Ordinal);
            var strengths = new Dictionary<string, object?>(StringComparer.Ordinal);
            foreach (var link in state.Links)
            {
                links[link.Key] = link.Value.MaxRangeMeters;
                if (link.Value.Strength is IPersistableLinkStrength persistable)
                {
                    strengths[link.Key] = new Dictionary<string, object?> { ["model"] = persistable.ModelId, ["data"] = pool.Compact(persistable.Describe()) };
                }
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
                ["centre"] = CentreOf(state),
                ["links"] = links,
                ["strengths"] = strengths,
            };
        }

        private static CraftState StateFrom(Dictionary<string, object?> map, Func<string, IReadOnlyDictionary<string, object?>, IContactLinkStrength?>? restoreStrength, List<object?> shared)
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
                    links[link.Key] = new CraftLink(link.Value as double?, null, StrengthOf(map, link.Key, restoreStrength, shared));
                }
            }
            var roster = Get(map, "roster") is Dictionary<string, object?> listed ? Listed(listed) : null;
            var name = Get(map, "name") as string;
            var bodyIndex = (int)(double)map["bodyIndex"]!;
            var plannable = Get(map, "plannable") is bool p && p;
            var settled = !(Get(map, "settled") is bool s) || s;

            var centre = Get(map, "centre") is Dictionary<string, object?> entry ? CentreFrom(entry) : null;
            return Moving(map, id, capturedUt, bodyIndex, plannable, settled, links, roster).Named(name).Listed(roster).AsCentre(centre);
        }

        /// <summary>A radio reading as the save keeps it. A save's own layout, not the wire's.</summary>
        private static Dictionary<string, object?> RadioOf(ContactRadio radio)
        {
            var hops = new List<object?>();
            foreach (var hop in radio.Hops)
            {
                hops.Add(new Dictionary<string, object?>
                {
                    ["from"] = hop.From, ["to"] = hop.To, ["toIsCraft"] = hop.ToIsCraft, ["extensions"] = hop.Extensions,
                });
            }
            return new Dictionary<string, object?>
            {
                ["craftId"] = radio.CraftId,
                ["capturedUt"] = radio.CapturedUt,
                ["connected"] = radio.Connected,
                ["strength"] = radio.Strength,
                ["quantity"] = (double)(int)radio.Quantity,
                ["gradedBy"] = radio.Degrade.ModelId,
                ["gradedByName"] = radio.Degrade.ModelName,
                ["grade"] = radio.Degrade.Level,
                ["hops"] = hops,
            };
        }

        private static ContactRadio RadioFrom(Dictionary<string, object?> r)
        {
            var hops = new List<RadioHop>();
            foreach (var item in List(r, "hops"))
            {
                var hop = (Dictionary<string, object?>)item!;
                hops.Add(new RadioHop(
                    (string)hop["from"]!,
                    (string)hop["to"]!,
                    Get(hop, "toIsCraft") is bool craft && craft,
                    Get(hop, "extensions") as Dictionary<string, object?>));
            }
            var degrade = new CommsDegrade
            {
                ModelId = Get(r, "gradedBy") as string ?? "",
                ModelName = Get(r, "gradedByName") as string ?? "",
                Level = Get(r, "grade") as double?,
            };
            return new ContactRadio(
                (string)r["craftId"]!,
                Get(r, "connected") is bool connected && connected,
                (double)r["strength"]!,
                degrade,
                hops,
                Get(r, "quantity") is double quantity ? (SignalQuantity)(int)quantity : SignalQuantity.Unknown)
            {
                CapturedUt = (double)r["capturedUt"]!,
            };
        }

        /// <summary>The craft's roster entry as the save keeps it, or null for a craft that was not a command centre. A save's own layout, not the wire's.</summary>
        private static Dictionary<string, object?>? CentreOf(CraftState state)
        {
            var centre = state.Centre;
            if (centre == null)
            {
                return null;
            }
            return new Dictionary<string, object?>
            {
                ["id"] = centre.Id,
                ["displayName"] = centre.DisplayName,
                ["kind"] = centre.Kind,
                ["bodyIndex"] = centre.BodyIndex == null ? null : (object)(double)centre.BodyIndex.Value,
                ["latitude"] = centre.Latitude,
                ["longitude"] = centre.Longitude,
                ["active"] = centre.Active,
                ["isHome"] = centre.IsHome,
                ["isHomeFallback"] = centre.IsHomeFallback,
                ["delayQuality"] = centre.DelayQuality,
            };
        }

        private static CommandCentreEntry CentreFrom(Dictionary<string, object?> c) => new CommandCentreEntry
        {
            Id = Get(c, "id") as string,
            DisplayName = Get(c, "displayName") as string,
            Kind = Get(c, "kind") as string,
            BodyIndex = Get(c, "bodyIndex") is double body ? (int)body : (int?)null,
            Latitude = Get(c, "latitude") as double?,
            Longitude = Get(c, "longitude") as double?,
            Active = Get(c, "active") is bool active && active,
            IsHome = Get(c, "isHome") is bool home && home,
            IsHomeFallback = Get(c, "isHomeFallback") is bool fallback && fallback,
            DelayQuality = Get(c, "delayQuality") as string,
        };

        /// <summary>The state by how the craft was held when it was heard: standing on a surface, on an orbit, or neither for one with no radio.</summary>
        private static CraftState Moving(
            Dictionary<string, object?> map,
            string id,
            double capturedUt,
            int bodyIndex,
            bool plannable,
            bool settled,
            Dictionary<string, CraftLink> links,
            IReadOnlyDictionary<string, object?>? roster)
        {
            if (Get(map, "surface") is Dictionary<string, object?> surface)
            {
                return CraftState.Landed(id, capturedUt, bodyIndex, SurfaceFrom(surface), links);
            }
            if (Get(map, "orbit") is Dictionary<string, object?> orbit)
            {
                return CraftState.Orbiting(
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
            return CraftState.WithoutARadio(id, capturedUt, roster);
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
