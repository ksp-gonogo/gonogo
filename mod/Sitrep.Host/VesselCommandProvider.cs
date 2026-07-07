using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free command-handling logic for M1 Task 3's typed vessel/action
    /// commands — the command-side twin of <see cref="VesselViewProvider"/>.
    /// Each <c>Handle*</c> method is the exact delegate
    /// <c>Gonogo.KSP.VesselExtension.Register</c> hands to
    /// <see cref="IExtensionHost.AddCommandHandler{TArgs,TResult}"/>: parse
    /// the already-typed args, call the one matching
    /// <see cref="IVesselActuator"/> method, hand back an already-typed
    /// result. No KSP/Unity type appears anywhere in this file — every
    /// domain check that doesn't need live game state (range validation on
    /// the args themselves) happens HERE; every check that does (mode
    /// availability, whether a target id actually resolves, whether a
    /// vessel exists at all) is the actuator's job and comes back as a typed
    /// <see cref="Ack.ErrorCode"/>.
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
        public const string SetThrottleCommand = "vessel.control.setThrottle";
        public const string StageCommand = "vessel.control.stage";
        public const string SetActionGroupCommand = "vessel.control.setActionGroup";

        // ---- vessel.maneuver.* -- delayed:false (planning, not actuation) ----
        public const string ManeuverAddCommand = "vessel.maneuver.add";
        public const string ManeuverUpdateCommand = "vessel.maneuver.update";
        public const string ManeuverRemoveCommand = "vessel.maneuver.remove";

        // ---- vessel.target.* -- delayed:false (designation, not actuation) ----
        public const string TargetSetCommand = "vessel.target.set";
        public const string TargetClearCommand = "vessel.target.clear";

        // ---- time.* -- delayed:false (sim-meta, never a light-time fiction) ----
        public const string SetWarpIndexCommand = "time.setWarpIndex";
        public const string SetPausedCommand = "time.setPaused";

        public static Ack HandleSetSas(IVesselActuator actuator, SetEnabledArgs args) =>
            actuator.SetSas(args.Enabled);

        public static Ack HandleSetSasMode(IVesselActuator actuator, SetSasModeArgs args) =>
            actuator.SetSasMode(args.Mode);

        public static Ack HandleSetRcs(IVesselActuator actuator, SetEnabledArgs args) =>
            actuator.SetRcs(args.Enabled);

        public static Ack HandleSetGear(IVesselActuator actuator, SetEnabledArgs args) =>
            actuator.SetGear(args.Enabled);

        public static Ack HandleSetBrakes(IVesselActuator actuator, SetEnabledArgs args) =>
            actuator.SetBrakes(args.Enabled);

        public static Ack HandleSetLights(IVesselActuator actuator, SetEnabledArgs args) =>
            actuator.SetLights(args.Enabled);

        /// <summary>Validated (not silently clamped) at THIS admission gate — A-10's inconsistency fixed at the send gate, per the design doc §3.</summary>
        public static Ack HandleSetThrottle(IVesselActuator actuator, SetThrottleArgs args)
        {
            if (args.Value < 0.0 || args.Value > 1.0)
            {
                return Ack.Fail("E_RANGE");
            }
            return actuator.SetThrottle(args.Value);
        }

        public static StageResult HandleStage(IVesselActuator actuator, object? _) =>
            actuator.Stage();

        public static Ack HandleSetActionGroup(IVesselActuator actuator, SetActionGroupArgs args)
        {
            if (args.Group < 1 || args.Group > 10)
            {
                return Ack.Fail("E_RANGE");
            }
            return actuator.SetActionGroup(args.Group, args.State);
        }

        public static AddManeuverNodeResult HandleManeuverAdd(IVesselActuator actuator, AddManeuverNodeArgs args) =>
            actuator.AddManeuverNode(args.Ut, args.Prograde, args.Normal, args.RadialOut);

        public static Ack HandleManeuverUpdate(IVesselActuator actuator, UpdateManeuverNodeArgs args) =>
            actuator.UpdateManeuverNode(args.NodeId, args.Ut, args.Prograde, args.Normal, args.RadialOut);

        public static Ack HandleManeuverRemove(IVesselActuator actuator, RemoveManeuverNodeArgs args) =>
            actuator.RemoveManeuverNode(args.NodeId);

        /// <summary>
        /// Structurally-invalid args (the discriminated union's "wrong field
        /// for this Kind is missing" case) fail-fast here as <c>"E_NOT_FOUND"</c>
        /// without ever reaching the actuator — there is nothing a real KSP
        /// lookup could resolve from a null id. A well-formed request that
        /// simply doesn't match a live vessel/body is the actuator's own
        /// <c>"E_NOT_FOUND"</c> to return (it's the one with FlightGlobals in
        /// hand).
        /// </summary>
        public static Ack HandleTargetSet(IVesselActuator actuator, SetTargetArgs args)
        {
            switch (args.Kind)
            {
                case TargetKind.Vessel when string.IsNullOrEmpty(args.VesselId):
                case TargetKind.Body when !args.BodyIndex.HasValue:
                case TargetKind.Other:
                    return Ack.Fail("E_NOT_FOUND");
            }
            return actuator.SetTarget(args.Kind, args.VesselId, args.BodyIndex);
        }

        public static Ack HandleTargetClear(IVesselActuator actuator, object? _) =>
            actuator.ClearTarget();

        public static Ack HandleSetWarpIndex(IVesselActuator actuator, SetWarpIndexArgs args) =>
            actuator.SetWarp(args.Index);

        public static Ack HandleSetPaused(IVesselActuator actuator, SetPausedArgs args) =>
            actuator.SetPause(args.Paused);
    }
}
