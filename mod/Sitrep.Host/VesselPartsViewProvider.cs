using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free mapping logic for the <c>vessel.parts</c> channel (P1b slice 2)
    /// — the active vessel's full part-tree topology. Kept SEPARATE from
    /// <see cref="PartsViewProvider"/> (which owns the <c>parts.power</c>/
    /// <c>parts.robotics</c> raw dicts): this channel's domain is
    /// <c>vessel</c>, so it is subject-provenance-scoped exactly like
    /// <see cref="VesselViewProvider"/> (every payload's <c>Meta.Source</c> is
    /// <c>"vessel:&lt;guid&gt;"</c>; the whole payload is <c>null</c> when
    /// there is no active vessel / no <c>topology</c> group this tick), and it
    /// lives on <c>Gonogo.KSP.VesselUplink</c> beside <c>vessel.structure</c>.
    ///
    /// <para><b>Raw snapshot encoding (<c>Gonogo.KSP.KspHost.BuildTopology</c>
    /// populates exactly this shape at <c>Values["vessel"]["topology"]</c> — a
    /// LIST like <c>maneuverNodes</c>, entirely omitted when there's no active
    /// vessel):</b></para>
    /// <code>
    /// Values["vessel"]["topology"] = [
    ///   { "id", "parentId", "name", "title",
    ///     "position": [x,y,z], "up": [x,y,z]|null,
    ///     "bounds": { "size": [x,y,z], "center": [x,y,z]|null },
    ///     "dryMass", "inverseStage", "maxTemp", "skinMaxTemp"|null,
    ///     "currentTemp"|null, "skinTemp", "category",
    ///     "modules": [ "ModuleEngines", ... ],
    ///     "isRobotics", "isPowerRelated", "fuelLineTargetId"|null }, ...
    /// ]
    /// </code>
    ///
    /// <para><b>Wire adapter.</b> Same reasoning as
    /// <see cref="VesselViewProvider"/>'s <c>*Wire</c> methods: the typed POCOs
    /// (<see cref="VesselParts"/>/<see cref="VesselPart"/>/<see cref="PartBounds"/>)
    /// are never handed to <c>JsonWriter.AppendValue</c> raw — <see cref="ToWire(VesselParts)"/>
    /// flattens them into the <c>Dictionary&lt;string, object?&gt;</c> tree the
    /// writer understands. <see cref="BuildPartsWire"/> is what
    /// <c>VesselUplink.Register</c> hands to <c>AddChannelSource</c>;
    /// <see cref="BuildParts"/> is the typed logic itself, exercised directly by
    /// unit tests.</para>
    /// </summary>
    public static class VesselPartsViewProvider
    {
        public const string PartsTopic = "vessel.parts";

        // ----------------------------------------------------------------
        // Typed mapper
        // ----------------------------------------------------------------

        public static VesselParts? BuildParts(KspSnapshot? snapshot)
        {
            var vessel = GetVesselGroup(snapshot);
            if (vessel == null || !TryGetSubjectId(vessel, out var vesselId))
            {
                return null;
            }

            if (!vessel.TryGetValue("topology", out var rawTopology) || rawTopology is not IEnumerable<object?> rawList)
            {
                // No topology group at all this tick (KspHost.BuildTopology
                // returned null or the group build threw and was omitted) —
                // never a fabricated empty-vessel record.
                return null;
            }

            var parts = new List<VesselPart>();
            foreach (var rawEntry in rawList)
            {
                if (rawEntry is IDictionary<string, object?> raw)
                {
                    parts.Add(MapPart(raw));
                }
            }

            return new VesselParts
            {
                Parts = parts,
                Meta = BuildMeta(vesselId),
            };
        }

        private static VesselPart MapPart(IDictionary<string, object?> raw)
        {
            return new VesselPart
            {
                // Id is the join key; the capture only ever omits it for the
                // uninitialized-0 flightID sentinel, which reads through as "".
                Id = GetString(raw, "id") ?? "",
                ParentId = GetString(raw, "parentId"),
                Name = GetString(raw, "name") ?? "",
                Title = GetString(raw, "title") ?? "",
                // Position is a required field but stays a zero Vec3 rather
                // than dropping the whole part if a single part's orgPos read
                // was non-finite (R1/F-1) — one bad part must not blank the
                // tree the rest of the topology needs.
                Position = GetVec3(raw, "position") ?? new Vec3(),
                Up = GetVec3(raw, "up"),
                Bounds = MapBounds(raw),
                DryMass = GetDouble(raw, "dryMass") ?? 0.0,
                InverseStage = GetInt(raw, "inverseStage") ?? 0,
                MaxTemp = GetDouble(raw, "maxTemp") ?? 0.0,
                SkinMaxTemp = GetDouble(raw, "skinMaxTemp"),
                CurrentTemp = GetDouble(raw, "currentTemp"),
                SkinTemp = GetDouble(raw, "skinTemp"),
                Category = GetString(raw, "category") ?? "",
                Modules = MapModules(raw),
                IsRobotics = GetBool(raw, "isRobotics") ?? false,
                IsPowerRelated = GetBool(raw, "isPowerRelated") ?? false,
                FuelLineTargetId = GetString(raw, "fuelLineTargetId"),
            };
        }

        private static PartBounds MapBounds(IDictionary<string, object?> raw)
        {
            if (raw.TryGetValue("bounds", out var rawBounds) && rawBounds is IDictionary<string, object?> bounds)
            {
                return new PartBounds
                {
                    Size = GetVec3(bounds, "size") ?? new Vec3(),
                    Center = GetVec3(bounds, "center"),
                };
            }

            return new PartBounds();
        }

        private static List<string> MapModules(IDictionary<string, object?> raw)
        {
            var result = new List<string>();
            if (raw.TryGetValue("modules", out var rawModules) && rawModules is IEnumerable<object?> list)
            {
                foreach (var entry in list)
                {
                    if (entry is string name)
                    {
                        result.Add(name);
                    }
                }
            }

            return result;
        }

        // ----------------------------------------------------------------
        // Wire adapter — see the class doc comment for why this exists.
        // ----------------------------------------------------------------

        public static object? BuildPartsWire(KspSnapshot? snapshot) =>
            BuildParts(snapshot) is { } parts ? ToWire(parts) : null;

        private static Dictionary<string, object?> ToWire(VesselParts parts) => new Dictionary<string, object?>
        {
            ["parts"] = parts.Parts.Select(ToWire).ToList<object?>(),
            ["meta"] = ToWire(parts.Meta),
        };

        private static Dictionary<string, object?> ToWire(VesselPart part) => new Dictionary<string, object?>
        {
            ["id"] = part.Id,
            ["parentId"] = part.ParentId,
            ["name"] = part.Name,
            ["title"] = part.Title,
            ["position"] = ToWire(part.Position),
            ["up"] = part.Up != null ? ToWire(part.Up) : null,
            ["bounds"] = ToWire(part.Bounds),
            ["dryMass"] = part.DryMass,
            ["inverseStage"] = part.InverseStage,
            ["maxTemp"] = part.MaxTemp,
            ["skinMaxTemp"] = part.SkinMaxTemp,
            ["currentTemp"] = part.CurrentTemp,
            ["skinTemp"] = part.SkinTemp,
            ["category"] = part.Category,
            ["modules"] = part.Modules.Select(m => (object?)m).ToList(),
            ["isRobotics"] = part.IsRobotics,
            ["isPowerRelated"] = part.IsPowerRelated,
            ["fuelLineTargetId"] = part.FuelLineTargetId,
        };

        private static Dictionary<string, object?> ToWire(PartBounds bounds) => new Dictionary<string, object?>
        {
            ["size"] = ToWire(bounds.Size),
            ["center"] = bounds.Center != null ? ToWire(bounds.Center) : null,
        };

        private static Dictionary<string, object?> ToWire(Vec3 v) => new Dictionary<string, object?>
        {
            ["x"] = v.X,
            ["y"] = v.Y,
            ["z"] = v.Z,
        };

        private static Dictionary<string, object?> ToWire(PayloadMeta meta) => new Dictionary<string, object?>
        {
            ["source"] = meta.Source,
            ["quality"] = (int)meta.Quality,
        };

        // ----------------------------------------------------------------
        // Shared helpers — copied from VesselViewProvider (the per-provider
        // duplication that class documents; matching that convention).
        // ----------------------------------------------------------------

        private static PayloadMeta BuildMeta(string vesselId) => new PayloadMeta
        {
            Source = "vessel:" + vesselId,
            Quality = Quality.OnRails,
        };

        private static bool TryGetSubjectId(IDictionary<string, object?> vessel, out string vesselId)
        {
            if (vessel.TryGetValue("identity", out var rawIdentity) && rawIdentity is IDictionary<string, object?> identity)
            {
                var id = GetString(identity, "id");
                if (!string.IsNullOrEmpty(id))
                {
                    vesselId = id!;
                    return true;
                }
            }
            vesselId = "";
            return false;
        }

        private static IDictionary<string, object?>? GetVesselGroup(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null)
            {
                return null;
            }
            return snapshot.Values.TryGetValue("vessel", out var raw) && raw is IDictionary<string, object?> vessel
                ? vessel
                : null;
        }

        private static string? GetString(IDictionary<string, object?> raw, string key) => SnapshotDict.GetString(raw, key);
        private static bool? GetBool(IDictionary<string, object?> raw, string key) => SnapshotDict.GetBool(raw, key);
        private static int? GetInt(IDictionary<string, object?> raw, string key) => SnapshotDict.GetInt(raw, key);
        private static double? GetDouble(IDictionary<string, object?> raw, string key) => SnapshotDict.GetDouble(raw, key);
        private static Vec3? GetVec3(IDictionary<string, object?> raw, string key) => SnapshotDict.GetVec3(raw, key);
    }
}
