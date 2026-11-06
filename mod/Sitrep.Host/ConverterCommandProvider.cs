using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// What switches a converter on a part, behind <see cref="ConverterCommandProvider"/>.
    /// The game-side implementation resolves the part and the converter and
    /// answers with the shared converter actuator's result.
    /// </summary>
    public interface IConverterSwitch
    {
        /// <summary>
        /// Switches the named converter on the part on or off. A null
        /// <paramref name="converterName"/> means the part's only converter.
        /// </summary>
        CommandResult Switch(string partId, string? converterName, bool on);
    }

    /// <summary>
    /// KSP-free command handling for <c>vessel.converter.start</c> and
    /// <c>vessel.converter.stop</c>: the one check that needs no live game state
    /// (an empty part id resolves to nothing), then the switch.
    /// </summary>
    public static class ConverterCommandProvider
    {
        public const string StartCommand = "vessel.converter.start";
        public const string StopCommand = "vessel.converter.stop";

        public static CommandResult HandleStart(IConverterSwitch converters, ConverterSwitchArgs args) =>
            Handle(converters, args, on: true);

        public static CommandResult HandleStop(IConverterSwitch converters, ConverterSwitchArgs args) =>
            Handle(converters, args, on: false);

        private static CommandResult Handle(IConverterSwitch converters, ConverterSwitchArgs args, bool on)
        {
            if (string.IsNullOrEmpty(args.PartId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            return converters.Switch(args.PartId, string.IsNullOrEmpty(args.ConverterName) ? null : args.ConverterName, on);
        }
    }
}
