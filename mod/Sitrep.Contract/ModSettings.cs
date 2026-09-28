using System;
using System.Collections.Generic;
using System.Globalization;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract
{
    /// <summary>When the host reads a mod setting again.</summary>
    public enum ModSettingRefresh
    {
        /// <summary>Fixed for the KSP process: read until one read answers, then never again.</summary>
        Launch = 0,

        /// <summary>Belongs to the loaded save: read again whenever a save is loaded or the scene changes.</summary>
        Save = 1,

        /// <summary>Can change at any moment: read again once a second, in real time.</summary>
        Live = 2,
    }

    /// <summary>
    /// One of a host mod's own settings, as its Uplink describes it to Gonogo:
    /// what it is called, what it may hold, and where an operator changes it.
    ///
    /// <para>The mod owns and stores the value; this describes it and nothing
    /// more. Build one with <see cref="Bool"/>, <see cref="Number"/> or
    /// <see cref="Text"/>.</para>
    /// </summary>
    public sealed class ModSetting
    {
        private ModSetting(
            string id,
            string label,
            SettingKind kind,
            string? unit,
            ModSettingRefresh refresh,
            string description,
            string group,
            string setIn,
            bool writable)
        {
            Id = id ?? throw new ArgumentNullException(nameof(id));
            Label = label ?? throw new ArgumentNullException(nameof(label));
            Kind = kind;
            Unit = unit;
            Refresh = refresh;
            Description = description ?? string.Empty;
            Group = group ?? string.Empty;
            SetIn = setIn ?? string.Empty;
            Writable = writable;
        }

        /// <summary>A setting that is on or off.</summary>
        public static ModSetting Bool(
            string id,
            string label,
            ModSettingRefresh refresh,
            string description = "",
            string group = "",
            string setIn = "",
            bool writable = false) =>
            new ModSetting(id, label, SettingKind.Bool, null, refresh, description, group, setIn, writable);

        /// <summary>A number, in <paramref name="unit"/>: a <see cref="Units"/> token, or null for a plain count.</summary>
        public static ModSetting Number(
            string id,
            string label,
            string? unit,
            ModSettingRefresh refresh,
            string description = "",
            string group = "",
            string setIn = "",
            bool writable = false) =>
            new ModSetting(id, label, SettingKind.Number, unit, refresh, description, group, setIn, writable);

        /// <summary>A line of text, and the fallback for anything the other kinds cannot express.</summary>
        public static ModSetting Text(
            string id,
            string label,
            ModSettingRefresh refresh,
            string description = "",
            string group = "",
            string setIn = "",
            bool writable = false) =>
            new ModSetting(id, label, SettingKind.Text, null, refresh, description, group, setIn, writable);

        /// <summary>Stable within its Uplink, and never shown. The name a read and a write use.</summary>
        public string Id { get; }

        /// <summary>What an operator reads beside the value.</summary>
        public string Label { get; }

        /// <summary>Why the setting matters, read under the label. Empty when the label says enough.</summary>
        public string Description { get; }

        /// <summary>What the value may be.</summary>
        public SettingKind Kind { get; }

        /// <summary>The <see cref="Units"/> token a <see cref="SettingKind.Number"/> is in, or null.</summary>
        public string? Unit { get; }

        /// <summary>When the host reads it again.</summary>
        public ModSettingRefresh Refresh { get; }

        /// <summary>A named block inside the Uplink's section. Empty for none. Settings keep list order within it.</summary>
        public string Group { get; }

        /// <summary>Where in the game an operator changes it, such as "Difficulty settings". Empty when nowhere.</summary>
        public string SetIn { get; }

        /// <summary>
        /// Whether Gonogo may ask the Uplink to change it. The Uplink must then
        /// implement <see cref="IModSettingsWriter"/>, and Gonogo never asks it to
        /// write a setting not marked here.
        /// </summary>
        public bool Writable { get; }
    }

    /// <summary>
    /// A mod setting's value as its Uplink read it, or the reason it could not
    /// be read. Never pre-formatted: a number stays a number in its setting's
    /// unit.
    /// </summary>
    public readonly struct ModSettingValue
    {
        private readonly bool _bool;
        private readonly double _number;
        private readonly string? _text;

        private ModSettingValue(SettingKind? kind, bool boolValue, double number, string? text, string? unavailable)
        {
            Kind = kind;
            _bool = boolValue;
            _number = number;
            _text = text;
            UnavailableReason = unavailable;
        }

        /// <summary>On or off.</summary>
        public static ModSettingValue Of(bool value) => new ModSettingValue(SettingKind.Bool, value, 0, null, null);

        /// <summary>A number in its setting's unit.</summary>
        public static ModSettingValue Of(double value) => new ModSettingValue(SettingKind.Number, false, value, null, null);

        /// <summary>A line of text.</summary>
        public static ModSettingValue Of(string text) =>
            new ModSettingValue(SettingKind.Text, false, 0, text ?? throw new ArgumentNullException(nameof(text)), null);

        /// <summary>The value cannot be known right now, and why: "no save loaded", "the mod is not installed".</summary>
        public static ModSettingValue Unavailable(string reason) =>
            new ModSettingValue(null, false, 0, null, string.IsNullOrEmpty(reason) ? "unavailable" : reason);

        /// <summary>The kind of value held, or null when it is unavailable.</summary>
        public SettingKind? Kind { get; }

        /// <summary>Why it could not be read, or null when it was.</summary>
        public string? UnavailableReason { get; }

        /// <summary>Whether the value was read.</summary>
        public bool IsAvailable => Kind.HasValue;

        /// <summary>The value, when <see cref="Kind"/> is <see cref="SettingKind.Bool"/>.</summary>
        public bool AsBool => Kind == SettingKind.Bool ? _bool : throw Wrong(SettingKind.Bool);

        /// <summary>The value, when <see cref="Kind"/> is <see cref="SettingKind.Number"/>.</summary>
        public double AsNumber => Kind == SettingKind.Number ? _number : throw Wrong(SettingKind.Number);

        /// <summary>The value, when <see cref="Kind"/> is <see cref="SettingKind.Text"/>.</summary>
        public string AsText => Kind == SettingKind.Text ? _text! : throw Wrong(SettingKind.Text);

        /// <summary>
        /// The value spelled as a settings row spells it: <c>True</c> or
        /// <c>False</c>, a number with a full stop, or the text itself. Null
        /// when unavailable.
        /// </summary>
        public string? Spelled()
        {
            switch (Kind)
            {
                case SettingKind.Bool:
                    return _bool ? "True" : "False";
                case SettingKind.Number:
                    return _number.ToString("R", CultureInfo.InvariantCulture);
                case SettingKind.Text:
                    return _text;
                default:
                    return null;
            }
        }

        private InvalidOperationException Wrong(SettingKind wanted) =>
            new InvalidOperationException(
                "a " + (Kind.HasValue ? Kind.Value.ToString() : "unavailable") + " mod setting value read as " + wanted);
    }

    /// <summary>
    /// Implemented by an Uplink whose host mod has settings that shape what
    /// Gonogo shows. Gonogo lists them once and reads each on the cadence its
    /// <see cref="ModSetting.Refresh"/> names; how the mod stores them is the
    /// Uplink's business.
    ///
    /// <para><b>A throw costs the mod settings, never the Uplink.</b> A list
    /// that throws or breaks a rule leaves the Uplink running with no mod
    /// settings shown, and the reason on its settings topic.</para>
    ///
    /// <para>Not shape-gated: an interface on the Uplink-facing surface, not a
    /// wire type.</para>
    /// </summary>
    public interface IModSettingsSource
    {
        /// <summary>
        /// Every mod setting this Uplink can read, in the order an operator reads
        /// them. Called once, on the main thread, after the Uplink's own settings
        /// are declared and before any Uplink registers. The list is fixed for the
        /// session: a setting that cannot be read right now is still listed, and
        /// reads <see cref="ModSettingValue.Unavailable"/>. Ids are unique and not
        /// empty.
        /// </summary>
        IReadOnlyList<ModSetting> ListModSettings();

        /// <summary>
        /// The value in force for one listed setting. Called on the main thread,
        /// as often as its refresh says, so it reads a field rather than a file. A
        /// value of the wrong kind or a throw reads as unavailable, with the
        /// reason.
        /// </summary>
        ModSettingValue ReadModSetting(string id);
    }

    /// <summary>
    /// Implemented beside <see cref="IModSettingsSource"/> by an Uplink that can
    /// change some of its mod's settings. Gonogo asks it only for a setting
    /// listed <see cref="ModSetting.Writable"/>, with a value of that setting's
    /// kind, and reads the setting again straight after, which is how an
    /// operator learns whether it landed.
    /// </summary>
    public interface IModSettingsWriter
    {
        /// <summary>
        /// Set one setting, on the main thread. Safe to repeat: setting the value
        /// it already has changes nothing, because a command can time out and
        /// still land. A refusal says why and changes nothing.
        /// </summary>
        CommandResult WriteModSetting(string id, ModSettingValue value);
    }

    /// <summary>
    /// The <c>settings.&lt;uplink&gt;</c> channel payload: one Uplink's host mod's
    /// own settings, as the Uplink read them.
    ///
    /// <para><b>One topic per Uplink</b>, declared only for an Uplink that
    /// implements <see cref="IModSettingsSource"/>; its entry on
    /// <c>system.uplinks</c> says so with <c>modSettings</c>.</para>
    ///
    /// <para><b>TrueNow.</b> A mod setting configures the simulation on the KSP
    /// machine, not a craft, so there is no vantage from which it is not yet
    /// known.</para>
    ///
    /// <para><b>The authority for "did it change".</b> A write can time out and
    /// still land, so a client reads the outcome here, never from the command's
    /// reply.</para>
    /// </summary>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class ModSettingsModel
    {
        /// <summary>The Uplink these settings are read through.</summary>
        [SitrepUnit(Units.Id)]
        public string Uplink { get; set; } = "";

        /// <summary>Every listed setting, in the order the Uplink listed them.</summary>
        public List<ModSettingRow> Settings { get; set; } = new();

        /// <summary>Why the settings could not be listed this session, or null. <see cref="Settings"/> is then empty.</summary>
        [SitrepUnit(Units.Text)]
        public string? Failure { get; set; }

        /// <summary>The game install's own configuration, about no vessel.</summary>
        public PayloadMeta Meta { get; set; } = new();
    }

    /// <summary>One mod setting, described well enough to draw, with the value in force.</summary>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class ModSettingRow
    {
        /// <summary>The setting's id within its Uplink; what a write names.</summary>
        [SitrepUnit(Units.Id)]
        public string Id { get; set; } = "";

        /// <summary>What an operator reads beside the value.</summary>
        [SitrepUnit(Units.Text)]
        public string Label { get; set; } = "";

        /// <summary>Why the setting matters, read under the label. May be empty.</summary>
        [SitrepUnit(Units.Text)]
        public string Description { get; set; } = "";

        /// <summary>What the value may be.</summary>
        [SitrepUnit(Units.Enumeration)]
        public SettingKind Kind { get; set; }

        /// <summary>The unit token a number is in, or null for a count or a setting that is not a number.</summary>
        [SitrepUnit(Units.Id)]
        public string? Unit { get; set; }

        /// <summary>A named block inside the Uplink's section. Empty for none.</summary>
        [SitrepUnit(Units.Text)]
        public string Group { get; set; } = "";

        /// <summary>Where in the game an operator changes it. Empty when nowhere.</summary>
        [SitrepUnit(Units.Text)]
        public string SetIn { get; set; } = "";

        /// <summary>Whether <c>settings.mod.write</c> may change it.</summary>
        [SitrepUnit(Units.Flag)]
        public bool Writable { get; set; }

        /// <summary>
        /// The value in force, spelled as <see cref="SettingsRowState.Value"/> is:
        /// <c>True</c> or <c>False</c>, a number with a full stop in
        /// <see cref="Unit"/>, or the text. Null when it cannot be read, and
        /// <see cref="Unavailable"/> then says why.
        /// </summary>
        [SitrepUnit(Units.Text)]
        public string? Value { get; set; }

        /// <summary>Why the value cannot be read right now, or null when it was.</summary>
        [SitrepUnit(Units.Text)]
        public string? Unavailable { get; set; }
    }

    /// <summary>
    /// Arguments to <c>settings.mod.write</c>: change one of a host mod's own
    /// settings through its Uplink, at once.
    ///
    /// <para><b>Safe to send again.</b> It sets the value named, so repeating one
    /// that already landed changes nothing.</para>
    ///
    /// <para>Refused, with nothing changed, when the Uplink lists no such
    /// setting, when the setting is not writable, when the value is not one its
    /// kind can hold, or when the Uplink refuses it. What the mod holds after
    /// any of those is on <c>settings.&lt;uplink&gt;</c>.</para>
    /// </summary>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    [SitrepCommand("settings.mod.write", Delay = DelayRole.TrueNow)]
    public class WriteModSettingArgs
    {
        /// <summary>The Uplink the setting is read through.</summary>
        [SitrepUnit(Units.Id)]
        public string Uplink { get; set; } = "";

        /// <summary>The setting, as <see cref="ModSettingRow.Id"/> names it.</summary>
        [SitrepUnit(Units.Id)]
        public string Id { get; set; } = "";

        /// <summary>The new value, spelled as <see cref="ModSettingRow.Value"/> is.</summary>
        [SitrepUnit(Units.Text)]
        public string Value { get; set; } = "";
    }
}
