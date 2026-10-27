using Sitrep.Contract;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// Writes to a kerbal outside a craft, read and applied live on the main thread by the
    /// command dispatcher. The decision is <see cref="EvaLampRule"/>'s.
    /// </summary>
    public sealed class KspEvaKerbalActuator : IEvaKerbalActuator
    {
        public CommandResult SetLamp(string kerbalVesselId, bool enabled)
        {
            var vessel = FindKerbal(kerbalVesselId);
            KerbalEVA? eva = null;
            if (vessel != null && vessel.loaded && vessel.rootPart != null)
            {
                eva = vessel.rootPart.FindModuleImplementing<KerbalEVA>();
            }

            var focused = vessel != null && ReferenceEquals(vessel, ActiveVesselScope.Focused);
            var outcome = EvaLampRule.Decide(
                found: vessel != null,
                loaded: eva != null,
                focused: focused,
                lampOn: eva != null ? (bool?)eva.lampOn : null,
                enabled: enabled,
                out var code,
                out var detail);

            switch (outcome)
            {
                case EvaLampRule.Outcome.Refused:
                    return CommandResult.Fail(code!, detail);
                case EvaLampRule.Outcome.AlreadyThere:
                    return CommandResult.Ok();
                default:
                    eva!.ToggleLamp();
                    return CommandResult.Ok();
            }
        }

        private static Vessel? FindKerbal(string kerbalVesselId)
        {
            var all = FlightGlobals.Vessels;
            if (all == null)
            {
                return null;
            }

            foreach (var vessel in all)
            {
                if (vessel != null && vessel.vesselType == VesselType.EVA && vessel.id.ToString() == kerbalVesselId)
                {
                    return vessel;
                }
            }

            return null;
        }
    }
}
