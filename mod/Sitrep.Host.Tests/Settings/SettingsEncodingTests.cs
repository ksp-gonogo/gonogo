using System;
using Sitrep.Host.Settings;
using Xunit;

namespace Sitrep.Host.Tests.Settings
{
    /// <summary>
    /// The encoding every settings value obeys, enforced where a value enters
    /// the store. Each refused spelling is one KSP's format changes without an
    /// error; the real parser's half of that claim is in
    /// <c>Gonogo.KSP.Tests.Settings.SettingsEncodingRoundTripTests</c>.
    /// </summary>
    public class SettingsEncodingTests
    {
        public static TheoryData<string, string> Refused => new TheoryData<string, string>
        {
            { "a\nb", "single line" },
            { "a\rb", "single line" },
            { "ws://host:8090", "//" },
            { "//leading", "//" },
            { "a{b", "brace" },
            { "a}b", "brace" },
            { "a\tb", "tab" },
            { " leading", "whitespace" },
            { "trailing ", "whitespace" },
        };

        [Theory]
        [MemberData(nameof(Refused))]
        public void AValueKspWouldChangeIsRefusedWithItsReason(string text, string reason)
        {
            var store = new SettingsStore(new InMemorySettingsStore());

            var refused = Assert.Throws<ArgumentException>(() => store.Stage("PANEL/label", text));

            Assert.Contains(reason, refused.Message);
            Assert.Contains("PANEL/label", refused.Message);
        }

        /// <summary>
        /// A refused stage changes nothing: the document, the next commit and
        /// the medium all carry on as if it never happened.
        /// </summary>
        [Fact]
        public void ARefusedValueNeverReachesTheMedium()
        {
            var backing = new InMemorySettingsStore();
            var store = new SettingsStore(backing);
            store.Stage("PANEL/label", "fine");

            Assert.Throws<ArgumentException>(() => store.Stage("PANEL/label", "not // fine"));
            store.Commit();

            Assert.Equal("fine", backing.Read().Text("PANEL/label"));
        }

        [Theory]
        [InlineData("a=b=c")]
        [InlineData("ws:")]
        [InlineData("")]
        [InlineData(@"C:\Games\KSP")]
        [InlineData(@"\\server\share")]
        [InlineData("one word and another")]
        public void WhatTheFormatCarriesIsAccepted(string text)
        {
            var store = new SettingsStore(new InMemorySettingsStore());

            store.Stage("PANEL/label", text);
            store.Commit();

            Assert.Equal(text, store.Text("PANEL/label"));
        }

        [Theory]
        [InlineData("PANEL/a=b", "=")]
        [InlineData("PANEL/a{b", "brace")]
        [InlineData("PANEL/ padded", "whitespace")]
        [InlineData("PANEL/a\tb", "tab")]
        public void ANameKspWouldChangeIsRefused(string path, string reason)
        {
            var store = new SettingsStore(new InMemorySettingsStore());

            var refused = Assert.Throws<ArgumentException>(() => store.Stage(path, "1"));

            Assert.Contains(reason, refused.Message);
        }

        [Fact]
        public void ADeclaredDefaultIsHeldToTheSameRule()
        {
            var refused = Assert.Throws<ArgumentException>(
                () => SettingsRow.Text("PANEL/endpoint", "ws://localhost:8090"));

            Assert.Contains("//", refused.Message);
        }

        /// <summary>
        /// The writer's check, for a document that was built without going
        /// through <see cref="SettingsStore.Stage(string, string)"/>. It names
        /// the offending row so the refusal can say where.
        /// </summary>
        [Fact]
        public void TheWritersCheckNamesTheFirstRowThatWouldNotSurvive()
        {
            var document = new SettingsDocument();
            document.Set("SIGNAL_DELAY/enabled", "True");
            document.Root.BlockOrAdd("Uplinks").BlockOrAdd("Rp1").SetValue("endpoint", "ws://host");

            var violation = document.FirstEncodingViolation();

            Assert.NotNull(violation);
            Assert.StartsWith("Uplinks/Rp1/endpoint: ", violation);
        }

        [Fact]
        public void ACleanDocumentHasNoViolation()
        {
            var document = new SettingsDocument();
            document.Set("SIGNAL_DELAY/enabled", "True");
            document.Set("SIGNAL_DELAY/lightSpeedScale", "0.1");

            Assert.Null(document.FirstEncodingViolation());
        }

        /// <summary>
        /// A hand-typed <c>= 5</c> reads back as a row with an empty name. The
        /// writer's check lets it through, because refusing it would let one
        /// stray line block every save for the rest of the file's life.
        /// </summary>
        [Fact]
        public void AnEmptyNameReadFromTheFileDoesNotBlockASave()
        {
            var document = new SettingsDocument();
            document.Root.BlockOrAdd("GHOST").SetValue(string.Empty, "5");

            Assert.Null(document.FirstEncodingViolation());
        }
    }
}
