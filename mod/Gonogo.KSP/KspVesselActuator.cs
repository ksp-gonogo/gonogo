using System;
using KSP.UI.Screens;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.ActionGroups;
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
    /// <para><b>Main-thread marshaling (F2 — resolved):</b> every method here
    /// now runs on the Unity main thread. <see cref="ChannelEngine"/> is
    /// constructed with <c>executeCommandsOnMainThread: true</c> (see
    /// <c>GonogoAddon.Awake</c>), so it marshals each command handler onto its
    /// main-thread queue and blocks the Courier thread until
    /// <c>GonogoAddon.FixedUpdate</c> drains it via
    /// <c>ChannelEngine.RunPendingCommands</c> — exactly the "main-thread job
    /// queue drained every FixedUpdate, Courier thread blocked until the
    /// action completes" fix the RETIRED <c>GonogoTelemetry</c> staging plugin
    /// used (<c>GonogoTelemetryAddon.Defer</c>). This closes the previously-
    /// deferred crash class: no KSP/Unity API here is ever touched from the
    /// Courier thread.</para>
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

        /// <summary>
        /// Resolves the elected <see cref="IActionGroupsBackend"/> for
        /// <see cref="SetActionGroup"/> — the WRITE-side counterpart to the
        /// resolver <see cref="KspHost"/> holds for the read side, and
        /// deliberately the SAME elected instance, so a group's index means the
        /// same thing whether it arrived in a sample or is being commanded.
        /// Late-bound for the same reason (see
        /// <c>KspHost.SetActionGroupsBackendSource</c>): the capability Kernel
        /// isn't resolved until every uplink has registered its providers, well
        /// after <see cref="GonogoAddon"/> constructs this actuator.
        /// </summary>
        private Func<IActionGroupsBackend?>? _actionGroupsBackend;

        /// <summary>Installs the elected-backend resolver — called by <see cref="GonogoAddon"/> once the capability Kernel has resolved.</summary>
        public void SetActionGroupsBackendSource(Func<IActionGroupsBackend?> resolver)
        {
            _actionGroupsBackend = resolver;
        }

        // ---- persistent fly-by-wire override (main-thread-only, no lock) ------
        // Command handlers and Vessel.OnFlyByWire both run on the Unity main
        // thread (see the class doc comment's F2 marshaling note), so this
        // mutable state needs no synchronization. The callback delegate is
        // created once so Delegate.Remove/Combine target the SAME reference; the
        // struct holds every axis/trim value the callback writes each frame.
        private struct FbwOverride
        {
            public bool Enabled;
            public float Pitch;
            public float Yaw;
            public float Roll;
            public float X;
            public float Y;
            public float Z;
            public float PitchTrim;
            public float YawTrim;
            public float RollTrim;
        }

        private FbwOverride _fbw;
        private Vessel? _attachedVessel;
        private readonly FlightInputCallback _flyByWireCallback;

        public KspVesselActuator(ReferenceIdRegistry<ManeuverNode> maneuverNodeIdRegistry)
        {
            _maneuverNodeIdRegistry = maneuverNodeIdRegistry;
            _flyByWireCallback = ApplyFlyByWireOverride;
        }

        public CommandResult SetSas(bool enabled) => WithActionGroups(actionGroups =>
        {
            actionGroups.SetGroup(KSPActionGroup.SAS, enabled);
            return CommandResult.Ok();
        });

        public CommandResult SetSasMode(SasMode mode)
        {
            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null || vessel.Autopilot == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }

            // SasMode.Unknown (the contract's own parse-fallback for an
            // unrecognized READ value -- see SasMode's doc comment) has no
            // matching real KSP AutopilotMode member; guard it explicitly
            // rather than casting an out-of-range int into a native enum.
            if (mode == SasMode.Unknown)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            // VesselAutopilot.SetMode returns false when the requested mode
            // isn't currently available (e.g. Maneuver with no node queued,
            // Target with nothing targeted) -- see the decompile-confirmed
            // signature `bool SetMode(AutopilotMode mode)` /
            // `bool CanSetMode(AutopilotMode mode)`.
            return vessel.Autopilot.SetMode((VesselAutopilot.AutopilotMode)(int)mode)
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.ModeUnavailable);
        }

        public CommandResult SetRcs(bool enabled) => WithActionGroups(actionGroups =>
        {
            actionGroups.SetGroup(KSPActionGroup.RCS, enabled);
            return CommandResult.Ok();
        });

        public CommandResult SetGear(bool enabled) => WithActionGroups(actionGroups =>
        {
            actionGroups.SetGroup(KSPActionGroup.Gear, enabled);
            return CommandResult.Ok();
        });

        public CommandResult SetBrakes(bool enabled) => WithActionGroups(actionGroups =>
        {
            actionGroups.SetGroup(KSPActionGroup.Brakes, enabled);
            return CommandResult.Ok();
        });

        public CommandResult SetLights(bool enabled) => WithActionGroups(actionGroups =>
        {
            actionGroups.SetGroup(KSPActionGroup.Light, enabled);
            return CommandResult.Ok();
        });

        public CommandResult SetAbort(bool enabled) => WithActionGroups(actionGroups =>
        {
            actionGroups.SetGroup(KSPActionGroup.Abort, enabled);
            return CommandResult.Ok();
        });

        /// <summary>
        /// Writes the ACTIVE vessel's commanded throttle via
        /// <c>FlightInputHandler.state.mainThrottle</c> -- the same static
        /// accessor KSP's own input pipeline reads/writes every frame (and
        /// clamps -- see <c>KspHost.BuildControl</c>'s doc comment on why
        /// <c>vessel.ctrlState.mainThrottle</c> itself is read-only ground
        /// truth downstream of this, not the write target).
        /// </summary>
        public CommandResult SetThrottle(double value)
        {
            if (FlightGlobals.ActiveVessel == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }
            FlightInputHandler.state.mainThrottle = (float)value;
            return CommandResult.Ok();
        }

        /// <summary>
        /// Arms/disarms the persistent fly-by-wire override. Arming attaches
        /// <see cref="_flyByWireCallback"/> to <c>FlightGlobals.ActiveVessel</c>'s
        /// <c>OnFlyByWire</c> (idempotent remove-then-combine) and sets the armed
        /// flag; the axes resume from their last-set values (or 0 on first arm).
        /// Disarming clears the flag, detaches the callback, and neutralizes the
        /// stored axes AND trims so control is fully handed back to the player/SAS
        /// with no residual override — a later re-arm starts from a clean stick.
        /// </summary>
        public CommandResult SetFlyByWire(bool enabled)
        {
            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }

            if (enabled)
            {
                AttachFlyByWire(vessel);
                _fbw.Enabled = true;
            }
            else
            {
                _fbw.Enabled = false;
                DetachFlyByWire();
                _fbw.Pitch = _fbw.Yaw = _fbw.Roll = 0f;
                _fbw.X = _fbw.Y = _fbw.Z = 0f;
                _fbw.PitchTrim = _fbw.YawTrim = _fbw.RollTrim = 0f;
            }
            return CommandResult.Ok();
        }

        /// <summary>
        /// Partially updates the held override — only the non-null fields of
        /// <paramref name="axes"/> overwrite their stored value (single-axis
        /// commands never clobber the others). Values arrive already clamped to
        /// −1..1 by <see cref="VesselCommandProvider.HandleSetControlAxes"/>. If
        /// the active vessel changed since the callback was attached, re-attach
        /// it lazily here so a mid-flight vessel switch keeps the override live
        /// on whichever vessel the next axis command targets.
        /// </summary>
        public CommandResult SetControlAxes(SetControlAxesArgs axes)
        {
            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }

            if (_fbw.Enabled && !ReferenceEquals(_attachedVessel, vessel))
            {
                AttachFlyByWire(vessel);
            }

            if (axes.Pitch.HasValue)
            {
                _fbw.Pitch = (float)axes.Pitch.Value;
            }
            if (axes.Yaw.HasValue)
            {
                _fbw.Yaw = (float)axes.Yaw.Value;
            }
            if (axes.Roll.HasValue)
            {
                _fbw.Roll = (float)axes.Roll.Value;
            }
            if (axes.X.HasValue)
            {
                _fbw.X = (float)axes.X.Value;
            }
            if (axes.Y.HasValue)
            {
                _fbw.Y = (float)axes.Y.Value;
            }
            if (axes.Z.HasValue)
            {
                _fbw.Z = (float)axes.Z.Value;
            }
            if (axes.PitchTrim.HasValue)
            {
                _fbw.PitchTrim = (float)axes.PitchTrim.Value;
            }
            if (axes.YawTrim.HasValue)
            {
                _fbw.YawTrim = (float)axes.YawTrim.Value;
            }
            if (axes.RollTrim.HasValue)
            {
                _fbw.RollTrim = (float)axes.RollTrim.Value;
            }
            return CommandResult.Ok();
        }

        /// <summary>
        /// The <c>FlightInputCallback</c> KSP runs each physics frame BEFORE the
        /// autopilot (so SAS can trim on top, matching stock stick behaviour). A
        /// no-op while disarmed, so on disarm the axes stop being written and
        /// SAS/manual input resumes with no residual override. Both axes and
        /// trims are written from inside the callback, keeping trim durable while
        /// armed rather than one-shot-writing it to <c>ctrlState</c>.
        /// </summary>
        private void ApplyFlyByWireOverride(FlightCtrlState st)
        {
            if (!_fbw.Enabled)
            {
                return;
            }
            st.pitch = _fbw.Pitch;
            st.yaw = _fbw.Yaw;
            st.roll = _fbw.Roll;
            st.X = _fbw.X;
            st.Y = _fbw.Y;
            st.Z = _fbw.Z;
            st.pitchTrim = _fbw.PitchTrim;
            st.yawTrim = _fbw.YawTrim;
            st.rollTrim = _fbw.RollTrim;
        }

        /// <summary>
        /// Binds <see cref="_flyByWireCallback"/> to <paramref name="vessel"/>'s
        /// <c>OnFlyByWire</c> multicast delegate via the idempotent
        /// remove-then-combine pattern (a double-arm never double-registers). If
        /// a different vessel was previously attached, detach it first so only
        /// one vessel ever carries the override.
        /// </summary>
        private void AttachFlyByWire(Vessel vessel)
        {
            if (!ReferenceEquals(_attachedVessel, vessel))
            {
                DetachFlyByWire();
            }
            vessel.OnFlyByWire = (FlightInputCallback)Delegate.Remove(vessel.OnFlyByWire, _flyByWireCallback);
            vessel.OnFlyByWire = (FlightInputCallback)Delegate.Combine(vessel.OnFlyByWire, _flyByWireCallback);
            _attachedVessel = vessel;
        }

        private void DetachFlyByWire()
        {
            if (_attachedVessel != null)
            {
                _attachedVessel.OnFlyByWire = (FlightInputCallback)Delegate.Remove(_attachedVessel.OnFlyByWire, _flyByWireCallback);
                _attachedVessel = null;
            }
        }

        public CommandResult<int> Stage()
        {
            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null)
            {
                return CommandResult<int>.Fail(CommandErrorCode.NoVessel);
            }
            StageManager.ActivateNextStage();
            return CommandResult<int>.Ok(vessel.currentStage);
        }

        /// <summary>
        /// Delegates to the ELECTED action-groups backend rather than the magic
        /// <c>1 => Custom01 ... 10 => Custom10</c> switch this used to be. The
        /// backend owns both the mapping and the RANGE — stock stops at 10, AGX
        /// goes to 250 — so an index it doesn't know comes back <c>false</c>
        /// and becomes <c>CommandErrorCode.Range</c> here.
        /// <see cref="VesselCommandProvider.HandleSetActionGroup"/> has already
        /// rejected the non-positive case; this is the live bound it can't see.
        ///
        /// <para>Runs on the main thread: the engine is constructed with
        /// <c>executeCommandsOnMainThread: true</c> and
        /// <see cref="GonogoAddon"/> drains the command queue from
        /// <c>FixedUpdate</c>, so the backend's live-KSP read is safe here —
        /// see <see cref="IActionGroupsBackend"/>'s threading note.</para>
        /// </summary>
        public CommandResult SetActionGroup(int group, bool state)
        {
            var backend = _actionGroupsBackend?.Invoke();
            if (backend == null)
            {
                // No elected backend => nothing can actuate. NoVessel would be
                // wrong (a vessel may well be there) and Range would lie about
                // the group; ModeUnavailable is the honest "this isn't
                // currently available". Only reachable if the capability never
                // resolved — a correctly bootstrapped engine always has the
                // stock backend.
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }
            return backend.SetGroup(group, state)
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.Range);
        }

        /// <summary>
        /// <c>ManeuverNode.DeltaV</c> is in the node's own radial/normal/
        /// prograde frame -- x=radialOut, y=normal, z=prograde (the project's
        /// own "Telemachus maneuver-node arg order" finding, re-confirmed by
        /// <c>KspHost.BuildManeuverNodes</c>' identical doc comment). This
        /// assignment must NOT be reordered.
        /// </summary>
        public CommandResult<string> AddManeuverNode(double ut, double prograde, double normal, double radialOut)
        {
            var solver = FlightGlobals.ActiveVessel?.patchedConicSolver;
            if (solver == null)
            {
                return CommandResult<string>.Fail(CommandErrorCode.NoVessel);
            }

            var node = solver.AddManeuverNode(ut);
            node.DeltaV = new Vector3d(radialOut, normal, prograde);
            solver.UpdateFlightPlan();

            var nodeId = _maneuverNodeIdRegistry.GetOrAssign(node);
            return CommandResult<string>.Ok(nodeId);
        }

        public CommandResult UpdateManeuverNode(string nodeId, double ut, double prograde, double normal, double radialOut)
        {
            if (!TryResolveNode(nodeId, out var node) || node?.solver == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            node.UT = ut;
            node.DeltaV = new Vector3d(radialOut, normal, prograde);
            node.solver.UpdateFlightPlan();
            return CommandResult.Ok();
        }

        public CommandResult RemoveManeuverNode(string nodeId)
        {
            if (!TryResolveNode(nodeId, out var node))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            if (node?.solver != null)
            {
                node.solver.RemoveManeuverNode(node);
            }
            return CommandResult.Ok();
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
        public CommandResult SetTarget(TargetKind kind, string? vesselId, int? bodyIndex)
        {
            var fetch = FlightGlobals.fetch;
            if (fetch == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
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
                    return CommandResult.Fail(CommandErrorCode.NotFound);
                }
                fetch.SetVesselTarget(found);
                return CommandResult.Ok();
            }

            if (kind == TargetKind.Body)
            {
                var bodies = FlightGlobals.Bodies;
                if (bodyIndex == null || bodyIndex.Value < 0 || bodyIndex.Value >= bodies.Count)
                {
                    return CommandResult.Fail(CommandErrorCode.NotFound);
                }
                fetch.SetVesselTarget(bodies[bodyIndex.Value]);
                return CommandResult.Ok();
            }

            return CommandResult.Fail(CommandErrorCode.NotFound);
        }

        public CommandResult ClearTarget()
        {
            var fetch = FlightGlobals.fetch;
            if (fetch == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }
            fetch.SetVesselTarget(null);
            return CommandResult.Ok();
        }

        /// <summary>
        /// Sim-meta, not vessel-scoped -- <c>TimeWarp.SetRate</c> is a static
        /// call, safe with or without an active vessel. Negative indices are
        /// already rejected upstream by
        /// <see cref="VesselCommandProvider.HandleSetWarpIndex"/>; this is
        /// the ONLY place the real upper bound is known
        /// (<c>TimeWarp.fetch.warpRates.Length</c> -- the live rate table,
        /// which differs between on-rails and physics warp and isn't a fixed
        /// contract-side constant), so the design table's <c>CommandResult | CommandErrorCode.Range</c>
        /// (§3) is enforced here rather than silently clamped/passed to
        /// <c>TimeWarp.SetRate</c>, which does no bounds checking of its own.
        /// </summary>
        public CommandResult SetWarp(int index)
        {
            var warpRates = TimeWarp.fetch?.warpRates;
            if (warpRates == null || index < 0 || index >= warpRates.Length)
            {
                return CommandResult.Fail(CommandErrorCode.Range);
            }
            TimeWarp.SetRate(index, instant: true);
            return CommandResult.Ok();
        }

        /// <summary>Sim-meta, not vessel-scoped -- <c>FlightDriver.SetPause</c> is a static call.</summary>
        public CommandResult SetPause(bool paused)
        {
            FlightDriver.SetPause(paused);
            return CommandResult.Ok();
        }

        private static CommandResult WithActionGroups(Func<ActionGroupList, CommandResult> action)
        {
            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null || vessel.ActionGroups == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }
            return action(vessel.ActionGroups);
        }
    }
}
