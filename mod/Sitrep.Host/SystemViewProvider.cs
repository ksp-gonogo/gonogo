using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free mapping logic for the "System View" typed stream topic
    /// (<see cref="Topic"/> = <c>"system.bodies"</c>). Reads the raw body
    /// data an <see cref="IKspHost.Sample"/> snapshot carries and produces
    /// the clean, typed <c>system.bodies</c> wire payload — fixing the
    /// Telemachus orbit warts catalogued in
    /// <c>local_docs/telemetry-mod/telemachus-api-issues.md</c> (O-1, O-7,
    /// O-9, N-2) rather than reproducing them: an explicit parent-index tree
    /// instead of flat <c>b.*[idx]</c> keys, no in-band numeric sentinels for
    /// missing data, and no <c>eccentricAnomaly</c> field (Telemachus's
    /// <c>OrbitPatchJSONFormatter</c> assigns that key the body's
    /// eccentricity — a confirmed copy-paste bug; see O-1).
    ///
    /// This class does NOT touch the Courier/transport — Task 4's
    /// MonoBehaviour pipeline calls <see cref="BuildSystemBodies"/> and
    /// records the result with <c>courier.record("system", Topic, payload, ut)</c>.
    ///
    /// <para><b>Raw snapshot encoding (Task 4 must populate exactly this
    /// shape in <see cref="KspSnapshot.Values"/>):</b></para>
    /// <code>
    /// snapshot.Values["bodies"] = List&lt;object?&gt;  // one entry per celestial body
    ///   each entry = Dictionary&lt;string, object?&gt; {
    ///     "name":                string   — body name (e.g. "Kerbin")
    ///     "index":                int      — this body's position in the list (stable per session)
    ///     "parentIndex":          int      — index of the body it orbits; OMITTED (or explicit null)
    ///                                        for the root star — never a sentinel like -1
    ///     "radius":               double   — mean radius, metres
    ///     "sma":                  double   — semi-major axis, metres
    ///     "ecc":                  double   — eccentricity
    ///     "inc":                  double   — inclination, degrees
    ///     "lan":                  double   — longitude of ascending node, degrees
    ///     "argPe":                double   — argument of periapsis, degrees
    ///     "meanAnomalyAtEpoch":   double   — mean anomaly at epoch, radians
    ///     "epoch":                double   — epoch UT, seconds
    ///   }
    /// </code>
    /// The seven orbital-element keys (everything but name/index/parentIndex/
    /// radius) are meaningless for the root star and MAY be omitted there —
    /// <see cref="BuildSystemBodies"/> ignores them whenever
    /// <c>parentIndex</c> is absent, regardless of what else is present.
    /// ANY field may be omitted (or explicitly <c>null</c>) when the live
    /// game genuinely doesn't have the value yet; <see cref="BuildSystemBodies"/>
    /// maps that to <c>null</c> in the output, never a sentinel. Numbers may
    /// arrive as any boxed CLR numeric type (<c>int</c>/<c>long</c>/<c>float</c>/
    /// <c>double</c>) from a live <c>KspHost</c>, or uniformly as <c>double</c>
    /// after a <see cref="RecordedSessionCodec"/> JSON round-trip (the
    /// <see cref="ReplayKspHost"/> path) — both are accepted.
    ///
    /// <para><b>The <c>system.bodies</c> payload this produces</b> (a plain
    /// <c>Dictionary&lt;string, object?&gt;</c> / <c>List&lt;object?&gt;</c> /
    /// scalar tree — the exact shape <c>Sitrep.Core.Serialization.JsonWriter.AppendValue</c>
    /// already walks, so it drops straight into a
    /// <c>StreamData&lt;object?&gt;.Payload</c> and serializes via the
    /// existing <c>EnvelopeCodec.WriteStreamData</c> with no writer changes):
    /// </para>
    /// <code>
    /// {
    ///   "bodies": [
    ///     {
    ///       "name":        string | null,
    ///       "index":       int,
    ///       "parentIndex": int | null,       // null ONLY for the root star
    ///       "radius":      double | null,
    ///       "orbit": {                        // null ONLY for the root star
    ///         "sma": double|null, "ecc": double|null, "inc": double|null,
    ///         "lan": double|null, "argPe": double|null,
    ///         "meanAnomalyAtEpoch": double|null, "epoch": double|null
    ///       } | null
    ///       // deliberately NO "eccentricAnomaly" field — see O-1 above.
    ///     },
    ///     ...
    ///   ]
    /// }
    /// </code>
    /// </summary>
    public static class SystemViewProvider
    {
        /// <summary>The typed stream topic this provider feeds.</summary>
        public const string Topic = "system.bodies";

        /// <summary>
        /// The M3 R3 roster capture-add — every known vessel (not just the
        /// active one), for TargetPicker-style widgets that need to list
        /// "what could I target" without the player having flown each one
        /// yet. See <see cref="BuildSystemVessels"/>.
        /// </summary>
        public const string VesselsTopic = "system.vessels";

        /// <summary>
        /// Maps <paramref name="snapshot"/>'s raw <c>"bodies"</c> value (see
        /// the class doc for the encoding) to the clean <c>system.bodies</c>
        /// payload. Returns <c>null</c> — not an empty-bodies payload — when
        /// the snapshot doesn't carry a <c>"bodies"</c> list at all (e.g. no
        /// sample has landed yet), so a caller can distinguish "no data yet"
        /// from "zero bodies reported."
        /// </summary>
        public static object? BuildSystemBodies(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null)
            {
                return null;
            }

            if (!snapshot.Values.TryGetValue("bodies", out var rawBodies) || !(rawBodies is IEnumerable<object?> rawList))
            {
                return null;
            }

            var bodies = new List<object?>();
            var i = 0;
            foreach (var rawEntry in rawList)
            {
                if (rawEntry is IDictionary<string, object?> rawBody)
                {
                    bodies.Add(BuildBody(rawBody, i));
                }
                i++;
            }

            return new Dictionary<string, object?>
            {
                ["bodies"] = bodies,
            };
        }

        private static Dictionary<string, object?> BuildBody(IDictionary<string, object?> raw, int fallbackIndex)
        {
            var index = GetInt(raw, "index") ?? fallbackIndex;
            var parentIndex = GetInt(raw, "parentIndex");

            return new Dictionary<string, object?>
            {
                ["name"] = GetString(raw, "name"),
                ["index"] = index,
                ["parentIndex"] = parentIndex,
                ["radius"] = GetDouble(raw, "radius"),
                // Orbit is meaningless for the root star (no parent) — suppress it
                // entirely rather than emit junk elements, per the fix for
                // Telemachus's "sun has a bogus orbit" wart.
                ["orbit"] = parentIndex.HasValue ? BuildOrbit(raw) : null,
            };
        }

        private static Dictionary<string, object?> BuildOrbit(IDictionary<string, object?> raw)
        {
            return new Dictionary<string, object?>
            {
                ["sma"] = GetDouble(raw, "sma"),
                ["ecc"] = GetDouble(raw, "ecc"),
                ["inc"] = GetDouble(raw, "inc"),
                ["lan"] = GetDouble(raw, "lan"),
                ["argPe"] = GetDouble(raw, "argPe"),
                ["meanAnomalyAtEpoch"] = GetDouble(raw, "meanAnomalyAtEpoch"),
                ["epoch"] = GetDouble(raw, "epoch"),
                // NO "eccentricAnomaly" — Telemachus's OrbitPatchJSONFormatter
                // assigns that key the body's ECCENTRICITY (a confirmed
                // copy-paste bug; see telemachus-api-issues.md O-1). If a real
                // anomaly is ever needed, compute it correctly under its own
                // name rather than resurrect this one.
            };
        }

        /// <summary>
        /// Maps <paramref name="snapshot"/>'s raw <c>"vessels"</c> list
        /// (<c>Gonogo.KSP.KspHost.BuildVesselRosterEntry</c>'s shape — id/
        /// name/vesselType/situation/mainBody, primitives only) to the
        /// <c>system.vessels</c> payload: <c>{ "vessels": [ { vesselId,
        /// name, vesselType, situation, bodyIndex }, ... ] }</c>. Follows
        /// <see cref="BuildSystemBodies"/>'s own untyped-dict convention
        /// (no separate Sitrep.Contract POCO — this channel isn't
        /// vessel-scoped-provenance like the <c>vessel.*</c> family, it's a
        /// <c>system</c>-domain snapshot list, same shape class as
        /// <c>system.bodies</c>). Returns <c>null</c> — not an empty-roster
        /// payload — when the snapshot doesn't carry a <c>"vessels"</c> list
        /// at all (main menu / nothing loaded yet), same "no data yet" vs.
        /// "zero vessels" distinction <see cref="BuildSystemBodies"/> makes.
        /// A roster entry with no resolvable <c>id</c> is dropped, never
        /// emitted with a fabricated one (R1).
        /// </summary>
        public static object? BuildSystemVessels(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null)
            {
                return null;
            }

            if (!snapshot.Values.TryGetValue("vessels", out var rawVessels) || !(rawVessels is IEnumerable<object?> rawList))
            {
                return null;
            }

            var vessels = new List<object?>();
            foreach (var rawEntry in rawList)
            {
                if (rawEntry is not IDictionary<string, object?> rawVessel)
                {
                    continue;
                }

                var id = GetString(rawVessel, "id");
                if (string.IsNullOrEmpty(id))
                {
                    // No stable subject id -- can't attribute this roster
                    // entry to anything (same R1 rule vessel.identity's
                    // BuildIdentity applies to the active vessel).
                    continue;
                }

                var mainBodyName = GetString(rawVessel, "mainBody");
                int? bodyIndex = mainBodyName != null ? SharedMappers.ResolveBodyIndex(snapshot, mainBodyName) : null;

                vessels.Add(new Dictionary<string, object?>
                {
                    ["vesselId"] = id,
                    ["name"] = GetString(rawVessel, "name") ?? "",
                    ["vesselType"] = (int)SharedMappers.ParseVesselType(GetString(rawVessel, "vesselType")),
                    ["situation"] = (int)SharedMappers.ParseSituation(GetString(rawVessel, "situation")),
                    ["bodyIndex"] = bodyIndex,
                });
            }

            return new Dictionary<string, object?>
            {
                ["vessels"] = vessels,
            };
        }

        // Scalar readers live in the shared SnapshotDict — see that class's
        // doc comment for the R1/F-1 non-finite-is-absent rule GetDouble
        // applies (this is also why a body with a near-equatorial/
        // near-circular orbit gets a null lan/argPe here rather than a
        // NaN-carrying wire value, same as vessel.orbit).
        private static string? GetString(IDictionary<string, object?> raw, string key) => SnapshotDict.GetString(raw, key);
        private static int? GetInt(IDictionary<string, object?> raw, string key) => SnapshotDict.GetInt(raw, key);
        private static double? GetDouble(IDictionary<string, object?> raw, string key) => SnapshotDict.GetDouble(raw, key);
    }
}
