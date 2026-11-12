using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// An Uplink locks one of Gonogo's own settings from its Register, and the
    /// host records the value, the reason and which Uplink locked it.
    /// </summary>
    public class CoreSettingLockTests
    {
        private const string Reason = "Example Mod already cuts the link of a craft with no charge";

        [Fact]
        public void ALockTakenInRegisterNamesTheUplinkAndItsReason()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterUplink(new LockingUplink("example", "Example Mod", CoreSettings.TelemetryRequiresCharge, true, Reason));

            var held = engine.SettingLock(CoreSettings.TelemetryRequiresCharge);

            Assert.NotNull(held);
            Assert.True(held!.Value);
            Assert.Equal("example", held.UplinkId);
            Assert.Equal("Example Mod", held.UplinkName);
            Assert.Equal(Reason, held.Reason);
        }

        [Fact]
        public void AnUplinkWhoseManifestHasNoNameIsNamedByItsId()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterUplink(new LockingUplink("example", "", CoreSettings.TelemetryRequiresCharge, true, Reason));

            Assert.Equal("example", engine.SettingLock(CoreSettings.TelemetryRequiresCharge)!.UplinkName);
        }

        [Fact]
        public void WithNoUplinkLockingItASettingIsUnlocked()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");

            Assert.Null(engine.SettingLock(CoreSettings.TelemetryRequiresCharge));
        }

        [Fact]
        public void ALockOutsideRegisterIsIgnoredAndSaysSo()
        {
            var diagnostics = new ConcurrentQueue<string>();
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.SetDiagnosticLog(diagnostics.Enqueue);

            engine.Lock(CoreSettings.TelemetryRequiresCharge, true, Reason);

            Assert.Null(engine.SettingLock(CoreSettings.TelemetryRequiresCharge));
            Assert.Contains(diagnostics, line => line.Contains("outside an uplink's Register") && line.Contains("IGNORED"));
        }

        [Fact]
        public void TheEngineIgnoresWhatItCannotHoldWithoutThrowing()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");

            CoreSettingLocksConformance.AssertIgnoresWhatItCannotHold(engine);

            Assert.Null(engine.SettingLock(CoreSettings.TelemetryRequiresCharge));
        }

        [Fact]
        public void ASettingNoUplinkMayLockIsIgnored()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterUplink(new LockingUplink("example", "Example Mod", "signalDelay", false, Reason));

            Assert.Null(engine.SettingLock("signalDelay"));
        }

        [Fact]
        public void ALockWithNoReasonIsIgnored()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterUplink(new LockingUplink("example", "Example Mod", CoreSettings.TelemetryRequiresCharge, true, " "));

            Assert.Null(engine.SettingLock(CoreSettings.TelemetryRequiresCharge));
        }

        [Fact]
        public void TheFirstUplinkToLockASettingHoldsIt()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterUplink(new LockingUplink("first", "First", CoreSettings.TelemetryRequiresCharge, true, Reason));
            engine.RegisterUplink(new LockingUplink("second", "Second", CoreSettings.TelemetryRequiresCharge, false, "Second's reason"));

            var held = engine.SettingLock(CoreSettings.TelemetryRequiresCharge)!;
            Assert.Equal("first", held.UplinkId);
            Assert.True(held.Value);
        }

        private sealed class LockingUplink : ISitrepUplink
        {
            private readonly string _setting;
            private readonly bool _value;
            private readonly string _reason;

            public LockingUplink(string id, string name, string setting, bool value, string reason)
            {
                Manifest = new UplinkManifest
                {
                    Id = id,
                    Name = name,
                    Version = "0.1.0",
                    Channels = new List<ChannelDeclaration>(),
                };
                _setting = setting;
                _value = value;
                _reason = reason;
            }

            public UplinkManifest Manifest { get; }

            public void Register(IUplinkHost host)
            {
                if (host is ICoreSettingLocks locks)
                {
                    locks.Lock(_setting, _value, _reason);
                }
            }

            public UplinkHealth Health() => UplinkHealth.Healthy;
        }
    }
}
