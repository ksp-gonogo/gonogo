using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// The writes on a kerbal outside a craft, kept apart from <see cref="IVesselActuator"/>
    /// because they act on a kerbal rather than on the craft being reported.
    /// </summary>
    public interface IEvaKerbalActuator
    {
        /// <summary>
        /// Sets the headlamp of the kerbal with this vessel id. Returns a typed failure
        /// rather than throwing; the rule that decides which one is <see cref="EvaLampRule"/>.
        /// </summary>
        CommandResult SetLamp(string kerbalVesselId, bool enabled);
    }
}
