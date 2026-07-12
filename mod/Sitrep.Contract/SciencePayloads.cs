#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One entry in the <c>science.experiments</c> channel payload — a single
/// science module (or a container holding stored results) on the ACTIVE
/// vessel. The channel payload is a BARE ARRAY of these (<c>ExperimentEntry[]</c>)
/// or <c>null</c> — never a wrapper object, and never an empty-vs-absent
/// distinction beyond "the whole array is null when there is no active
/// vessel / the sub-group could not be built" (see
/// <c>Sitrep.Host.ScienceViewProvider</c>).
///
/// <para><b>Typing-only mirror.</b> This type reproduces, field-for-field, the
/// exact serialized shape <c>Sitrep.Host.ScienceViewProvider.BuildExperimentEntry</c>
/// already emits (same names, same camelCase wire keys via
/// <c>RtConfig.CamelCaseForProperties</c>, same units). It is NOT serialized
/// itself — the wire is written by <c>JsonWriter</c> walking the provider's
/// dictionary — so adding it changes no bytes. Every field is nullable
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
    public string? PartName { get; set; }

    /// <summary>"experiment" (a live science module) or "container" (a part storing collected results).</summary>
    public string? Location { get; set; }

    public string? ExperimentId { get; set; }

    public string? SubjectId { get; set; }

    public string? Title { get; set; }

    public double? DataAmount { get; set; }

    public double? ScienceValueRatio { get; set; }

    public double? BaseTransmitValue { get; set; }

    public double? TransmitBonus { get; set; }

    public double? LabValue { get; set; }

    public bool? Deployed { get; set; }

    public bool? Inoperable { get; set; }

    public string? Situation { get; set; }
}

/// <summary>
/// One entry in the <c>science.instruments</c> channel payload — a single
/// <c>ModuleScienceExperiment</c> on the ACTIVE vessel, captured as an
/// INVENTORY / status row keyed by <see cref="PartId"/> (the part's KSP
/// <c>flightID</c>). This is distinct from <see cref="ExperimentEntry"/>:
/// <c>science.experiments</c> walks the same modules but yields one row per
/// STORED <c>ScienceData</c> result (a module with no data produces no row),
/// whereas <c>science.instruments</c> yields one row per module regardless of
/// whether it currently holds data — the operability picture (deployed /
/// inoperable / rerunnable / resettable / collectable) an operator needs to
/// decide what to run next. The channel payload is a BARE ARRAY
/// (<c>InstrumentEntry[]</c>) or <c>null</c>. Typing-only mirror of
/// <c>Sitrep.Host.ScienceViewProvider.BuildInstrumentEntry</c> — see
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
    /// <summary>The part's KSP <c>flightID</c> (stringified) — the stable join key for this instrument.</summary>
    public string? PartId { get; set; }

    public string? PartName { get; set; }

    public string? ExperimentId { get; set; }

    public string? Title { get; set; }

    public bool? Deployed { get; set; }

    public bool? Inoperable { get; set; }

    public bool? Rerunnable { get; set; }

    public bool? Resettable { get; set; }

    public bool? DataIsCollectable { get; set; }
}

/// <summary>
/// One entry in the <c>science.lab</c> channel payload — a Mobile Processing
/// Lab on the active vessel. The channel payload is a BARE ARRAY
/// (<c>LabEntry[]</c>) or <c>null</c>. Typing-only mirror of
/// <c>Sitrep.Host.ScienceViewProvider.BuildLabEntry</c> — see
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
    public string? PartName { get; set; }

    public double? DataStored { get; set; }

    public double? DataStorage { get; set; }

    public double? StoredScience { get; set; }

    public bool? ProcessingData { get; set; }

    public string? StatusText { get; set; }

    public int? ScientistCount { get; set; }

    public double? ScienceRate { get; set; }

    public bool? IsOperational { get; set; }
}

/// <summary>
/// One entry in the <c>science.deployed</c> channel payload — a Breaking
/// Ground deployed-science experiment. The channel payload is a BARE ARRAY
/// (<c>DeployedEntry[]</c>) or <c>null</c>. Unlike the other two channels,
/// <c>science.deployed</c> is captured GLOBALLY across every loaded vessel: a
/// deployed cluster is its own ground vessel, so an entry normally describes a
/// vessel OTHER than the active one, distinguished by <see cref="VesselName"/>.
/// Typing-only mirror of <c>Sitrep.Host.ScienceViewProvider.BuildDeployedEntry</c>
/// — see <see cref="ExperimentEntry"/> for the "no wire change, all fields
/// nullable" rationale.
/// </summary>
[SitrepContract]
[SitrepTopic("science.deployed", isArray: true)]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class DeployedEntry
{
    public string? VesselName { get; set; }

    public string? PartName { get; set; }

    public string? Body { get; set; }

    public string? Situation { get; set; }

    public string? Biome { get; set; }

    public string? ExperimentId { get; set; }

    public double? ScienceCompletedPercentage { get; set; }

    public double? ScienceTransmittedPercentage { get; set; }

    public double? ScienceValue { get; set; }

    public double? ScienceLimit { get; set; }

    public string? PowerState { get; set; }

    public string? ConnectionState { get; set; }

    public bool? DeployedOnGround { get; set; }
}

/// <summary>
/// One entry in the <c>science.sensors</c> channel payload — a single
/// environmental-sensor module (<c>ModuleEnviroSensor</c>: thermometer,
/// barometer, gravioli detector, accelerometer, and any modded sensor
/// sharing the module) on the ACTIVE vessel. The channel payload is a BARE
/// ARRAY (<c>SensorEntry[]</c>) or <c>null</c>.
///
/// <para>Deliberately a GENERAL sensor group — one entry per sensor module,
/// with <see cref="Type"/> carrying the raw <c>SensorType</c> enum name
/// (<c>TEMP</c>/<c>PRES</c>/<c>GRAV</c>/<c>ACC</c>/…) as a string — rather than
/// four fixed <c>temp/pres/grav/acc</c> Values. Modded sensor types and
/// multiple instances of the same type both fall out naturally; the consumer
/// (ScienceBench) groups/labels by <see cref="Type"/>.</para>
///
/// <para>Typing-only mirror of
/// <c>Sitrep.Host.ScienceViewProvider.BuildSensorEntry</c> — see
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
    public string? PartId { get; set; }

    public string? PartName { get; set; }

    /// <summary>The raw <c>SensorType</c> enum name — <c>TEMP</c>/<c>PRES</c>/<c>GRAV</c>/<c>ACC</c>/… — passed through as a string so modded types survive.</summary>
    public string? Type { get; set; }

    /// <summary>The sensor's current human-readable readout string (KSP's <c>readoutInfo</c>, e.g. "293.1K" or "Off").</summary>
    public string? Readout { get; set; }

    public bool? Active { get; set; }
}

/// <summary>
/// One entry in the <c>science.experimentBreakdown</c> channel payload — a
/// per-SUBJECT rollup of the same stored <see cref="ScienceData"/> rows
/// <c>science.experiments</c> lists one-row-per-blob, the new home for the old
/// GonogoTelemetry-only <c>sci.experimentBreakdown</c> enrichment (which had
/// no equivalent on the base wire until now). <see cref="Biome"/>/
/// <see cref="Situation"/> are parsed straight off <c>ScienceData.subjectID</c>
/// via KSP's own <c>ScienceUtil.GetExperimentFieldsFromScienceID</c> (confirmed
/// via decompile — public static, splits the subject id it was built from
/// rather than re-deriving from the vessel's CURRENT position, so a subject
/// collected earlier in the flight keeps its own original biome/situation).
/// <see cref="RemainingPotential"/> is the ABSOLUTE science still recoverable
/// from the subject (<c>ScienceSubject.scienceCap - ScienceSubject.science</c>,
/// via <c>ResearchAndDevelopment.GetSubjectByID</c>), matching the old
/// GonogoTelemetry semantics — <c>0</c> in Sandbox mode (no R&D instance, no
/// subject caps to speak of). The channel payload is a BARE ARRAY
/// (<c>ExperimentBreakdownEntry[]</c>) or <c>null</c> — never a wrapper
/// object, and never an empty-vs-absent distinction beyond "the whole array
/// is null when there's no active vessel / the vessel carries no stored
/// science data" (mirrors <see cref="ExperimentEntry"/>'s convention). One row
/// per DISTINCT subject id — multiple stored blobs for the same subject
/// (e.g. two crew reports from the same biome) collapse into one entry with
/// <see cref="DataMits"/> summed across them.
///
/// <para><b>Typing-only mirror</b> of
/// <c>Sitrep.Host.ScienceViewProvider.BuildExperimentBreakdownEntry</c> — see
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
    public string? SubjectId { get; set; }

    public string? Biome { get; set; }

    public string? Situation { get; set; }

    public string? ExpTitle { get; set; }

    /// <summary>Summed <c>ScienceData.dataAmount</c> (mits) across every stored blob for this subject.</summary>
    public double? DataMits { get; set; }

    /// <summary>Absolute science still recoverable from this subject (<c>scienceCap - science</c>); <c>0</c> outside Career/Science mode.</summary>
    public double? RemainingPotential { get; set; }
}
