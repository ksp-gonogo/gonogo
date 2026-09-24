using System;

namespace Sitrep.Host.Settings
{
    /// <summary>What a row's text is allowed to say.</summary>
    public enum SettingsRowKind
    {
        Text = 0,
        Bool = 1,
        Number = 2,
    }

    /// <summary>
    /// A declared settings row: where it lives, what it may hold, and the value
    /// in force when the file does not mention it.
    ///
    /// <para>Declaring a row is what lets the store coerce and refuse. An
    /// undeclared path still reads and writes as text, so a block carried
    /// through from a launch where its declarer did not run is never lost, but
    /// nothing checks what goes into it.</para>
    /// </summary>
    public sealed class SettingsRow
    {
        public SettingsRow(string path, SettingsRowKind kind, string defaultText)
        {
            if (string.IsNullOrEmpty(path))
            {
                throw new ArgumentException("a row names a path", nameof(path));
            }

            SettingsDocument.Split(path);
            Path = path;
            Kind = kind;
            DefaultText = defaultText ?? string.Empty;
            var refusal = SettingsText.RefusalOf(DefaultText);
            if (refusal != null)
            {
                throw new ArgumentException(path + ": " + refusal, nameof(defaultText));
            }

            if (!Accepts(DefaultText))
            {
                throw new ArgumentException(
                    "the default " + DefaultText + " is not a " + kind + " value", nameof(defaultText));
            }
        }

        public static SettingsRow Bool(string path, bool defaultValue) =>
            new SettingsRow(path, SettingsRowKind.Bool, SettingsText.FromBool(defaultValue));

        public static SettingsRow Number(string path, double defaultValue) =>
            new SettingsRow(path, SettingsRowKind.Number, SettingsText.FromNumber(defaultValue));

        public static SettingsRow Text(string path, string defaultValue) =>
            new SettingsRow(path, SettingsRowKind.Text, defaultValue);

        public string Path { get; }

        public SettingsRowKind Kind { get; }

        public string DefaultText { get; }

        /// <summary>Whether <paramref name="text"/> is a value this row could hold.</summary>
        public bool Accepts(string text)
        {
            switch (Kind)
            {
                case SettingsRowKind.Bool:
                    return SettingsText.ToBool(text) != null;
                case SettingsRowKind.Number:
                    return SettingsText.ToNumber(text) != null;
                default:
                    return text != null;
            }
        }
    }

    /// <summary>
    /// The one spelling a value takes on the wire and on disk.
    ///
    /// <para>Parsing is invariant-culture on purpose: a settings file written
    /// on one machine is read on whatever locale the next launch happens to
    /// have, and a decimal comma would turn a light-speed scale of 0.1 into an
    /// unparseable row that silently reverts to its default.</para>
    /// </summary>
    public static class SettingsText
    {
        /// <summary>
        /// Why <paramref name="text"/> cannot be stored as a settings value, or
        /// null when it can.
        ///
        /// <para>A value is a single line with no <c>//</c>, no brace, no tab
        /// and no leading or trailing whitespace. Each of those is changed by
        /// KSP's own parser or writer without an error: <c>//</c> is read back
        /// as the start of a comment and the rest of the value is lost, a brace
        /// is rewritten to a bracket on the way out, a tab becomes a space, edge
        /// whitespace is trimmed on the way in, and a line break reaching
        /// <c>ConfigNode.SetValue</c> is written literally and breaks the file's
        /// structure. There is no escape in the format, so a value that needs
        /// any of them is split into several rows rather than encoded.</para>
        ///
        /// <para><c>=</c>, <c>:</c> and an empty value are all safe.</para>
        /// </summary>
        public static string? RefusalOf(string? text) => HazardIn(text, "value");

        /// <summary>
        /// Why <paramref name="name"/> cannot name a settings row or block, or
        /// null when it can: everything a value refuses, plus emptiness and
        /// <c>=</c>, which KSP's reader takes as the end of the name.
        /// </summary>
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

        public static string FromBool(bool value) => value ? "True" : "False";

        public static string FromNumber(double value) =>
            value.ToString("R", System.Globalization.CultureInfo.InvariantCulture);

        public static bool? ToBool(string? text) =>
            bool.TryParse(text, out var parsed) ? parsed : (bool?)null;

        public static double? ToNumber(string? text) =>
            double.TryParse(
                text,
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture,
                out var parsed)
                ? parsed
                : (double?)null;
    }
}
