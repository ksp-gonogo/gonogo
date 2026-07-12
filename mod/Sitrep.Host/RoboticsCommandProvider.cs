using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free command-handling logic for the Breaking Ground robotics
    /// commands — the command-side twin of <see cref="PartsViewProvider"/>'s
    /// robotics read channel, and the robotics analogue of
    /// <see cref="VesselCommandProvider"/>. Each <c>Handle*</c> method is the
    /// exact delegate <c>Gonogo.KSP.PartsUplink.Register</c> hands to
    /// <see cref="IUplinkHost.AddCommandHandler{TArgs,TResult}"/>: it validates
    /// the already-typed args, calls the one matching
    /// <see cref="IRoboticsActuator"/> method, and hands back the typed result.
    /// No KSP/Unity type appears here.
    ///
    /// <para><b>Two-tier validation</b>, matching every other command provider:
    /// a check that needs only the args themselves happens HERE (an empty
    /// <c>partId</c> can never resolve a live part, so it fails fast with
    /// <see cref="CommandErrorCode.NotFound"/>; the contract-known scalar
    /// bounds — torque 0–100, brake 0–200 — are rejected with
    /// <see cref="CommandErrorCode.Range"/>). Everything that needs live game
    /// state — whether the id resolves, whether the resolved part is the right
    /// subtype, whether a servo is motorized — is the actuator's job and comes
    /// back as a typed <see cref="CommandResult.ErrorCode"/>.</para>
    ///
    /// <para><b>Absolute set, never toggle</b> for every value/boolean command
    /// (see <see cref="ServoSetEnabledArgs"/>'s doc comment); the lone
    /// exception is <c>robotics.rotor.reverse</c>, which is a direction flip by
    /// nature and so carries no state.</para>
    /// </summary>
    public static class RoboticsCommandProvider
    {
        // ---- robotics.* -- delayed:true (actuation of parts ON the craft
        // rides light-time, same class as vessel.control.*) ----
        public const string ServoSetTargetCommand = "robotics.servo.setTarget";
        public const string ServoSetMotorCommand = "robotics.servo.setMotor";
        public const string ServoSetLockCommand = "robotics.servo.setLock";
        public const string RotorSetRpmLimitCommand = "robotics.rotor.setRpmLimit";
        public const string RotorSetTorqueLimitCommand = "robotics.rotor.setTorqueLimit";
        public const string RotorSetBrakeCommand = "robotics.rotor.setBrake";
        public const string RotorSetMotorCommand = "robotics.rotor.setMotor";
        public const string RotorSetLockCommand = "robotics.rotor.setLock";
        public const string RotorReverseCommand = "robotics.rotor.reverse";

        /// <summary>Torque-limit percentage upper bound (<c>servoMotorLimit</c> is a 0–100 percent).</summary>
        private const double TorqueLimitMax = 100.0;

        /// <summary>Brake percentage upper bound (<c>brakePercentage</c> ranges 0–200 in the stock UI).</summary>
        private const double BrakePercentMax = 200.0;

        public static CommandResult HandleServoSetTarget(IRoboticsActuator actuator, ServoSetTargetArgs args)
        {
            if (string.IsNullOrEmpty(args.PartId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return actuator.SetServoTarget(args.PartId, args.Value);
        }

        public static CommandResult HandleServoSetMotor(IRoboticsActuator actuator, ServoSetEnabledArgs args)
        {
            if (string.IsNullOrEmpty(args.PartId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return actuator.SetServoMotor(args.PartId, args.Enabled);
        }

        public static CommandResult HandleServoSetLock(IRoboticsActuator actuator, ServoSetEnabledArgs args)
        {
            if (string.IsNullOrEmpty(args.PartId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return actuator.SetServoLock(args.PartId, args.Enabled);
        }

        public static CommandResult HandleRotorSetRpmLimit(IRoboticsActuator actuator, RotorSetValueArgs args)
        {
            if (string.IsNullOrEmpty(args.PartId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return actuator.SetRotorRpmLimit(args.PartId, args.Value);
        }

        public static CommandResult HandleRotorSetTorqueLimit(IRoboticsActuator actuator, RotorSetValueArgs args)
        {
            if (string.IsNullOrEmpty(args.PartId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            if (args.Value < 0.0 || args.Value > TorqueLimitMax)
            {
                return CommandResult.Fail(CommandErrorCode.Range);
            }
            return actuator.SetRotorTorqueLimit(args.PartId, args.Value);
        }

        public static CommandResult HandleRotorSetBrake(IRoboticsActuator actuator, RotorSetValueArgs args)
        {
            if (string.IsNullOrEmpty(args.PartId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            if (args.Value < 0.0 || args.Value > BrakePercentMax)
            {
                return CommandResult.Fail(CommandErrorCode.Range);
            }
            return actuator.SetRotorBrake(args.PartId, args.Value);
        }

        public static CommandResult HandleRotorSetMotor(IRoboticsActuator actuator, ServoSetEnabledArgs args)
        {
            if (string.IsNullOrEmpty(args.PartId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return actuator.SetRotorMotor(args.PartId, args.Enabled);
        }

        public static CommandResult HandleRotorSetLock(IRoboticsActuator actuator, ServoSetEnabledArgs args)
        {
            if (string.IsNullOrEmpty(args.PartId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return actuator.SetRotorLock(args.PartId, args.Enabled);
        }

        public static CommandResult HandleRotorReverse(IRoboticsActuator actuator, RotorReverseArgs args)
        {
            if (string.IsNullOrEmpty(args.PartId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return actuator.ReverseRotor(args.PartId);
        }
    }
}
