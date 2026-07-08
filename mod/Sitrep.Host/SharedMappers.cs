using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// Small mapping helpers genuinely shared by more than one
    /// <c>*ViewProvider</c> — extracted (M3 R3 capture-adds) when
    /// <c>SystemViewProvider</c>'s new <c>system.vessels</c> roster mapper
    /// needed the EXACT SAME body-name -&gt; <c>system.bodies</c> index
    /// resolution and <see cref="VesselType"/>/<see cref="Situation"/>
    /// string parsing <see cref="VesselViewProvider"/> already had, private,
    /// for <c>vessel.identity</c>. Rather than duplicate this logic a second
    /// time (a roster entry needs identical semantics — same "no sentinel,
    /// null when unresolved" rule, same enum fallback-to-Unknown rule), both
    /// providers call through this shared, internal-only class.
    /// <see cref="VesselViewProvider"/>'s own private
    /// <c>ResolveBodyIndex</c>/<c>ParseVesselType</c>/<c>ParseSituation</c>
    /// now delegate here too, so every existing caller/test keeps working
    /// unchanged — this is a pure extraction, not a behavior change.
    /// </summary>
    internal static class SharedMappers
    {
        /// <summary>
        /// Resolves a body NAME to its stable <c>system.bodies</c> index by
        /// scanning <c>snapshot.Values["bodies"]</c> — see
        /// <see cref="VesselViewProvider"/>'s original doc comment on this
        /// method (moved here verbatim). Returns null if the bodies list is
        /// absent or the name doesn't match any entry — never a sentinel
        /// index like -1.
        /// </summary>
        public static int? ResolveBodyIndex(KspSnapshot snapshot, string bodyName)
        {
            if (!snapshot.Values.TryGetValue("bodies", out var rawBodies) || rawBodies is not IEnumerable<object?> list)
            {
                return null;
            }

            foreach (var rawEntry in list)
            {
                if (rawEntry is IDictionary<string, object?> body && SnapshotDict.GetString(body, "name") == bodyName)
                {
                    var index = SnapshotDict.GetInt(body, "index");
                    if (index.HasValue)
                    {
                        return index.Value;
                    }
                }
            }
            return null;
        }

        /// <summary>KSP's <c>VesselType.ToString()</c> already yields PascalCase matching <see cref="Sitrep.Contract.VesselType"/>'s members — case-insensitive parse, <c>Unknown</c> fallback.</summary>
        public static Sitrep.Contract.VesselType ParseVesselType(string? raw)
        {
            return raw != null && Enum.TryParse<Sitrep.Contract.VesselType>(raw, ignoreCase: true, out var parsed)
                ? parsed
                : Sitrep.Contract.VesselType.Unknown;
        }

        /// <summary>KSP's raw SCREAMING_SNAKE_CASE <c>Vessel.Situations.ToString()</c> mapped onto <see cref="Sitrep.Contract.Situation"/>'s members.</summary>
        public static Sitrep.Contract.Situation ParseSituation(string? raw)
        {
            return raw switch
            {
                "LANDED" => Sitrep.Contract.Situation.Landed,
                "SPLASHED" => Sitrep.Contract.Situation.Splashed,
                "PRELAUNCH" => Sitrep.Contract.Situation.PreLaunch,
                "ORBITING" => Sitrep.Contract.Situation.Orbiting,
                "ESCAPING" => Sitrep.Contract.Situation.Escaping,
                "FLYING" => Sitrep.Contract.Situation.Flying,
                "SUB_ORBITAL" => Sitrep.Contract.Situation.SubOrbital,
                "DOCKED" => Sitrep.Contract.Situation.Docked,
                _ => Sitrep.Contract.Situation.Unknown,
            };
        }
    }
}
