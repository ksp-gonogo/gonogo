using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Unit tests for <see cref="VesselCommandProvider"/>'s <c>Handle*</c>
    /// glue against a <see cref="FakeVesselActuator"/> — proves typed args
    /// reach the correct actuator method with the correct values (never
    /// scrambled), that every boolean command is an ABSOLUTE set (not a
    /// toggle — see <see cref="SetEnabledArgs"/>'s doc comment), that
    /// args-level range validation happens before the actuator is ever
    /// called, and that the maneuver-node radial/normal/prograde frame is
    /// threaded through in the correct order end to end. The engine-level
    /// <c>delayed</c> disposition itself is proven separately in
    /// <c>Sitrep.Host.IntegrationTests.ChannelEngineTests</c> (this project
    /// doesn't reference <see cref="ChannelEngine"/>).
    /// </summary>
    public class VesselCommandProviderTests
    {
        [Fact]
        public void HandleSetSasPassesEnabledThroughAsAbsoluteState()
        {
            var actuator = new FakeVesselActuator();

            var result = VesselCommandProvider.HandleSetSas(actuator, new SetEnabledArgs { Enabled = true });

            Assert.True(actuator.LastSetSasEnabled);
            Assert.True(result.Success);
        }

        [Fact]
        public void HandleSetSasModePassesTypedModeThrough()
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleSetSasMode(actuator, new SetSasModeArgs { Mode = SasMode.Prograde });

            Assert.Equal(SasMode.Prograde, actuator.LastSetSasMode);
        }

        [Fact]
        public void HandleSetSasModeSurfacesTheActuatorsModeUnavailableError()
        {
            var actuator = new FakeVesselActuator { SetSasModeResult = Ack.Fail("E_MODE_UNAVAILABLE") };

            var result = VesselCommandProvider.HandleSetSasMode(actuator, new SetSasModeArgs { Mode = SasMode.Maneuver });

            Assert.False(result.Success);
            Assert.Equal("E_MODE_UNAVAILABLE", result.ErrorCode);
        }

        [Fact]
        public void HandleSetRcsPassesEnabledThroughAsAbsoluteState()
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleSetRcs(actuator, new SetEnabledArgs { Enabled = false });

            Assert.False(actuator.LastSetRcsEnabled);
        }

        [Fact]
        public void HandleSetGearPassesEnabledThroughAsAbsoluteState()
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleSetGear(actuator, new SetEnabledArgs { Enabled = true });

            Assert.True(actuator.LastSetGearEnabled);
        }

        [Fact]
        public void HandleSetBrakesPassesEnabledThroughAsAbsoluteState()
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleSetBrakes(actuator, new SetEnabledArgs { Enabled = true });

            Assert.True(actuator.LastSetBrakesEnabled);
        }

        [Fact]
        public void HandleSetLightsPassesEnabledThroughAsAbsoluteState()
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleSetLights(actuator, new SetEnabledArgs { Enabled = false });

            Assert.False(actuator.LastSetLightsEnabled);
        }

        [Theory]
        [InlineData(0.0)]
        [InlineData(0.5)]
        [InlineData(1.0)]
        public void HandleSetThrottleCallsActuatorForInRangeValues(double value)
        {
            var actuator = new FakeVesselActuator();

            var result = VesselCommandProvider.HandleSetThrottle(actuator, new SetThrottleArgs { Value = value });

            Assert.Equal(value, actuator.LastSetThrottleValue);
            Assert.True(result.Success);
        }

        [Theory]
        [InlineData(-0.1)]
        [InlineData(1.1)]
        [InlineData(2.0)]
        public void HandleSetThrottleRejectsOutOfRangeValuesBeforeEverCallingTheActuator(double value)
        {
            var actuator = new FakeVesselActuator();

            var result = VesselCommandProvider.HandleSetThrottle(actuator, new SetThrottleArgs { Value = value });

            Assert.False(result.Success);
            Assert.Equal("E_RANGE", result.ErrorCode);
            Assert.Null(actuator.LastSetThrottleValue);
        }

        [Fact]
        public void HandleStageCallsTheActuatorAndReturnsItsNewStageResult()
        {
            var actuator = new FakeVesselActuator { StageResultValue = new StageResult { Success = true, NewStage = 3 } };

            var result = VesselCommandProvider.HandleStage(actuator, null);

            Assert.Equal(1, actuator.StageCallCount);
            Assert.Equal(3, result.NewStage);
        }

        [Theory]
        [InlineData(1)]
        [InlineData(10)]
        public void HandleSetActionGroupCallsActuatorForInRangeGroups(int group)
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleSetActionGroup(actuator, new SetActionGroupArgs { Group = group, State = true });

            Assert.Equal(group, actuator.LastActionGroup);
            Assert.True(actuator.LastActionGroupState);
        }

        [Theory]
        [InlineData(0)]
        [InlineData(11)]
        public void HandleSetActionGroupRejectsOutOfRangeGroupsBeforeEverCallingTheActuator(int group)
        {
            var actuator = new FakeVesselActuator();

            var result = VesselCommandProvider.HandleSetActionGroup(actuator, new SetActionGroupArgs { Group = group, State = true });

            Assert.False(result.Success);
            Assert.Equal("E_RANGE", result.ErrorCode);
            Assert.Null(actuator.LastActionGroup);
        }

        /// <summary>
        /// The load-bearing arg-order test: named radial/normal/prograde
        /// fields must reach the actuator's matching NAMED parameters
        /// unscrambled — O-4's whole point. Using three distinct values (not
        /// e.g. all 1.0) means any accidental swap between prograde/normal/
        /// radialOut would fail this assertion.
        /// </summary>
        [Fact]
        public void HandleManeuverAddThreadsNamedDvComponentsInTheCorrectOrder()
        {
            var actuator = new FakeVesselActuator();

            var result = VesselCommandProvider.HandleManeuverAdd(actuator, new AddManeuverNodeArgs
            {
                Ut = 12345.0,
                Prograde = 100.0,
                Normal = 20.0,
                RadialOut = 3.0,
            });

            Assert.Equal(12345.0, actuator.LastManeuverAddUt);
            Assert.Equal(100.0, actuator.LastManeuverAddPrograde);
            Assert.Equal(20.0, actuator.LastManeuverAddNormal);
            Assert.Equal(3.0, actuator.LastManeuverAddRadialOut);
            Assert.True(result.Success);
        }

        [Fact]
        public void HandleManeuverUpdateThreadsNodeIdAndNamedDvComponentsInTheCorrectOrder()
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleManeuverUpdate(actuator, new UpdateManeuverNodeArgs
            {
                NodeId = "node-7",
                Ut = 999.0,
                Prograde = 7.0,
                Normal = 8.0,
                RadialOut = 9.0,
            });

            Assert.Equal("node-7", actuator.LastManeuverUpdateNodeId);
            Assert.Equal(999.0, actuator.LastManeuverUpdateUt);
            Assert.Equal(7.0, actuator.LastManeuverUpdatePrograde);
            Assert.Equal(8.0, actuator.LastManeuverUpdateNormal);
            Assert.Equal(9.0, actuator.LastManeuverUpdateRadialOut);
        }

        [Fact]
        public void HandleManeuverUpdateSurfacesTheActuatorsNotFoundError()
        {
            var actuator = new FakeVesselActuator { UpdateManeuverNodeResult = Ack.Fail("E_NOT_FOUND") };

            var result = VesselCommandProvider.HandleManeuverUpdate(actuator, new UpdateManeuverNodeArgs { NodeId = "missing" });

            Assert.False(result.Success);
            Assert.Equal("E_NOT_FOUND", result.ErrorCode);
        }

        [Fact]
        public void HandleManeuverRemovePassesNodeIdThrough()
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleManeuverRemove(actuator, new RemoveManeuverNodeArgs { NodeId = "node-3" });

            Assert.Equal("node-3", actuator.LastManeuverRemoveNodeId);
        }

        [Fact]
        public void HandleTargetSetPassesVesselKindAndIdThrough()
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleTargetSet(actuator, new SetTargetArgs { Kind = TargetKind.Vessel, VesselId = "guid-1" });

            Assert.Equal(TargetKind.Vessel, actuator.LastSetTargetKind);
            Assert.Equal("guid-1", actuator.LastSetTargetVesselId);
        }

        [Fact]
        public void HandleTargetSetPassesBodyKindAndIndexThrough()
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleTargetSet(actuator, new SetTargetArgs { Kind = TargetKind.Body, BodyIndex = 2 });

            Assert.Equal(TargetKind.Body, actuator.LastSetTargetKind);
            Assert.Equal(2, actuator.LastSetTargetBodyIndex);
        }

        [Fact]
        public void HandleTargetSetRejectsAVesselKindWithNoVesselIdWithoutEverCallingTheActuator()
        {
            var actuator = new FakeVesselActuator();

            var result = VesselCommandProvider.HandleTargetSet(actuator, new SetTargetArgs { Kind = TargetKind.Vessel, VesselId = null });

            Assert.False(result.Success);
            Assert.Equal("E_NOT_FOUND", result.ErrorCode);
            Assert.Null(actuator.LastSetTargetKind);
        }

        [Fact]
        public void HandleTargetSetRejectsABodyKindWithNoBodyIndexWithoutEverCallingTheActuator()
        {
            var actuator = new FakeVesselActuator();

            var result = VesselCommandProvider.HandleTargetSet(actuator, new SetTargetArgs { Kind = TargetKind.Body, BodyIndex = null });

            Assert.False(result.Success);
            Assert.Equal("E_NOT_FOUND", result.ErrorCode);
            Assert.Null(actuator.LastSetTargetKind);
        }

        [Fact]
        public void HandleTargetClearCallsTheActuator()
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleTargetClear(actuator, null);

            Assert.Equal(1, actuator.ClearTargetCallCount);
        }

        [Fact]
        public void HandleSetWarpIndexPassesIndexThrough()
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleSetWarpIndex(actuator, new SetWarpIndexArgs { Index = 4 });

            Assert.Equal(4, actuator.LastSetWarpIndex);
        }

        [Fact]
        public void HandleSetPausedPassesPausedThroughAsAbsoluteState()
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleSetPaused(actuator, new SetPausedArgs { Paused = true });

            Assert.True(actuator.LastSetPause);
        }
    }
}
