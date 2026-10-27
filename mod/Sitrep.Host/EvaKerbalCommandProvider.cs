using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free command handling for a kerbal outside a craft, the write twin of the kerbal's
    /// own <c>eva.kerbal.&lt;vessel id&gt;.state</c> Topic. <see cref="HandleSetLamp"/> is the
    /// delegate <c>Gonogo.KSP.VesselUplink.Register</c> hands to
    /// <see cref="IUplinkHost.AddCommandHandler{TArgs,TResult}"/>.
    /// </summary>
    public static class EvaKerbalCommandProvider
    {
        /// <summary>
        /// Sets a kerbal's headlamp. Delayed: it acts on a kerbal in the group of the craft being
        /// reported, so it rides that craft's signal delay like <c>vessel.control.*</c>.
        /// </summary>
        public const string SetLampCommand = "eva.kerbal.setLamp";

        public static CommandResult HandleSetLamp(IEvaKerbalActuator actuator, SetEvaLampArgs args)
        {
            if (string.IsNullOrEmpty(args.KerbalVesselId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound, EvaLampRule.NotOutside);
            }

            return actuator.SetLamp(args.KerbalVesselId, args.Enabled);
        }
    }
}
