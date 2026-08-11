using System.Collections.Generic;
#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The vocabulary for the <c>valueModel</c> discriminator that the value-bearing
/// <c>science.*</c> payloads carry (<see cref="ExperimentEntry.ValueModel"/>,
/// <see cref="LabEntry.ValueModel"/>,
/// <see cref="ExperimentBreakdownEntry.ValueModel"/>).
///
/// <para><b>Why a discriminator at all.</b> <c>science</c> is a Kernel-elected
/// capability, and the mods that model science do not merely put different NUMBERS
/// in these fields, they compute them from different models. Stock's "value of the
/// next report" is a diminishing-returns curve tracked per subject in R&amp;D;
/// another's is a flat rate times remaining data. A widget that treats one
/// provider's <c>scienceValueRatio</c> as comparable to another's is silently
/// wrong, and nothing in the field's name or unit says so. This is the same job
/// <see cref="ReliabilitySummary.Unmodeled"/> does for reliability: stop a
/// consumer reading a number as something it is not.</para>
///
/// <para><b>An OPEN vocabulary, deliberately.</b> Like <see cref="Units"/> and the
/// generated <c>SitrepUnit</c> union it feeds, this is a bag of known tokens, not
/// a closed enum: a provider Uplink cannot add a member to a const-string class in
/// this assembly, so closing the set would mean a third-party science provider
/// could never tag its own model. The tag is a plain string on the wire and a
/// consumer must treat an unrecognised token as "a model I do not know", never as
/// stock.</para>
/// </summary>
public static class ScienceValueModels
{
    /// <summary>
    /// Stock KSP: per-subject diminishing returns tracked in R&amp;D, data in mits.
    /// Emitted by the stock backend on every value-bearing entry, so a consumer
    /// never has to read ABSENCE as "probably stock".
    /// </summary>
    public const string Stock = "stock";
}

/// <summary>
/// One entry in the <c>science.experiments</c> channel payload, a single
/// science module (or a container holding stored results) on the ACTIVE
/// vessel. The channel payload is a BARE ARRAY of these (<c>ExperimentEntry[]</c>)
/// or <c>null</c>: never a wrapper object, and never an empty-vs-absent
/// distinction beyond "the whole array is null when there is no active
/// vessel / the sub-group could not be built" (see
/// <c>Sitrep.Host.ScienceViewProvider</c>).
///
/// <para><b>Typing-only mirror.</b> This type reproduces, field-for-field, the
/// exact serialized shape <c>Sitrep.Host.ScienceViewProvider.BuildExperimentEntry</c>
/// already emits (same names, same camelCase wire keys via
/// <c>RtConfig.CamelCaseForProperties</c>, same units). It is NOT serialized
/// itself: the wire is written by <c>JsonWriter</c> walking the provider's
/// dictionary: so adding it changes no bytes. Every field is nullable
/// because each is read through <c>SnapshotDict.Get*</c>, which yields
/// <c>null</c> (not a sentinel) whenever the raw value is absent or
/// non-finite.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("science.experiments", isArray: true)]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class ExperimentEntry
{
    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    /// <summary>"experiment" (a live science module) or "container" (a part storing collected results).</summary>
    [SitrepUnit(Units.Text)]
    public string? Location { get; set; }

    [SitrepUnit(Units.Id)]
    public string? ExperimentId { get; set; }

    [SitrepUnit(Units.Id)]
    public string? SubjectId { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }

    [SitrepUnit(Units.Mits)]
    public double? DataAmount { get; set; }

    [SitrepUnit(Units.Ratio)]
    public double? ScienceValueRatio { get; set; }

    [SitrepUnit(Units.Science)]
    public double? BaseTransmitValue { get; set; }

    /// <summary>
    /// Transmit-value multiplier, 0..1. Every <c>xmitDataScalar</c> across
    /// the installed part cfgs is at most 1.0, so this is a bounded ratio,
    /// not an open-ended dimensionless number.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? TransmitBonus { get; set; }

    [SitrepUnit(Units.Science)]
    public double? LabValue { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? Deployed { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? Inoperable { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Situation { get; set; }

    /// <summary>
    /// Which value model produced <see cref="ScienceValueRatio"/> /
    /// <see cref="BaseTransmitValue"/> / <see cref="LabValue"/>, and which unit
    /// <see cref="DataAmount"/> is really in. See
    /// <see cref="ScienceValueModels"/> for why this exists and why the
    /// vocabulary is open.
    ///
    /// <para><b>The one field on this payload that is not simply "what the game
    /// says".</b> A provider whose data is not in mits leaves
    /// <see cref="DataAmount"/> null rather than putting a megabyte figure in a
    /// mits-typed field: a field's unit is compile-time-baked here and cannot
    /// vary by elected provider, so the honest move is absence plus the real
    /// figure in the provider's own <see cref="Extensions"/> namespace.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? ValueModel { get; set; }

    /// <summary>
    /// The provider-namespaced extension bag: how a science backend carries a
    /// per-experiment field this shared shape does not declare, WITHOUT a PR
    /// against this file. See <see cref="ProviderExtensionBagAttribute"/> for the
    /// whole mechanism.
    ///
    /// <para>This is where everything a richer science model knows that stock has
    /// no concept of belongs: storage capacity, file-vs-sample, transmit rate,
    /// per-unit science rate. Adding those as nullable members here instead is the
    /// hand-curated-superset anti-pattern the bag replaces
    /// (<c>Sitrep.Host.Tests.ScienceProviderExtensionRatchetTests</c> holds that
    /// line).</para>
    /// </summary>
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}

/// <summary>
/// One entry in the <c>science.instruments</c> channel payload, a single
/// <c>ModuleScienceExperiment</c> on the ACTIVE vessel, captured as an
/// INVENTORY / status row keyed by <see cref="PartId"/> (the part's KSP
/// <c>flightID</c>). This is distinct from <see cref="ExperimentEntry"/>:
/// <c>science.experiments</c> walks the same modules but yields one row per
/// STORED <c>ScienceData</c> result (a module with no data produces no row),
/// whereas <c>science.instruments</c> yields one row per module regardless of
/// whether it currently holds data, the operability picture (deployed /
/// inoperable / rerunnable / resettable / collectable) an operator needs to
/// decide what to run next. The channel payload is a BARE ARRAY
/// (<c>InstrumentEntry[]</c>) or <c>null</c>. Typing-only mirror of
/// <c>Sitrep.Host.ScienceViewProvider.BuildInstrumentEntry</c>: see
/// <see cref="ExperimentEntry"/> for the "no wire change, all fields nullable"
/// rationale.
/// </summary>
[SitrepContract]
[SitrepTopic("science.instruments", isArray: true)]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class InstrumentEntry
{
    /// <summary>The part's KSP <c>flightID</c> (stringified): the stable join key for this instrument.</summary>
    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    [SitrepUnit(Units.Id)]
    public string? ExperimentId { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? Deployed { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? Inoperable { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? Rerunnable { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? Resettable { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? DataIsCollectable { get; set; }

    /// <summary>
    /// The provider-namespaced extension bag, instrument half. Same mechanism and
    /// same rule as <see cref="ExperimentEntry.Extensions"/>. This payload carries
    /// no value-model-dependent number (it is pure operability), so it takes the
    /// bag but no <c>valueModel</c> tag.
    ///
    /// <para>Stock's operability picture is a flat pair of bools
    /// (<see cref="Deployed"/>/<see cref="Inoperable"/>). A provider that models
    /// running as a state machine with a reason ("shrouded", "no EC", "sample
    /// depleted") projects it down to those bools and carries the state and the
    /// reason here.</para>
    /// </summary>
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}

/// <summary>
/// One entry in the <c>science.lab</c> channel payload, a Mobile Processing
/// Lab on the active vessel. The channel payload is a BARE ARRAY
/// (<c>LabEntry[]</c>) or <c>null</c>. Typing-only mirror of
/// <c>Sitrep.Host.ScienceViewProvider.BuildLabEntry</c>: see
/// <see cref="ExperimentEntry"/> for the "no wire change, all fields nullable"
/// rationale.
/// </summary>
[SitrepContract]
[SitrepTopic("science.lab", isArray: true)]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class LabEntry
{
    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    [SitrepUnit(Units.Mits)]
    public double? DataStored { get; set; }

    [SitrepUnit(Units.Mits)]
    public double? DataStorage { get; set; }

    [SitrepUnit(Units.Science)]
    public double? StoredScience { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? ProcessingData { get; set; }

    [SitrepUnit(Units.Text)]
    public string? StatusText { get; set; }

    [SitrepUnit(Units.Count)]
    public int? ScientistCount { get; set; }

    /// <summary>
    /// Science generated per GAME-DAY, not per second. The host reads this
    /// off <c>ModuleScienceConverter.CalculateScienceRate</c>, whose
    /// decompile multiplies the per-tick rate by a full day.
    /// </summary>
    [SitrepUnit(Units.SciencePerDay)]
    public double? ScienceRate { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? IsOperational { get; set; }

    /// <summary>
    /// Which value model produced <see cref="ScienceRate"/> and
    /// <see cref="StoredScience"/>, and which unit <see cref="DataStored"/> /
    /// <see cref="DataStorage"/> are really in. See
    /// <see cref="ScienceValueModels"/>.
    ///
    /// <para>A lab is not the same KIND of thing under every model. Stock's is
    /// terminal: it turns stored data into science per game-day and you are done.
    /// A provider whose lab is an intermediate pipeline stage (analysing a sample
    /// into a transmissible file, which then still has to be sent) produces NO
    /// science itself, leaves <see cref="ScienceRate"/> null, and carries its own
    /// rate in <see cref="Extensions"/>. Without this tag a widget cannot tell
    /// that null apart from "idle".</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? ValueModel { get; set; }

    /// <summary>
    /// The provider-namespaced extension bag, lab half. Same mechanism and same
    /// rule as <see cref="ExperimentEntry.Extensions"/>.
    /// </summary>
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}

/// <summary>
/// One entry in the <c>deployed.bases</c> channel payload, a Breaking
/// Ground deployed-science experiment. The channel payload is a BARE ARRAY
/// (<c>DeployedEntry[]</c>) or <c>null</c>. Unlike the other two channels,
/// <c>deployed.bases</c> is captured GLOBALLY across every loaded vessel: a
/// deployed cluster is its own ground vessel, so an entry normally describes a
/// vessel OTHER than the active one, distinguished by <see cref="VesselName"/>.
/// Typing-only mirror of <c>Sitrep.Host.BreakingGroundViewProvider.BuildDeployedEntry</c>;
/// see <see cref="ExperimentEntry"/> for the "no wire change, all fields
/// nullable" rationale.
/// </summary>
[SitrepContract]
[SitrepTopic("deployed.bases", isArray: true)]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class DeployedEntry
{
    [SitrepUnit(Units.Text)]
    public string? VesselName { get; set; }

    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Body { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Situation { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Biome { get; set; }

    [SitrepUnit(Units.Id)]
    public string? ExperimentId { get; set; }

    [SitrepUnit(Units.Percent)]
    public double? ScienceCompletedPercentage { get; set; }

    [SitrepUnit(Units.Percent)]
    public double? ScienceTransmittedPercentage { get; set; }

    [SitrepUnit(Units.Science)]
    public double? ScienceValue { get; set; }

    [SitrepUnit(Units.Science)]
    public double? ScienceLimit { get; set; }

    [SitrepUnit(Units.Text)]
    public string? PowerState { get; set; }

    [SitrepUnit(Units.Text)]
    public string? ConnectionState { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? DeployedOnGround { get; set; }
}

/// <summary>
/// One entry in the <c>science.sensors</c> channel payload, a single
/// environmental-sensor module (<c>ModuleEnviroSensor</c>: thermometer,
/// barometer, gravioli detector, accelerometer, and any modded sensor
/// sharing the module) on the ACTIVE vessel. The channel payload is a BARE
/// ARRAY (<c>SensorEntry[]</c>) or <c>null</c>.
///
/// <para>Deliberately a GENERAL sensor group: one entry per sensor module,
/// with <see cref="Type"/> carrying the raw <c>SensorType</c> enum name
/// (<c>TEMP</c>/<c>PRES</c>/<c>GRAV</c>/<c>ACC</c>/…) as a string: rather than
/// four fixed <c>temp/pres/grav/acc</c> Values. Modded sensor types and
/// multiple instances of the same type both fall out naturally; the consumer
/// (ScienceBench) groups/labels by <see cref="Type"/>.</para>
///
/// <para>Typing-only mirror of
/// <c>Sitrep.Host.ScienceViewProvider.BuildSensorEntry</c>: see
/// <see cref="ExperimentEntry"/> for the "no wire change, all fields nullable"
/// rationale.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("science.sensors", isArray: true)]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class SensorEntry
{
    /// <summary>Flight-scoped <c>part.flightID</c> as a string (null when the sentinel 0), the join key that disambiguates symmetric same-named sensor parts.</summary>
    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    /// <summary>The raw <c>SensorType</c> enum name (<c>TEMP</c>/<c>PRES</c>/<c>GRAV</c>/<c>ACC</c>/…) passed through as a string so modded types survive.</summary>
    [SitrepUnit(Units.Id)]
    public string? Type { get; set; }

    /// <summary>The sensor's current human-readable readout string (KSP's <c>readoutInfo</c>, e.g. "293.1K" or "Off").</summary>
    [SitrepUnit(Units.Text)]
    public string? Readout { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? Active { get; set; }
}

/// <summary>
/// One entry in the <c>science.experimentBreakdown</c> channel payload, a
/// per-SUBJECT rollup of the same stored <see cref="ScienceData"/> rows
/// <c>science.experiments</c> lists one-row-per-blob, the new home for the old
/// GonogoTelemetry-only <c>sci.experimentBreakdown</c> enrichment (which had
/// no equivalent on the base wire until now). <see cref="Biome"/>/
/// <see cref="Situation"/> are parsed straight off <c>ScienceData.subjectID</c>
/// via KSP's own <c>ScienceUtil.GetExperimentFieldsFromScienceID</c> (confirmed
/// via decompile: public static, splits the subject id it was built from
/// rather than re-deriving from the vessel's CURRENT position, so a subject
/// collected earlier in the flight keeps its own original biome/situation).
/// <see cref="RemainingPotential"/> is the ABSOLUTE science still recoverable
/// from the subject (<c>ScienceSubject.scienceCap - ScienceSubject.science</c>,
/// via <c>ResearchAndDevelopment.GetSubjectByID</c>), matching the old
/// GonogoTelemetry semantics: <c>0</c> in Sandbox mode (no R&D instance, no
/// subject caps to speak of). The channel payload is a BARE ARRAY
/// (<c>ExperimentBreakdownEntry[]</c>) or <c>null</c>: never a wrapper
/// object, and never an empty-vs-absent distinction beyond "the whole array
/// is null when there's no active vessel / the vessel carries no stored
/// science data" (mirrors <see cref="ExperimentEntry"/>'s convention). One row
/// per DISTINCT subject id: multiple stored blobs for the same subject
/// (e.g. two crew reports from the same biome) collapse into one entry with
/// <see cref="DataMits"/> summed across them.
///
/// <para><b>Typing-only mirror</b> of
/// <c>Sitrep.Host.ScienceViewProvider.BuildExperimentBreakdownEntry</c>: see
/// <see cref="ExperimentEntry"/> for the "no wire change, all fields nullable"
/// rationale.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("science.experimentBreakdown", isArray: true)]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class ExperimentBreakdownEntry
{
    [SitrepUnit(Units.Id)]
    public string? SubjectId { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Biome { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Situation { get; set; }

    [SitrepUnit(Units.Text)]
    public string? ExpTitle { get; set; }

    /// <summary>Summed <c>ScienceData.dataAmount</c> (mits) across every stored blob for this subject.</summary>
    [SitrepUnit(Units.Mits)]
    public double? DataMits { get; set; }

    /// <summary>Absolute science still recoverable from this subject (<c>scienceCap - science</c>); <c>0</c> outside Career/Science mode.</summary>
    [SitrepUnit(Units.Science)]
    public double? RemainingPotential { get; set; }

    /// <summary>
    /// Which value model produced <see cref="RemainingPotential"/>, and which unit
    /// <see cref="DataMits"/> is really in. See <see cref="ScienceValueModels"/>.
    ///
    /// <para>Stock's rollup is a snapshot: one summed data figure and one
    /// "how much is left". A provider with a full per-subject ledger (collected vs
    /// retrieved, in-flight split, times completed) projects it down to those two
    /// and carries the ledger in <see cref="Extensions"/>: stock's pair is a lossy
    /// VIEW of the richer set, never the other way round.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? ValueModel { get; set; }

    /// <summary>
    /// The provider-namespaced extension bag, per-subject-rollup half. Same
    /// mechanism and same rule as <see cref="ExperimentEntry.Extensions"/>.
    /// </summary>
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}
