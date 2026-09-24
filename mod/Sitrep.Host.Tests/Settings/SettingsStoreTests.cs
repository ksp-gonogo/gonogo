using System;
using System.Collections.Generic;
using Sitrep.Host.Settings;
using Xunit;

namespace Sitrep.Host.Tests.Settings
{
    /// <summary>
    /// The store's own behaviour, with no KSP anywhere: what a declared default
    /// does to a document the file did not fill, what a commit tells its
    /// watchers, and how many times a SAVE press reaches the medium.
    /// </summary>
    public class SettingsStoreTests
    {
        [Fact]
        public void ADeclaredDefaultFillsARowTheDocumentLacks()
        {
            var store = new SettingsStore(new InMemorySettingsStore());

            store.Declare(SettingsRow.Bool("SIGNAL_DELAY/enabled", true));

            Assert.True(store.Bool("SIGNAL_DELAY/enabled"));
            Assert.Equal("True", store.Text("SIGNAL_DELAY/enabled"));
        }

        [Fact]
        public void ADeclaredDefaultNeverOverwritesWhatWasRead()
        {
            var seed = new SettingsDocument();
            seed.Set("SIGNAL_DELAY/lightSpeedScale", "0.1");
            var store = new SettingsStore(new InMemorySettingsStore(seed));

            store.Declare(SettingsRow.Number("SIGNAL_DELAY/lightSpeedScale", 1.0));

            Assert.Equal(0.1, store.Number("SIGNAL_DELAY/lightSpeedScale"));
        }

        /// <summary>
        /// Seeding a default is not a change to the file. A launch that only
        /// read the settings leaves the file exactly as it found it, which is
        /// what stops a boot from rewriting a document whose declarers happen
        /// to differ from last launch's.
        /// </summary>
        [Fact]
        public void DeclaringWritesNothing()
        {
            var backing = new InMemorySettingsStore();
            var store = new SettingsStore(backing);

            store.Declare(SettingsRow.Bool("RECORDING/enabled", false));

            Assert.Equal(0, backing.Writes);
        }

        /// <summary>
        /// A watcher hears the value as it stands the moment it subscribes.
        /// That immediate fire is what makes OnChanged a replacement for
        /// reading the file once at boot rather than an addition to it.
        /// </summary>
        [Fact]
        public void AWatcherHearsTheCurrentValueAsItSubscribes()
        {
            var seed = new SettingsDocument();
            seed.Set("SIGNAL_DELAY/delayInSimulation", "True");
            var store = new SettingsStore(new InMemorySettingsStore(seed));
            var heard = new List<string?>();

            store.OnChanged("SIGNAL_DELAY", doc => heard.Add(doc.Text("SIGNAL_DELAY/delayInSimulation")));

            Assert.Equal(new[] { "True" }, heard);
        }

        [Fact]
        public void ACommitTellsAWatcherOnTheBlockAbove()
        {
            var store = new SettingsStore(new InMemorySettingsStore());
            store.Declare(SettingsRow.Bool("SIGNAL_DELAY/delayInSimulation", false));
            var heard = new List<bool>();
            store.OnChanged("SIGNAL_DELAY", _ => heard.Add(store.Bool("SIGNAL_DELAY/delayInSimulation")));

            store.Stage("SIGNAL_DELAY/delayInSimulation", true);
            store.Commit();

            Assert.Equal(new[] { false, true }, heard);
        }

        [Fact]
        public void ACommitLeavesAWatcherOnAnotherBlockAlone()
        {
            var store = new SettingsStore(new InMemorySettingsStore());
            store.Declare(SettingsRow.Bool("SIGNAL_DELAY/enabled", true));
            store.Declare(SettingsRow.Bool("RECORDING/enabled", false));
            var heard = 0;
            store.OnChanged("RECORDING", _ => heard++);

            store.Stage("SIGNAL_DELAY/enabled", false);
            store.Commit();

            Assert.Equal(1, heard);
        }

        /// <summary>
        /// One file write per SAVE press, not one per row. That is the whole of
        /// why the surface is Stage plus Commit rather than a per-key write.
        /// </summary>
        [Fact]
        public void ManyStagedRowsCostOneWrite()
        {
            var backing = new InMemorySettingsStore();
            var store = new SettingsStore(backing);
            store.Declare(SettingsRow.Bool("SIGNAL_DELAY/enabled", true));
            store.Declare(SettingsRow.Number("SIGNAL_DELAY/lightSpeedScale", 1.0));
            store.Declare(SettingsRow.Bool("RECORDING/enabled", false));

            store.Stage("SIGNAL_DELAY/enabled", false);
            store.Stage("SIGNAL_DELAY/lightSpeedScale", 0.1);
            store.Stage("RECORDING/enabled", true);
            store.Commit();

            Assert.Equal(1, backing.Writes);
        }

        [Fact]
        public void ACommittedDocumentIsWhatTheNextReadReturns()
        {
            var backing = new InMemorySettingsStore();
            var store = new SettingsStore(backing);
            store.Declare(SettingsRow.Number("SIGNAL_DELAY/lightSpeedScale", 1.0));

            store.Stage("SIGNAL_DELAY/lightSpeedScale", 0.1);
            store.Commit();

            Assert.Equal(0.1, new SettingsStore(backing).Number("SIGNAL_DELAY/lightSpeedScale"));
        }

        [Fact]
        public void StagingRefusesAValueTheRowCannotHold()
        {
            var store = new SettingsStore(new InMemorySettingsStore());
            store.Declare(SettingsRow.Number("SIGNAL_DELAY/lightSpeedScale", 1.0));

            Assert.Throws<ArgumentException>(() => store.Stage("SIGNAL_DELAY/lightSpeedScale", "quite fast"));
        }

        /// <summary>
        /// A failed persist still changes the setting. The operator loses the
        /// value at the next launch, not at this one, so refusing the change
        /// would leave the console showing the opposite of what the mod does.
        /// </summary>
        [Fact]
        public void AFailedWriteStillAppliesTheChange()
        {
            var backing = new InMemorySettingsStore { FailWith = "read-only GameData" };
            var store = new SettingsStore(backing);
            store.Declare(SettingsRow.Bool("SIGNAL_DELAY/delayInSimulation", false));

            store.Stage("SIGNAL_DELAY/delayInSimulation", true);
            var outcome = store.Commit();

            Assert.False(outcome.Success);
            Assert.Equal("read-only GameData", outcome.Reason);
            Assert.True(store.Bool("SIGNAL_DELAY/delayInSimulation"));
        }

        /// <summary>
        /// A block nothing declared this launch is still in the document, so
        /// the settings of an uplink that did not load are not lost merely by
        /// being unrecognised.
        /// </summary>
        [Fact]
        public void AnUndeclaredBlockSurvivesTheRead()
        {
            var seed = new SettingsDocument();
            seed.Set("GHOST/someSetting", "12");
            var store = new SettingsStore(new InMemorySettingsStore(seed));

            store.Declare(SettingsRow.Bool("SIGNAL_DELAY/enabled", true));

            Assert.Equal("12", store.Text("GHOST/someSetting"));
        }

        [Fact]
        public void ARowKeepsItsPlaceWhenItChanges()
        {
            var document = new SettingsDocument();
            document.Set("SIGNAL_DELAY/enabled", "True");
            document.Set("SIGNAL_DELAY/lightSpeedScale", "1.0");

            document.Set("SIGNAL_DELAY/enabled", "False");

            var block = document.Root.Block("SIGNAL_DELAY");
            Assert.NotNull(block);
            Assert.Equal(new[] { "enabled", "lightSpeedScale" }, Names(block!));
        }

        /// <summary>
        /// A decimal point is a decimal point wherever the file is read. A
        /// culture-sensitive parse turns a light-speed scale of 0.1 into an
        /// unreadable row on a comma-decimal machine, which reverts silently to
        /// the default.
        /// </summary>
        [Fact]
        public void ANumberIsWrittenAndReadInvariantly()
        {
            Assert.Equal("0.1", SettingsText.FromNumber(0.1));
            Assert.Equal(0.1, SettingsText.ToNumber("0.1"));
            Assert.Null(SettingsText.ToNumber("0,1"));
        }

        [Fact]
        public void ADisposedWatcherHearsNothingMore()
        {
            var store = new SettingsStore(new InMemorySettingsStore());
            store.Declare(SettingsRow.Bool("SIGNAL_DELAY/enabled", true));
            var heard = 0;
            var watch = store.OnChanged("SIGNAL_DELAY", _ => heard++);

            watch.Dispose();
            store.Stage("SIGNAL_DELAY/enabled", false);
            store.Commit();

            Assert.Equal(1, heard);
        }

        /// <summary>
        /// One watcher's throw must not abandon the rest of them mid-notify,
        /// and must not take down a change that is already in force.
        /// </summary>
        [Fact]
        public void AThrowingWatcherDoesNotStopTheOthers()
        {
            var store = new SettingsStore(new InMemorySettingsStore());
            store.Declare(SettingsRow.Bool("SIGNAL_DELAY/enabled", true));
            var logged = new List<string>();
            store.DiagnosticLog = logged.Add;
            var heard = 0;
            store.OnChanged("SIGNAL_DELAY", _ => throw new InvalidOperationException("boom"));
            store.OnChanged("SIGNAL_DELAY", _ => heard++);

            store.Stage("SIGNAL_DELAY/enabled", false);
            var outcome = store.Commit();

            Assert.True(outcome.Success);
            Assert.Equal(2, heard);
            Assert.Equal(2, logged.Count);
        }

        private static string[] Names(SettingsBlock block)
        {
            var names = new string[block.Values.Count];
            for (var i = 0; i < names.Length; i++)
            {
                names[i] = block.Values[i].Name;
            }

            return names;
        }
    }
}
