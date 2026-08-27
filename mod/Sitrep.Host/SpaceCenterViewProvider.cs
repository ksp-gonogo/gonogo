using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free mapping logic for the <c>spaceCenter.*</c> stream topics,
    /// <c>spaceCenter.launchSites</c> (the keyed launch-site roster: stock KSC
    /// pad + runway, plus any Making History / Kerbal Konstructs sites, all of
    /// which land in the one <c>PSystemSetup.Instance.LaunchSites</c> union),
    /// <c>spaceCenter.scene</c> (the current game scene),
    /// <c>spaceCenter.crewRoster</c> (the hired-crew roster),
    /// <c>spaceCenter.savedShips</c> (the saved VAB/SPH craft),
    /// <c>spaceCenter.partsAvailable</c> (the count of buildable parts) and
    /// <c>spaceCenter.pois</c> (the map points-of-interest union of launch
    /// sites + active/offered contract targets). Reads the raw values a
    /// <see cref="IKspHost.Sample"/> snapshot carries (populated by
    /// <c>Gonogo.KSP.KspHost.BuildSpaceCenter</c>/<c>BuildScene</c>) and hand-
    /// builds the wire trees, following <see cref="SystemViewProvider"/>'s
    /// untyped-dict convention (NOT <c>VesselViewProvider</c>'s typed-POCO +
    /// ToWire): the <see cref="LaunchSiteEntry"/> / <see cref="SpaceCenterScene"/> /
    /// <see cref="SpaceCenterPoiEntry"/> contract types are TS-shape-only
    /// mirrors, never serialized: the live dict/list tree this produces is
    /// what <c>JsonWriter</c> walks.
    ///
    /// <para><b>Raw snapshot encoding (KspHost must populate exactly this):</b>
    /// <code>
    /// snapshot.Values["scene"] = string  : RAW GameScenes enum name
    ///                                        (e.g. "FLIGHT"/"TRACKSTATION"); this
    ///                                        provider owns the fold to the six
    ///                                        output strings, same capture→provider
    ///                                        split as gameMode→CareerViewProvider.
    /// snapshot.Values["activeLaunchSite"] = string?: EditorLogic.launchSiteName,
    ///                                        the editor-selected launch site (null
    ///                                        outside the editor); passed straight
    ///                                        onto spaceCenter.scene.launchSite.
    /// snapshot.Values["spaceCenter"] = Dictionary {
    ///   "launchSites": List&lt;object?&gt;   // one entry per launch site
    ///     each entry = Dictionary {
    ///       "name":           string  : LaunchSite.name (internal id)
    ///       "displayName":    string  : resolved display name
    ///       "editorFacility": string  : EditorFacility enum name ("None"/"VAB"/"SPH")
    ///       "body":           string  : the site's body NAME (provider resolves to index)
    ///       "isStock":        bool    : PSystemSetup.IsStockLaunchSite
    ///       "padOccupied":    bool?   : stock-pad occupancy (null off the stock pad)
    ///       "padVesselTitle": string? : occupying vessel name (null when none)
    ///       "latitude":       double? : first spawn point with latlonaltSet, null if none
    ///       "longitude":      double? : paired with latitude
    ///     }
    ///   "contractTargets": List&lt;object?&gt;   // one entry per WaypointManager waypoint with a contractReference
    ///     each entry = Dictionary {
    ///       "navigationId":            string  : Waypoint.navigationId.ToString()
    ///       "celestialName":           string  : Waypoint.celestialName
    ///       "latitude":                double  : Waypoint.latitude
    ///       "longitude":               double  : Waypoint.longitude
    ///       "isOnSurface":             bool    : Waypoint.isOnSurface (provider filters non-surface out)
    ///       "contractState":           string  : RAW Contract.State enum name (provider filters to Active/Offered)
    ///       "contractTitle":           string  : Contract.Title
    ///       "contractAgent":           string? : Contract.Agent?.Name
    ///       "contractFundsAdvance":    double  : Contract.FundsAdvance
    ///       "contractFundsCompletion": double  : Contract.FundsCompletion
    ///       "contractDateDeadline":    double  : Contract.DateDeadline
    ///     }
    ///   "crewRoster": List&lt;object?&gt;   // one entry per hired kerbal
    ///     each entry = Dictionary {
    ///       "name":            string  : ProtoCrewMember.name
    ///       "trait":           string  : ProtoCrewMember.trait
    ///       "experienceLevel": int     : ProtoCrewMember.experienceLevel
    ///       "rosterStatus":    string  : RAW RosterStatus enum name (a DISPLAY LABEL only)
    ///       "rosterStatusOrdinal": int? : (int)RosterStatus, KSP's own answer
    ///       "standing":        int?    : (int)CrewStanding from the elected backend, what the provider BRANCHES on
    ///       "standingSource":  string? : that backend's ProviderId
    ///       "standingAvailable": bool? : the backend's own free-to-fly override, null to derive
    ///       "standingUnavailableReason": string? : the backend's own wording, null to derive
    ///       "isApplicant":     bool?   : a hireable candidate rather than owned crew
    ///       "inactive":        bool?   : ProtoCrewMember.inactive (standing down)
    ///       "inactiveUntilUt": double? : ProtoCrewMember.inactiveTimeEnd
    ///     }
    ///   "savedShips": List&lt;object?&gt;   // one entry per .craft file
    ///     each entry = Dictionary {
    ///       "name":          string  : CraftProfileInfo.shipName
    ///       "partCount":     int     : CraftProfileInfo.partCount
    ///       "totalMass":     double  : CraftProfileInfo.totalMass
    ///       "facility":      string  : EditorFacility enum name (a DISPLAY LABEL only)
    ///       "facilityOrdinal": int?   : (int)EditorFacility, what the client branches on
    ///                                    and sends back as ksp.launch's facility arg
    ///       "requiresFunds": double  : CraftProfileInfo.totalCost
    ///       "missingParts":  List&lt;object?&gt; of string: UnavailableShipParts
    ///     }
    ///   "partsAvailable": int         : count of buildable parts (provider wraps to { count })
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

        /// <summary>The map points-of-interest channel (a BARE ARRAY, <c>isArray: true</c>).</summary>
        public const string PoisTopic = "spaceCenter.pois";

        /// <summary>The Astronaut Complex hire channel (a wrapper object: applicant pool + roster cap + active-crew count).</summary>
        public const string AstronautComplexTopic = "spaceCenter.astronautComplex";

        /// <summary>
        /// Maps <paramref name="snapshot"/>'s raw
        /// <c>Values["spaceCenter"]["launchSites"]</c> list to the
        /// <c>spaceCenter.launchSites</c> payload: a BARE
        /// <c>List&lt;object?&gt;</c> (matching <c>isArray: true</c>), one dict per
        /// site mirroring <see cref="LaunchSiteEntry"/> field-for-field.
        /// <c>body</c> (a captured body NAME) resolves to a
        /// <see cref="SystemBodies"/> index via
        /// <see cref="SharedMappers.ResolveBodyIndex"/>: the SAME pattern
        /// <see cref="SystemViewProvider.BuildSystemVessels"/> uses; never a
        /// fabricated sentinel index. Returns <c>null</c> (not an empty list)
        /// when the snapshot carries no <c>spaceCenter</c>/<c>launchSites</c> key
        /// at all (no sample landed / <c>PSystemSetup</c> not ready yet), so a
        /// caller distinguishes "no data yet" from "zero sites."
        /// </summary>
        /// <summary>
        /// Reads a launch site's spawn-point <c>(latitude, longitude)</c> from its
        /// raw snapshot dict, the single home for the raw <c>"latitude"</c>/
        /// <c>"longitude"</c> key names both launch-site channels consume:
        /// <see cref="BuildLaunchSites"/> passes the pair through as nullable
        /// enrichment, <see cref="BuildPois"/> skips a site when either is null.
        /// Keeping the read in one place stops the two channels drifting on the key
        /// names or the null-fold (<see cref="SnapshotDict.GetDouble"/> folds
        /// absent/<c>NaN</c>/<c>Infinity</c> to null, never a <c>0</c> sentinel).
        /// </summary>
        private static (double? Latitude, double? Longitude) ReadLaunchSiteSpawn(IDictionary<string, object?> raw)
            => (SnapshotDict.GetDouble(raw, "latitude"), SnapshotDict.GetDouble(raw, "longitude"));

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

                // The site's spawn-point lat/lon, via the shared reader BuildPois
                // also uses (one home for the raw "latitude"/"longitude" keys so
                // the two launch-site channels can't drift). Unlike BuildPois this
                // NEVER skips a site that lacks a coordinate: a launch site is a
                // launch site whether or not its spawn point is set, so the pair is
                // nullable enrichment (never a fabricated 0), matching the bodyIndex
                // discipline above.
                var (latitude, longitude) = ReadLaunchSiteSpawn(raw);

                sites.Add(new Dictionary<string, object?>
                {
                    ["name"] = SnapshotDict.GetString(raw, "name"),
                    ["displayName"] = SnapshotDict.GetString(raw, "displayName"),
                    ["editorFacility"] = SnapshotDict.GetString(raw, "editorFacility"),
                    ["bodyIndex"] = bodyIndex,
                    ["latitude"] = latitude,
                    ["longitude"] = longitude,
                    ["isStock"] = SnapshotDict.GetBool(raw, "isStock"),
                    ["padOccupied"] = SnapshotDict.GetBool(raw, "padOccupied"),
                    ["padVesselTitle"] = SnapshotDict.GetString(raw, "padVesselTitle"),
                });
            }

            return sites;
        }

        /// <summary>
        /// Maps <paramref name="snapshot"/>'s raw <c>Values["scene"]</c> string:
        /// the RAW <c>GameScenes</c> enum name KspHost captured, to the
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
        /// Maps one raw kerbal dict (KspHost's <c>BuildCrewEntry</c> shape) to
        /// the <c>CrewRosterEntry</c> wire shape shared by the hired-crew
        /// roster and the Astronaut Complex applicant pool.
        ///
        /// <para>The STANDING is the elected <see cref="ICrewStandingBackend"/>'s
        /// answer, stamped into the raw dict at capture time (the same
        /// capture→provider split <see cref="BuildScene"/> uses), and
        /// <c>situation</c> / <c>available</c> / <c>unavailableReason</c> are all
        /// derived from it here. That is the point of the capability: KSP's own
        /// roster status is NOT the answer under a career overhaul, so the
        /// derivation has to hang off the corrected standing rather than off the
        /// ordinal, or a retiree reaches the wire as a fatality. The raw ordinal
        /// still goes out beside it as <c>situationOrdinal</c>, because what KSP
        /// itself holds is worth knowing.</para>
        ///
        /// <para>The backend may override <c>available</c> and
        /// <c>unavailableReason</c> in its own words; absent an override the
        /// derivation from the standing stands. An applicant reads as available
        /// with no reason, since nothing blocks hiring one.</para>
        /// </summary>
        private static Dictionary<string, object?> BuildCrewEntryPayload(IDictionary<string, object?> raw)
        {
            var ordinal = SnapshotDict.GetInt(raw, "rosterStatusOrdinal");
            var isApplicant = SnapshotDict.GetBool(raw, "isApplicant") == true;
            var inactive = SnapshotDict.GetBool(raw, "inactive");
            var resolution = ReadResolution(raw, ordinal, isApplicant, inactive);

            return new Dictionary<string, object?>
            {
                ["name"] = SnapshotDict.GetString(raw, "name"),
                ["trait"] = SnapshotDict.GetString(raw, "trait"),
                ["experienceLevel"] = SnapshotDict.GetInt(raw, "experienceLevel"),
                ["available"] = resolution.Available,
                ["unavailableReason"] = resolution.UnavailableReason,
                ["standing"] = (int)resolution.Standing,
                ["standingSource"] = resolution.Source,
                ["standingEndsAtUt"] = resolution.StandingEndsAtUt,
                ["retiresAtUt"] = resolution.RetiresAtUt,
                ["situation"] = resolution.Standing.ToString(),
                // An applicant is not in the roster, so it has no RosterStatus
                // to report - a real distinction, not a missing value.
                ["situationOrdinal"] = isApplicant ? null : ordinal,
                ["isApplicant"] = isApplicant,
                ["inactive"] = inactive,
                // A kerbal on duty carries whatever the last rest period left
                // in the field, so quoting it would date a rest already over.
                ["inactiveUntilUt"] = inactive == true ? SnapshotDict.GetDouble(raw, "inactiveUntilUt") : null,
                ["courage"] = SnapshotDict.GetDouble(raw, "courage"),
                ["stupidity"] = SnapshotDict.GetDouble(raw, "stupidity"),
                ["experience"] = SnapshotDict.GetDouble(raw, "experience"),
                ["experienceLevelDelta"] = SnapshotDict.GetDouble(raw, "experienceLevelDelta"),
                ["roleDescription"] = SnapshotDict.GetString(raw, "roleDescription"),
                ["descriptionEffects"] = SnapshotDict.GetString(raw, "descriptionEffects"),
            };
        }

        /// <summary>
        /// The standing the capture stamped, falling back to the stock mapping
        /// when no backend was reachable.
        ///
        /// <para>The fallback is the contract's own
        /// <see cref="CrewStandings.Resolve"/> with no reading, called rather than
        /// copied, so a bare host with no Kernel wired (a unit test, or the window
        /// before capabilities resolve) publishes exactly what a stock install
        /// publishes and never a hole. Going through <c>Resolve</c> rather than
        /// re-deriving here is the point: the availability and the wording used to
        /// be computed in this file from the standing alone, so a kerbal standing
        /// down reached the wire free to fly. There is now one derivation and this
        /// is a caller of it. What the fallback does NOT do is invent a
        /// correction: without a backend there is no retiree set to consult.</para>
        /// </summary>
        private static CrewStandingResolution ReadResolution(
            IDictionary<string, object?> raw,
            int? ordinal,
            bool isApplicant,
            bool? inactive)
        {
            var stamped = SnapshotDict.GetInt(raw, "standing");
            var query = new CrewStandingQuery
            {
                KerbalName = SnapshotDict.GetString(raw, "name") ?? "",
                RosterStatusOrdinal = isApplicant ? null : ordinal,
                IsApplicant = isApplicant,
                Inactive = inactive == true,
                InactiveUntilUt = SnapshotDict.GetDouble(raw, "inactiveUntilUt"),
            };
            if (stamped == null)
            {
                return CrewStandings.Resolve(query, null, null);
            }

            // The capture already ran the derivation against a live backend, so
            // its answers are authoritative and are read as a reading rather than
            // recomputed: recomputing would discard a backend's own wording and,
            // for a Training standing, the course ETA this side cannot see.
            return CrewStandings.Resolve(
                query,
                new CrewStandingReading
                {
                    Standing = (CrewStanding)stamped.Value,
                    Available = SnapshotDict.GetBool(raw, "standingAvailable"),
                    UnavailableReason = SnapshotDict.GetString(raw, "standingUnavailableReason"),
                    StandingEndsAtUt = SnapshotDict.GetDouble(raw, "standingEndsAtUt"),
                    RetiresAtUt = SnapshotDict.GetDouble(raw, "retiresAtUt"),
                },
                SnapshotDict.GetString(raw, "standingSource"));
        }

        /// <summary>
        /// Maps <paramref name="snapshot"/>'s raw
        /// <c>Values["spaceCenter"]["crewRoster"]</c> list to the
        /// <c>spaceCenter.crewRoster</c> payload: a BARE <c>List&lt;object?&gt;</c>
        /// (matching <c>isArray: true</c>), one dict per kerbal mapped by
        /// <see cref="BuildCrewEntryPayload"/>. Returns <c>null</c>, not an
        /// empty list: when the snapshot carries no <c>crewRoster</c> key (no
        /// sample landed yet), distinct from a genuinely empty roster.
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

                crew.Add(BuildCrewEntryPayload(raw));
            }

            return crew;
        }

        /// <summary>
        /// Maps <paramref name="snapshot"/>'s raw
        /// <c>Values["spaceCenter"]["astronautComplex"]</c> dict to the
        /// <c>spaceCenter.astronautComplex</c> payload: a wrapper object mirroring
        /// <see cref="AstronautComplexInfo"/> (the applicant pool plus the
        /// facility-cap context and next-hire cost a hire is gated on).
        /// <c>applicants</c> is mapped per-entry by <see cref="BuildCrewEntryPayload"/>,
        /// the same shape as the hired-crew roster; the numeric header fields
        /// are a straight re-map through <see cref="SnapshotDict"/>'s readers.
        /// Returns <c>null</c> (the SANDBOX / no-career / no-game case) when the
        /// snapshot carries no <c>astronautComplex</c> key at all, distinct from a
        /// career save whose pool is genuinely empty (a non-null payload with an
        /// empty <c>applicants</c> list).
        /// </summary>
        public static object? BuildAstronautComplex(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null)
            {
                return null;
            }

            if (!snapshot.Values.TryGetValue("spaceCenter", out var rawGroup) || rawGroup is not IDictionary<string, object?> group)
            {
                return null;
            }

            if (!group.TryGetValue("astronautComplex", out var rawComplex) || rawComplex is not IDictionary<string, object?> raw)
            {
                return null;
            }

            var applicants = new List<object?>();
            if (raw.TryGetValue("applicants", out var rawApplicants) && rawApplicants is IEnumerable<object?> applicantList)
            {
                foreach (var rawEntry in applicantList)
                {
                    if (rawEntry is not IDictionary<string, object?> entry)
                    {
                        continue;
                    }

                    applicants.Add(BuildCrewEntryPayload(entry));
                }
            }

            return new Dictionary<string, object?>
            {
                ["applicants"] = applicants,
                ["activeCrew"] = SnapshotDict.GetInt(raw, "activeCrew"),
                ["crewCapacity"] = SnapshotDict.GetInt(raw, "crewCapacity"),
                ["nextHireCost"] = SnapshotDict.GetDouble(raw, "nextHireCost"),
            };
        }

        /// <summary>
        /// Maps <paramref name="snapshot"/>'s raw
        /// <c>Values["spaceCenter"]["savedShips"]</c> list to the
        /// <c>spaceCenter.savedShips</c> payload: a BARE <c>List&lt;object?&gt;</c>
        /// (matching <c>isArray: true</c>), one dict per craft file mirroring
        /// <see cref="SavedShipEntry"/> field-for-field. Every value is already a
        /// primitive KspHost read off <c>CraftProfileInfo</c>, so this is a
        /// straight re-map (no enum fold), with <c>missingParts</c> copied to a
        /// fresh string list. Returns <c>null</c> (not an empty list) when the
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
                ["facilityOrdinal"] = SnapshotDict.GetInt(raw, "facilityOrdinal"),
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
        /// Maps <paramref name="snapshot"/>'s raw <c>launchSites</c> and
        /// <c>contractTargets</c> sub-lists to the <c>spaceCenter.pois</c>
        /// payload: a BARE <c>List&lt;object?&gt;</c> (matching
        /// <c>isArray: true</c>) combining both sources into one flat roster,
        /// mirroring <see cref="SpaceCenterPoiEntry"/> field-for-field.
        ///
        /// <para>Launch sites without a set spawn-point coordinate are
        /// skipped (no fabricated <c>(0,0)</c> sentinel, the same "null,
        /// never a sentinel" discipline <see cref="BuildLaunchSites"/>'s
        /// <c>bodyIndex</c> follows); a stock site (<c>isStock</c>) maps to
        /// <c>Kind = "ksc"</c>, everything else to <c>"launchSite"</c>.
        /// Contract targets are filtered to <c>isOnSurface</c> AND a raw
        /// <c>contractState</c> of <c>"Active"</c> or <c>"Offered"</c>: the
        /// inclusion decision this KSP-free layer owns (the capture side
        /// passes every waypoint's raw state through unfiltered, same
        /// capture→provider split <see cref="BuildCrewRoster"/> uses for
        /// <c>rosterStatus</c>); <c>Active</c> maps to <c>Status = "active"</c>,
        /// <c>Offered</c> to <c>"available"</c>.</para>
        ///
        /// <para><c>body</c>/<c>celestialName</c> (captured body/celestial
        /// NAMEs) resolve to a <see cref="SystemBodies"/> index via
        /// <see cref="SharedMappers.ResolveBodyIndex"/>, the SAME pattern
        /// <see cref="BuildLaunchSites"/> uses (never a fabricated sentinel
        /// index). Returns <c>null</c>, not an empty list, when the snapshot
        /// carries no <c>spaceCenter</c> group at all (no sample landed yet),
        /// so a caller distinguishes "no data yet" from "zero POIs."</para>
        ///
        /// <para><c>contractDateDeadline</c> folds the raw <c>0.0</c> stock
        /// KSP uses as <c>Contract.DateDeadline</c>'s "no deadline set"
        /// sentinel (confirmed via decompile) onto <c>null</c>:
        /// <see cref="SnapshotDict.GetDouble"/> only nulls
        /// <c>NaN</c>/<c>Infinity</c>/absent, so an un-folded <c>0</c> would
        /// otherwise read as "overdue since epoch" for every no-deadline
        /// contract.</para>
        /// </summary>
        public static object? BuildPois(KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null)
            {
                return null;
            }

            if (!snapshot.Values.TryGetValue("spaceCenter", out var rawGroup) || rawGroup is not IDictionary<string, object?> group)
            {
                return null;
            }

            var pois = new List<object?>();

            if (group.TryGetValue("launchSites", out var rawSites) && rawSites is IEnumerable<object?> siteList)
            {
                foreach (var rawEntry in siteList)
                {
                    if (rawEntry is not IDictionary<string, object?> raw)
                    {
                        continue;
                    }

                    var (latitude, longitude) = ReadLaunchSiteSpawn(raw);
                    if (latitude == null || longitude == null)
                    {
                        continue;
                    }

                    var name = SnapshotDict.GetString(raw, "name");
                    var bodyName = SnapshotDict.GetString(raw, "body");
                    int? bodyIndex = bodyName != null ? SharedMappers.ResolveBodyIndex(snapshot, bodyName) : null;
                    var isStock = SnapshotDict.GetBool(raw, "isStock") ?? false;

                    pois.Add(new Dictionary<string, object?>
                    {
                        ["id"] = name != null ? "launchSite:" + name : null,
                        ["kind"] = isStock ? "ksc" : "launchSite",
                        ["bodyIndex"] = bodyIndex,
                        ["latitude"] = latitude,
                        ["longitude"] = longitude,
                        ["label"] = SnapshotDict.GetString(raw, "displayName") ?? name,
                        ["status"] = null,
                        ["contractAgent"] = null,
                        ["contractFundsAdvance"] = null,
                        ["contractFundsCompletion"] = null,
                        ["contractDateDeadline"] = null,
                    });
                }
            }

            if (group.TryGetValue("contractTargets", out var rawTargets) && rawTargets is IEnumerable<object?> targetList)
            {
                foreach (var rawEntry in targetList)
                {
                    if (rawEntry is not IDictionary<string, object?> raw)
                    {
                        continue;
                    }

                    if (SnapshotDict.GetBool(raw, "isOnSurface") != true)
                    {
                        continue;
                    }

                    var status = MapContractStatus(SnapshotDict.GetString(raw, "contractState"));
                    if (status == null)
                    {
                        continue;
                    }

                    var navigationId = SnapshotDict.GetString(raw, "navigationId");
                    var celestialName = SnapshotDict.GetString(raw, "celestialName");
                    int? bodyIndex = celestialName != null ? SharedMappers.ResolveBodyIndex(snapshot, celestialName) : null;

                    // Stock KSP uses 0.0 as Contract.DateDeadline's "no deadline
                    // set" sentinel (confirmed via decompile against
                    // Assembly-CSharp.dll) - SnapshotDict.GetDouble only folds
                    // NaN/Infinity/absent to null, so the raw 0 would otherwise
                    // ride straight onto the wire and read as "overdue since
                    // epoch." Folded here, in this KSP-free transform layer,
                    // mirroring the sentinel folds this file already applies
                    // (bodyIndex's "never a fabricated index", the launch-site
                    // "no set spawn point" skip above).
                    var deadline = SnapshotDict.GetDouble(raw, "contractDateDeadline");
                    if (deadline == 0.0)
                    {
                        deadline = null;
                    }

                    pois.Add(new Dictionary<string, object?>
                    {
                        ["id"] = navigationId != null ? "contract:" + navigationId : null,
                        ["kind"] = "contractTarget",
                        ["bodyIndex"] = bodyIndex,
                        ["latitude"] = SnapshotDict.GetDouble(raw, "latitude"),
                        ["longitude"] = SnapshotDict.GetDouble(raw, "longitude"),
                        ["label"] = SnapshotDict.GetString(raw, "contractTitle"),
                        ["status"] = status,
                        ["contractAgent"] = SnapshotDict.GetString(raw, "contractAgent"),
                        ["contractFundsAdvance"] = SnapshotDict.GetDouble(raw, "contractFundsAdvance"),
                        ["contractFundsCompletion"] = SnapshotDict.GetDouble(raw, "contractFundsCompletion"),
                        ["contractDateDeadline"] = deadline,
                    });
                }
            }

            return pois;
        }

        /// <summary>
        /// Folds a raw <c>Contracts.Contract.State</c> enum name onto the
        /// <c>spaceCenter.pois</c> status a widget reads: <c>Active</c> →
        /// <c>"active"</c>, <c>Offered</c> → <c>"available"</c>, every other
        /// state (Completed/Failed/Declined/...) → <c>null</c>, which
        /// <see cref="BuildPois"/> reads as "exclude this waypoint." Kept
        /// internal-static so the provider test can assert the mapping
        /// without a KSP reference.
        /// </summary>
        internal static string? MapContractStatus(string? rawState)
        {
            return rawState switch
            {
                "Active" => "active",
                "Offered" => "available",
                _ => null,
            };
        }

        /// <summary>
        /// Pulls the raw <c>Values["spaceCenter"][<paramref name="key"/>]</c>
        /// sub-list, or <c>null</c> when the snapshot has no <c>spaceCenter</c>
        /// group or the sub-key is absent, the "no sample yet" signal shared by
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
        /// <c>null</c>) when the field is absent, a craft with no missing parts
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
        /// <c>TRACKSTATION</c> (verified via decompile): not the
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
