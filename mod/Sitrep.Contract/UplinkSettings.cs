using System;
using System.Collections.Generic;
using System.Globalization;

namespace Sitrep.Contract
{
    /// <summary>
    /// What an Uplink setting may hold.
    ///
    /// <para>The set is deliberately small and closed. A setting that needs
    /// more than these is a <see cref="Text"/> row that the Uplink checks when
    /// it reads it.</para>
    /// </summary>
    public enum UplinkSettingKind
    {
        /// <summary>A single line of text. Also the fallback for anything the other kinds cannot express.</summary>
        Text = 0,

        /// <summary>True or false.</summary>
        Bool = 1,

        /// <summary>A number, written with a full stop for the decimal point whatever the player's locale.</summary>
        Number = 2,
    }

    /// <summary>
    /// What a settings name or value may be, so that the settings file carries it
    /// back unchanged.
    ///
    /// <para>A value is a single line with no <c>//</c>, no brace, no tab and no
    /// leading or trailing whitespace. KSP's settings format changes each of
    /// those without an error: <c>//</c> is read back as the start of a comment
    /// and the rest of the value is lost, a brace is rewritten to a bracket, a
    /// tab becomes a space, edge whitespace is trimmed, and a line break can
    /// split one row into two. The format has no escape, so a value that needs
    /// any of them is split into several settings rather than encoded: a host
    /// and a port are two rows, never one URL.</para>
    ///
    /// <para><c>=</c>, <c>:</c>, a backslash and an empty value are all safe in a
    /// value. A name additionally cannot be empty or contain <c>=</c>.</para>
    /// </summary>
    public static class SettingsEncoding
    {
        /// <summary>Why <paramref name="value"/> cannot be stored, or null when it can.</summary>
        public static string? RefusalOf(string? value) => HazardIn(value, "value");

        /// <summary>Why <paramref name="name"/> cannot name a setting or a block, or null when it can.</summary>
        public static string? RefusalOfName(string? name)
        {
            if (string.IsNullOrEmpty(name))
            {
                return "a settings name cannot be empty";
            }

            if (name!.IndexOf('=') >= 0)
            {
                return "a settings name cannot contain =, which KSP reads as the end of the name";
            }

            return HazardIn(name, "name");
        }

        private static string? HazardIn(string? text, string what)
        {
            if (text == null)
            {
                return "a settings " + what + " cannot be null";
            }

            if (text.IndexOf('\n') >= 0 || text.IndexOf('\r') >= 0)
            {
                return "a settings " + what + " is a single line, and this one spans several";
            }

            if (text.IndexOf("//", StringComparison.Ordinal) >= 0)
            {
                return "a settings " + what
                    + " cannot contain //, which KSP reads back as the start of a comment and truncates";
            }

            if (text.IndexOf('{') >= 0 || text.IndexOf('}') >= 0)
            {
                return "a settings " + what + " cannot contain a brace, which KSP rewrites to a bracket when it saves";
            }

            if (text.IndexOf('\t') >= 0)
            {
                return "a settings " + what + " cannot contain a tab, which KSP writes as a space";
            }

            if (text.Length > 0 && (char.IsWhiteSpace(text[0]) || char.IsWhiteSpace(text[text.Length - 1])))
            {
                return "a settings " + what + " cannot start or end with whitespace, which KSP trims when it reads";
            }

            return null;
        }
    }

    /// <summary>
    /// One setting an Uplink declares: its name within the Uplink's own block,
    /// what it may hold, the value in force until the operator changes it, and
    /// the label an operator reads.
    ///
    /// <para>Its name and default are held to <see cref="SettingsEncoding"/>,
    /// and a declaration that breaks it is refused.</para>
    /// </summary>
    public sealed class UplinkSettingRow
    {
        /// <summary>The name a block stores <see cref="IUplinkSettings.WrittenBy"/> under, reserved for it.</summary>
        public const string WrittenByName = "writtenBy";

        public UplinkSettingRow(string name, UplinkSettingKind kind, string defaultText, string label)
        {
            Name = name ?? throw new ArgumentNullException(nameof(name));
            Kind = kind;
            DefaultText = defaultText ?? throw new ArgumentNullException(nameof(defaultText));
            Label = label ?? string.Empty;
        }

        public static UplinkSettingRow Bool(string name, bool defaultValue, string label) =>
            new UplinkSettingRow(name, UplinkSettingKind.Bool, defaultValue ? "True" : "False", label);

        public static UplinkSettingRow Number(string name, double defaultValue, string label) =>
            new UplinkSettingRow(
                name, UplinkSettingKind.Number, defaultValue.ToString("R", CultureInfo.InvariantCulture), label);

        public static UplinkSettingRow Text(string name, string defaultValue, string label) =>
            new UplinkSettingRow(name, UplinkSettingKind.Text, defaultValue, label);

        public string Name { get; }

        public UplinkSettingKind Kind { get; }

        /// <summary>The value in force when the settings file holds none for this row.</summary>
        public string DefaultText { get; }

        /// <summary>What an operator reads beside the control.</summary>
        public string Label { get; }
    }

    /// <summary>
    /// One Uplink's own block of settings, handed to it once at start-up and
    /// valid for the rest of the session.
    ///
    /// <para>The block is <c>Uplinks { &lt;id&gt; { ... } }</c> in the settings
    /// file. It exists only once the Uplink has run and declared something: no
    /// block means the Uplink was never asked, which is not the same as any
    /// value being false.</para>
    /// </summary>
    public interface IUplinkSettings
    {
        /// <summary>
        /// The Uplink version that last saved this block, or null when the file
        /// holds no block for it. A migration compares this with its own
        /// version; doing nothing is always safe.
        ///
        /// <para>It is stored beside the block's values under the name
        /// <see cref="UplinkSettingRow.WrittenByName"/>, which no declaration may use.</para>
        /// </summary>
        string? WrittenBy { get; }

        /// <summary>Every name the stored block holds, including ones this version no longer declares.</summary>
        IReadOnlyList<string> StoredNames { get; }

        /// <summary>The value stored for <paramref name="name"/> exactly as the file holds it, or null when there is none.</summary>
        string? Stored(string name);

        /// <summary>
        /// Declare a setting. Only valid inside
        /// <see cref="IUplinkSettingsDeclarer.DeclareSettings"/>. Refused with an
        /// <see cref="ArgumentException"/> when the name is
        /// <see cref="UplinkSettingRow.WrittenByName"/>, when the name or default
        /// breaks <see cref="SettingsEncoding"/>, or when the default is not a
        /// value of the row's kind.
        /// </summary>
        void Declare(UplinkSettingRow row);

        /// <summary>
        /// Replace a stored value, for an Uplink migrating a block an older
        /// version wrote. Takes effect at once and reaches the file with the
        /// operator's next save, so a migration must give the same result if it
        /// runs again. Only valid inside
        /// <see cref="IUplinkSettingsDeclarer.DeclareSettings"/>.
        /// </summary>
        void Migrate(string name, string text);

        /// <summary>The value in force for a declared setting: the stored one, or the declared default.</summary>
        string? Text(string name);

        /// <summary>The value in force for a declared <see cref="UplinkSettingKind.Bool"/> setting.</summary>
        bool Bool(string name);

        /// <summary>The value in force for a declared <see cref="UplinkSettingKind.Number"/> setting.</summary>
        double Number(string name);

        /// <summary>
        /// Hear every change to this block for the lifetime of the returned
        /// handle. The callback also runs once with the values as they stand: at
        /// once when registered outside
        /// <see cref="IUplinkSettingsDeclarer.DeclareSettings"/>, or as it
        /// returns when registered inside it, since only then are the values
        /// known.
        /// </summary>
        IDisposable OnChanged(Action<IUplinkSettings> callback);
    }

    /// <summary>
    /// Implemented by an Uplink that has settings of its own.
    ///
    /// <para>The host calls <see cref="DeclareSettings"/> once at start-up,
    /// after every Uplink has declared its capabilities and before any
    /// <see cref="ISitrepUplink.Register"/> runs, so the values are ready to
    /// read while the Uplink registers. Keep the handle it is given to read them
    /// later.</para>
    ///
    /// <para><b>A throw costs the settings, never the Uplink.</b> It still
    /// registers and publishes, its settings read as their declared defaults for
    /// the session, and its stored block is left in the file exactly as it
    /// was.</para>
    ///
    /// <para>Not shape-gated: this is an interface on the Uplink-facing surface,
    /// not a wire type, so adding it does not change
    /// <see cref="ContractVersion"/>.</para>
    /// </summary>
    public interface IUplinkSettingsDeclarer
    {
        /// <summary>Declare this Uplink's settings, and migrate what an older version stored if it needs to.</summary>
        void DeclareSettings(IUplinkSettings settings);
    }
}
