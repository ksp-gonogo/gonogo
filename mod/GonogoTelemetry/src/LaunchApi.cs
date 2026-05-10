using System;
using System.Collections.Generic;
using System.IO;
using KSP.UI.Screens;
using Telemachus;

namespace GonogoTelemetry
{
    /// <summary>
    /// Launch / recover / revert verbs for the Launch Director widget.
    ///
    /// Keys (all global — `Vessel` argument optional):
    ///
    /// - `ksp.launch[shipName,facility,site,crewSemicolons]` — load a
    ///   saved craft to the chosen pad. `crewSemicolons` is a
    ///   semicolon-separated list of kerbal names (Telemachus splits
    ///   action args on comma, so commas would land in the wrong field;
    ///   we use ';' inside the crew slot). Empty crew = launch unmanned.
    ///   Refuses unless KSP is in the Space Center / Editor scene.
    /// - `ksp.recover` — recover the active vessel. Refuses unless the
    ///   vessel is recoverable (PRELAUNCH / LANDED / SPLASHED). Fires
    ///   `GameEvents.OnVesselRecoveryRequested` so KSP runs its standard
    ///   refund + crew-roster path.
    /// - `ksp.revertToEditor[vab|sph]` — revert flight back to the named
    ///   editor scene with the same craft loaded. Refuses unless KSP is
    ///   in flight.
    ///
    /// Scene transitions are queued onto the main thread via
    /// `GonogoTelemetryAddon.Defer` — Telemachus handlers run off the
    /// HTTP/WS thread, calling `FlightDriver.StartWithNewLaunch` etc.
    /// directly from there crashes.
    /// </summary>
    public class LaunchApi : IMinimalTelemachusPlugin
    {
        public string[] Commands => new[]
        {
            "ksp.launch",
            "ksp.recover",
            "ksp.revertToEditor",
        };

        public Func<Vessel, string[], object> GetAPIHandler(string api)
        {
            switch (api)
            {
                case "ksp.launch":
                    return (_, args) => Launch(args);
                case "ksp.recover":
                    return (v, _) => Recover(v);
                case "ksp.revertToEditor":
                    return (_, args) => RevertToEditor(args);
                default:
                    return null;
            }
        }

        private static object Launch(string[] args)
        {
            if (args == null || args.Length < 3)
                return "expected [shipName,facility,site,crew]";
            var shipName = args[0];
            var facility = args[1];
            var site = args[2];
            var crewArg = args.Length >= 4 ? args[3] : string.Empty;

            if (string.IsNullOrEmpty(shipName)) return "missing ship name";

            // FlightDriver.StartWithNewLaunch only behaves cleanly when
            // KSP is in the Space Center or an editor.  Refuse loudly
            // rather than risk an undefined mid-flight transition.
            if (HighLogic.LoadedScene != GameScenes.SPACECENTER &&
                HighLogic.LoadedScene != GameScenes.EDITOR)
                return "not in a launchable scene";

            // Defensive: even at SC, if there's an ActiveVessel from a
            // prior flight that hasn't been recovered/destroyed yet,
            // launching another wedges KSP — observed in-session as a
            // frozen Flight scene with maxed-out UT counters. Refuse so
            // the operator recovers the existing vessel first.
            if (FlightGlobals.ActiveVessel != null)
                return "active vessel exists — recover or revert before launching";

            var saveFolder = HighLogic.SaveFolder;
            if (string.IsNullOrEmpty(saveFolder)) return "no active save";
            var craftPath = Path.Combine(KSPUtil.ApplicationRootPath, "saves");
            craftPath = Path.Combine(craftPath, saveFolder);
            craftPath = Path.Combine(craftPath, "Ships");
            craftPath = Path.Combine(craftPath, facility);
            craftPath = Path.Combine(craftPath, shipName + ".craft");
            if (!File.Exists(craftPath)) return "craft file not found";

            var crewNames = string.IsNullOrEmpty(crewArg)
                ? Array.Empty<string>()
                : crewArg.Split(';');

            // Build a VesselCrewManifest by reading the .craft to find the
            // command pod / crew capacity, then assigning the named crew
            // to the first available seats. KSP exposes
            // `VesselCrewManifest.FromConfigNode` for this; if the
            // manifest is null the vessel launches unmanned.
            VesselCrewManifest manifest = null;
            try
            {
                var craftNode = ConfigNode.Load(craftPath);
                if (craftNode != null && crewNames.Length > 0)
                {
                    manifest = VesselCrewManifest.FromConfigNode(craftNode);
                    AssignCrew(manifest, crewNames);
                }
            }
            catch (Exception ex)
            {
                return "manifest build failed: " + ex.Message;
            }

            // Resolve flag URL — fall back to stock flag if the player
            // hasn't picked one (the launch path needs *something* there).
            var flagUrl = HighLogic.CurrentGame?.flagURL ?? "Squad/Flags/default";

            // Defer onto the main thread.  KSP's scene loader is not
            // re-entrant from a non-main thread.
            GonogoTelemetryAddon.Defer(() =>
            {
                FlightDriver.StartWithNewLaunch(craftPath, flagUrl, site, manifest);
            });
            return 0;
        }

        private static void AssignCrew(VesselCrewManifest manifest,
            string[] crewNames)
        {
            if (manifest == null || crewNames == null) return;
            var roster = HighLogic.CurrentGame?.CrewRoster;
            if (roster == null) return;

            // VesselCrewManifest holds part-level manifests on
            // PartManifests (List<PartCrewManifest>). The seat count
            // varies per part — we just probe AddCrewToSeat with
            // increasing indices and break on a slot that already has
            // someone (KSP's PartCrewManifest internally validates the
            // seat index against the part's crewCapacity).
            var queue = new Queue<string>(crewNames);
            foreach (var partManifest in manifest.PartManifests)
            {
                if (partManifest == null) continue;
                if (queue.Count == 0) return;
                var existing = partManifest.GetPartCrew();
                if (existing == null) continue;
                for (var i = 0; i < existing.Length && queue.Count > 0; i++)
                {
                    if (existing[i] != null) continue; // seat occupied
                    var kerbalName = queue.Dequeue();
                    if (string.IsNullOrEmpty(kerbalName)) continue;
                    var kerbal = roster[kerbalName];
                    if (kerbal == null) continue;
                    if (kerbal.rosterStatus !=
                        ProtoCrewMember.RosterStatus.Available) continue;
                    partManifest.AddCrewToSeat(kerbal, i);
                }
            }
        }

        private static object Recover(Vessel vessel)
        {
            if (vessel == null) return "no active vessel";
            // Stock recoverable situations.
            var s = vessel.situation;
            if (s != Vessel.Situations.PRELAUNCH &&
                s != Vessel.Situations.LANDED &&
                s != Vessel.Situations.SPLASHED)
                return "vessel not in a recoverable state";

            GonogoTelemetryAddon.Defer(() =>
            {
                // GameEvents.OnVesselRecoveryRequested is EventData<Vessel>
                // per the decompiled API surface — the lowercase event
                // doesn't exist; the only similar lowercase one is
                // onVesselRecovered which is the post-recovery
                // notification, not the request. Fire the request and
                // KSP runs its standard refund + crew transfer flow.
                GameEvents.OnVesselRecoveryRequested.Fire(vessel);
            });
            return 0;
        }

        private static object RevertToEditor(string[] args)
        {
            if (args == null || args.Length == 0) return "expected [vab|sph]";
            var which = args[0];
            EditorFacility facility;
            if (string.Equals(which, "vab", StringComparison.OrdinalIgnoreCase))
                facility = EditorFacility.VAB;
            else if (string.Equals(which, "sph", StringComparison.OrdinalIgnoreCase))
                facility = EditorFacility.SPH;
            else return "expected vab or sph";

            if (HighLogic.LoadedScene != GameScenes.FLIGHT)
                return "not in flight";

            GonogoTelemetryAddon.Defer(() =>
            {
                FlightDriver.RevertToPrelaunch(facility);
            });
            return 0;
        }
    }
}
