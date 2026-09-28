using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests.FlightOps
{
    /// <summary>
    /// The fly-by-wire override belongs to the craft it was armed on. The
    /// actuator needs a live scene, so its wiring is reachable only as source
    /// text: each check below is a path by which an arm would outlive a vessel
    /// switch, either still flying the craft switched away from or carried onto
    /// the craft switched to while the widget reads it as disarmed.
    /// </summary>
    public class FlyByWireOwnershipTests
    {
        private static string Body(string declaration) =>
            CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspVesselActuator.cs"), declaration);

        [Fact]
        public void TheOverrideDisarmsOnceAnotherCraftIsReported()
        {
            var body = Body("private void ApplyFlyByWireOverride(");

            Assert.Contains("DisarmIfArmedOnAnotherCraft(ActiveVesselScope.Current)", body);
        }

        [Fact]
        public void AnAxisCommandNeverCarriesTheArmOntoAnotherCraft()
        {
            var body = Body("public CommandResult SetControlAxes(");

            Assert.Contains("DisarmIfArmedOnAnotherCraft(vessel)", body);
            Assert.DoesNotContain("AttachFlyByWire(", body);
        }

        [Fact]
        public void DisarmingOnAnotherCraftIsAFullDisarm()
        {
            var body = Body("private void DisarmIfArmedOnAnotherCraft(");

            Assert.Contains("ReferenceEquals(_attachedVessel, reported)", body);
            Assert.Contains("DisarmFlyByWire()", body);
        }
    }
}
