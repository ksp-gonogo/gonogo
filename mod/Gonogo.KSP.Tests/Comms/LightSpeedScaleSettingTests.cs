using System.Collections.Generic;
using Sitrep.Host.Comms;
using Sitrep.Host.Settings;
using Xunit;

namespace Gonogo.KSP.Tests.Comms
{
    /// <summary>
    /// That a file carrying a light speed scale of zero or less leaves real
    /// light speed in force and says so once, rather than reading as no delay
    /// or as a silent revert.
    /// </summary>
    [Collection(CommsCoreUplinkStatics.Name)]
    public class LightSpeedScaleSettingTests
    {
        [Fact]
        public void AFileCarryingZeroKeepsRealLightSpeedAndSaysSoOnce()
        {
            var authored = CommsCoreUplink.AuthoredSignalDelayConfig;
            try
            {
                var seed = new SettingsDocument();
                seed.Set(CommsCoreUplink.LightSpeedScaleRow, "0");
                var store = new SettingsStore(new InMemorySettingsStore(seed));
                var logged = new List<string>();
                store.DiagnosticLog = logged.Add;

                CommsCoreUplink.BindSettings(store);
                store.Stage(CommsCoreUplink.DelayEnabledRow, "False");
                store.Commit();

                Assert.Equal(1.0, CommsCoreUplink.AuthoredSignalDelayConfig.LightSpeedScale);
                var line = Assert.Single(logged);
                Assert.Contains(CommsCoreUplink.LightSpeedScaleRow, line);
                Assert.Contains("real light speed (1) is in force", line);
            }
            finally
            {
                CommsCoreUplink.ConfigureSignalDelay(authored);
            }
        }
    }
}
