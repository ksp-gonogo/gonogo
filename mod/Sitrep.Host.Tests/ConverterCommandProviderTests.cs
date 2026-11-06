using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class ConverterCommandProviderTests
    {
        private sealed class RecordingSwitch : IConverterSwitch
        {
            public string? PartId;
            public string? ConverterName;
            public bool? On;
            public CommandResult Result = CommandResult<RunStateChange>.Ok(new RunStateChange { Changed = true, Running = true });

            public CommandResult Switch(string partId, string? converterName, bool on)
            {
                PartId = partId;
                ConverterName = converterName;
                On = on;
                return Result;
            }
        }

        [Fact]
        public void AStartOrStopWithNoPartIsNotFoundAndNeverReachesTheGame()
        {
            var game = new RecordingSwitch();

            Assert.Equal(CommandErrorCode.NotFound, ConverterCommandProvider.HandleStart(game, new ConverterSwitchArgs()).ErrorCode);
            Assert.Equal(CommandErrorCode.NotFound, ConverterCommandProvider.HandleStop(game, new ConverterSwitchArgs()).ErrorCode);
            Assert.Null(game.On);
        }

        [Fact]
        public void StartAndStopReachTheSwitchWithThePartAndTheConverterName()
        {
            var game = new RecordingSwitch();

            ConverterCommandProvider.HandleStart(game, new ConverterSwitchArgs { PartId = "301", ConverterName = "ISRU" });
            Assert.Equal(("301", "ISRU", true), (game.PartId, game.ConverterName, game.On));

            ConverterCommandProvider.HandleStop(game, new ConverterSwitchArgs { PartId = "302", ConverterName = "ISRU" });
            Assert.Equal(("302", "ISRU", false), (game.PartId, game.ConverterName, game.On));
        }

        [Fact]
        public void AnEmptyConverterNameIsPassedOnAsNoNameSoThePartsOnlyConverterIsMeant()
        {
            var game = new RecordingSwitch();

            ConverterCommandProvider.HandleStart(game, new ConverterSwitchArgs { PartId = "301", ConverterName = "" });

            Assert.Null(game.ConverterName);
        }

        [Fact]
        public void TheGamesAnswerIsHandedBackWhole()
        {
            var game = new RecordingSwitch
            {
                Result = CommandResult<RunStateChange>.Ok(new RunStateChange { Changed = false, Running = true }),
            };

            var result = ConverterCommandProvider.HandleStart(game, new ConverterSwitchArgs { PartId = "301" });

            Assert.False(Assert.IsType<CommandResult<RunStateChange>>(result).Payload!.Changed);
        }
    }
}
