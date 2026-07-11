using Sitrep.Contract;
using Sitrep.Host;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Test double for <see cref="IVesselActuator"/> — records exactly what
    /// each call was made with (so a test can assert "typed args produced
    /// the correct actuator call with the correct values", per M1 Task 3's
    /// verification plan) and returns a per-method, test-configurable
    /// result (defaulting to success) instead of ever touching KSP. Mirrors
    /// <see cref="FakeUplinkHost"/>'s "record + configurable" convention
    /// for this project's other seam interfaces.
    /// </summary>
    internal sealed class FakeVesselActuator : IVesselActuator
    {
        // ---- recorded calls (null/default until the method is invoked) ----
        public bool? LastSetSasEnabled;
        public SasMode? LastSetSasMode;
        public bool? LastSetRcsEnabled;
        public bool? LastSetGearEnabled;
        public bool? LastSetBrakesEnabled;
        public bool? LastSetLightsEnabled;
        public bool? LastSetAbortEnabled;
        public double? LastSetThrottleValue;
        public bool? LastSetFlyByWireEnabled;
        public SetControlAxesArgs? LastSetControlAxes;
        public int StageCallCount;
        public int? LastActionGroup;
        public bool? LastActionGroupState;
        public double? LastManeuverAddUt;
        public double? LastManeuverAddPrograde;
        public double? LastManeuverAddNormal;
        public double? LastManeuverAddRadialOut;
        public string? LastManeuverUpdateNodeId;
        public double? LastManeuverUpdateUt;
        public double? LastManeuverUpdatePrograde;
        public double? LastManeuverUpdateNormal;
        public double? LastManeuverUpdateRadialOut;
        public string? LastManeuverRemoveNodeId;
        public TargetKind? LastSetTargetKind;
        public string? LastSetTargetVesselId;
        public int? LastSetTargetBodyIndex;
        public int ClearTargetCallCount;
        public int? LastSetWarpIndex;
        public bool? LastSetPause;

        // ---- configurable results (default: success) ----
        public CommandResult SetSasResult = CommandResult.Ok();
        public CommandResult SetSasModeResult = CommandResult.Ok();
        public CommandResult SetRcsResult = CommandResult.Ok();
        public CommandResult SetGearResult = CommandResult.Ok();
        public CommandResult SetBrakesResult = CommandResult.Ok();
        public CommandResult SetLightsResult = CommandResult.Ok();
        public CommandResult SetAbortResult = CommandResult.Ok();
        public CommandResult SetThrottleResult = CommandResult.Ok();
        public CommandResult SetFlyByWireResult = CommandResult.Ok();
        public CommandResult SetControlAxesResult = CommandResult.Ok();
        public CommandResult<int> StageResultValue = CommandResult<int>.Ok(1);
        public CommandResult SetActionGroupResult = CommandResult.Ok();
        public CommandResult<string> AddManeuverNodeResultValue = CommandResult<string>.Ok("node-1");
        public CommandResult UpdateManeuverNodeResult = CommandResult.Ok();
        public CommandResult RemoveManeuverNodeResult = CommandResult.Ok();
        public CommandResult SetTargetResult = CommandResult.Ok();
        public CommandResult ClearTargetResult = CommandResult.Ok();
        public CommandResult SetWarpResult = CommandResult.Ok();
        public CommandResult SetPauseResult = CommandResult.Ok();

        public CommandResult SetSas(bool enabled)
        {
            LastSetSasEnabled = enabled;
            return SetSasResult;
        }

        public CommandResult SetSasMode(SasMode mode)
        {
            LastSetSasMode = mode;
            return SetSasModeResult;
        }

        public CommandResult SetRcs(bool enabled)
        {
            LastSetRcsEnabled = enabled;
            return SetRcsResult;
        }

        public CommandResult SetGear(bool enabled)
        {
            LastSetGearEnabled = enabled;
            return SetGearResult;
        }

        public CommandResult SetBrakes(bool enabled)
        {
            LastSetBrakesEnabled = enabled;
            return SetBrakesResult;
        }

        public CommandResult SetLights(bool enabled)
        {
            LastSetLightsEnabled = enabled;
            return SetLightsResult;
        }

        public CommandResult SetAbort(bool enabled)
        {
            LastSetAbortEnabled = enabled;
            return SetAbortResult;
        }

        public CommandResult SetThrottle(double value)
        {
            LastSetThrottleValue = value;
            return SetThrottleResult;
        }

        public CommandResult SetFlyByWire(bool enabled)
        {
            LastSetFlyByWireEnabled = enabled;
            return SetFlyByWireResult;
        }

        public CommandResult SetControlAxes(SetControlAxesArgs axes)
        {
            LastSetControlAxes = axes;
            return SetControlAxesResult;
        }

        public CommandResult<int> Stage()
        {
            StageCallCount++;
            return StageResultValue;
        }

        public CommandResult SetActionGroup(int group, bool state)
        {
            LastActionGroup = group;
            LastActionGroupState = state;
            return SetActionGroupResult;
        }

        public CommandResult<string> AddManeuverNode(double ut, double prograde, double normal, double radialOut)
        {
            LastManeuverAddUt = ut;
            LastManeuverAddPrograde = prograde;
            LastManeuverAddNormal = normal;
            LastManeuverAddRadialOut = radialOut;
            return AddManeuverNodeResultValue;
        }

        public CommandResult UpdateManeuverNode(string nodeId, double ut, double prograde, double normal, double radialOut)
        {
            LastManeuverUpdateNodeId = nodeId;
            LastManeuverUpdateUt = ut;
            LastManeuverUpdatePrograde = prograde;
            LastManeuverUpdateNormal = normal;
            LastManeuverUpdateRadialOut = radialOut;
            return UpdateManeuverNodeResult;
        }

        public CommandResult RemoveManeuverNode(string nodeId)
        {
            LastManeuverRemoveNodeId = nodeId;
            return RemoveManeuverNodeResult;
        }

        public CommandResult SetTarget(TargetKind kind, string? vesselId, int? bodyIndex)
        {
            LastSetTargetKind = kind;
            LastSetTargetVesselId = vesselId;
            LastSetTargetBodyIndex = bodyIndex;
            return SetTargetResult;
        }

        public CommandResult ClearTarget()
        {
            ClearTargetCallCount++;
            return ClearTargetResult;
        }

        public CommandResult SetWarp(int index)
        {
            LastSetWarpIndex = index;
            return SetWarpResult;
        }

        public CommandResult SetPause(bool paused)
        {
            LastSetPause = paused;
            return SetPauseResult;
        }
    }
}
