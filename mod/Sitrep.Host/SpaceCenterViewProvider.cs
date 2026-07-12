using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free mapping logic for the <c>spaceCenter.*</c> stream topics —
    /// <c>spaceCenter.launchSites</c> (the keyed launch-site roster: stock KSC
    /// pad + runway, plus any Making History / Kerbal Konstructs sites, all of
    /// which land in the one <c>PSystemSetup.Instance.LaunchSites</c> union),
    /// <c>spaceCenter.scene</c> (the current game scene),
    /// <c>spaceCenter.crewRoster</c> (the hired-crew roster),
    /// <c>spaceCenter.savedShips</c> (the saved VAB/SPH craft) and
    /// <c>spaceCenter.partsAvailable</c> (the count of buildable parts). Reads the raw values a
    /// <see cref="IKspHost.Sample"/> snapshot carries (populated by
    /// <c>Gonogo.KSP.KspHost.BuildSpaceCenter</c>/<c>BuildScene</c>) and hand-
    /// builds the wire trees, following <see cref="SystemViewProvider"/>'s
    /// untyped-dict convention (NOT <c>VesselViewProvider</c>'s typed-POCO +
    /// ToWire): the <see cref="LaunchSiteEntry"/> / <see cref="SpaceCenterScene"/>
    /// contract types are TS-shape-only mirrors, never serialized — the live
    /// dict/list tree this produces is what <c>JsonWriter</c> walks.
    ///
    /// <para><b>Raw snapshot encoding (KspHost must populate exactly this):</b>
    /// <code>
    /// snapshot.Values["scene"] = string   — RAW GameScenes enum name
    ///                                        (e.g. "FLIGHT"/"TRACKSTATION"); this
    ///                                        provider owns the fold to the six
    ///                                        output strings, same capture→provider
    ///                                        split as gameMode→CareerViewProvider.
    /// snapshot.Values["activeLaunchSite"] = string? — EditorLogic.launchSiteName,
    ///                                        the editor-selected launch site (null
    ///                                        outside the editor); passed straight
    ///                                        onto spaceCenter.scene.launchSite.
    /// snapshot.Values["spaceCenter"] = Dictionary {
    ///   "launchSites": List&lt;object?&gt;   // one entry per launch site
    ///     each entry = Dictionary {
    ///       "name":           string   — LaunchSite.name (internal id)
    ///       "displayName":    string   — resolved display name
    ///       "editorFacility": string   — EditorFacility enum name ("None"/"VAB"/"SPH")
    ///       "body":           string   — the site's body NAME (provider resolves to index)
    ///       "isStock":        bool     — PSystemSetup.IsStockLaunchSite
    ///       "padOccupied":    bool?    — stock-pad occupancy (null off the stock pad)
    ///       "padVesselTitle": string?  — occupying vessel name (null when none)
    ///     }
    ///   "crewRoster": List&lt;object?&gt;   // one entry per hired kerbal
    ///     each entry = Dictionary {
    ///       "name":            string   — ProtoCrewMember.name
    ///       "trait":           string   — ProtoCrewMember.trait
    ///       "experienceLevel": int      — ProtoCrewMember.experienceLevel
    ///       "rosterStatus":    string   — RAW RosterStatus enum name (provider folds to available/reason)
    ///     }
    ///   "savedShips": List&lt;object?&gt;   // one entry per .craft file
    ///     each entry = Dictionary {
    ///       "name":          string   — CraftProfileInfo.shipName
    ///       "partCount":     int      — CraftProfileInfo.partCount
    ///       "totalMass":     double   — CraftProfileInfo.totalMass
    ///       "facility":      string   — EditorFacility enum name ("VAB"/"SPH")
    ///       "requiresFunds": double   — CraftProfileInfo.totalCost
    ///       "missingParts":  List&lt;object?&gt; of string — UnavailableShipParts
    ///     }
    ///   "partsAvailable": int          — count of buildable parts (provider wraps to { count })
    /// }
    /// </code></para>
    /// </summary>
    public static class SpaceCenterViewProvider
    {
        /// <summary>The keyed launch-site roster channel (a BARE ARRAY, <c>isArray: true</c>).</summary>
        public const string LaunchSitesTopic = "spaceCenter.launchSites";

        /// <summary>The current-scene channel (a wrapper object <c>{ "scene": string }</c>).</summary>
        public const string SceneTopic = "spaceCenter.scene";

        /// <summary>The hired-crew roster channel (a BARE ARRAY, <c>isArray: true</c>).</summary>
        public const string CrewRosterTopic = "spaceCenter.crewRoster";

        /// <summary>The saved-craft roster channel (a BARE ARRAY, <c>isArray: true</c>).</summary>
        public const string SavedShipsTopic = "spaceCenter.savedShips";

        /// <summary>The buildable-parts-count channel (a wrapper object <c>{ "count": int }</c>).</summary>
        public const string PartsAvailableTopic = "spaceCenter.partsAvailable";

        /// <summary>
        /// Maps <paramref name="snapshot"/>'s raw
        /// <c>Values["spaceCenter"]["launchSites"]</c> list to the
        /// <c>spaceCenter.launchSites</c> payload — a BARE
        /// <c>List&lt;object?&gt;</c> (matching <c>isArray: true</c>), one dict per
        /// site mirroring <see cref="LaunchSiteEntry"/> field-for-field.
        /// <c>body</c> (a captured body NAME) resolves to a
        /// <see cref="SystemBodies"/> index via
        /// <see cref="SharedMappers.ResolveBodyIndex"/> — the SAME pattern
        /// <see cref="SystemViewProvider.BuildSystemVessels"/> uses — never a
        /// fabricated sentinel index. Returns <c>null</c> — not an empty list —
        /// when the snapshot carries no <c>spaceCenter</c>/<c>launchSites</c> key
        /// at all (no sample landed / <c>PSystemSetup</c> not ready yet), so a
        /// caller distinguishes "no data yet" from "zero sites."
        /// </summary>
        public static object? BuildLaunchSites(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null)
            {
                return null;
            }

            if (!snapshot.Values.TryGetValue("spaceCenter", out var rawGroup) || rawGroup is not IDictionary<string, object?> group)
            {
                return null;
            }

            if (!group.TryGetValue("launchSites", out var rawSites) || rawSites is not IEnumerable<object?> rawList)
            {
                return null;
            }

            var sites = new List<object?>();
            foreach (var rawEntry in rawList)
            {
                if (rawEntry is not IDictionary<string, object?> raw)
                {
                    continue;
                }

                var bodyName = SnapshotDict.GetString(raw, "body");
                int? bodyIndex = bodyName != null ? SharedMappers.ResolveBodyIndex(snapshot, bodyName) : null;

                sites.Add(new Dictionary<string, object?>
                {
                    ["name"] = SnapshotDict.GetString(raw, "name"),
                    ["displayName"] = SnapshotDict.GetString(raw, "displayName"),
                    ["editorFacility"] = SnapshotDict.GetString(raw, "editorFacility"),
                    ["bodyIndex"] = bodyIndex,
                    ["isStock"] = SnapshotDict.GetBool(raw, "isStock"),
                    ["padOccupied"] = SnapshotDict.GetBool(raw, "padOccupied"),
                    ["padVesselTitle"] = SnapshotDict.GetString(raw, "padVesselTitle"),
                });
            }

            return sites;
        }

        /// <summary>
        /// Maps <paramref name="snapshot"/>'s raw <c>Values["scene"]</c> string —
        /// the RAW <c>GameScenes</c> enum name KspHost captured — to the
        /// <c>spaceCenter.scene</c> payload <c>{ "scene": string }</c>, folding
        /// the enum onto the six migration-target strings the legacy
        /// <c>kc.scene</c> key used (<c>FLIGHT</c>→<c>"Flight"</c>,
        /// <c>SPACECENTER</c>→<c>"SpaceCenter"</c>, <c>EDITOR</c>→<c>"Editor"</c>,
        /// <c>TRACKSTATION</c>→<c>"TrackingStation"</c>,
        /// <c>MAINMENU</c>→<c>"MainMenu"</c>, everything else →<c>"Other"</c>).
        /// Returns <c>null</c> when no <c>scene</c> key is present (no sample
        /// yet), distinct from a mapped <c>"Other"</c>.
        /// </summary>
        public static object? BuildScene(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null)
            {
                return null;
            }

            if (!snapshot.Values.TryGetValue("scene", out var rawScene) || rawScene is not string raw)
            {
                return null;
            }

            // Active launch site rides alongside the scene as its own raw value
            // (KspHost captures EditorLogic.launchSiteName); null outside the
            // editor, passed straight through onto spaceCenter.scene.launchSite.
            var launchSite = snapshot.Values.TryGetValue("activeLaunchSite", out var rawSite) ? rawSite as string : null;

            return new Dictionary<string, object?>
            {
                ["scene"] = MapScene(raw),
                ["launchSite"] = launchSite,
            };
        }

        /// <summary>
        /// Maps <paramref name="snapshot"/>'s raw
        /// <c>Values["spaceCenter"]["crewRoster"]</c> list to the
        /// <c>spaceCenter.crewRoster</c> payload — a BARE <c>List&lt;object?&gt;</c>
        /// (matching <c>isArray: true</c>), one dict per kerbal mirroring
        /// <see cref="CrewRosterEntry"/>. The raw <c>rosterStatus</c> string
        /// (the RAW <c>ProtoCrewMember.RosterStatus</c> enum name KspHost
        /// captured) folds here — the same capture→provider split
        /// <see cref="BuildScene"/> uses — into the <c>available</c> bool and the
        /// <c>unavailableReason</c> string the widgets read. Returns <c>null</c> —
        /// not an empty list — when the snapshot carries no <c>crewRoster</c> key
        /// (no sample landed yet), distinct from a genuinely empty roster.
        /// </summary>
        public static object? BuildCrewRoster(KspSnapshot? snapshot)
        {
            var rawList = GetSpaceCenterList(snapshot, "crewRoster");
            if (rawList == null)
            {
                return null;
            }

            var crew = new List<object?>();
            foreach (var rawEntry in rawList)
            {
                if (rawEntry is not IDictionary<string, object?> raw)
                {
                    continue;
                }

                var status = SnapshotDict.GetString(raw, "rosterStatus");

                crew.Add(new Dictionary<string, object?>
                {
                    ["name"] = SnapshotDict.GetString(raw, "name"),
                    ["trait"] = SnapshotDict.GetString(raw, "trait"),
                    ["experienceLevel"] = SnapshotDict.GetInt(raw, "experienceLevel"),
                    ["available"] = status == "Available",
                    ["unavailableReason"] = MapUnavailableReason(status),
                });
            }

            return crew;
        }

        /// <summary>
        /// Folds a raw <c>ProtoCrewMember.RosterStatus</c> enum name onto the
        /// human reason a kerbal can't fly. <c>Available</c> → empty string (the
        /// kerbal IS free), <c>Assigned</c> → "On mission", and every other
        /// status (<c>Dead</c>/<c>Missing</c>, or an unrecognised value) passes
        /// through as its own name. Kept internal-static so the provider test can
        /// assert the mapping without a KSP reference.
        /// </summary>
        internal static string MapUnavailableReason(string? status)
        {
            return status switch
            {
                "Available" => "",
                "Assigned" => "On mission",
                null => "",
                _ => status,
            };
        }

        /// <summary>
        /// Maps <paramref name="snapshot"/>'s raw
        /// <c>Values["spaceCenter"]["savedShips"]</c> list to the
        /// <c>spaceCenter.savedShips</c> payload — a BARE <c>List&lt;object?&gt;</c>
        /// (matching <c>isArray: true</c>), one dict per craft file mirroring
        /// <see cref="SavedShipEntry"/> field-for-field. Every value is already a
        /// primitive KspHost read off <c>CraftProfileInfo</c>, so this is a
        /// straight re-map (no enum fold), with <c>missingParts</c> copied to a
        /// fresh string list. Returns <c>null</c> — not an empty list — when the
        /// snapshot carries no <c>savedShips</c> key (no sample yet).
        /// </summary>
        public static object? BuildSavedShips(KspSnapshot? snapshot)
        {
            var rawList = GetSpaceCenterList(snapshot, "savedShips");
            if (rawList == null)
            {
                return null;
            }

            var ships = new List<object?>();
            foreach (var rawEntry in rawList)
            {
                if (rawEntry is not IDictionary<string, object?> raw)
                {
                    continue;
                }

                ships.Add(new Dictionary<string, object?>
                {
                    ["name"] = SnapshotDict.GetString(raw, "name"),
                    ["partCount"] = SnapshotDict.GetInt(raw, "partCount"),
                    ["totalMass"] = SnapshotDict.GetDouble(raw, "totalMass"),
                    ["facility"] = SnapshotDict.GetString(raw, "facility"),
                    ["requiresFunds"] = SnapshotDict.GetDouble(raw, "requiresFunds"),
                    ["missingParts"] = GetStringList(raw, "missingParts"),
                });
            }

            return ships;
        }

        /// <summary>
        /// Maps <paramref name="snapshot"/>'s raw
        /// <c>Values["spaceCenter"]["partsAvailable"]</c> integer to the
        /// <c>spaceCenter.partsAvailable</c> payload <c>{ "count": int }</c>.
        /// Returns <c>null</c> when the snapshot carries no <c>partsAvailable</c>
        /// key (no sample yet), distinct from a count of zero.
        /// </summary>
        public static object? BuildPartsAvailable(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null)
            {
                return null;
            }

            if (!snapshot.Values.TryGetValue("spaceCenter", out var rawGroup) || rawGroup is not IDictionary<string, object?> group)
            {
                return null;
            }

            var count = SnapshotDict.GetInt(group, "partsAvailable");
            if (count == null)
            {
                return null;
            }

            return new Dictionary<string, object?>
            {
                ["count"] = count,
            };
        }

        /// <summary>
        /// Pulls the raw <c>Values["spaceCenter"][<paramref name="key"/>]</c>
        /// sub-list, or <c>null</c> when the snapshot has no <c>spaceCenter</c>
        /// group or the sub-key is absent — the "no sample yet" signal shared by
        /// the array builders.
        /// </summary>
        private static IEnumerable<object?>? GetSpaceCenterList(KspSnapshot? snapshot, string key)
        {
            if (snapshot?.Values == null)
            {
                return null;
            }

            if (!snapshot.Values.TryGetValue("spaceCenter", out var rawGroup) || rawGroup is not IDictionary<string, object?> group)
            {
                return null;
            }

            return group.TryGetValue(key, out var raw) && raw is IEnumerable<object?> list ? list : null;
        }

        /// <summary>
        /// Copies a raw string-list field to a fresh <c>List&lt;object?&gt;</c> of
        /// strings, dropping any non-string element. Returns an empty list (never
        /// <c>null</c>) when the field is absent — a craft with no missing parts
        /// is buildable-as-is, which the widget renders as an empty array.
        /// </summary>
        private static List<object?> GetStringList(IDictionary<string, object?> raw, string key)
        {
            var result = new List<object?>();
            if (raw.TryGetValue(key, out var value) && value is IEnumerable<object?> items)
            {
                foreach (var item in items)
                {
                    if (item is string s)
                    {
                        result.Add(s);
                    }
                }
            }

            return result;
        }

        /// <summary>
        /// Folds a raw <c>GameScenes</c> enum name onto the six fixed output
        /// strings. Kept internal-static so the provider test can assert the
        /// mapping for every enum value (incl. the <c>"Other"</c> fallback)
        /// without a KSP reference. NOTE the real enum member is
        /// <c>TRACKSTATION</c> (verified via decompile) — not the
        /// <c>TRACKINGSTATION</c> the earlier scoping guessed.
        /// </summary>
        internal static string MapScene(string? raw)
        {
            return raw switch
            {
                "FLIGHT" => "Flight",
                "SPACECENTER" => "SpaceCenter",
                "EDITOR" => "Editor",
                "TRACKSTATION" => "TrackingStation",
                "MAINMENU" => "MainMenu",
                _ => "Other",
            };
        }
    }
}
