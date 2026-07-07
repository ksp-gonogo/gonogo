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
    /// <see cref="FakeExtensionHost"/>'s "record + configurable" convention
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
        public double? LastSetThrottleValue;
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
        public Ack SetSasResult = Ack.Ok();
        public Ack SetSasModeResult = Ack.Ok();
        public Ack SetRcsResult = Ack.Ok();
        public Ack SetGearResult = Ack.Ok();
        public Ack SetBrakesResult = Ack.Ok();
        public Ack SetLightsResult = Ack.Ok();
        public Ack SetThrottleResult = Ack.Ok();
        public StageResult StageResultValue = new StageResult { Success = true, NewStage = 1 };
        public Ack SetActionGroupResult = Ack.Ok();
        public AddManeuverNodeResult AddManeuverNodeResultValue = new AddManeuverNodeResult { Success = true, NodeId = "node-1" };
        public Ack UpdateManeuverNodeResult = Ack.Ok();
        public Ack RemoveManeuverNodeResult = Ack.Ok();
        public Ack SetTargetResult = Ack.Ok();
        public Ack ClearTargetResult = Ack.Ok();
        public Ack SetWarpResult = Ack.Ok();
        public Ack SetPauseResult = Ack.Ok();

        public Ack SetSas(bool enabled)
        {
            LastSetSasEnabled = enabled;
            return SetSasResult;
        }

        public Ack SetSasMode(SasMode mode)
        {
            LastSetSasMode = mode;
            return SetSasModeResult;
        }

        public Ack SetRcs(bool enabled)
        {
            LastSetRcsEnabled = enabled;
            return SetRcsResult;
        }

        public Ack SetGear(bool enabled)
        {
            LastSetGearEnabled = enabled;
            return SetGearResult;
        }

        public Ack SetBrakes(bool enabled)
        {
            LastSetBrakesEnabled = enabled;
            return SetBrakesResult;
        }

        public Ack SetLights(bool enabled)
        {
            LastSetLightsEnabled = enabled;
            return SetLightsResult;
        }

        public Ack SetThrottle(double value)
        {
            LastSetThrottleValue = value;
            return SetThrottleResult;
        }

        public StageResult Stage()
        {
            StageCallCount++;
            return StageResultValue;
        }

        public Ack SetActionGroup(int group, bool state)
        {
            LastActionGroup = group;
            LastActionGroupState = state;
            return SetActionGroupResult;
        }

        public AddManeuverNodeResult AddManeuverNode(double ut, double prograde, double normal, double radialOut)
        {
            LastManeuverAddUt = ut;
            LastManeuverAddPrograde = prograde;
            LastManeuverAddNormal = normal;
            LastManeuverAddRadialOut = radialOut;
            return AddManeuverNodeResultValue;
        }

        public Ack UpdateManeuverNode(string nodeId, double ut, double prograde, double normal, double radialOut)
        {
            LastManeuverUpdateNodeId = nodeId;
            LastManeuverUpdateUt = ut;
            LastManeuverUpdatePrograde = prograde;
            LastManeuverUpdateNormal = normal;
            LastManeuverUpdateRadialOut = radialOut;
            return UpdateManeuverNodeResult;
        }

        public Ack RemoveManeuverNode(string nodeId)
        {
            LastManeuverRemoveNodeId = nodeId;
            return RemoveManeuverNodeResult;
        }

        public Ack SetTarget(TargetKind kind, string? vesselId, int? bodyIndex)
        {
            LastSetTargetKind = kind;
            LastSetTargetVesselId = vesselId;
            LastSetTargetBodyIndex = bodyIndex;
            return SetTargetResult;
        }

        public Ack ClearTarget()
        {
            ClearTargetCallCount++;
            return ClearTargetResult;
        }

        public Ack SetWarp(int index)
        {
            LastSetWarpIndex = index;
            return SetWarpResult;
        }

        public Ack SetPause(bool paused)
        {
            LastSetPause = paused;
            return SetPauseResult;
        }
    }
}
