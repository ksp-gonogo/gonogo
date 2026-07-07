using System;
using System.Collections.Generic;
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
        // Maneuver-node ids are this actuator INSTANCE's own bookkeeping —
        // KSP's own ManeuverNode has no stable id at all (see
        // KspHost.BuildManeuverNodes' doc comment: nodes are ordered by UT,
        // never keyed). Scoped to this actuator's lifetime (one per running
        // session, same as GonogoAddon's other singletons) rather than
        // persisted -- a quickload/scene-reload invalidates every id, same
        // as the player's own maneuver plan does.
        private readonly Dictionary<string, ManeuverNode> _maneuverNodesById = new Dictionary<string, ManeuverNode>();

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

            var nodeId = Guid.NewGuid().ToString();
            _maneuverNodesById[nodeId] = node;
            return new AddManeuverNodeResult { Success = true, NodeId = nodeId };
        }

        public Ack UpdateManeuverNode(string nodeId, double ut, double prograde, double normal, double radialOut)
        {
            if (!_maneuverNodesById.TryGetValue(nodeId, out var node) || node?.solver == null)
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
            if (!_maneuverNodesById.TryGetValue(nodeId, out var node))
            {
                return Ack.Fail("E_NOT_FOUND");
            }

            _maneuverNodesById.Remove(nodeId);
            if (node?.solver != null)
            {
                node.solver.RemoveManeuverNode(node);
            }
            return Ack.Ok();
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

        /// <summary>Sim-meta, not vessel-scoped -- <c>TimeWarp.SetRate</c> is a static call, safe with or without an active vessel.</summary>
        public Ack SetWarp(int index)
        {
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
