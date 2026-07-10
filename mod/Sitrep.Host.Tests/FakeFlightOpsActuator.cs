using Sitrep.Contract;
using Sitrep.Host;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Test double for <see cref="IFlightOpsActuator"/> — records exactly what
    /// each call was made with (so a test can assert typed args reached the
    /// correct actuator method with the correct values) and returns a
    /// per-method, test-configurable result (defaulting to success) instead of
    /// ever touching KSP. Mirrors <see cref="FakeVesselActuator"/>'s
    /// "record + configurable" convention.
    /// </summary>
    internal sealed class FakeFlightOpsActuator : IFlightOpsActuator
    {
        // ---- recorded calls (null/0 until the method is invoked) ----
        public int RevertToLaunchCallCount;
        public EditorFacilityKind? LastRevertToEditorFacility;
        public int ToTrackingStationCallCount;
        public string? LastSwitchVesselId;
        public int RecoverCallCount;

        // ---- configurable results (default: success) ----
        public CommandResult RevertToLaunchResult = CommandResult.Ok();
        public CommandResult RevertToEditorResult = CommandResult.Ok();
        public CommandResult ToTrackingStationResult = CommandResult.Ok();
        public CommandResult SwitchVesselResult = CommandResult.Ok();
        public CommandResult RecoverResult = CommandResult.Ok();

        public CommandResult RevertToLaunch()
        {
            RevertToLaunchCallCount++;
            return RevertToLaunchResult;
        }

        public CommandResult RevertToEditor(EditorFacilityKind facility)
        {
            LastRevertToEditorFacility = facility;
            return RevertToEditorResult;
        }

        public CommandResult ToTrackingStation()
        {
            ToTrackingStationCallCount++;
            return ToTrackingStationResult;
        }

        public CommandResult SwitchVessel(string vesselId)
        {
            LastSwitchVesselId = vesselId;
            return SwitchVesselResult;
        }

        public CommandResult Recover()
        {
            RecoverCallCount++;
            return RecoverResult;
        }
    }
}
