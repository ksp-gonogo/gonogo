using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Sitrep.Host.Settings;
using Xunit;
using Xunit.Sdk;

namespace Sitrep.Host.Tests.Settings
{
    /// <summary>
    /// The shipped settings assertions, run against this repo's own
    /// implementations and against the implementations they exist to reject.
    /// An outside Uplink author runs the same two assertions, so what passes
    /// here and what passes for them is the same claim.
    /// </summary>
    public class UplinkSettingsConformanceTests
    {
        /// <summary>A declarer that renames an old row, the way a real migration does.</summary>
        private sealed class RenamingDeclarer : IUplinkSettingsDeclarer
        {
            public void DeclareSettings(IUplinkSettings settings)
            {
                settings.Declare(UplinkSettingRow.Number("upgradeSlipWarningDays", 30, "Slip warning"));
                if (settings.Stored("upgradeSlipWarningDays") == null && settings.Stored("slipDays") is string old)
                {
                    settings.Migrate("upgradeSlipWarningDays", old);
                }
            }
        }

        /// <summary>A migration that does not settle: every start-up moves the value again.</summary>
        private sealed class DriftingDeclarer : IUplinkSettingsDeclarer
        {
            public void DeclareSettings(IUplinkSettings settings)
            {
                settings.Declare(UplinkSettingRow.Number("days", 30, "Days"));
                settings.Migrate("days", (settings.Number("days") + 1).ToString(System.Globalization.CultureInfo.InvariantCulture));
            }
        }

        /// <summary>A handle that accepts anything, which is the implementation the handle assertion rejects.</summary>
        private sealed class LaxSettings : IUplinkSettings
        {
            private readonly Dictionary<string, string> _values = new Dictionary<string, string>();

            public string? WrittenBy => null;

            public IReadOnlyList<string> StoredNames => Array.Empty<string>();

            public string? Stored(string name) => null;

            public void Declare(UplinkSettingRow row) => _values[row.Name] = row.DefaultText;

            public void Migrate(string name, string text) => _values[name] = text;

            public string? Text(string name) => _values.TryGetValue(name, out var text) ? text : null;

            public bool Bool(string name) => Text(name) == "True";

            public double Number(string name) => double.Parse(Text(name) ?? "0", System.Globalization.CultureInfo.InvariantCulture);

            public IDisposable OnChanged(Action<IUplinkSettings> callback) => new NoOp();

            private sealed class NoOp : IDisposable
            {
                public void Dispose() { }
            }
        }

        [Fact]
        public void TheHostsHandleKeepsTheDeclaringContract()
        {
            var store = new SettingsStore(new InMemorySettingsStore());

            UplinkSettingsConformance.AssertDeclaringHandleContract(new UplinkSettingsScope(store, "Rp1", "0.4.1"));
        }

        [Fact]
        public void TheShippedDoubleKeepsTheSameContract()
        {
            UplinkSettingsConformance.AssertDeclaringHandleContract(new RecordingUplinkSettings());
        }

        [Fact]
        public void TheHandleAssertionRejectsAHandleThatAcceptsAnything()
        {
            Assert.ThrowsAny<XunitException>(
                () => UplinkSettingsConformance.AssertDeclaringHandleContract(new LaxSettings()));
        }

        [Fact]
        public void ARenamingMigrationSettlesFromEveryBlockItCouldMeet()
        {
            var declarer = new RenamingDeclarer();

            UplinkSettingsConformance.AssertDeclarerContract(declarer);
            UplinkSettingsConformance.AssertDeclarerContract(
                declarer, new Dictionary<string, string> { ["slipDays"] = "45" }, writtenBy: "0.3.0");
            UplinkSettingsConformance.AssertDeclarerContract(
                declarer, new Dictionary<string, string> { ["upgradeSlipWarningDays"] = "60" }, writtenBy: "0.4.1");
        }

        [Fact]
        public void TheDeclarerAssertionRejectsAMigrationThatNeverSettles()
        {
            var failed = Assert.ThrowsAny<XunitException>(
                () => UplinkSettingsConformance.AssertDeclarerContract(new DriftingDeclarer()));

            Assert.Contains("days", failed.Message);
        }

        [Fact]
        public void TheDeclarerAssertionRejectsADeclarerThatThrows()
        {
            var failed = Assert.ThrowsAny<XunitException>(
                () => UplinkSettingsConformance.AssertDeclarerContract(new ThrowingDeclarer()));

            Assert.Contains("threw", failed.Message);
        }

        private sealed class ThrowingDeclarer : IUplinkSettingsDeclarer
        {
            public void DeclareSettings(IUplinkSettings settings) =>
                settings.Declare(UplinkSettingRow.Text("endpoint", "ws://host:8090", "Endpoint"));
        }
    }
}
