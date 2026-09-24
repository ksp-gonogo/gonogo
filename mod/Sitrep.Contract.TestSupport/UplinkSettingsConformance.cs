using System;
using System.Collections.Generic;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// What the settings seams promise, for an implementer to run against their
    /// own implementation.
    /// </summary>
    public static class UplinkSettingsConformance
    {
        /// <summary>
        /// Everything an <see cref="IUplinkSettingsDeclarer"/> owes, run against
        /// a <see cref="RecordingUplinkSettings"/> holding
        /// <paramref name="stored"/> as written by <paramref name="writtenBy"/>:
        ///
        /// <list type="bullet">
        /// <item>it declares without throwing, so start-up does not lose its settings</item>
        /// <item>it declares each name once</item>
        /// <item>running it again over what it left gives the same values, which
        /// the contract requires of a migration because the host runs it at every
        /// start-up until the operator next saves</item>
        /// </list>
        ///
        /// <para>Call it once with no stored block and once with each block an
        /// older version could have written.</para>
        /// </summary>
        public static void AssertDeclarerContract(
            IUplinkSettingsDeclarer declarer,
            IReadOnlyDictionary<string, string>? stored = null,
            string? writtenBy = null)
        {
            if (declarer == null)
            {
                throw new ArgumentNullException(nameof(declarer));
            }

            var first = Run(declarer, stored, writtenBy, "the first run");

            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var row in first.Declared)
            {
                Assert.True(names.Add(row.Name), "DeclareSettings declares " + row.Name + " more than once");
            }

            var second = Run(declarer, first.InForce, writtenBy, "a second run over what the first left");
            foreach (var value in first.InForce)
            {
                second.InForce.TryGetValue(value.Key, out var again);
                Assert.True(
                    string.Equals(value.Value, again, StringComparison.Ordinal),
                    "running DeclareSettings again changes " + value.Key + " from " + value.Value + " to "
                        + (again ?? "nothing") + ". A migration runs at every start-up until the next save, so it has to settle.");
            }
        }

        /// <summary>
        /// Everything an <see cref="IUplinkSettings"/> promises while its Uplink
        /// is declaring, run against <paramref name="declaring"/>, a handle in
        /// that phase: a storable row is accepted and its default is in force,
        /// and each kind of declaration the interface refuses is refused with an
        /// <see cref="ArgumentException"/>. It declares one row, named
        /// <c>conformanceProbe</c>, into the handle.
        /// </summary>
        public static void AssertDeclaringHandleContract(IUplinkSettings declaring)
        {
            if (declaring == null)
            {
                throw new ArgumentNullException(nameof(declaring));
            }

            declaring.Declare(UplinkSettingRow.Number("conformanceProbe", 2.5, "Conformance probe"));
            if (declaring.Stored("conformanceProbe") == null)
            {
                Assert.Equal("2.5", declaring.Text("conformanceProbe"));
                Assert.Equal(2.5, declaring.Number("conformanceProbe"));
            }

            Refused(declaring, UplinkSettingRow.Bool(UplinkSettingRow.WrittenByName, true, "Reserved"), "the reserved name");
            Refused(declaring, UplinkSettingRow.Text("a//b", "x", "Comment marker"), "a name containing //");
            Refused(declaring, UplinkSettingRow.Text("endpoint", "ws://host:8090", "Comment marker"), "a default containing //");
            Refused(declaring, UplinkSettingRow.Text("brace", "a{b", "Brace"), "a default containing a brace");
            Refused(declaring, new UplinkSettingRow("flag", UplinkSettingKind.Bool, "maybe", "Wrong kind"), "a default of the wrong kind");

            var migrated = Assert.ThrowsAny<ArgumentException>(() => declaring.Migrate("conformanceProbe", "one\ntwo"));
            Assert.False(string.IsNullOrWhiteSpace(migrated.Message), "a refused migration should say why");
        }

        private static void Refused(IUplinkSettings declaring, UplinkSettingRow row, string what)
        {
            var refused = ThrownBy(() => declaring.Declare(row));
            Assert.True(
                refused is ArgumentException,
                "Declare accepted " + what + " (" + row.Name + " = " + row.DefaultText + "), which the interface says Declare refuses");
        }

        private static Exception? ThrownBy(Action action)
        {
            try
            {
                action();
                return null;
            }
            catch (Exception ex)
            {
                return ex;
            }
        }

        private static RecordingUplinkSettings Run(
            IUplinkSettingsDeclarer declarer,
            IReadOnlyDictionary<string, string>? stored,
            string? writtenBy,
            string when)
        {
            var settings = new RecordingUplinkSettings(stored, writtenBy);
            var thrown = ThrownBy(() => declarer.DeclareSettings(settings));
            Assert.True(
                thrown == null,
                "DeclareSettings threw on " + when + ", which costs the Uplink every setting for the session: "
                    + thrown?.Message);
            settings.Close();
            return settings;
        }
    }
}
