using System;
using KSP.UI.Screens;
using Sitrep.Contract;
using Sitrep.Host;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The real <see cref="IVesselActuator"/> — M1 Task 3's KSP-actuation
    /// seam, wired to <c>Vessel.ActionGroups</c>/<c>VesselAutopilot</c>/
    /// <c>FlightInputHandler</c>/<c>StageManager</c>/
    /// <c>Vessel.patchedConicSolver</c>/<c>FlightGlobals</c>/<c>TimeWarp</c>/
    /// <c>FlightDriver</c> — confirmed against this KSP version's actual API
    /// shapes via decompile (see each method's own comment for the specific
    /// call). Every method operates on <c>FlightGlobals.ActiveVessel</c> —
    /// there is no per-call vessel selector, matching every M1 read channel's
    /// "the vessel" scoping.
    ///
    /// <para><b>This is now the SECOND class in the mod that touches KSP/
    /// Unity APIs directly</b> — see <see cref="KspHost"/>'s doc comment,
    /// written before this class existed, for the READ-side half of that
    /// invariant ("the only class that touches KSP" was true for sampling;
    /// this is its actuation counterpart, deliberately separated by
    /// direction of data flow rather than folded into <see cref="KspHost"/>
    /// itself).</para>
    ///
    /// <para><b>Known, deliberately-deferred gap — main-thread marshaling:</b>
    /// <see cref="ChannelEngine"/> currently invokes every registered command
    /// handler (delayed or not) from its own Courier thread (see
    /// <c>ChannelEngine.ProcessDispatchCommand</c>/<c>InvokeCommandHandler</c>),
    /// never from Unity's main thread. Calling live Unity/KSP APIs from a
    /// background thread is exactly the class of bug the RETIRED
    /// <c>GonogoTelemetry</c> staging plugin already hit and fixed via
    /// <c>GonogoTelemetryAddon.Defer</c> (see <c>LaunchApi</c>'s doc comment)
    /// for its scene-transition commands — the same fix (a main-thread job
    /// queue <see cref="GonogoAddon"/> drains every <c>FixedUpdate</c>, with
    /// the command handler blocking the Courier thread until the queued
    /// action completes) is the natural follow-up here, but is NOT wired in
    /// this task: M1 Task 3's scope is the typed command contract, the
    /// actuator seam's API shape, and engine-level delay-disposition
    /// dispatch — proven against <c>Sitrep.Host.Tests.FakeVesselActuator</c>,
    /// never this class, which is untested by design (see the task's own
    /// "commands are live-only for real firing — test the seam, not KSP"
    /// scoping note). Live-firing THIS class before the marshaling fix lands
    /// risks exactly the crash <c>LaunchApi</c>'s comment describes.</para>
    /// </summary>
    public sealed class KspVesselActuator : IVesselActuator
    {
        // M3 R3: this is now the SAME ReferenceIdRegistry<ManeuverNode>
        // instance KspHost's read-side BuildManeuverNodes assigns ids from
        // (GonogoAddon.Awake constructs one and hands it to both) — see
        // that class's doc comment. Before this change, this actuator kept
        // its OWN throwaway Dictionary<string, ManeuverNode>, so
        // update/remove only ever worked for a node created THROUGH
        // AddManeuverNode; a node the player placed by hand in the map view
        // had no id at all and could never be referenced. Sharing the
        // registry closes that gap: GetOrAssign returns the SAME id
        // regardless of which side (read sampling or this AddManeuverNode
        // call) sees a given node object first.
        private readonly ReferenceIdRegistry<ManeuverNode> _maneuverNodeIdRegistry;

        public KspVesselActuator(ReferenceIdRegistry<ManeuverNode> maneuverNodeIdRegistry)
        {
            _maneuverNodeIdRegistry = maneuverNodeIdRegistry;
        }

        public Ack SetSas(bool enabled) => WithActionGroups(actionGroups =>
        {
            actionGroups.SetGroup(KSPActionGroup.SAS, enabled);
            return Ack.Ok();
        });

        public Ack SetSasMode(SasMode mode)
        {
            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null || vessel.Autopilot == null)
            {
                return Ack.Fail("E_NO_VESSEL");
            }

            // SasMode.Unknown (the contract's own parse-fallback for an
            // unrecognized READ value -- see SasMode's doc comment) has no
            // matching real KSP AutopilotMode member; guard it explicitly
            // rather than casting an out-of-range int into a native enum.
            if (mode == SasMode.Unknown)
            {
                return Ack.Fail("E_MODE_UNAVAILABLE");
            }

            // VesselAutopilot.SetMode returns false when the requested mode
            // isn't currently available (e.g. Maneuver with no node queued,
            // Target with nothing targeted) -- see the decompile-confirmed
            // signature `bool SetMode(AutopilotMode mode)` /
            // `bool CanSetMode(AutopilotMode mode)`.
            return vessel.Autopilot.SetMode((VesselAutopilot.AutopilotMode)(int)mode)
                ? Ack.Ok()
                : Ack.Fail("E_MODE_UNAVAILABLE");
        }

        public Ack SetRcs(bool enabled) => WithActionGroups(actionGroups =>
        {
            actionGroups.SetGroup(KSPActionGroup.RCS, enabled);
            return Ack.Ok();
        });

        public Ack SetGear(bool enabled) => WithActionGroups(actionGroups =>
        {
            actionGroups.SetGroup(KSPActionGroup.Gear, enabled);
            return Ack.Ok();
        });

        public Ack SetBrakes(bool enabled) => WithActionGroups(actionGroups =>
        {
            actionGroups.SetGroup(KSPActionGroup.Brakes, enabled);
            return Ack.Ok();
        });

        public Ack SetLights(bool enabled) => WithActionGroups(actionGroups =>
        {
            actionGroups.SetGroup(KSPActionGroup.Light, enabled);
            return Ack.Ok();
        });

        public Ack SetAbort(bool enabled) => WithActionGroups(actionGroups =>
        {
            actionGroups.SetGroup(KSPActionGroup.Abort, enabled);
            return Ack.Ok();
        });

        /// <summary>
        /// Writes the ACTIVE vessel's commanded throttle via
        /// <c>FlightInputHandler.state.mainThrottle</c> -- the same static
        /// accessor KSP's own input pipeline reads/writes every frame (and
        /// clamps -- see <c>KspHost.BuildControl</c>'s doc comment on why
        /// <c>vessel.ctrlState.mainThrottle</c> itself is read-only ground
        /// truth downstream of this, not the write target).
        /// </summary>
        public Ack SetThrottle(double value)
        {
            if (FlightGlobals.ActiveVessel == null)
            {
                return Ack.Fail("E_NO_VESSEL");
            }
            FlightInputHandler.state.mainThrottle = (float)value;
            return Ack.Ok();
        }

        public StageResult Stage()
        {
            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null)
            {
                return new StageResult { Success = false, ErrorCode = "E_NO_VESSEL" };
            }
            StageManager.ActivateNextStage();
            return new StageResult { Success = true, NewStage = vessel.currentStage };
        }

        /// <summary>1..10 maps to <c>KSPActionGroup.Custom01..Custom10</c> -- validated by <see cref="VesselCommandProvider.HandleSetActionGroup"/> before this is ever called.</summary>
        public Ack SetActionGroup(int group, bool state) => WithActionGroups(actionGroups =>
        {
            var kspGroup = group switch
            {
                1 => KSPActionGroup.Custom01,
                2 => KSPActionGroup.Custom02,
                3 => KSPActionGroup.Custom03,
                4 => KSPActionGroup.Custom04,
                5 => KSPActionGroup.Custom05,
                6 => KSPActionGroup.Custom06,
                7 => KSPActionGroup.Custom07,
                8 => KSPActionGroup.Custom08,
                9 => KSPActionGroup.Custom09,
                10 => KSPActionGroup.Custom10,
                _ => KSPActionGroup.None,
            };
            if (kspGroup == KSPActionGroup.None)
            {
                return Ack.Fail("E_RANGE");
            }
            actionGroups.SetGroup(kspGroup, state);
            return Ack.Ok();
        });

        /// <summary>
        /// <c>ManeuverNode.DeltaV</c> is in the node's own radial/normal/
        /// prograde frame -- x=radialOut, y=normal, z=prograde (the project's
        /// own "Telemachus maneuver-node arg order" finding, re-confirmed by
        /// <c>KspHost.BuildManeuverNodes</c>' identical doc comment). This
        /// assignment must NOT be reordered.
        /// </summary>
        public AddManeuverNodeResult AddManeuverNode(double ut, double prograde, double normal, double radialOut)
        {
            var solver = FlightGlobals.ActiveVessel?.patchedConicSolver;
            if (solver == null)
            {
                return new AddManeuverNodeResult { Success = false, ErrorCode = "E_NO_VESSEL" };
            }

            var node = solver.AddManeuverNode(ut);
            node.DeltaV = new Vector3d(radialOut, normal, prograde);
            solver.UpdateFlightPlan();

            var nodeId = _maneuverNodeIdRegistry.GetOrAssign(node);
            return new AddManeuverNodeResult { Success = true, NodeId = nodeId };
        }

        public Ack UpdateManeuverNode(string nodeId, double ut, double prograde, double normal, double radialOut)
        {
            if (!TryResolveNode(nodeId, out var node) || node?.solver == null)
            {
                return Ack.Fail("E_NOT_FOUND");
            }

            node.UT = ut;
            node.DeltaV = new Vector3d(radialOut, normal, prograde);
            node.solver.UpdateFlightPlan();
            return Ack.Ok();
        }

        public Ack RemoveManeuverNode(string nodeId)
        {
            if (!TryResolveNode(nodeId, out var node))
            {
                return Ack.Fail("E_NOT_FOUND");
            }

            if (node?.solver != null)
            {
                node.solver.RemoveManeuverNode(node);
            }
            return Ack.Ok();
        }

        /// <summary>
        /// Resolves an opaque <paramref name="nodeId"/> back to a LIVE
        /// <c>ManeuverNode</c> by scanning the active vessel's CURRENT
        /// <c>solver.maneuverNodes</c> and matching against
        /// <see cref="_maneuverNodeIdRegistry"/> — never a cached reference
        /// from whenever the id was first assigned, since a stale node
        /// reference could otherwise outlive its own removal/a vessel
        /// switch. Fails (returns false) if there's no active vessel/solver,
        /// or no current node carries this id (either it was already
        /// removed, or the id is simply unknown).
        /// </summary>
        private bool TryResolveNode(string nodeId, out ManeuverNode? node)
        {
            var solver = FlightGlobals.ActiveVessel?.patchedConicSolver;
            var candidates = solver != null ? solver.maneuverNodes : null;
            if (candidates == null)
            {
                node = null;
                return false;
            }
            return _maneuverNodeIdRegistry.TryResolve(nodeId, candidates, out node);
        }

        /// <summary>
        /// Resolves the opaque <paramref name="vesselId"/>/<paramref name="bodyIndex"/>
        /// server-side against live <c>FlightGlobals</c> state (T-1/T-2) --
        /// the client never needs (or supplies) a live array index itself.
        /// </summary>
        public Ack SetTarget(TargetKind kind, string? vesselId, int? bodyIndex)
        {
            var fetch = FlightGlobals.fetch;
            if (fetch == null)
            {
                return Ack.Fail("E_NO_VESSEL");
            }

            if (kind == TargetKind.Vessel)
            {
                Vessel? found = null;
                foreach (var candidate in FlightGlobals.Vessels)
                {
                    if (candidate != null && string.Equals(candidate.id.ToString(), vesselId, StringComparison.OrdinalIgnoreCase))
                    {
                        found = candidate;
                        break;
                    }
                }
                if (found == null)
                {
                    return Ack.Fail("E_NOT_FOUND");
                }
                fetch.SetVesselTarget(found);
                return Ack.Ok();
            }

            if (kind == TargetKind.Body)
            {
                var bodies = FlightGlobals.Bodies;
                if (bodyIndex == null || bodyIndex.Value < 0 || bodyIndex.Value >= bodies.Count)
                {
                    return Ack.Fail("E_NOT_FOUND");
                }
                fetch.SetVesselTarget(bodies[bodyIndex.Value]);
                return Ack.Ok();
            }

            return Ack.Fail("E_NOT_FOUND");
        }

        public Ack ClearTarget()
        {
            var fetch = FlightGlobals.fetch;
            if (fetch == null)
            {
                return Ack.Fail("E_NO_VESSEL");
            }
            fetch.SetVesselTarget(null);
            return Ack.Ok();
        }

        /// <summary>
        /// Sim-meta, not vessel-scoped -- <c>TimeWarp.SetRate</c> is a static
        /// call, safe with or without an active vessel. Negative indices are
        /// already rejected upstream by
        /// <see cref="VesselCommandProvider.HandleSetWarpIndex"/>; this is
        /// the ONLY place the real upper bound is known
        /// (<c>TimeWarp.fetch.warpRates.Length</c> -- the live rate table,
        /// which differs between on-rails and physics warp and isn't a fixed
        /// contract-side constant), so the design table's <c>Ack | E_RANGE</c>
        /// (§3) is enforced here rather than silently clamped/passed to
        /// <c>TimeWarp.SetRate</c>, which does no bounds checking of its own.
        /// </summary>
        public Ack SetWarp(int index)
        {
            var warpRates = TimeWarp.fetch?.warpRates;
            if (warpRates == null || index < 0 || index >= warpRates.Length)
            {
                return Ack.Fail("E_RANGE");
            }
            TimeWarp.SetRate(index, instant: true);
            return Ack.Ok();
        }

        /// <summary>Sim-meta, not vessel-scoped -- <c>FlightDriver.SetPause</c> is a static call.</summary>
        public Ack SetPause(bool paused)
        {
            FlightDriver.SetPause(paused);
            return Ack.Ok();
        }

        private static Ack WithActionGroups(Func<ActionGroupList, Ack> action)
        {
            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null || vessel.ActionGroups == null)
            {
                return Ack.Fail("E_NO_VESSEL");
            }
            return action(vessel.ActionGroups);
        }
    }
}
