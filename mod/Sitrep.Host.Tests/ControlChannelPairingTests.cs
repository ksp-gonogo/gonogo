using System.Reflection;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The write half a control channel declares (its command name + args type)
    /// must be the SAME command the host actually registers a handler for. The
    /// command string is declared in the contract attribute AND as a
    /// <c>VesselCommandProvider</c> const; this pins them together so one cannot
    /// drift from the other, which would silently strand every value dispatched
    /// on the channel.
    /// </summary>
    public class ControlChannelPairingTests
    {
        [Fact]
        public void ThrottleChannelWriteHalfMatchesTheRegisteredCommand()
        {
            var attr = typeof(VesselControl)
                .GetProperty(nameof(VesselControl.Throttle))!
                .GetCustomAttribute<SitrepControlChannelAttribute>();

            Assert.NotNull(attr);
            Assert.Equal(VesselCommandProvider.SetThrottleCommand, attr!.WriteCommand);
            Assert.Equal(typeof(SetThrottleArgs), attr.Args);
        }
    }
}
