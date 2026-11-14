using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// What a part action that threw is reported as. Some actions (an undock, a
    /// decouple) move the part off the vessel the command was aimed at, and the
    /// code that then raises can only be reading the vessel that no longer holds
    /// it, so a throw alone does not say the game refused.
    /// </summary>
    public static class PartActionFault
    {
        /// <summary>
        /// The reply for an action whose invoke threw. When the part has left the
        /// vessel the command was aimed at, the game did what was asked and the
        /// reply is a success; otherwise it is a refusal carrying
        /// <paramref name="fault"/>, coded as the game giving no reason, since the
        /// craft is not known to lack the capability.
        /// </summary>
        public static CommandResult AfterThrow(bool partLeftVessel, string fault) =>
            partLeftVessel
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.ModeUnavailable, fault);
    }
}
