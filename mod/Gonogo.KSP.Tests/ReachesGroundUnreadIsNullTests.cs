using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// Whether a crewed command centre's route ends at a ground station is a fact only
    /// when its link was read. A craft with no CommNet connection to read, or a connected
    /// one with no solved path, is unknown, not cut off from the ground.
    ///
    /// <para>Source text, not behaviour: the reader walks live CommNet and cannot be
    /// compiled into this project.</para>
    /// </summary>
    public class ReachesGroundUnreadIsNullTests
    {
        [Fact]
        public void an_unread_link_is_unknown_and_a_down_link_is_false()
        {
            var body = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("FleetCommsReader.cs"),
                "internal static bool? ReachesGround(Vessel vessel, SignalDelayConfig? config)");
            var compact = body.Replace(" ", "").Replace("\n", "").Replace("\r", "");

            Assert.Contains("if(conn==null){returnnull;}", compact, StringComparison.Ordinal);
            Assert.Contains("if(!conn.IsConnected){returnfalse;}", compact, StringComparison.Ordinal);
            Assert.Contains("if(conn.ControlPath==null){returnnull;}", compact, StringComparison.Ordinal);
        }
    }
}
