using Sitrep.Contract;
using Sitrep.Host;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Test double for <see cref="IRoboticsActuator"/> — records exactly what
    /// each call was made with (so a test can assert "typed args produced the
    /// correct actuator call with the correct values, unscrambled") and returns
    /// a per-method, test-configurable result (defaulting to success) instead
    /// of ever touching KSP. Mirrors <see cref="FakeVesselActuator"/>'s
    /// "record + configurable" convention.
    /// </summary>
    internal sealed class FakeRoboticsActuator : IRoboticsActuator
    {
        // ---- recorded calls (null/default until the method is invoked) ----
        public string? LastSetServoTargetPartId;
        public double? LastSetServoTargetValue;
        public string? LastSetServoMotorPartId;
        public bool? LastSetServoMotorEngaged;
        public string? LastSetServoLockPartId;
        public bool? LastSetServoLockLocked;
        public string? LastSetRotorRpmLimitPartId;
        public double? LastSetRotorRpmLimitValue;
        public string? LastSetRotorTorqueLimitPartId;
        public double? LastSetRotorTorqueLimitValue;
        public string? LastSetRotorBrakePartId;
        public double? LastSetRotorBrakeValue;
        public string? LastSetRotorMotorPartId;
        public bool? LastSetRotorMotorEngaged;
        public string? LastSetRotorLockPartId;
        public bool? LastSetRotorLockLocked;
        public string? LastReverseRotorPartId;

        // ---- configurable results (default: success) ----
        public CommandResult SetServoTargetResult = CommandResult.Ok();
        public CommandResult SetServoMotorResult = CommandResult.Ok();
        public CommandResult SetServoLockResult = CommandResult.Ok();
        public CommandResult SetRotorRpmLimitResult = CommandResult.Ok();
        public CommandResult SetRotorTorqueLimitResult = CommandResult.Ok();
        public CommandResult SetRotorBrakeResult = CommandResult.Ok();
        public CommandResult SetRotorMotorResult = CommandResult.Ok();
        public CommandResult SetRotorLockResult = CommandResult.Ok();
        public CommandResult ReverseRotorResult = CommandResult.Ok();

        public CommandResult SetServoTarget(string partId, double value)
        {
            LastSetServoTargetPartId = partId;
            LastSetServoTargetValue = value;
            return SetServoTargetResult;
        }

        public CommandResult SetServoMotor(string partId, bool engaged)
        {
            LastSetServoMotorPartId = partId;
            LastSetServoMotorEngaged = engaged;
            return SetServoMotorResult;
        }

        public CommandResult SetServoLock(string partId, bool locked)
        {
            LastSetServoLockPartId = partId;
            LastSetServoLockLocked = locked;
            return SetServoLockResult;
        }

        public CommandResult SetRotorRpmLimit(string partId, double value)
        {
            LastSetRotorRpmLimitPartId = partId;
            LastSetRotorRpmLimitValue = value;
            return SetRotorRpmLimitResult;
        }

        public CommandResult SetRotorTorqueLimit(string partId, double value)
        {
            LastSetRotorTorqueLimitPartId = partId;
            LastSetRotorTorqueLimitValue = value;
            return SetRotorTorqueLimitResult;
        }

        public CommandResult SetRotorBrake(string partId, double value)
        {
            LastSetRotorBrakePartId = partId;
            LastSetRotorBrakeValue = value;
            return SetRotorBrakeResult;
        }

        public CommandResult SetRotorMotor(string partId, bool engaged)
        {
            LastSetRotorMotorPartId = partId;
            LastSetRotorMotorEngaged = engaged;
            return SetRotorMotorResult;
        }

        public CommandResult SetRotorLock(string partId, bool locked)
        {
            LastSetRotorLockPartId = partId;
            LastSetRotorLockLocked = locked;
            return SetRotorLockResult;
        }

        public CommandResult ReverseRotor(string partId)
        {
            LastReverseRotorPartId = partId;
            return ReverseRotorResult;
        }
    }
}
