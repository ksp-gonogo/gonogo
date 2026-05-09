using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using KSP.UI.Screens;
using Telemachus;

namespace GonogoTelemetry
{
    /// <summary>
    /// Surfaces Space Center / launch-site state — building levels, the
    /// parts catalogue under current tech, and the rosters the
    /// launch-director widget will consume in Phase 4.
    ///
    /// Keys (all global, vessel param ignored):
    ///
    /// - `kc.facilityLevels` — dict keyed by facility short-name
    ///   (`launchPad`, `vab`, …) of `{ level, max }`. `upgradeFunds` is
    ///   intentionally omitted: pulling next-upgrade cost reliably needs
    ///   `UpgradeableObject` instances that only exist in the Space
    ///   Center scene. Exposed via a follow-up once we've validated the
    ///   read path in-game.
    /// - `kc.partsAvailable` — int. Same source as `tech.unlockedPartCount`
    ///   but namespaced under kc for the Space Center widget; alias
    ///   rather than duplicate logic.
    /// - `kc.launchSite` — string, the active flight's launch site name.
    ///   Empty when not in flight.
    /// - `kc.padOccupied` — bool. True iff there's an active vessel and
    ///   it's still on the pad / runway (situation == PRELAUNCH).
    /// - `kc.padVesselTitle` — string, vessel name when padOccupied; empty
    ///   otherwise.
    /// - `kc.savedShips` — array of `{ name, partCount, totalMass, facility }`
    ///   for every craft file under VAB + SPH. partCount / totalMass
    ///   come from the .craft ConfigNode; `requiresFunds` and
    ///   `missingParts` (career filtering) are stubbed empty for now —
    ///   they need a deeper part-walk that we can layer on once the
    ///   basic listing is verified.
    /// - `kc.crewRoster` — array of `{ name, trait, experienceLevel,
    ///   available, unavailableReason }`. `available` is false when the
    ///   kerbal is `Assigned`, `Missing`, `Dead`, or `Hospitalized`;
    ///   `unavailableReason` is the raw RosterStatus string for the
    ///   greyed-out tooltip in the launch-director widget.
    /// </summary>
    public class KscApi : IMinimalTelemachusPlugin
    {
        // Stock KSP facility ids. Mods (KK etc.) add more; this set is
        // the stable subset every save has.
        private static readonly Dictionary<string, string> Facilities =
            new Dictionary<string, string>
            {
                ["launchPad"] = "SpaceCenter/LaunchPad",
                ["runway"] = "SpaceCenter/Runway",
                ["vab"] = "SpaceCenter/VehicleAssemblyBuilding",
                ["sph"] = "SpaceCenter/SpaceplaneHangar",
                ["mission"] = "SpaceCenter/MissionControl",
                ["tracking"] = "SpaceCenter/TrackingStation",
                ["admin"] = "SpaceCenter/Administration",
                ["rd"] = "SpaceCenter/ResearchAndDevelopment",
                ["astronaut"] = "SpaceCenter/AstronautComplex",
            };

        public string[] Commands => new[]
        {
            "kc.facilityLevels",
            "kc.partsAvailable",
            "kc.launchSite",
            "kc.padOccupied",
            "kc.padVesselTitle",
            "kc.savedShips",
            "kc.crewRoster",
            "kc.scene",
        };

        public Func<Vessel, string[], object> GetAPIHandler(string api)
        {
            switch (api)
            {
                case "kc.facilityLevels":
                    return (_, __) => FacilityLevels();
                case "kc.partsAvailable":
                    return (_, __) => PartsAvailable();
                case "kc.launchSite":
                    return (_, __) => LaunchSite();
                case "kc.padOccupied":
                    return (v, __) => PadOccupied(v);
                case "kc.padVesselTitle":
                    return (v, __) => PadVesselTitle(v);
                case "kc.savedShips":
                    return (_, __) => SavedShips();
                case "kc.crewRoster":
                    return (_, __) => CrewRoster();
                case "kc.scene":
                    return (_, __) => Scene();
                default:
                    return null;
            }
        }

        private static object Scene()
        {
            // The widget side cares about a small set: Flight, SpaceCenter,
            // Editor, TrackingStation, MainMenu. Anything else collapses to
            // "Other" so widgets can do `=== "Flight"` checks without
            // worrying about edge scenes (loading, mission builder, etc.).
            switch (HighLogic.LoadedScene)
            {
                case GameScenes.FLIGHT:
                    return "Flight";
                case GameScenes.SPACECENTER:
                    return "SpaceCenter";
                case GameScenes.EDITOR:
                    return "Editor";
                case GameScenes.TRACKSTATION:
                    return "TrackingStation";
                case GameScenes.MAINMENU:
                    return "MainMenu";
                default:
                    return "Other";
            }
        }

        private static object FacilityLevels()
        {
            var result = new Dictionary<string, object>();
            foreach (var pair in Facilities)
            {
                try
                {
                    // GetFacilityLevel returns 0..1 (normalised across max
                    // upgrade tiers). Convert to integer level by
                    // multiplying by (count - 1); count is the number of
                    // tiers including tier 0.
                    var normalised = ScenarioUpgradeableFacilities.GetFacilityLevel(pair.Value);
                    var max = ScenarioUpgradeableFacilities.GetFacilityLevelCount(pair.Value);
                    var level = max > 0 ? (int)Math.Round(normalised * max) : 0;
                    result[pair.Key] = new Dictionary<string, object>
                    {
                        ["level"] = level,
                        ["max"] = max,
                    };
                }
                catch (Exception)
                {
                    // Sandbox saves have no upgrade scenario module; the
                    // call throws. Surface tier 0 / max 0 so the widget
                    // can render a "—" cell rather than crashing.
                    result[pair.Key] = new Dictionary<string, object>
                    {
                        ["level"] = 0,
                        ["max"] = 0,
                    };
                }
            }
            return result;
        }

        private static object PartsAvailable()
        {
            if (PartLoader.LoadedPartsList == null) return 0;
            var count = 0;
            foreach (var part in PartLoader.LoadedPartsList)
            {
                if (ResearchAndDevelopment.PartTechAvailable(part)) count++;
            }
            return count;
        }

        private static object LaunchSite()
        {
            try { return FlightDriver.LaunchSiteName ?? string.Empty; }
            catch (Exception) { return string.Empty; }
        }

        private static object PadOccupied(Vessel vessel)
        {
            if (vessel == null) return false;
            return vessel.situation == Vessel.Situations.PRELAUNCH;
        }

        private static object PadVesselTitle(Vessel vessel)
        {
            if (vessel == null) return string.Empty;
            if (vessel.situation != Vessel.Situations.PRELAUNCH) return string.Empty;
            return vessel.vesselName ?? string.Empty;
        }

        private static object SavedShips()
        {
            var result = new List<Dictionary<string, object>>();
            var saveFolder = HighLogic.SaveFolder;
            if (string.IsNullOrEmpty(saveFolder)) return result;
            var rootPath = Path.Combine(KSPUtil.ApplicationRootPath, "saves");
            rootPath = Path.Combine(rootPath, saveFolder);
            rootPath = Path.Combine(rootPath, "Ships");
            if (!Directory.Exists(rootPath)) return result;

            foreach (var facility in new[] { "VAB", "SPH" })
            {
                var dir = Path.Combine(rootPath, facility);
                if (!Directory.Exists(dir)) continue;
                foreach (var craftPath in Directory.GetFiles(dir, "*.craft"))
                {
                    result.Add(SerialiseCraftFile(craftPath, facility));
                }
            }
            return result;
        }

        private static Dictionary<string, object> SerialiseCraftFile(
            string craftPath, string facility)
        {
            var name = Path.GetFileNameWithoutExtension(craftPath);
            int partCount = 0;
            double totalMass = 0;
            double requiresFunds = 0;
            var missing = new HashSet<string>();

            try
            {
                var node = ConfigNode.Load(craftPath);
                if (node != null)
                {
                    var partNodes = node.GetNodes("PART");
                    partCount = partNodes.Length;
                    foreach (var p in partNodes)
                    {
                        WalkPart(p, ref totalMass, ref requiresFunds, missing);
                    }
                }
            }
            catch (Exception)
            {
                // Corrupt or in-progress .craft — surface the file with
                // whatever we managed to read rather than dropping it.
            }

            return new Dictionary<string, object>
            {
                ["name"] = name,
                ["partCount"] = partCount,
                ["totalMass"] = totalMass,
                ["facility"] = facility,
                ["requiresFunds"] = requiresFunds,
                // List ordering is unstable across runs but the contents
                // matter (UI dedupes / counts), so a HashSet → List<string>
                // is the cheapest way to keep it predictable.
                ["missingParts"] = new List<string>(missing),
            };
        }

        // Stripping the craft-file part-id suffix.  The .craft format writes
        // each part as `<partName>_<flightId>` (or sometimes the same shape
        // under the `part = ` field instead of `name`). PartLoader keys by
        // `<partName>` only, so we need everything before the last `_<digits>`.
        private static string ExtractPartName(ConfigNode partNode)
        {
            var raw = partNode.HasValue("name")
                ? partNode.GetValue("name")
                : partNode.HasValue("part")
                    ? partNode.GetValue("part")
                    : null;
            if (string.IsNullOrEmpty(raw)) return null;
            var underscore = raw.LastIndexOf('_');
            if (underscore <= 0) return raw;
            // Only strip if the suffix is all digits — preserves part names
            // that legitimately contain underscores (e.g. mod parts).
            for (var i = underscore + 1; i < raw.Length; i++)
            {
                if (raw[i] < '0' || raw[i] > '9') return raw;
            }
            return raw.Substring(0, underscore);
        }

        private static void WalkPart(ConfigNode partNode,
            ref double totalMass, ref double requiresFunds,
            HashSet<string> missing)
        {
            var partName = ExtractPartName(partNode);
            // Always count the dry mass declared on the PART node — even
            // if we can't resolve the prefab, the mass field is reliable.
            if (partNode.HasValue("mass") &&
                double.TryParse(partNode.GetValue("mass"), out var dryMass))
                totalMass += dryMass;

            AvailablePart available = null;
            if (!string.IsNullOrEmpty(partName) && PartLoader.LoadedPartsList != null)
            {
                foreach (var ap in PartLoader.LoadedPartsList)
                {
                    if (ap != null && ap.name == partName)
                    {
                        available = ap;
                        break;
                    }
                }
            }

            if (available == null)
            {
                if (!string.IsNullOrEmpty(partName)) missing.Add(partName);
            }
            else
            {
                requiresFunds += available.cost;
                if (ResearchAndDevelopment.Instance != null &&
                    !ResearchAndDevelopment.PartTechAvailable(available))
                    missing.Add(partName);
            }

            // Resources contribute both mass and funds. Read amount per
            // RESOURCE subnode and look up density / unitCost from the
            // global resource library.
            foreach (var resNode in partNode.GetNodes("RESOURCE"))
            {
                if (!resNode.HasValue("name")) continue;
                if (!resNode.HasValue("amount")) continue;
                if (!double.TryParse(resNode.GetValue("amount"), out var amount)) continue;
                var def = PartResourceLibrary.Instance?.GetDefinition(
                    resNode.GetValue("name"));
                if (def == null) continue;
                totalMass += amount * def.density;
                requiresFunds += amount * def.unitCost;
            }
        }

        private static object CrewRoster()
        {
            var result = new List<Dictionary<string, object>>();
            var roster = HighLogic.CurrentGame?.CrewRoster;
            if (roster == null) return result;

            foreach (var kerbal in roster.Crew)
            {
                if (kerbal == null) continue;
                var status = kerbal.rosterStatus.ToString();
                var available = kerbal.rosterStatus == ProtoCrewMember.RosterStatus.Available;
                result.Add(new Dictionary<string, object>
                {
                    ["name"] = kerbal.name ?? string.Empty,
                    ["trait"] = kerbal.trait ?? string.Empty,
                    ["experienceLevel"] = kerbal.experienceLevel,
                    ["available"] = available,
                    ["unavailableReason"] = available ? string.Empty : status,
                });
            }
            return result;
        }
    }
}
