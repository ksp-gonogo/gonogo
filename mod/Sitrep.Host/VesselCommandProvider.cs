using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free command-handling logic for M1 Task 3's typed vessel/action
    /// commands — the command-side twin of <see cref="VesselViewProvider"/>.
    /// Each <c>Handle*</c> method is the exact delegate
    /// <c>Gonogo.KSP.VesselUplink.Register</c> hands to
    /// <see cref="IUplinkHost.AddCommandHandler{TArgs,TResult}"/>: parse
    /// the already-typed args, call the one matching
    /// <see cref="IVesselActuator"/> method, hand back an already-typed
    /// result. No KSP/Unity type appears anywhere in this file — every
    /// domain check that doesn't need live game state (range validation on
    /// the args themselves) happens HERE; every check that does (mode
    /// availability, whether a target id actually resolves, whether a
    /// vessel exists at all) is the actuator's job and comes back as a typed
    /// <see cref="CommandResult.ErrorCode"/>.
    ///
    /// <para><b>Absolute set, never toggle</b> (design doc §3/§6.2): every
    /// boolean actuation command takes the state to APPLY, not "flip
    /// whatever it currently is" — a toggle racing an unknown intervening
    /// state under light-time delay is a footgun this contract doesn't
    /// reproduce.</para>
    /// </summary>
    public static class VesselCommandProvider
    {
        // ---- vessel.control.* -- delayed:true (actuation rides light-time) ----
        public const string SetSasCommand = "vessel.control.setSas";
        public const string SetSasModeCommand = "vessel.control.setSasMode";
        public const string SetRcsCommand = "vessel.control.setRcs";
        public const string SetGearCommand = "vessel.control.setGear";
        public const string SetBrakesCommand = "vessel.control.setBrakes";
        public const string SetLightsCommand = "vessel.control.setLights";

        /// <summary>
        /// The design table's <c>ActionGroup</c> union (§3) lists <c>abort</c>
        /// alongside <c>gear</c>/<c>brakes</c>/<c>lights</c>, but those three
        /// are already split out as their own dedicated commands rather than
        /// folded into <see cref="SetActionGroupCommand"/>'s numbered-group
        /// shape — <c>abort</c> follows that same precedent instead of the
        /// union's literal shape, so a client never has to string-match
        /// "abort" through the generic action-group command.
        /// </summary>
        public const string SetAbortCommand = "vessel.control.setAbort";

        public const string SetThrottleCommand = "vessel.control.setThrottle";
        public const string StageCommand = "vessel.control.stage";
        public const string SetActionGroupCommand = "vessel.control.setActionGroup";

        // ---- fly-by-wire (persistent override, not one-shot actuation) --------
        // Unlike every other vessel.control.* command, a raw control axis is
        // re-zeroed by KSP each physics frame, so the actuator holds an override
        // struct and re-applies it from Vessel.OnFlyByWire while armed. setFlyByWire
        // arms/disarms; setAxes partially updates the held axes/trims.
        public const string SetFlyByWireCommand = "vessel.control.setFlyByWire";
        public const string SetControlAxesCommand = "vessel.control.setAxes";

        // ---- vessel.maneuver.* -- delayed:true (F2: a maneuver node is
        // craft-side state, so add/update/remove is an uplink that rides
        // light-time; see VesselUplink's command-classification table) ----
        public const string ManeuverAddCommand = "vessel.maneuver.add";
        public const string ManeuverUpdateCommand = "vessel.maneuver.update";
        public const string ManeuverRemoveCommand = "vessel.maneuver.remove";

        // ---- vessel.target.* -- delayed:false (designation, not actuation) ----
        public const string TargetSetCommand = "vessel.target.set";
        public const string TargetClearCommand = "vessel.target.clear";

        // ---- time.* -- delayed:false (sim-meta, never a light-time fiction) ----
        public const string SetWarpIndexCommand = "time.setWarpIndex";
        public const string SetPausedCommand = "time.setPaused";

        public static CommandResult HandleSetSas(IVesselActuator actuator, SetEnabledArgs args) =>
            actuator.SetSas(args.Enabled);

        public static CommandResult HandleSetSasMode(IVesselActuator actuator, SetSasModeArgs args) =>
            actuator.SetSasMode(args.Mode);

        public static CommandResult HandleSetRcs(IVesselActuator actuator, SetEnabledArgs args) =>
            actuator.SetRcs(args.Enabled);

        public static CommandResult HandleSetGear(IVesselActuator actuator, SetEnabledArgs args) =>
            actuator.SetGear(args.Enabled);

        public static CommandResult HandleSetBrakes(IVesselActuator actuator, SetEnabledArgs args) =>
            actuator.SetBrakes(args.Enabled);

        public static CommandResult HandleSetLights(IVesselActuator actuator, SetEnabledArgs args) =>
            actuator.SetLights(args.Enabled);

        public static CommandResult HandleSetAbort(IVesselActuator actuator, SetEnabledArgs args) =>
            actuator.SetAbort(args.Enabled);

        /// <summary>Validated (not silently clamped) at THIS admission gate — A-10's inconsistency fixed at the send gate, per the design doc §3.</summary>
        public static CommandResult HandleSetThrottle(IVesselActuator actuator, SetThrottleArgs args)
        {
            if (args.Value < 0.0 || args.Value > 1.0)
            {
                return CommandResult.Fail(CommandErrorCode.Range);
            }
            return actuator.SetThrottle(args.Value);
        }

        public static CommandResult HandleSetFlyByWire(IVesselActuator actuator, SetFlyByWireArgs args) =>
            actuator.SetFlyByWire(args.Enabled);

        /// <summary>
        /// Clamps every provided axis/trim field to −1..1 HERE (KSP-free
        /// admission validation) before handing the whole partial-update struct
        /// to the actuator. Axes are CLAMPED rather than rejected — an
        /// over-range stick reading is a routine hardware quirk, not an error
        /// (contrast <see cref="HandleSetThrottle"/>, which rejects out-of-range
        /// with <see cref="CommandErrorCode.Range"/> because a throttle past
        /// full is a genuine mistake).
        /// </summary>
        public static CommandResult HandleSetControlAxes(IVesselActuator actuator, SetControlAxesArgs args)
        {
            args.Pitch = ClampAxis(args.Pitch);
            args.Yaw = ClampAxis(args.Yaw);
            args.Roll = ClampAxis(args.Roll);
            args.X = ClampAxis(args.X);
            args.Y = ClampAxis(args.Y);
            args.Z = ClampAxis(args.Z);
            args.PitchTrim = ClampAxis(args.PitchTrim);
            args.YawTrim = ClampAxis(args.YawTrim);
            args.RollTrim = ClampAxis(args.RollTrim);
            return actuator.SetControlAxes(args);
        }

        private static double? ClampAxis(double? value)
        {
            if (!value.HasValue)
            {
                return null;
            }
            var v = value.Value;
            if (v < -1.0)
            {
                return -1.0;
            }
            if (v > 1.0)
            {
                return 1.0;
            }
            return v;
        }

        public static CommandResult<int> HandleStage(IVesselActuator actuator, object? _) =>
            actuator.Stage();

        /// <summary>
        /// Same split as <see cref="HandleSetWarpIndex"/>, and for the same
        /// reason: the unambiguously-invalid case is rejected HERE, but the
        /// REAL upper bound is only known live, so the actuator owns it.
        ///
        /// <para>This used to hardcode <c>1..10</c>. It can't any more — the
        /// elected action-groups backend owns the range (stock stops at 10;
        /// Action Groups Extended legitimately goes to 250), and this
        /// KSP-free provider cannot see which backend won. A non-positive
        /// group is still nonsense under EVERY backend, so it fails fast here;
        /// anything else goes to the actuator, which asks the backend and
        /// returns <c>CommandErrorCode.Range</c> for a group it doesn't know.
        /// A command naming an unknown group therefore still fails cleanly —
        /// the check MOVED, it did not disappear.</para>
        /// </summary>
        public static CommandResult HandleSetActionGroup(IVesselActuator actuator, SetActionGroupArgs args)
        {
            if (args.Group < 1)
            {
                return CommandResult.Fail(CommandErrorCode.Range);
            }
            return actuator.SetActionGroup(args.Group, args.State);
        }

        public static CommandResult<string> HandleManeuverAdd(IVesselActuator actuator, AddManeuverNodeArgs args) =>
            actuator.AddManeuverNode(args.Ut, args.Prograde, args.Normal, args.RadialOut);

        public static CommandResult HandleManeuverUpdate(IVesselActuator actuator, UpdateManeuverNodeArgs args) =>
            actuator.UpdateManeuverNode(args.NodeId, args.Ut, args.Prograde, args.Normal, args.RadialOut);

        public static CommandResult HandleManeuverRemove(IVesselActuator actuator, RemoveManeuverNodeArgs args) =>
            actuator.RemoveManeuverNode(args.NodeId);

        /// <summary>
        /// Structurally-invalid args (the discriminated union's "wrong field
        /// for this Kind is missing" case) fail-fast here as <c>CommandErrorCode.NotFound</c>
        /// without ever reaching the actuator — there is nothing a real KSP
        /// lookup could resolve from a null id. A well-formed request that
        /// simply doesn't match a live vessel/body/position is the actuator's
        /// own <c>CommandErrorCode.NotFound</c> to return (it's the one with
        /// FlightGlobals in hand). <c>TargetKind.Position</c> (T-POI-4) needs
        /// BOTH <see cref="SetTargetArgs.Latitude"/> and
        /// <see cref="SetTargetArgs.Longitude"/> set, mirroring the
        /// Vessel/Body cases' own "the one field this Kind needs is missing"
        /// guard.
        /// </summary>
        public static CommandResult HandleTargetSet(IVesselActuator actuator, SetTargetArgs args)
        {
            switch (args.Kind)
            {
                case TargetKind.Vessel when string.IsNullOrEmpty(args.VesselId):
                case TargetKind.Body when !args.BodyIndex.HasValue:
                case TargetKind.Position when !args.BodyIndex.HasValue || !args.Latitude.HasValue || !args.Longitude.HasValue:
                case TargetKind.Other:
                    return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return actuator.SetTarget(args.Kind, args.VesselId, args.BodyIndex, args.Latitude, args.Longitude);
        }

        public static CommandResult HandleTargetClear(IVesselActuator actuator, object? _) =>
            actuator.ClearTarget();

        /// <summary>
        /// Mirrors <see cref="HandleSetActionGroup"/>'s split: the
        /// unambiguously-invalid case (negative) is rejected HERE, before the
        /// actuator is ever called, exactly like every other range-checked
        /// command in this file. The real upper bound
        /// (<c>TimeWarp.warpRates.Length</c>) is only known live, so
        /// <c>KspVesselActuator.SetWarp</c> is responsible for rejecting an
        /// index beyond it with the same <c>CommandErrorCode.Range</c> code — this
        /// provider can't see that bound at all.
        /// </summary>
        public static CommandResult HandleSetWarpIndex(IVesselActuator actuator, SetWarpIndexArgs args)
        {
            if (args.Index < 0)
            {
                return CommandResult.Fail(CommandErrorCode.Range);
            }
            return actuator.SetWarp(args.Index);
        }

        public static CommandResult HandleSetPaused(IVesselActuator actuator, SetPausedArgs args) =>
            actuator.SetPause(args.Paused);
    }
}
