using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free command-handling logic for the PAW part-action invoke: the
    /// command-side twin of <see cref="PartActionsViewProvider"/>'s per-part read
    /// channel, and a direct copy of <see cref="RoboticsCommandProvider"/>'s
    /// shape. <see cref="HandleInvoke"/> is the exact delegate
    /// <c>Gonogo.KSP.VesselUplink.Register</c> hands to
    /// <see cref="IUplinkHost.AddCommandHandler{TArgs,TResult}"/>: it validates
    /// the already-typed args, calls the one matching
    /// <see cref="IPartActionActuator"/> method, and hands back the typed result.
    /// No KSP/Unity type appears here.
    ///
    /// <para><b>Two-tier validation</b>, matching every other command provider: a
    /// check that needs only the args themselves happens HERE (an empty
    /// <c>partId</c> or <c>eventName</c> can never resolve anything live, so it
    /// fails fast with <see cref="CommandErrorCode.NotFound"/> /
    /// <see cref="CommandErrorCode.ModeUnavailable"/> respectively, each naming
    /// which half was missing). Everything that needs live game state, whether
    /// the id resolves, whether the resolved part still exposes that event, is
    /// the actuator's job and comes back as a typed
    /// <see cref="CommandResult.ErrorCode"/>.</para>
    ///
    /// <para><b>No absolute-set discipline here, deliberately.</b> Every other
    /// actuation command in this contract sets an absolute state rather than
    /// toggling (see <see cref="ServoSetEnabledArgs"/>), but a <c>BaseEvent</c>
    /// has no value to set: KSP models a PAW button as fire-this. See
    /// <see cref="InvokePartActionArgs"/> for why that is a property of the game
    /// rather than a shortcut.</para>
    /// </summary>
    public static class PartActionCommandProvider
    {
        /// <summary>
        /// Fires one PAW button. <c>delayed: true</c>: invoking an action on a
        /// part ON the craft is an uplink that rides light-time, the same class as
        /// <c>vessel.control.*</c> and the robotics commands.
        /// </summary>
        public const string InvokePartActionCommand = "vessel.invokePartAction";

        public static CommandResult HandleInvoke(IPartActionActuator actuator, InvokePartActionArgs args)
        {
            if (string.IsNullOrEmpty(args.PartId))
            {
                // No id at all can never name a live part: the same fast-fail (and
                // the same code) RoboticsCommandProvider gives an empty partId.
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            if (string.IsNullOrEmpty(args.EventName))
            {
                // The part may well exist; the request names no button on it.
                // ModeUnavailable rather than NotFound so this is distinguishable
                // from an unresolvable part, which is the distinction an operator
                // needs to tell "wrong id" from "wrong action".
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            return actuator.Invoke(args.PartId, args.EventName);
        }
    }
}
