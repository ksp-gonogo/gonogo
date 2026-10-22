using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The part-action invoke must not pick one of two parts that share an id. Read as source for
    /// the same reason <c>SandboxRecoveryIsWiredTests</c> is: the parts are live objects.
    /// </summary>
    public class PartActionRefusesAnAmbiguousIdTests
    {
        [Fact]
        public void the_invoke_counts_the_parts_carrying_the_id_and_refuses_before_it_picks_one()
        {
            var source = CurrencyDelaySourceText.ReadRelative("KspPartActionActuator.cs");
            var invoke = CurrencyDelaySourceText.MethodBody(source, "public CommandResult Invoke(string partId, string eventName)");

            var refused = invoke.IndexOf("PartIdRule.AmbiguousRefusal(partId, CountParts(vessel, partId))", StringComparison.Ordinal);
            var picked = invoke.IndexOf("FindPart(vessel, partId)", StringComparison.Ordinal);

            Assert.True(refused >= 0 && refused < picked, "the ambiguity check must run before a part is picked");
        }
    }
}
