using System;
using Sitrep.Contract;

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
        public SettingsRow(string path, SettingsRowKind kind, string defaultText, string? label = null)
        {
            if (string.IsNullOrEmpty(path))
            {
                throw new ArgumentException("a row names a path", nameof(path));
            }

            SettingsDocument.Split(path);
            Path = path;
            Kind = kind;
            DefaultText = defaultText ?? string.Empty;
            Label = label ?? string.Empty;
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

        public static SettingsRow Bool(string path, bool defaultValue, string? label = null) =>
            new SettingsRow(path, SettingsRowKind.Bool, SettingsText.FromBool(defaultValue), label);

        public static SettingsRow Number(string path, double defaultValue, string? label = null) =>
            new SettingsRow(path, SettingsRowKind.Number, SettingsText.FromNumber(defaultValue), label);

        public static SettingsRow Text(string path, string defaultValue, string? label = null) =>
            new SettingsRow(path, SettingsRowKind.Text, defaultValue, label);

        public string Path { get; }

        public SettingsRowKind Kind { get; }

        public string DefaultText { get; }

        /// <summary>What an operator reads beside the control, and the start of the comment written beside the row.</summary>
        public string Label { get; }

        /// <summary>
        /// The comment written beside the row: its label, what it may hold, and
        /// its default. One line, since a line break would end the comment and
        /// start a row nobody wrote. Empty for an unlabelled text row, which has
        /// nothing to say beyond its value.
        /// </summary>
        public string Comment
        {
            get
            {
                var parts = new System.Collections.Generic.List<string>();
                if (Label.Length > 0)
                {
                    parts.Add(Label);
                }

                switch (Kind)
                {
                    case SettingsRowKind.Bool:
                        parts.Add("True or False, default " + DefaultText);
                        break;
                    case SettingsRowKind.Number:
                        parts.Add("A number, default " + DefaultText);
                        break;
                    case SettingsRowKind.Text:
                        if (parts.Count > 0 && DefaultText.Length > 0)
                        {
                            parts.Add("Default " + DefaultText);
                        }

                        break;
                }

                var comment = string.Join(". ", parts).Replace("\r", " ").Replace("\n", " ");
                return comment.Length == 0 ? comment : char.ToUpperInvariant(comment[0]) + comment.Substring(1);
            }
        }

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
        /// <summary>Why <paramref name="text"/> cannot be stored as a settings value, or null when it can: <see cref="SettingsEncoding.RefusalOf"/>.</summary>
        public static string? RefusalOf(string? text) => SettingsEncoding.RefusalOf(text);

        /// <summary>Why <paramref name="name"/> cannot name a settings row or block, or null when it can: <see cref="SettingsEncoding.RefusalOfName"/>.</summary>
        public static string? RefusalOfName(string? name) => SettingsEncoding.RefusalOfName(name);

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
