using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Unit tests for <see cref="RoboticsCommandProvider"/>'s <c>Handle*</c>
    /// glue against a <see cref="FakeRoboticsActuator"/> — proves typed args
    /// reach the correct actuator method with the correct values (never
    /// scrambled), that args-level validation (empty partId, contract-known
    /// scalar ranges) happens before the actuator is ever called, and that the
    /// actuator's live failure codes (<c>ModeUnavailable</c>/<c>NotFound</c>)
    /// surface unchanged through the provider. The field-write-vs-callback
    /// correctness is a KSP-side concern and is Deck-validated separately (no
    /// headless test can catch it).
    /// </summary>
    public class RoboticsCommandProviderTests
    {
        // ---- servo.setTarget --------------------------------------------------

        [Fact]
        public void HandleServoSetTargetPassesPartIdAndValueThrough()
        {
            var actuator = new FakeRoboticsActuator();

            var result = RoboticsCommandProvider.HandleServoSetTarget(actuator, new ServoSetTargetArgs { PartId = "42", Value = 73.5 });

            Assert.Equal("42", actuator.LastSetServoTargetPartId);
            Assert.Equal(73.5, actuator.LastSetServoTargetValue);
            Assert.True(result.Success);
        }

        [Fact]
        public void HandleServoSetTargetRejectsEmptyPartIdBeforeEverCallingTheActuator()
        {
            var actuator = new FakeRoboticsActuator();

            var result = RoboticsCommandProvider.HandleServoSetTarget(actuator, new ServoSetTargetArgs { PartId = "", Value = 10.0 });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastSetServoTargetPartId);
        }

        [Fact]
        public void HandleServoSetTargetSurfacesTheActuatorsModeUnavailableError()
        {
            var actuator = new FakeRoboticsActuator { SetServoTargetResult = CommandResult.Fail(CommandErrorCode.ModeUnavailable) };

            var result = RoboticsCommandProvider.HandleServoSetTarget(actuator, new ServoSetTargetArgs { PartId = "7", Value = 1.0 });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }

        // ---- servo.setMotor / setLock (absolute set) -------------------------

        [Fact]
        public void HandleServoSetMotorPassesEnabledThroughAsAbsoluteState()
        {
            var actuator = new FakeRoboticsActuator();

            RoboticsCommandProvider.HandleServoSetMotor(actuator, new ServoSetEnabledArgs { PartId = "5", Enabled = true });

            Assert.Equal("5", actuator.LastSetServoMotorPartId);
            Assert.True(actuator.LastSetServoMotorEngaged);
        }

        [Fact]
        public void HandleServoSetMotorSurfacesTheActuatorsModeUnavailableError()
        {
            var actuator = new FakeRoboticsActuator { SetServoMotorResult = CommandResult.Fail(CommandErrorCode.ModeUnavailable) };

            var result = RoboticsCommandProvider.HandleServoSetMotor(actuator, new ServoSetEnabledArgs { PartId = "5", Enabled = true });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }

        [Fact]
        public void HandleServoSetLockPassesLockedThroughAsAbsoluteState()
        {
            var actuator = new FakeRoboticsActuator();

            RoboticsCommandProvider.HandleServoSetLock(actuator, new ServoSetEnabledArgs { PartId = "6", Enabled = false });

            Assert.Equal("6", actuator.LastSetServoLockPartId);
            Assert.False(actuator.LastSetServoLockLocked);
        }

        [Fact]
        public void HandleServoSetLockRejectsEmptyPartIdBeforeEverCallingTheActuator()
        {
            var actuator = new FakeRoboticsActuator();

            var result = RoboticsCommandProvider.HandleServoSetLock(actuator, new ServoSetEnabledArgs { PartId = "", Enabled = true });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastSetServoLockPartId);
        }

        // ---- rotor.setRpmLimit -----------------------------------------------

        [Fact]
        public void HandleRotorSetRpmLimitPassesPartIdAndValueThrough()
        {
            var actuator = new FakeRoboticsActuator();

            RoboticsCommandProvider.HandleRotorSetRpmLimit(actuator, new RotorSetValueArgs { PartId = "9", Value = 180.0 });

            Assert.Equal("9", actuator.LastSetRotorRpmLimitPartId);
            Assert.Equal(180.0, actuator.LastSetRotorRpmLimitValue);
        }

        [Fact]
        public void HandleRotorSetRpmLimitSurfacesTheActuatorsModeUnavailableError()
        {
            var actuator = new FakeRoboticsActuator { SetRotorRpmLimitResult = CommandResult.Fail(CommandErrorCode.ModeUnavailable) };

            var result = RoboticsCommandProvider.HandleRotorSetRpmLimit(actuator, new RotorSetValueArgs { PartId = "9", Value = 180.0 });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }

        // ---- rotor.setTorqueLimit (0..100) -----------------------------------

        [Theory]
        [InlineData(0.0)]
        [InlineData(50.0)]
        [InlineData(100.0)]
        public void HandleRotorSetTorqueLimitCallsActuatorForInRangeValues(double value)
        {
            var actuator = new FakeRoboticsActuator();

            var result = RoboticsCommandProvider.HandleRotorSetTorqueLimit(actuator, new RotorSetValueArgs { PartId = "3", Value = value });

            Assert.Equal(value, actuator.LastSetRotorTorqueLimitValue);
            Assert.True(result.Success);
        }

        [Theory]
        [InlineData(-0.1)]
        [InlineData(100.1)]
        [InlineData(250.0)]
        public void HandleRotorSetTorqueLimitRejectsOutOfRangeValuesBeforeEverCallingTheActuator(double value)
        {
            var actuator = new FakeRoboticsActuator();

            var result = RoboticsCommandProvider.HandleRotorSetTorqueLimit(actuator, new RotorSetValueArgs { PartId = "3", Value = value });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
            Assert.Null(actuator.LastSetRotorTorqueLimitValue);
        }

        // ---- rotor.setBrake (0..200) -----------------------------------------

        [Theory]
        [InlineData(0.0)]
        [InlineData(100.0)]
        [InlineData(200.0)]
        public void HandleRotorSetBrakeCallsActuatorForInRangeValues(double value)
        {
            var actuator = new FakeRoboticsActuator();

            var result = RoboticsCommandProvider.HandleRotorSetBrake(actuator, new RotorSetValueArgs { PartId = "3", Value = value });

            Assert.Equal(value, actuator.LastSetRotorBrakeValue);
            Assert.True(result.Success);
        }

        [Theory]
        [InlineData(-0.1)]
        [InlineData(200.1)]
        [InlineData(1000.0)]
        public void HandleRotorSetBrakeRejectsOutOfRangeValuesBeforeEverCallingTheActuator(double value)
        {
            var actuator = new FakeRoboticsActuator();

            var result = RoboticsCommandProvider.HandleRotorSetBrake(actuator, new RotorSetValueArgs { PartId = "3", Value = value });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
            Assert.Null(actuator.LastSetRotorBrakeValue);
        }

        // ---- rotor.setMotor / setLock ----------------------------------------

        [Fact]
        public void HandleRotorSetMotorPassesEnabledThroughAsAbsoluteState()
        {
            var actuator = new FakeRoboticsActuator();

            RoboticsCommandProvider.HandleRotorSetMotor(actuator, new ServoSetEnabledArgs { PartId = "11", Enabled = false });

            Assert.Equal("11", actuator.LastSetRotorMotorPartId);
            Assert.False(actuator.LastSetRotorMotorEngaged);
        }

        [Fact]
        public void HandleRotorSetLockPassesLockedThroughAsAbsoluteState()
        {
            var actuator = new FakeRoboticsActuator();

            RoboticsCommandProvider.HandleRotorSetLock(actuator, new ServoSetEnabledArgs { PartId = "12", Enabled = true });

            Assert.Equal("12", actuator.LastSetRotorLockPartId);
            Assert.True(actuator.LastSetRotorLockLocked);
        }

        // ---- rotor.reverse ----------------------------------------------------

        [Fact]
        public void HandleRotorReversePassesPartIdThrough()
        {
            var actuator = new FakeRoboticsActuator();

            var result = RoboticsCommandProvider.HandleRotorReverse(actuator, new RotorReverseArgs { PartId = "8" });

            Assert.Equal("8", actuator.LastReverseRotorPartId);
            Assert.True(result.Success);
        }

        [Fact]
        public void HandleRotorReverseRejectsEmptyPartIdBeforeEverCallingTheActuator()
        {
            var actuator = new FakeRoboticsActuator();

            var result = RoboticsCommandProvider.HandleRotorReverse(actuator, new RotorReverseArgs { PartId = "" });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.LastReverseRotorPartId);
        }

        [Fact]
        public void HandleRotorReverseSurfacesTheActuatorsNotFoundError()
        {
            var actuator = new FakeRoboticsActuator { ReverseRotorResult = CommandResult.Fail(CommandErrorCode.NotFound) };

            var result = RoboticsCommandProvider.HandleRotorReverse(actuator, new RotorReverseArgs { PartId = "does-not-exist" });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
        }
    }
}
