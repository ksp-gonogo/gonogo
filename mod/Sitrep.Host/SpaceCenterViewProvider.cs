using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free mapping logic for the <c>spaceCenter.*</c> stream topics —
    /// <c>spaceCenter.launchSites</c> (the keyed launch-site roster: stock KSC
    /// pad + runway, plus any Making History / Kerbal Konstructs sites, all of
    /// which land in the one <c>PSystemSetup.Instance.LaunchSites</c> union) and
    /// <c>spaceCenter.scene</c> (the current game scene). Reads the raw values a
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
    /// }
    /// </code></para>
    /// </summary>
    public static class SpaceCenterViewProvider
    {
        /// <summary>The keyed launch-site roster channel (a BARE ARRAY, <c>isArray: true</c>).</summary>
        public const string LaunchSitesTopic = "spaceCenter.launchSites";

        /// <summary>The current-scene channel (a wrapper object <c>{ "scene": string }</c>).</summary>
        public const string SceneTopic = "spaceCenter.scene";

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

            return new Dictionary<string, object?>
            {
                ["scene"] = MapScene(raw),
            };
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
