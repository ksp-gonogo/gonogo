using System;
using Gonogo.KSP.Gates;
using KSP.UI.Screens;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.Maneuver;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The real <see cref="IVesselActuator"/>: M1 Task 3's KSP-actuation
    /// seam, wired to <c>Vessel.ActionGroups</c>/<c>VesselAutopilot</c>/
    /// <c>FlightInputHandler</c>/<c>StageManager</c>/
    /// <c>Vessel.patchedConicSolver</c>/<c>FlightGlobals</c>/<c>TimeWarp</c>/
    /// <c>FlightDriver</c>: confirmed against this KSP version's actual API
    /// shapes via decompile (see each method's own comment for the specific
    /// call). Every method operates on <c>FlightGlobals.ActiveVessel</c>:
    /// there is no per-call vessel selector, matching every M1 read channel's
    /// "the vessel" scoping.
    ///
    /// <para><b>This is now the SECOND class in the mod that touches KSP/
    /// Unity APIs directly</b>: see <see cref="KspHost"/>'s doc comment,
    /// written before this class existed, for the READ-side half of that
    /// invariant ("the only class that touches KSP" was true for sampling;
    /// this is its actuation counterpart, deliberately separated by
    /// direction of data flow rather than folded into <see cref="KspHost"/>
    /// itself).</para>
    ///
    /// <para><b>Main-thread marshaling:</b> every method here runs on the Unity
    /// main thread. <see cref="ChannelEngine"/> is constructed with
    /// <c>executeCommandsOnMainThread: true</c> (see <c>GonogoAddon.Awake</c>),
    /// so it marshals each command handler onto its main-thread queue and
    /// blocks the Courier thread until <c>GonogoAddon.FixedUpdate</c> drains it
    /// via <c>ChannelEngine.RunPendingCommands</c>. That is what closes the
    /// whole deferred-crash class: no KSP/Unity API here is ever touched from
    /// the Courier thread, which is fatal.</para>
    /// </summary>
    public sealed class KspVesselActuator : IVesselActuator
    {
        // M3 R3: this is now the SAME ReferenceIdRegistry<ManeuverNode>
        // instance KspHost's read-side BuildManeuverNodes assigns ids from
        // (GonogoAddon.Awake constructs one and hands it to both); see
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
        /// <see cref="SetActionGroup"/>: the WRITE-side counterpart to the
        /// resolver <see cref="KspHost"/> holds for the read side, and
        /// deliberately the SAME elected instance, so a group's index means the
        /// same thing whether it arrived in a sample or is being commanded.
        /// Late-bound for the same reason (see
        /// <c>KspHost.SetActionGroupsBackendSource</c>): the capability Kernel
        /// isn't resolved until every uplink has registered its providers, well
        /// after <see cref="GonogoAddon"/> constructs this actuator.
        /// </summary>
        private Func<IActionGroupsBackend?>? _actionGroupsBackend;

        /// <summary>Installs the elected-backend resolver, called by <see cref="GonogoAddon"/> once the capability Kernel has resolved.</summary>
        public void SetActionGroupsBackendSource(Func<IActionGroupsBackend?> resolver)
        {
            _actionGroupsBackend = resolver;
        }

        /// <summary>
        /// Resolves the elected <see cref="IManeuverPlanSource"/> so the three
        /// maneuver WRITE commands respect the same election the read side
        /// already does. Late-bound for the same reason as
        /// <see cref="_actionGroupsBackend"/> above.
        ///
        /// <para>The read path has known this since it was written
        /// (<c>KspHost.BuildManeuverNodes</c>: "Whatever the ELECTED provider
        /// answered, never <c>patchedConicSolver</c> directly"). The write path
        /// did not check at all, which is the asymmetry this resolver closes.</para>
        /// </summary>
        private Func<PlanOwner>? _planOwner;

        /// <summary>Installs the plan-ownership resolver; see <see cref="_planOwner"/>.</summary>
        public void SetPlanOwnerSource(Func<PlanOwner> resolver)
        {
            _planOwner = resolver;
        }

        /// <summary>
        /// The refusal for a write into stock's solver, or <c>null</c> when the
        /// write may proceed.
        ///
        /// <para>Checked BEFORE the vessel/solver guards on purpose. Not owning
        /// the plan is a fact about authority that holds whether or not there is
        /// an active vessel, so it is the more fundamental answer; ordering it
        /// first also makes it reachable without live KSP state, which is what
        /// lets <c>ManeuverPlanOwnershipTests</c> exercise it.</para>
        ///
        /// <para>A null elected source means there is no planner AT ALL (an
        /// un-upgraded Tracking Station leaves <c>patchedConicSolver</c> null),
        /// which is a different fact with its own existing answer: it falls
        /// through to the solver-null guard rather than being reported as a
        /// foreign plan.</para>
        ///
        /// <para>LIVE-INERT TODAY: the maneuver-plan election has exactly one
        /// member, so this never refuses on a stock install. It is tested rather
        /// than merely commented, because a branch nothing has executed is a
        /// claim with no evidence: see
        /// <c>Gonogo.KSP.Tests/ManeuverPlanOwnershipTests.cs</c>, which elects a
        /// second provider and asserts all three commands refuse, and asserts
        /// they do NOT refuse with only the stock backend elected.</para>
        /// </summary>
        private CommandErrorCode? PlanWriteRefusal() =>
            ManeuverPlanWriteRule.RefusalFor(_planOwner?.Invoke() ?? PlanOwner.None);

        /// <summary>
        /// Reads the facts <see cref="ManeuverWriteAuthority"/> decides on off
        /// the live game: whether there is a vessel, whether the Tracking
        /// Station's tier attached a solver to it, whether Mission Control has
        /// unlocked flight planning, and whether the node editor is locked right
        /// now. The rule itself carries no KSP type and is exercised directly by
        /// <c>ManeuverWriteAuthorityTests</c>.
        ///
        /// <para><paramref name="plans"/> false is a delete, which needs no
        /// flight-planning unlock and asks <c>MANNODE_DELETE</c> instead of
        /// <c>MANNODE_ADDEDIT</c>: the two locks are separate members of
        /// <c>ControlTypes</c> and stock's own delete path checks the second
        /// one.</para>
        /// </summary>
        private static Refusal? ManeuverWriteRefusal(bool plans)
        {
            var vessel = FlightGlobals.ActiveVessel;

            // WHICH saves have no facility tiers is decided in one place, shared
            // with the gates (FacilityGateHelp.ReadFacilityTiers), so the two
            // cannot come to disagree about what a missing scenario means. In a
            // save that has none, Mission Control is at its ceiling and flight
            // planning is unlocked.
            var flightPlanningUnlocked = true;
            var missionControlName = "";
            var tiers = FacilityGateHelp.ReadFacilityTiers(
                FacilityGateHelp.FacilitiesScenarioLoaded(), FacilityGateHelp.CurrentGameMode());
            var gameVariables = GameVariables.Instance;
            if (tiers == FacilityTierRead.Live && gameVariables != null)
            {
                var norm = ScenarioUpgradeableFacilities.GetFacilityLevel(SpaceCenterFacility.MissionControl);
                flightPlanningUnlocked = gameVariables.UnlockedFlightPlanning(norm);
                missionControlName = FacilityName(SpaceCenterFacility.MissionControl);
            }
            // Unreadable stays OPEN here, unlike the gate, and deliberately.
            // A gate answers before anyone acts, so Unknown costs a moment; this
            // runs on a dispatch in FLIGHT, where the scenario has long since
            // loaded, so the only thing a refusal could be is a false one.

            return ManeuverWriteAuthority.RefusalFor(
                hasVessel: vessel != null,
                solverAttached: vessel?.patchedConicSolver != null,
                flightPlanningUnlocked: flightPlanningUnlocked,
                nodeEditingUnlocked: InputLockManager.IsUnlocked(
                    plans ? ControlTypes.MANNODE_ADDEDIT : ControlTypes.MANNODE_DELETE),
                plans: plans,
                trackingStationName: FacilityName(SpaceCenterFacility.TrackingStation),
                missionControlName: missionControlName);
        }

        /// <summary>The facility as the GAME names it, through <c>Localizer</c>.</summary>
        private static string FacilityName(SpaceCenterFacility facility)
        {
            try
            {
                return ScenarioUpgradeableFacilities.GetFacilityName(facility) ?? "";
            }
            catch (Exception)
            {
                return "";
            }
        }

        // The persistent fly-by-wire override, main-thread-only and so lock-free.
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

        /// <summary>
        /// T-POI-4's <see cref="TargetKind.Position"/> branch: the ONE
        /// <c>PositionTarget</c> this actuator ever constructs. The stock
        /// type (global namespace, NOT <c>FinePrint.PositionTarget</c>: the
        /// plan's naming guess was wrong; confirmed via decompile against
        /// Assembly-CSharp.dll) allocates its own <c>GameObject</c> in its
        /// constructor and destroys it in a finalizer, so a fresh instance
        /// per click would leak an orphaned GameObject every time the player
        /// re-picks a surface fix. Lazily constructed once, then reused via
        /// <c>Update(body, lat, lon)</c> on every subsequent Position target,
        /// never reconstructed.
        /// </summary>
        private PositionTarget? _poiTarget;

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
                // Range rather than a capability arm: nothing about the craft is
                // wrong, the client named a mode this contract cannot spell.
                return CommandResult.Fail(
                    CommandErrorCode.Range, "no such autopilot mode");
            }

            // VesselAutopilot.SetMode returns false when the requested mode
            // isn't currently available (e.g. Maneuver with no node queued,
            // Target with nothing targeted) -- see the decompile-confirmed
            // signature `bool SetMode(AutopilotMode mode)` /
            // `bool CanSetMode(AutopilotMode mode)`. Its arms are the pilot's
            // skill or the probe's SAS tier, a speed display mode that does not
            // suit the axis, and a missing target or node: all facts about what
            // this craft can hold, none of which a retry changes.
            return vessel.Autopilot.SetMode((VesselAutopilot.AutopilotMode)(int)mode)
                ? CommandResult.Ok()
                : CommandResult.Fail(
                    CommandErrorCode.CapabilityMismatch,
                    // The contract's own name for the mode, NOT through GameWords:
                    // that reads attributes, and a contract enum carries
                    // Reinforced.Typings' [TsEnum] on the netstandard build. See
                    // GameWords' own doc comment. This name is ours anyway.
                    $"this craft cannot hold {mode}");
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
        /// with no residual override: a later re-arm starts from a clean stick.
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
        /// Partially updates the held override: only the non-null fields of
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

        /// <summary>
        /// The same event pressing the space bar is, which this used to be only
        /// half of. See <see cref="StageRule"/> for stock's own three lines and
        /// what each of them is for.
        ///
        /// <para>The Stage action group fires whether or not the stack advances
        /// and only inside the staging lock, which is exactly where
        /// <c>FlightInputHandler</c> puts it. Without it, part actions the
        /// player assigned to Stage did not run on a console-issued stage: a
        /// silent behavioural difference from the key, not a missing
        /// refusal.</para>
        /// </summary>
        public CommandResult<int> Stage()
        {
            var vessel = FlightGlobals.ActiveVessel;
            var refusal = StageRule.RefusalFor(
                hasVessel: vessel != null,
                stagingUnlocked: InputLockManager.IsUnlocked(ControlTypes.STAGING));
            if (refusal != null)
            {
                return CommandResult<int>.Fail(refusal.Value.Code, refusal.Value.Detail);
            }

            if (StageRule.AdvancesTheStack(vessel!.ActionControlBlocked(KSPActionGroup.Stage)))
            {
                StageManager.ActivateNextStage();
            }
            vessel.ActionGroups?.ToggleGroup(KSPActionGroup.Stage);
            return CommandResult<int>.Ok(vessel.currentStage);
        }

        /// <summary>
        /// Delegates to the ELECTED action-groups backend rather than the magic
        /// <c>1 => Custom01 ... 10 => Custom10</c> switch this used to be. The
        /// backend owns both the mapping and the RANGE, stock stops at 10, AGX
        /// goes to 250: so an index it doesn't know comes back <c>false</c>
        /// and becomes <c>CommandErrorCode.Range</c> here.
        /// <see cref="VesselCommandProvider.HandleSetActionGroup"/> has already
        /// rejected the non-positive case; this is the live bound it can't see.
        ///
        /// <para>Runs on the main thread: the engine is constructed with
        /// <c>executeCommandsOnMainThread: true</c> and
        /// <see cref="GonogoAddon"/> drains the command queue from
        /// <c>FixedUpdate</c>, so the backend's live-KSP read is safe here,
        /// see <see cref="IActionGroupsBackend"/>'s threading note.</para>
        /// </summary>
        public CommandResult SetActionGroup(int group, bool state)
        {
            var backend = _actionGroupsBackend?.Invoke();
            if (backend == null)
            {
                // No elected backend => nothing can actuate. NoVessel would be
                // wrong (a vessel may well be there) and Range would lie about
                // the group. This is the one capability question the KERNEL
                // answers rather than KSP, and it is still a capability
                // question. Only reachable if the election never resolved: a
                // correctly bootstrapped engine always has the stock backend.
                return CommandResult.Fail(
                    CommandErrorCode.CapabilityMismatch,
                    "no action-group provider is elected");
            }
            return backend.SetGroup(group, state)
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.Range);
        }

        /// <summary>
        /// <c>ManeuverNode.DeltaV</c> is in the node's own radial/normal/
        /// prograde frame -- x=radialOut, y=normal, z=prograde (re-confirmed by
        /// <c>KspHost.BuildManeuverNodes</c>' identical doc comment). This
        /// assignment must NOT be reordered.
        /// </summary>
        public CommandResult<string> AddManeuverNode(double ut, double prograde, double normal, double radialOut)
        {
            var refusal = PlanWriteRefusal();
            if (refusal != null)
            {
                return CommandResult<string>.Fail(refusal.Value);
            }

            var gate = ManeuverWriteRefusal(plans: true);
            if (gate != null)
            {
                return CommandResult<string>.Fail(gate.Value.Code, gate.Value.Detail);
            }

            var solver = FlightGlobals.ActiveVessel!.patchedConicSolver;
            var node = solver.AddManeuverNode(ut);
            node.DeltaV = new Vector3d(radialOut, normal, prograde);
            solver.UpdateFlightPlan();

            var nodeId = _maneuverNodeIdRegistry.GetOrAssign(node);
            return CommandResult<string>.Ok(nodeId);
        }

        public CommandResult UpdateManeuverNode(string nodeId, double ut, double prograde, double normal, double radialOut)
        {
            var refusal = PlanWriteRefusal();
            if (refusal != null)
            {
                return CommandResult.Fail(refusal.Value);
            }

            var gate = ManeuverWriteRefusal(plans: true);
            if (gate != null)
            {
                return CommandResult.Fail(gate.Value.Code, gate.Value.Detail);
            }

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
            var refusal = PlanWriteRefusal();
            if (refusal != null)
            {
                return CommandResult.Fail(refusal.Value);
            }

            var gate = ManeuverWriteRefusal(plans: false);
            if (gate != null)
            {
                return CommandResult.Fail(gate.Value.Code, gate.Value.Detail);
            }

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
        /// <see cref="_maneuverNodeIdRegistry"/>: never a cached reference
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
        ///
        /// <para><paramref name="lat"/>/<paramref name="lon"/> (T-POI-4) are
        /// consumed ONLY by <see cref="TargetKind.Position"/>: a client-
        /// picked surface fix on <paramref name="bodyIndex"/>'s body (e.g. a
        /// <c>spaceCenter.pois</c> entry's own coordinate), wired through
        /// stock's own <c>PositionTarget</c>: the exact mechanism the stock
        /// map-view context menu itself uses to target a waypoint or anomaly
        /// (confirmed via decompile: <c>PositionTarget</c> is one of only
        /// four <c>ITargetable</c> implementers in the whole assembly,
        /// alongside <c>Vessel</c>/<c>CelestialBody</c>/
        /// <c>ModuleDockingNode</c>): nothing novel is being asked of the
        /// KSP API here. See <see cref="_poiTarget"/>'s own doc comment for
        /// why the instance is cached rather than reconstructed per call.</para>
        /// </summary>
        public CommandResult SetTarget(TargetKind kind, string? vesselId, int? bodyIndex, double? lat, double? lon, uint? partId)
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

            if (kind == TargetKind.Part)
            {
                // A docking port: find the owning vessel by guid, then the
                // ModuleDockingNode whose part.flightID matches. NotFound when
                // the vessel is unknown; NotClearToProceed when it's not loaded
                // (a ModuleDockingNode only exists on a loaded part tree, and
                // getting closer loads it, so this one does resolve by waiting);
                // Range when the vessel has no port with that flightID.
                if (string.IsNullOrEmpty(vesselId) || partId == null)
                {
                    return CommandResult.Fail(CommandErrorCode.NotFound);
                }
                Vessel? owner = null;
                foreach (var candidate in FlightGlobals.Vessels)
                {
                    if (candidate != null && string.Equals(candidate.id.ToString(), vesselId, StringComparison.OrdinalIgnoreCase))
                    {
                        owner = candidate;
                        break;
                    }
                }
                if (owner == null)
                {
                    return CommandResult.Fail(CommandErrorCode.NotFound);
                }
                if (!owner.loaded)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.NotClearToProceed,
                        "that vessel is out of physics range, so its ports are not there to target");
                }
                ModuleDockingNode? node = null;
                foreach (var candidate in owner.FindPartModulesImplementing<ModuleDockingNode>())
                {
                    if (candidate != null && candidate.part != null && candidate.part.flightID == partId.Value)
                    {
                        node = candidate;
                        break;
                    }
                }
                if (node == null)
                {
                    return CommandResult.Fail(CommandErrorCode.Range);
                }
                fetch.SetVesselTarget(node);
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

            if (kind == TargetKind.Position)
            {
                var bodies = FlightGlobals.Bodies;
                if (bodyIndex == null || bodyIndex.Value < 0 || bodyIndex.Value >= bodies.Count
                    || lat == null || lon == null)
                {
                    return CommandResult.Fail(CommandErrorCode.NotFound);
                }
                var body = bodies[bodyIndex.Value];
                _poiTarget ??= new PositionTarget("POI");
                _poiTarget.Update(body, lat.Value, lon.Value);
                fetch.SetVesselTarget(_poiTarget);
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
        /// (§3) is enforced here rather than passed to <c>TimeWarp.SetRate</c>.
        ///
        /// <para><b>And the rate the game settled on is read back.</b> The old
        /// comment here said <c>SetRate</c> "does no bounds checking of its
        /// own"; it does two. It clamps the index, and then <c>setRate</c> runs
        /// <c>getMaxOnRailsRateIdx</c> against the body's altitude limit (and a
        /// kerbal on a ladder, and the physics ceiling) and posts its own screen
        /// message. Returning <c>Ok()</c> regardless reported 100,000x at 20 km
        /// over Kerbin as a success while the game warped at 1x. See
        /// <see cref="WarpRateOutcome"/> for why the answer is read after rather
        /// than asked before.</para>
        /// </summary>
        public CommandResult SetWarp(int index)
        {
            var warpRates = TimeWarp.fetch?.warpRates;
            if (warpRates == null || index < 0 || index >= warpRates.Length)
            {
                return CommandResult.Fail(CommandErrorCode.Range);
            }
            TimeWarp.SetRate(index, instant: true);

            var settled = TimeWarp.CurrentRateIndex;
            var settledRate = settled >= 0 && settled < warpRates.Length
                ? warpRates[settled]
                : TimeWarp.CurrentRate;
            return WarpRateOutcome.Refusal(index, settled, warpRates[index], settledRate)
                ?? CommandResult.Ok();
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
