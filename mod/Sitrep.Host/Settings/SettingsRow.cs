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
