using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>settings.gonogo</c> channel payload: every setting the mod and its
/// Uplinks declared, what each holds now, and whether the settings file on the
/// KSP machine holds the same.
///
/// <para><b>The whole model on one topic.</b> A client renders a control per
/// row from the row's own description, so a setting an Uplink adds needs no
/// client code of its own.</para>
///
/// <para><b>TrueNow.</b> A setting configures the system the operator is
/// sitting at, not a craft, so there is no vantage from which it is not yet
/// known.</para>
///
/// <para><b>The authority for "did it save".</b> A save command can time out
/// and still land, so a client reads the outcome of a save here, never from
/// the command's reply.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("settings.gonogo")]
public class SettingsModel
{
    /// <summary>Every declared setting, in declaration order: the mod's own first, then each Uplink's.</summary>
    public List<SettingsRowState> Rows { get; set; } = new();

    /// <summary>Whether the values here are the ones the settings file holds.</summary>
    public SettingsPersistence Persistence { get; set; } = new();

    /// <summary>
    /// Uplinks that are running but whose settings could not be declared this
    /// session. Their settings are at their defaults and are not listed in
    /// <see cref="Rows"/>; what the file holds for them is kept as it is.
    /// </summary>
    public List<SettingsDeclarationFailure> Undeclared { get; set; } = new();

    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>One declared setting, described well enough for a client to draw its control.</summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SettingsRowState
{
    /// <summary>
    /// Where the setting lives, as blocks and a name separated by
    /// <c>/</c>: <c>SIGNAL_DELAY/enabled</c>, or
    /// <c>Uplinks/&lt;id&gt;/&lt;name&gt;</c> for an Uplink's own. This is the
    /// path a save names.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Path { get; set; } = "";

    /// <summary>Who declared it: <c>"gonogo"</c> for the mod itself, or the Uplink's id.</summary>
    [SitrepUnit(Units.Id)]
    public string Owner { get; set; } = "";

    /// <summary>What the value may be, and so which control draws it.</summary>
    [SitrepUnit(Units.Enumeration)]
    public SettingKind Kind { get; set; }

    /// <summary>What an operator reads beside the control. May be empty.</summary>
    [SitrepUnit(Units.Text)]
    public string Label { get; set; } = "";

    /// <summary>
    /// The value in force, as text: <c>True</c> or <c>False</c> for a
    /// <see cref="SettingKind.Bool"/>, a number written with a full stop for a
    /// <see cref="SettingKind.Number"/>.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string Value { get; set; } = "";

    /// <summary>The value in force when the settings file holds none for this row, in the same spelling as <see cref="Value"/>.</summary>
    [SitrepUnit(Units.Text)]
    public string Default { get; set; } = "";
}

/// <summary>Where the settings in force stand against the settings file.</summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum SettingsPersistenceState
{
    /// <summary>The file holds these values: it was read at start-up, or the last save wrote it.</summary>
    Saved = 0,

    /// <summary>
    /// The last save could not write the file. The values are in force for
    /// this session only and revert when KSP restarts;
    /// <see cref="SettingsPersistence.Reason"/> says why.
    /// </summary>
    MemoryOnly = 1,

    /// <summary>
    /// The file was missing, empty or damaged at start-up, and its backup was
    /// read instead. Anything saved after that backup was taken is lost. Clears
    /// at the next successful save.
    /// </summary>
    Recovered = 2,

    /// <summary>No settings file exists yet: a first run, every setting at its default until the first save.</summary>
    Defaults = 3,

    /// <summary>
    /// A settings file exists but neither it nor a backup could be read, so
    /// every setting is at its default. Clears at the next successful save,
    /// which replaces the unreadable file.
    /// </summary>
    Unreadable = 4,
}

/// <summary>Whether the settings file holds what is in force.</summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SettingsPersistence
{
    [SitrepUnit(Units.Enumeration)]
    public SettingsPersistenceState State { get; set; }

    /// <summary>The settings file on the KSP machine.</summary>
    [SitrepUnit(Units.Text)]
    public string Path { get; set; } = "";

    /// <summary>The instant of the last save that wrote the file, or null when none has this session.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? SavedAtUt { get; set; }

    /// <summary>Why the file could not be written or read, for an operator to read. Null when nothing went wrong.</summary>
    [SitrepUnit(Units.Text)]
    public string? Reason { get; set; }
}

/// <summary>An Uplink whose settings could not be declared this session.</summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SettingsDeclarationFailure
{
    [SitrepUnit(Units.Id)]
    public string UplinkId { get; set; } = "";

    /// <summary>Why, for an operator to read.</summary>
    [SitrepUnit(Units.Text)]
    public string Reason { get; set; } = "";
}

/// <summary>
/// Arguments to <c>settings.save</c>: one SAVE press, applied together and
/// written to the settings file once.
///
/// <para><b>Safe to send again.</b> A save sets each row to the value named,
/// so repeating one that already landed changes nothing. That matters because
/// a save that times out may still land.</para>
///
/// <para>Refused, with nothing changed, when any row is not declared or any
/// value is not one its row can hold. A save that changes the values but
/// cannot write the file is NOT refused: the values are in force, and
/// <c>settings.gonogo</c>'s <see cref="SettingsModel.Persistence"/> says the
/// file was not written.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("settings.save", Delay = DelayRole.TrueNow)]
public class SaveSettingsArgs
{
    public List<SettingsChange> Changes { get; set; } = new();
}

/// <summary>One row's new value in a <see cref="SaveSettingsArgs"/>.</summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SettingsChange
{
    /// <summary>The row, as <see cref="SettingsRowState.Path"/> names it.</summary>
    [SitrepUnit(Units.Id)]
    public string Path { get; set; } = "";

    /// <summary>The new value, spelled as <see cref="SettingsRowState.Value"/> is.</summary>
    [SitrepUnit(Units.Text)]
    public string Value { get; set; } = "";
}
