using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free verdicts for the stock action-group toggles (<c>setSas</c>,
    /// <c>setRcs</c>, <c>setGear</c> and the rest), so a write that did not take
    /// is reported as a refusal rather than as the success the write call itself
    /// always returns. <c>ActionGroupList.SetGroup</c> returns nothing and
    /// stock quietly clears a SAS flag no source backs, so the actuator checks
    /// before it writes and reads back after.
    /// </summary>
    public static class ActionGroupWrite
    {
        /// <summary>
        /// Refusal for turning SAS on when the craft has no source for it, or null
        /// when the write may go ahead. Turning it OFF is never refused.
        /// <c>canEngage</c> is stock's <c>VesselAutopilot.CanEngageSAS()</c>: a Pilot
        /// aboard, or a probe core whose SAS tier allows it. An Engineer or Scientist
        /// in a pod with a reaction wheel does not qualify.
        /// </summary>
        public static CommandResult? SasRefusal(bool enabling, bool canEngage) =>
            enabling && SasUnavailableReason(canEngage) is string reason
                ? CommandResult.Fail(CommandErrorCode.CapabilityMismatch, reason)
                : null;

        /// <summary>Why SAS cannot be turned on, or null when it can. The refusal and <c>vessel.control.sasUnavailableReason</c> share it.</summary>
        public static string? SasUnavailableReason(bool canEngage) =>
            canEngage ? null : "No SAS: needs a Pilot aboard or a probe core with SAS";

        /// <summary>
        /// Success when the group reads back as requested, otherwise a
        /// <see cref="CommandErrorCode.WrongState"/> refusal naming the group.
        /// A group that cannot be read back (null) is not taken as proof of failure.
        /// </summary>
        public static CommandResult Verify(string group, bool requested, bool? readBack) =>
            readBack.HasValue && readBack.Value != requested
                ? CommandResult.Fail(
                    CommandErrorCode.WrongState,
                    $"{group} did not change to {(requested ? "on" : "off")}")
                : CommandResult.Ok();
    }
}
