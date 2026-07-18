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
            var actuator = new FakeVesselActuator { SetSasModeResult = CommandResult.Fail(CommandErrorCode.ModeUnavailable) };

            var result = VesselCommandProvider.HandleSetSasMode(actuator, new SetSasModeArgs { Mode = SasMode.Maneuver });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
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
            Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
            Assert.Null(actuator.LastSetThrottleValue);
        }

        [Fact]
        public void HandleStageCallsTheActuatorAndReturnsItsNewStageResult()
        {
            var actuator = new FakeVesselActuator { StageResultValue = CommandResult<int>.Ok(3) };

            var result = VesselCommandProvider.HandleStage(actuator, null);

            Assert.Equal(1, actuator.StageCallCount);
            Assert.Equal(3, result.Payload);
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

        /// <summary>
        /// Same split as
        /// <see cref="HandleSetWarpIndexRejectsNegativeIndicesBeforeEverCallingTheActuator"/>:
        /// only the unambiguously-invalid case is rejected HERE. A non-positive
        /// group is nonsense under EVERY backend, so it never reaches the
        /// actuator.
        /// </summary>
        [Theory]
        [InlineData(0)]
        [InlineData(-1)]
        public void HandleSetActionGroupRejectsNonPositiveGroupsBeforeEverCallingTheActuator(int group)
        {
            var actuator = new FakeVesselActuator();

            var result = VesselCommandProvider.HandleSetActionGroup(actuator, new SetActionGroupArgs { Group = group, State = true });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
            Assert.Null(actuator.LastActionGroup);
        }

        /// <summary>
        /// This provider used to hardcode <c>group > 10 => Range</c>. It must
        /// NOT any more: the elected action-groups backend owns the upper bound
        /// (stock stops at 10, but Action Groups Extended legitimately goes to
        /// 250), and this KSP-free provider cannot see which backend won. So
        /// group 11 is DELEGATED, not pre-rejected — under stock the actuator's
        /// backend still fails it cleanly with Range (see
        /// <c>StockActionGroupsBackend.SetGroup</c>), but that verdict is the
        /// backend's to give, not this file's to assume.
        ///
        /// <para>This is the regression guard for the whole seam: reintroducing
        /// a <c>&gt; 10</c> check here would silently cap AGX at ten groups
        /// while every other layer happily carried 250.</para>
        /// </summary>
        [Theory]
        [InlineData(11)]
        [InlineData(250)]
        public void HandleSetActionGroupDelegatesAboveStocksTenRatherThanAssumingTheBound(int group)
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleSetActionGroup(actuator, new SetActionGroupArgs { Group = group, State = true });

            Assert.Equal(group, actuator.LastActionGroup);
            Assert.True(actuator.LastActionGroupState);
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
            var actuator = new FakeVesselActuator { UpdateManeuverNodeResult = CommandResult.Fail(CommandErrorCode.NotFound) };

            var result = VesselCommandProvider.HandleManeuverUpdate(actuator, new UpdateManeuverNodeArgs { NodeId = "missing" });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
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
        public void HandleTargetSetPassesPositionKindAndLatLonThrough()
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleTargetSet(actuator, new SetTargetArgs { Kind = TargetKind.Position, BodyIndex = 1, Latitude = -0.5, Longitude = 74.7 });

            Assert.Equal(TargetKind.Position, actuator.LastSetTargetKind);
            Assert.Equal(1, actuator.LastSetTargetBodyIndex);
            Assert.Equal(-0.5, actuator.LastSetTargetLatitude);
            Assert.Equal(74.7, actuator.LastSetTargetLongitude);
        }

        [Fact]
        public void HandleTargetSetRejectsAPositionKindWithNoLatLonWithoutEverCallingTheActuator()
        {
            var actuator = new FakeVesselActuator();

            var result = VesselCommandProvider.HandleTargetSet(actuator, new SetTargetArgs { Kind = TargetKind.Position, BodyIndex = 1, Latitude = null, Longitude = null });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastSetTargetKind);
        }

        [Fact]
        public void HandleTargetSetRejectsAPositionKindWithNoBodyIndexWithoutEverCallingTheActuator()
        {
            var actuator = new FakeVesselActuator();

            var result = VesselCommandProvider.HandleTargetSet(actuator, new SetTargetArgs { Kind = TargetKind.Position, BodyIndex = null, Latitude = -0.5, Longitude = 74.7 });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastSetTargetKind);
        }

        [Fact]
        public void HandleTargetSetRejectsAVesselKindWithNoVesselIdWithoutEverCallingTheActuator()
        {
            var actuator = new FakeVesselActuator();

            var result = VesselCommandProvider.HandleTargetSet(actuator, new SetTargetArgs { Kind = TargetKind.Vessel, VesselId = null });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastSetTargetKind);
        }

        [Fact]
        public void HandleTargetSetRejectsABodyKindWithNoBodyIndexWithoutEverCallingTheActuator()
        {
            var actuator = new FakeVesselActuator();

            var result = VesselCommandProvider.HandleTargetSet(actuator, new SetTargetArgs { Kind = TargetKind.Body, BodyIndex = null });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
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

        /// <summary>
        /// Mirrors <see cref="HandleSetActionGroupRejectsOutOfRangeGroupsBeforeEverCallingTheActuator"/> —
        /// the design table's <c>time.setWarpIndex</c> row (§3) specifies
        /// <c>CommandResult | CommandErrorCode.Range</c>, but nothing was admission-checking a
        /// negative index before this fix. The real upper bound
        /// (<c>TimeWarp.warpRates.Length</c>) is only known live in
        /// <c>KspVesselActuator</c>; the provider's own job is to reject the
        /// unambiguously-invalid case (negative) before the actuator is ever
        /// called, same split as every other range-checked command here.
        /// </summary>
        [Theory]
        [InlineData(-1)]
        [InlineData(-100)]
        public void HandleSetWarpIndexRejectsNegativeIndicesBeforeEverCallingTheActuator(int index)
        {
            var actuator = new FakeVesselActuator();

            var result = VesselCommandProvider.HandleSetWarpIndex(actuator, new SetWarpIndexArgs { Index = index });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
            Assert.Null(actuator.LastSetWarpIndex);
        }

        /// <summary>
        /// <c>vessel.control.setAbort</c> follows the exact same pattern as
        /// <see cref="HandleSetGearPassesEnabledThroughAsAbsoluteState"/>/
        /// setBrakes/setLights — absolute-set <see cref="SetEnabledArgs"/>,
        /// no range validation needed (it's boolean).
        /// </summary>
        [Fact]
        public void HandleSetAbortPassesEnabledThroughAsAbsoluteState()
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleSetAbort(actuator, new SetEnabledArgs { Enabled = true });

            Assert.True(actuator.LastSetAbortEnabled);
        }

        [Fact]
        public void HandleSetPausedPassesPausedThroughAsAbsoluteState()
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleSetPaused(actuator, new SetPausedArgs { Paused = true });

            Assert.True(actuator.LastSetPause);
        }

        [Theory]
        [InlineData(true)]
        [InlineData(false)]
        public void HandleSetFlyByWirePassesEnabledThroughAsAbsoluteState(bool enabled)
        {
            var actuator = new FakeVesselActuator();

            var result = VesselCommandProvider.HandleSetFlyByWire(actuator, new SetFlyByWireArgs { Enabled = enabled });

            Assert.Equal(enabled, actuator.LastSetFlyByWireEnabled);
            Assert.True(result.Success);
        }

        [Fact]
        public void HandleSetFlyByWireSurfacesTheActuatorsNoVesselError()
        {
            var actuator = new FakeVesselActuator { SetFlyByWireResult = CommandResult.Fail(CommandErrorCode.NoVessel) };

            var result = VesselCommandProvider.HandleSetFlyByWire(actuator, new SetFlyByWireArgs { Enabled = true });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NoVessel, result.ErrorCode);
        }

        /// <summary>
        /// Distinct values on every axis prove each named field reaches the
        /// actuator unscrambled — the fly-by-wire analog of the maneuver-node
        /// arg-order test.
        /// </summary>
        [Fact]
        public void HandleSetControlAxesThreadsEveryNamedAxisThrough()
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleSetControlAxes(actuator, new SetControlAxesArgs
            {
                Pitch = 0.1,
                Yaw = 0.2,
                Roll = 0.3,
                X = 0.4,
                Y = 0.5,
                Z = 0.6,
                PitchTrim = 0.7,
                YawTrim = 0.8,
                RollTrim = 0.9,
            });

            var axes = actuator.LastSetControlAxes;
            Assert.NotNull(axes);
            Assert.Equal(0.1, axes!.Pitch);
            Assert.Equal(0.2, axes.Yaw);
            Assert.Equal(0.3, axes.Roll);
            Assert.Equal(0.4, axes.X);
            Assert.Equal(0.5, axes.Y);
            Assert.Equal(0.6, axes.Z);
            Assert.Equal(0.7, axes.PitchTrim);
            Assert.Equal(0.8, axes.YawTrim);
            Assert.Equal(0.9, axes.RollTrim);
        }

        /// <summary>
        /// A single-axis command leaves every other field null, so the actuator
        /// only overwrites the one axis it was given — the partial-update
        /// contract that lets the client drive one axis without clobbering the
        /// rest.
        /// </summary>
        [Fact]
        public void HandleSetControlAxesLeavesUnsetFieldsNull()
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleSetControlAxes(actuator, new SetControlAxesArgs { Pitch = 0.5 });

            var axes = actuator.LastSetControlAxes;
            Assert.NotNull(axes);
            Assert.Equal(0.5, axes!.Pitch);
            Assert.Null(axes.Yaw);
            Assert.Null(axes.Roll);
            Assert.Null(axes.X);
            Assert.Null(axes.Y);
            Assert.Null(axes.Z);
            Assert.Null(axes.PitchTrim);
            Assert.Null(axes.YawTrim);
            Assert.Null(axes.RollTrim);
        }

        /// <summary>
        /// Out-of-range axis readings are CLAMPED to −1..1 (not rejected) — an
        /// over-range hardware stick is a routine quirk, not an error, unlike
        /// throttle which rejects out-of-range with
        /// <see cref="CommandErrorCode.Range"/>.
        /// </summary>
        [Fact]
        public void HandleSetControlAxesClampsOutOfRangeValuesToTheUnitInterval()
        {
            var actuator = new FakeVesselActuator();

            var result = VesselCommandProvider.HandleSetControlAxes(actuator, new SetControlAxesArgs
            {
                Pitch = 2.5,
                Yaw = -3.0,
                Z = 1.0,
                RollTrim = -1.0,
            });

            var axes = actuator.LastSetControlAxes;
            Assert.NotNull(axes);
            Assert.Equal(1.0, axes!.Pitch);
            Assert.Equal(-1.0, axes.Yaw);
            Assert.Equal(1.0, axes.Z);
            Assert.Equal(-1.0, axes.RollTrim);
            Assert.True(result.Success);
        }

        [Fact]
        public void HandleSetControlAxesLeavesNullFieldsUnclamped()
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleSetControlAxes(actuator, new SetControlAxesArgs { Pitch = 0.5 });

            Assert.Null(actuator.LastSetControlAxes!.Yaw);
        }
    }
}
