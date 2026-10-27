using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>What a lamp command answers for a kerbal, and what the handler does before asking the game.</summary>
    public class EvaLampRuleTests
    {
        private sealed class RecordingActuator : IEvaKerbalActuator
        {
            public string? Id;
            public bool? Asked;

            public CommandResult SetLamp(string kerbalVesselId, bool enabled)
            {
                Id = kerbalVesselId;
                Asked = enabled;
                return CommandResult.Ok();
            }
        }

        [Fact]
        public void AnIdThatIsNoKerbalOutsideIsNotFound()
        {
            var outcome = EvaLampRule.Decide(false, false, false, null, true, out var code, out var detail);

            Assert.Equal(EvaLampRule.Outcome.Refused, outcome);
            Assert.Equal(CommandErrorCode.NotFound, code);
            Assert.Equal(EvaLampRule.NotOutside, detail);
        }

        [Fact]
        public void AKerbalPastPhysicsRangeIsRefusedWithTheReason()
        {
            var outcome = EvaLampRule.Decide(true, false, false, null, true, out var code, out var detail);

            Assert.Equal(EvaLampRule.Outcome.Refused, outcome);
            Assert.Equal(CommandErrorCode.WrongState, code);
            Assert.Equal(EvaLampRule.OutOfRange, detail);
        }

        [Fact]
        public void AKerbalKspIsNotFlyingIsRefusedWithTheReason()
        {
            var outcome = EvaLampRule.Decide(true, true, false, false, true, out var code, out var detail);

            Assert.Equal(EvaLampRule.Outcome.Refused, outcome);
            Assert.Equal(CommandErrorCode.WrongState, code);
            Assert.Equal(EvaLampRule.NotFocused, detail);
        }

        [Theory]
        [InlineData(false, true, EvaLampRule.Outcome.Switch)]
        [InlineData(true, false, EvaLampRule.Outcome.Switch)]
        [InlineData(true, true, EvaLampRule.Outcome.AlreadyThere)]
        [InlineData(false, false, EvaLampRule.Outcome.AlreadyThere)]
        public void TheFlownKerbalIsSwitchedOnlyWhenTheLampIsNotAlreadyAsAsked(bool lampOn, bool enabled, EvaLampRule.Outcome expected)
        {
            var outcome = EvaLampRule.Decide(true, true, true, lampOn, enabled, out var code, out _);

            Assert.Equal(expected, outcome);
            Assert.Null(code);
        }

        [Fact]
        public void AnUnreadLampIsSwitchedBecauseItsStateIsNotKnownToBeAsAsked()
        {
            Assert.Equal(EvaLampRule.Outcome.Switch, EvaLampRule.Decide(true, true, true, null, true, out _, out _));
        }

        [Fact]
        public void AnEmptyIdIsNotFoundWithoutAskingTheGame()
        {
            var actuator = new RecordingActuator();

            var result = EvaKerbalCommandProvider.HandleSetLamp(actuator, new SetEvaLampArgs { KerbalVesselId = "", Enabled = true });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Null(actuator.Id);
        }

        [Fact]
        public void TheKerbalAndTheStateAskedForReachTheGame()
        {
            var actuator = new RecordingActuator();

            EvaKerbalCommandProvider.HandleSetLamp(actuator, new SetEvaLampArgs { KerbalVesselId = "k1", Enabled = false });

            Assert.Equal("k1", actuator.Id);
            Assert.False(actuator.Asked);
        }
    }
}
