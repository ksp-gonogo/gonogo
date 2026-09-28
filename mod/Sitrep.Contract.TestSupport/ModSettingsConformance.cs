using System;
using System.Collections.Generic;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// What <see cref="IModSettingsSource"/> and <see cref="IModSettingsWriter"/>
    /// promise, for an Uplink to run against its own implementation.
    /// </summary>
    public static class ModSettingsConformance
    {
        /// <summary>
        /// Everything an <see cref="IModSettingsSource"/> owes:
        ///
        /// <list type="bullet">
        /// <item>it lists without throwing, each id once and none empty, each with a label</item>
        /// <item>every listed setting reads without throwing, and a value it reads is of the setting's kind</item>
        /// <item>an id it did not list reads as unavailable rather than throwing</item>
        /// <item>a setting it marks writable comes with an <see cref="IModSettingsWriter"/></item>
        /// </list>
        ///
        /// <para>Run it with the mod in each state the Uplink handles: loaded,
        /// absent, and with no save.</para>
        /// </summary>
        public static void AssertSourceContract(IModSettingsSource source)
        {
            if (source == null)
            {
                throw new ArgumentNullException(nameof(source));
            }

            var listed = source.ListModSettings();
            Assert.True(listed != null, "ListModSettings answered null; an Uplink with nothing to show lists nothing");
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var setting in listed!)
            {
                Assert.True(setting != null, "ListModSettings listed a null setting");
                Assert.False(string.IsNullOrEmpty(setting!.Id), "a listed mod setting has no id");
                Assert.True(ids.Add(setting.Id), "ListModSettings lists " + setting.Id + " more than once");
                Assert.False(string.IsNullOrWhiteSpace(setting.Label), setting.Id + " has no label for an operator to read");
                Assert.True(
                    !setting.Writable || source is IModSettingsWriter,
                    setting.Id + " is marked writable, but the Uplink does not implement IModSettingsWriter");

                var read = source.ReadModSetting(setting.Id);
                Assert.True(
                    !read.IsAvailable || read.Kind == setting.Kind,
                    setting.Id + " is a " + setting.Kind + " setting and read as a " + read.Kind);
                Assert.True(
                    read.IsAvailable || !string.IsNullOrWhiteSpace(read.UnavailableReason),
                    setting.Id + " read as unavailable without saying why");
            }

            var unlisted = "conformanceUnlisted";
            while (ids.Contains(unlisted))
            {
                unlisted += "_";
            }

            Assert.False(
                source.ReadModSetting(unlisted).IsAvailable,
                "an id the Uplink did not list read as a value");
        }

        /// <summary>
        /// Everything an <see cref="IModSettingsWriter"/> owes, run against an
        /// Uplink that is also the <see cref="IModSettingsSource"/> it writes
        /// through: for every setting it lists writable and can read, writing
        /// back the value it holds succeeds and leaves that value in force, since
        /// a write can land twice. Run <see cref="AssertSourceContract"/> too.
        /// </summary>
        public static void AssertWriterContract(IModSettingsWriter writer)
        {
            if (writer is not IModSettingsSource source)
            {
                throw new ArgumentException("a mod settings writer is also the source it writes through", nameof(writer));
            }

            foreach (var setting in source.ListModSettings())
            {
                if (!setting.Writable)
                {
                    continue;
                }

                var read = source.ReadModSetting(setting.Id);
                if (!read.IsAvailable)
                {
                    continue;
                }

                var written = writer.WriteModSetting(setting.Id, read);
                Assert.True(
                    written != null && written.Success,
                    "writing back the value " + setting.Id + " already holds was refused: " + written?.Detail);
                Assert.Equal(read.Spelled(), source.ReadModSetting(setting.Id).Spelled());
            }
        }
    }
}
