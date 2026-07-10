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
