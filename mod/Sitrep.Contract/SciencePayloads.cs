using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The vocabulary for the <c>valueModel</c> tag that the value-bearing
/// <c>science.*</c> payloads carry (<see cref="ExperimentEntry.ValueModel"/>,
/// <see cref="LabEntry.ValueModel"/>,
/// <see cref="ExperimentBreakdownEntry.ValueModel"/>).
///
/// <para>The science provider is chosen at runtime, and the mods that model
/// science do not merely put different numbers in these fields, they compute
/// them from different models. Stock's "value of the next report" is a
/// diminishing-returns curve tracked per subject in R&amp;D; another model's
/// may be a flat rate times remaining data. Nothing in a field's name or unit
/// says which, so a widget that compares one provider's
/// <c>scienceValueRatio</c> with another's is silently wrong. The tag says
/// which model produced the numbers.</para>
///
/// <para>The vocabulary is open: the tag is a plain string on the wire, and a
/// third-party science provider may emit a token not listed here. Treat an
/// unrecognised token as "a model I do not know", never as stock.</para>
/// <internal>
/// Open rather than a closed enum because a provider Uplink cannot add a
/// member to a const-string class in this assembly; same shape as
/// <see cref="Units"/> and the generated <c>SitrepUnit</c> union it feeds.
/// </internal>
/// </summary>
/// <category>Science</category>
public static class ScienceValueModels
{
    /// <summary> Stock KSP: per-subject diminishing returns tracked in R&amp;D,
    /// data in mits. The stock provider sets it on every value-bearing entry,
    /// so an absent tag never has to be read as "probably stock".
    /// </summary>
    public const string Stock = "stock";
}

/// <summary> One entry in the <c>science.experiments</c> channel payload: a
/// single stored science result on the ACTIVE vessel, held either by the
/// science module that collected it or by a container part. The channel
/// payload is a BARE ARRAY of these (<c>ExperimentEntry[]</c>) or <c>null</c>,
/// never a wrapper object. The whole array is <c>null</c> when there is no
/// active vessel or the vessel holds no stored science data; there is no
/// separate empty-array state.
///
/// <para>One row per stored <c>ScienceData</c>: a module that holds no data
/// produces no row (see <see cref="InstrumentEntry"/> for one row per module).
/// Every field is nullable, and is <c>null</c> whenever the raw value is
/// absent or non-finite.</para>
/// <internal>
/// Typing-only mirror of what
/// <c>Sitrep.Host.ScienceViewProvider.BuildExperimentEntry</c> already emits
/// (same names, same camelCase wire keys via
/// <c>RtConfig.CamelCaseForProperties</c>, same units). It is never
/// serialized itself: the wire is written by <c>JsonWriter</c> walking the
/// provider's dictionary. Every field is nullable because each is read
/// through <c>SnapshotDict.Get*</c>, which yields <c>null</c> (not a
/// sentinel) whenever the raw value is absent or non-finite.
/// </internal>
/// </summary>
/// <category>Science</category>
[SitrepContract]
[SitrepTopic("science.experiments", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ExperimentEntry
{
    /// <summary>Display title of the part holding the result (the part's
    /// <c>partInfo.title</c>, or its internal name when that is
    /// missing).</summary>
    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    /// <summary>"experiment" (still held by the science module that collected
    /// it) or "container" (already collected into an onboard science
    /// container). KSP keeps no "already transmitted" flag on a result, so
    /// this is the closest available "stored vs not yet collected"
    /// signal.</summary>
    [SitrepUnit(Units.Text)]
    public string? Location { get; set; }

    /// <summary>The collecting module's experiment id (KSP's
    /// <c>ModuleScienceExperiment.experimentID</c>, for example
    /// <c>crewReport</c>). <c>null</c> on a <c>"container"</c> row, where the
    /// result no longer sits in its experiment module.</summary>
    [SitrepUnit(Units.Id)]
    public string? ExperimentId { get; set; }

    /// <summary>The science subject this result was recorded against (KSP's
    /// <c>ScienceData.subjectID</c>), the join key into
    /// <see cref="ExperimentBreakdownEntry.SubjectId"/> and
    /// <see cref="ArchiveEntry.SubjectId"/>.</summary>
    [SitrepUnit(Units.Id)]
    public string? SubjectId { get; set; }

    /// <summary>The result's display title (KSP's
    /// <c>ScienceData.title</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }

    /// <summary>Size of the stored result in mits (KSP's
    /// <c>ScienceData.dataAmount</c>). <c>null</c> under a
    /// <see cref="ValueModel"/> whose data is not measured in mits.</summary>
    [SitrepUnit(Units.Mits)]
    public double? DataAmount { get; set; }

    /// <summary>KSP's <c>ScienceData.scienceValueRatio</c> for this result.
    /// Its meaning depends on <see cref="ValueModel"/>: do not compare it
    /// across models.</summary>
    [SitrepUnit(Units.Ratio)]
    public double? ScienceValueRatio { get; set; }

    /// <summary>KSP's <c>ScienceData.baseTransmitValue</c> for this result.
    /// Its meaning depends on <see cref="ValueModel"/>.
    /// <internal>
    /// The ScienceData constructor stores its <c>xmitValue</c> argument here,
    /// which is the part cfg's <c>xmitDataScalar</c>, a 0..1 scalar; the
    /// <c>Units.Science</c> tag may not match what the field holds.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Science)]
    public double? BaseTransmitValue { get; set; }

    /// <summary>
    /// Transmit-value multiplier for this result (KSP's
    /// <c>ScienceData.transmitBonus</c>), a bounded ratio.
    /// <internal>
    /// The bound was argued from every <c>xmitDataScalar</c> across the
    /// installed part cfgs being at most 1.0; the ScienceData constructor
    /// stores <c>xmitDataScalar</c> in <c>baseTransmitValue</c>, not here,
    /// so that argument belongs to <see cref="BaseTransmitValue"/>.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? TransmitBonus { get; set; }

    /// <summary>KSP's <c>ScienceData.labValue</c> for this result: its value
    /// to a Mobile Processing Lab. Its meaning depends on
    /// <see cref="ValueModel"/>.</summary>
    [SitrepUnit(Units.Science)]
    public double? LabValue { get; set; }

    /// <summary>Whether the collecting experiment module is deployed (KSP's
    /// <c>ModuleScienceExperiment.Deployed</c>). <c>null</c> on a
    /// <c>"container"</c> row.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Deployed { get; set; }

    /// <summary>Whether the collecting experiment module is inoperable until
    /// reset (KSP's <c>ModuleScienceExperiment.Inoperable</c>). <c>null</c> on
    /// a <c>"container"</c> row.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Inoperable { get; set; }

    /// <summary>The active vessel's CURRENT situation, KSP's
    /// <c>Vessel.situation</c> enum name (for example <c>LANDED</c>,
    /// <c>ORBITING</c>). It describes where the vessel is now, not where the
    /// result was collected; the collection situation is encoded in
    /// <see cref="SubjectId"/>.</summary>
    [SitrepUnit(Units.Text)]
    public string? Situation { get; set; }

    /// <summary>
    /// Which value model produced <see cref="ScienceValueRatio"/>,
    /// <see cref="BaseTransmitValue"/> and <see cref="LabValue"/>, and which
    /// unit <see cref="DataAmount"/> is really in. A token from
    /// <see cref="ScienceValueModels"/>, or one it does not list.
    ///
    /// <para>This is the one field on the payload that is not simply "what the
    /// game says". A provider whose data is not in mits leaves
    /// <see cref="DataAmount"/> null rather than putting another unit's figure
    /// in a mits-typed field, and carries the real figure in its own
    /// <see cref="Extensions"/> namespace.</para>
    /// <internal>
    /// A field's unit is fixed at compile time here and cannot vary by
    /// elected provider, which is why absence plus an extension is the only
    /// honest option.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? ValueModel { get; set; }

    /// <summary>
    /// The provider-namespaced extension bag: how a science provider carries a
    /// per-experiment field this shared shape does not declare. See
    /// <see cref="ProviderExtensionBagAttribute"/> for the mechanism.
    ///
    /// <para>Everything a richer science model knows that stock has no concept
    /// of belongs here: storage capacity, file-vs-sample, transmit rate,
    /// per-unit science rate. Absent from the payload when no provider filled
    /// it.</para>
    /// <internal>
    /// Adding those as nullable members of this type instead is the
    /// hand-curated-superset pattern the bag replaces;
    /// <c>Sitrep.Host.Tests.ScienceProviderExtensionRatchetTests</c> holds
    /// that line.
    /// </internal>
    /// </summary>
    // AppendProviderExtensions omits the key when no provider filled a bag, so a
    // payload no provider extended carries no trace of the mechanism.
    [SitrepOmittedWhenNull]
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}

/// <summary>
/// One entry in the <c>science.instruments</c> channel payload: a single
/// <c>ModuleScienceExperiment</c> on the ACTIVE vessel, as an inventory and
/// status row keyed by <see cref="PartId"/> (the part's KSP
/// <c>flightID</c>).
///
/// <para>Distinct from <see cref="ExperimentEntry"/>:
/// <c>science.experiments</c> walks the same modules but yields one row per
/// STORED result (a module with no data produces no row), whereas
/// <c>science.instruments</c> yields one row per module whether or not it
/// holds data. It is the operability picture (deployed, inoperable,
/// rerunnable, resettable, collectable) an operator needs to decide what to run
/// next.</para>
///
/// <para>The channel payload is a BARE ARRAY (<c>InstrumentEntry[]</c>) or
/// <c>null</c> when there is no active vessel or it carries no experiment
/// module. Every field is nullable, and is <c>null</c> whenever the raw value
/// is absent.</para>
/// <internal>
/// Typing-only mirror of
/// <c>Sitrep.Host.ScienceViewProvider.BuildInstrumentEntry</c>: see
/// <see cref="ExperimentEntry"/> for the "no wire change, all fields
/// nullable" rationale.
/// </internal>
/// </summary>
/// <category>Science</category>
[SitrepContract]
[SitrepTopic("science.instruments", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class InstrumentEntry
{
    /// <summary>The part's KSP <c>flightID</c> as a string: the stable join
    /// key for this instrument. <c>null</c> when the part has no flight id yet
    /// (KSP's unset value, 0).</summary>
    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    /// <summary>Display title of the part carrying the module (the part's
    /// <c>partInfo.title</c>, or its internal name when that is
    /// missing).</summary>
    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    /// <summary>The module's experiment id (KSP's
    /// <c>ModuleScienceExperiment.experimentID</c>, for example
    /// <c>crewReport</c>).</summary>
    [SitrepUnit(Units.Id)]
    public string? ExperimentId { get; set; }

    /// <summary>The experiment's display title (KSP's
    /// <c>ScienceExperiment.experimentTitle</c>). <c>null</c> when the
    /// module's experiment definition has not resolved.</summary>
    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }

    /// <summary>Whether the experiment is deployed (KSP's
    /// <c>ModuleScienceExperiment.Deployed</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Deployed { get; set; }

    /// <summary>Whether the experiment cannot be run again until it is reset
    /// (KSP's <c>ModuleScienceExperiment.Inoperable</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Inoperable { get; set; }

    /// <summary>Whether the experiment can be run more than once without a
    /// reset (KSP's <c>ModuleScienceExperiment.rerunnable</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Rerunnable { get; set; }

    /// <summary>Whether the experiment can be reset (KSP's
    /// <c>ModuleScienceExperiment.resettable</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Resettable { get; set; }

    /// <summary>Whether a kerbal on EVA can collect the experiment's data
    /// (KSP's <c>ModuleScienceExperiment.dataIsCollectable</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? DataIsCollectable { get; set; }

    /// <summary> The provider-namespaced extension bag, instrument half. Same
    /// mechanism and same rule as <see cref="ExperimentEntry.Extensions"/>.
    /// This payload carries no number whose meaning depends on the value model
    /// (it is pure operability), so it has the bag but no <c>valueModel</c>
    /// tag.
    ///
    /// <para>Stock's operability picture is a flat pair of flags
    /// (<see cref="Deployed"/> and <see cref="Inoperable"/>). A provider that
    /// models running as a state machine with a reason ("shrouded", "no EC",
    /// "sample depleted") projects it down to those flags and carries the state
    /// and the reason here.</para>
    /// </summary>
    // AppendProviderExtensions omits the key when no provider filled a bag, so a
    // payload no provider extended carries no trace of the mechanism.
    [SitrepOmittedWhenNull]
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}

/// <summary>
/// One entry in the <c>science.lab</c> channel payload: a Mobile Processing
/// Lab (KSP's <c>ModuleScienceLab</c>) on the active vessel. The channel
/// payload is a BARE ARRAY (<c>LabEntry[]</c>) or <c>null</c> when there is no
/// active vessel or it carries no lab. Every field is nullable, and is
/// <c>null</c> whenever the raw value is absent or non-finite.
/// <internal>
/// Typing-only mirror of <c>Sitrep.Host.ScienceViewProvider.BuildLabEntry</c>:
/// see <see cref="ExperimentEntry"/> for the "no wire change, all fields
/// nullable" rationale.
/// </internal>
/// </summary>
/// <category>Science</category>
[SitrepContract]
[SitrepTopic("science.lab", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class LabEntry
{
    /// <summary>Display title of the lab part (the part's
    /// <c>partInfo.title</c>, or its internal name when that is
    /// missing).</summary>
    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    /// <summary>Data currently stored in the lab for processing, in mits
    /// (KSP's <c>ModuleScienceLab.dataStored</c>). Compare against
    /// <see cref="DataStorage"/>.</summary>
    [SitrepUnit(Units.Mits)]
    public double? DataStored { get; set; }

    /// <summary>The lab's data capacity in mits (KSP's
    /// <c>ModuleScienceLab.dataStorage</c>).</summary>
    [SitrepUnit(Units.Mits)]
    public double? DataStorage { get; set; }

    /// <summary>Science the lab has generated and is holding, not yet
    /// transmitted (KSP's <c>ModuleScienceLab.storedScience</c>).</summary>
    [SitrepUnit(Units.Science)]
    public double? StoredScience { get; set; }

    /// <summary>Whether the lab is currently processing data (KSP's
    /// <c>ModuleScienceLab.processingData</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? ProcessingData { get; set; }

    /// <summary>KSP's own status line for the lab
    /// (<c>ModuleScienceLab.statusText</c>), for display. Game-authored prose,
    /// so do not branch on it.</summary>
    [SitrepUnit(Units.Text)]
    public string? StatusText { get; set; }

    /// <summary>Number of crew with the Scientist trait aboard the lab part.
    /// <c>0</c> is a real reading: a lab with no scientist.</summary>
    [SitrepUnit(Units.Count)]
    public int? ScientistCount { get; set; }

    /// <summary>
    /// Science generated per GAME-DAY, not per second, at the lab's current
    /// stored data (KSP's <c>ModuleScienceConverter.CalculateScienceRate</c>,
    /// which scales the per-tick rate to a full day). <c>null</c> when the lab
    /// has no converter or the rate could not be read.
    /// </summary>
    [SitrepUnit(Units.SciencePerDay)]
    public double? ScienceRate { get; set; }

    /// <summary>Whether the lab can operate right now (KSP's
    /// <c>ModuleScienceLab.IsOperational()</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? IsOperational { get; set; }

    /// <summary>
    /// Which value model produced <see cref="ScienceRate"/> and
    /// <see cref="StoredScience"/>, and which unit <see cref="DataStored"/>
    /// and <see cref="DataStorage"/> are really in. See
    /// <see cref="ScienceValueModels"/>.
    ///
    /// <para>A lab is not the same kind of thing under every model. Stock's is
    /// terminal: it turns stored data into science per game-day. A provider
    /// whose lab is an intermediate pipeline stage (analysing a sample into a
    /// transmissible file, which then still has to be sent) produces no science
    /// itself, leaves <see cref="ScienceRate"/> null, and carries its own rate
    /// in <see cref="Extensions"/>. This tag is what tells that null apart from
    /// an idle lab.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? ValueModel { get; set; }

    /// <summary>
    /// The provider-namespaced extension bag, lab half. Same mechanism and same
    /// rule as <see cref="ExperimentEntry.Extensions"/>.
    /// </summary>
    // AppendProviderExtensions omits the key when no provider filled a bag, so a
    // payload no provider extended carries no trace of the mechanism.
    [SitrepOmittedWhenNull]
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}

/// <summary> One entry in the <c>deployed.bases</c> channel payload: a
/// Breaking Ground deployed-science experiment
/// (<c>ModuleGroundExperiment</c>). The channel payload is a BARE ARRAY
/// (<c>DeployedEntry[]</c>) or <c>null</c> when no loaded vessel carries a
/// deployed experiment (including an install without Breaking Ground).
///
/// <para>Unlike the <c>science.*</c> channels, <c>deployed.bases</c> covers
/// every LOADED vessel, not just the active one: a deployed cluster is its own
/// ground vessel, so an entry normally describes a vessel other than the
/// active one, named by <see cref="VesselName"/>. A cluster whose vessel is not
/// loaded does not appear.</para>
///
/// <para>Every field is nullable, and is <c>null</c> whenever the raw value is
/// absent or could not be read.</para>
/// <internal>
/// Typing-only mirror of
/// <c>Sitrep.Host.BreakingGroundViewProvider.BuildDeployedEntry</c>; see
/// <see cref="ExperimentEntry"/> for the "no wire change, all fields
/// nullable" rationale. Every module member is read by reflection, which is
/// why an absent member is a null field rather than a failure.
/// </internal>
/// </summary>
/// <category>Science</category>
[SitrepContract]
[SitrepTopic("deployed.bases", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class DeployedEntry
{
    /// <summary>Name of the vessel carrying the experiment (KSP's
    /// <c>Vessel.vesselName</c>). A deployed cluster is its own vessel, so
    /// this is normally not the active vessel's name.</summary>
    [SitrepUnit(Units.Text)]
    public string? VesselName { get; set; }

    /// <summary>Display title of the experiment part (the part's
    /// <c>partInfo.title</c>, or its internal name when that is
    /// missing).</summary>
    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    /// <summary>Name of the body the carrying vessel orbits or sits on (its
    /// orbit's reference body). <c>null</c> when the vessel has no
    /// orbit.</summary>
    [SitrepUnit(Units.Text)]
    public string? Body { get; set; }

    /// <summary>The carrying vessel's situation, KSP's
    /// <c>Vessel.situation</c> enum name (for example
    /// <c>LANDED</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string? Situation { get; set; }

    /// <summary>Biome at the carrying vessel's current position on
    /// <see cref="Body"/>. <c>null</c> when the body has no biome
    /// map.</summary>
    [SitrepUnit(Units.Text)]
    public string? Biome { get; set; }

    /// <summary>The experiment's id (KSP's
    /// <c>ModuleGroundExperiment.experimentId</c>).</summary>
    [SitrepUnit(Units.Id)]
    public string? ExperimentId { get; set; }

    /// <summary>How far the experiment has progressed, in percent (KSP's
    /// <c>ModuleGroundExperiment.ScienceCompletedPercentage</c>).</summary>
    [SitrepUnit(Units.Percent)]
    public double? ScienceCompletedPercentage { get; set; }

    /// <summary>How much of the experiment's science has been transmitted, in
    /// percent (KSP's
    /// <c>ModuleGroundExperiment.ScienceTransmittedPercentage</c>).</summary>
    [SitrepUnit(Units.Percent)]
    public double? ScienceTransmittedPercentage { get; set; }

    /// <summary>The science value KSP reports for the experiment
    /// (<c>ModuleGroundExperiment.ScienceValue</c>).</summary>
    [SitrepUnit(Units.Science)]
    public double? ScienceValue { get; set; }

    /// <summary>The experiment's science limit as KSP reports it
    /// (<c>ModuleGroundExperiment.ScienceLimit</c>). Compare against
    /// <see cref="ScienceValue"/>.</summary>
    [SitrepUnit(Units.Science)]
    public double? ScienceLimit { get; set; }

    /// <summary>
    /// <c>ModuleGroundSciencePart.PowerState</c> verbatim: KSP's own words for
    /// the power state, for display. Do not branch on this.
    ///
    /// <para>It is not an enum name, it is localised prose. The module assigns
    /// it from <c>Localizer</c> in <c>UpdateModuleUI()</c>, so the value is in
    /// whatever language the player runs KSP in, and it is only written when
    /// the part action window refreshes, so it can be a held value.
    /// <see cref="Power"/> is the field to read.</para>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? PowerState { get; set; }

    /// <summary>
    /// <c>ModuleGroundSciencePart.ConnectionState</c> verbatim, for display.
    /// Localised prose on the same terms as <see cref="PowerState"/>; read
    /// <see cref="ControllerConnected"/> instead.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? ConnectionState { get; set; }

    /// <summary>
    /// The cluster's power state, derived from the same facts
    /// <c>UpdateModuleUI()</c> itself branches on
    /// (<c>DeployedScienceCluster.IsPowered</c> and
    /// <c>.ControllerPartEnabled</c>, the module's <c>Enabled</c> and
    /// <c>DeployedOnGround</c>) rather than parsed out of the sentence that
    /// method writes. This is the field to branch on, not
    /// <see cref="PowerState"/>.
    ///
    /// <para><c>null</c> when the cluster could not be read at all, which is a
    /// third state and must not be read as either powered or unpowered.</para>
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public DeployedPowerState? Power { get; set; }

    /// <summary>
    /// Whether the experiment is attached to a controller cluster at all, the
    /// fact behind <see cref="ConnectionState"/>'s "Connected"/"Not Connected".
    /// <c>null</c> when it could not be determined.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? ControllerConnected { get; set; }

    /// <summary>
    /// Power units the cluster's parts PRODUCE
    /// (<c>DeployedScienceCluster.PowerAvailable</c>), against
    /// <see cref="PowerRequired"/>. Breaking Ground's own integral power scale
    /// summed over the cluster's parts: NOT electric charge, and not a rate.
    /// Available at or above required is what makes the cluster powered.
    ///
    /// <para><c>null</c> when the cluster could not be read, on the same terms
    /// as <see cref="Power"/>. Zero is a real reading a live cluster holds
    /// while its panels are dark, so it must not stand in for absence.</para>
    /// <internal>
    /// Read off the same cluster object <c>DerivePowerState</c> already
    /// resolves through <c>ScienceClusterData</c>, so this costs no extra
    /// reflection hop.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? PowerAvailable { get; set; }

    /// <summary>
    /// Power units the cluster's parts REQUIRE
    /// (<c>DeployedScienceCluster.PowerRequired</c>). Same scale and same null
    /// rule as <see cref="PowerAvailable"/>, the demand side of the balance.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? PowerRequired { get; set; }

    /// <summary>Whether the experiment part is deployed on the ground (KSP's
    /// <c>ModuleGroundSciencePart.DeployedOnGround</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? DeployedOnGround { get; set; }
}

/// <summary>
/// A deployed-science cluster's power state, defined by this contract rather
/// than by KSP.
///
/// <para>KSP has no enum for this. <c>ModuleGroundSciencePart</c> carries the
/// state as a localised sentence, so this reproduces the five outcomes
/// <c>UpdateModuleUI()</c> distinguishes, derived from the booleans it reads
/// rather than from the sentence it writes. It is an ordinal on the wire and a
/// closed union on the client like every other enum in this contract.</para>
/// <internal>
/// Being ours, it needs no mirror test: nobody else owns its numbering.
/// </internal>
/// </summary>
/// <category>Science</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum DeployedPowerState
{
    /// <summary>Powered and working: the cluster reports
    /// <c>IsPowered</c>.</summary>
    Powered,

    /// <summary>Deployed and switched on, but the cluster has no power.</summary>
    Unpowered,

    /// <summary>The cluster's CONTROLLER is switched off, so nothing is
    /// powered.</summary>
    ControllerDisabled,

    /// <summary>This experiment is switched off, or is not deployed on the
    /// ground.</summary>
    Disabled,

    /// <summary>
    /// Attached to no cluster at all. Distinct from <see cref="Unpowered"/>:
    /// there is nothing to supply power, rather than a supply that is empty.
    /// </summary>
    NotConnected,
}

/// <summary>
/// One entry in the <c>science.sensors</c> channel payload: a single
/// environmental-sensor module (<c>ModuleEnviroSensor</c>: thermometer,
/// barometer, gravioli detector, accelerometer, and any modded sensor
/// sharing the module) on the ACTIVE vessel. The channel payload is a BARE
/// ARRAY (<c>SensorEntry[]</c>) or <c>null</c> when there is no active vessel
/// or it carries no sensor module.
///
/// <para>One entry per sensor module, with <see cref="Type"/> carrying the raw
/// <c>SensorType</c> enum name (<c>TEMP</c>/<c>PRES</c>/<c>GRAV</c>/<c>ACC</c>/...)
/// as a string, so modded sensor types and several instances of the same type
/// each get their own row. Group and label by <see cref="Type"/>.</para>
///
/// <para>Every field is nullable, and is <c>null</c> whenever the raw value is
/// absent.</para>
/// <internal>
/// Typing-only mirror of
/// <c>Sitrep.Host.ScienceViewProvider.BuildSensorEntry</c>: see
/// <see cref="ExperimentEntry"/> for the "no wire change, all fields nullable"
/// rationale.
/// </internal>
/// </summary>
/// <category>Science</category>
[SitrepContract]
[SitrepTopic("science.sensors", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SensorEntry
{
    /// <summary>Flight-scoped <c>part.flightID</c> as a string (null when it
    /// is KSP's unset value, 0), the join key that tells symmetric same-named
    /// sensor parts apart.</summary>
    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    /// <summary>Display title of the sensor part (the part's
    /// <c>partInfo.title</c>, or its internal name when that is
    /// missing).</summary>
    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    /// <summary>The raw <c>SensorType</c> enum name
    /// (<c>TEMP</c>/<c>PRES</c>/<c>GRAV</c>/<c>ACC</c>/...) passed through as a
    /// string so modded types survive.</summary>
    [SitrepUnit(Units.Id)]
    public string? Type { get; set; }

    /// <summary>The sensor's current human-readable readout string (KSP's
    /// <c>readoutInfo</c>, e.g. "293.1K" or "Off").</summary>
    [SitrepUnit(Units.Text)]
    public string? Readout { get; set; }

    /// <summary>Whether the sensor is switched on (KSP's
    /// <c>ModuleEnviroSensor.sensorActive</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Active { get; set; }
}

/// <summary>
/// One entry in the <c>science.experimentBreakdown</c> channel payload: a
/// per-SUBJECT rollup of the stored science results that
/// <c>science.experiments</c> lists one row per result. One row per distinct
/// subject id: several stored results for the same subject (for example two
/// crew reports from the same biome) collapse into one entry with
/// <see cref="DataMits"/> summed across them.
///
/// <para>The channel payload is a BARE ARRAY
/// (<c>ExperimentBreakdownEntry[]</c>) or <c>null</c>, never a wrapper object.
/// The whole array is <c>null</c> when there is no active vessel or the vessel
/// holds no stored science data; there is no separate empty-array state.
/// Every field is nullable, and is <c>null</c> whenever the raw value is
/// absent or non-finite.</para>
///
/// <para><see cref="Biome"/> and <see cref="Situation"/> are parsed from the
/// subject id by KSP's <c>ScienceUtil.GetExperimentFieldsFromScienceID</c>,
/// not from the vessel's current position, so a subject collected earlier in
/// the flight keeps its own biome and situation.</para>
/// <internal>
/// Typing-only mirror of
/// <c>Sitrep.Host.ScienceViewProvider.BuildExperimentBreakdownEntry</c>: see
/// <see cref="ExperimentEntry"/> for the "no wire change, all fields nullable"
/// rationale.
/// </internal>
/// </summary>
/// <category>Science</category>
[SitrepContract]
[SitrepTopic("science.experimentBreakdown", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ExperimentBreakdownEntry
{
    /// <summary>The science subject id this row rolls up (KSP's
    /// <c>ScienceData.subjectID</c>), unique within the array. Joins to
    /// <see cref="ExperimentEntry.SubjectId"/> and
    /// <see cref="ArchiveEntry.SubjectId"/>.</summary>
    [SitrepUnit(Units.Id)]
    public string? SubjectId { get; set; }

    /// <summary>The biome part of <see cref="SubjectId"/>: where the subject
    /// was collected, not where the vessel is now.</summary>
    [SitrepUnit(Units.Text)]
    public string? Biome { get; set; }

    /// <summary>The situation part of <see cref="SubjectId"/> (a KSP
    /// <c>ExperimentSituations</c> name such as <c>SrfLanded</c>): the
    /// situation the subject was collected in, not the vessel's current
    /// one.</summary>
    [SitrepUnit(Units.Text)]
    public string? Situation { get; set; }

    /// <summary>Display title of the first stored result seen for this
    /// subject (KSP's <c>ScienceData.title</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string? ExpTitle { get; set; }

    /// <summary>Summed <c>ScienceData.dataAmount</c> (mits) across every stored
    /// result for this subject.</summary>
    [SitrepUnit(Units.Mits)]
    public double? DataMits { get; set; }

    /// <summary>Absolute science still recoverable from this subject
    /// (<c>scienceCap - science</c> from R&amp;D). <c>0</c> in Sandbox (no
    /// R&amp;D) and when R&amp;D holds no subject with this id.</summary>
    [SitrepUnit(Units.Science)]
    public double? RemainingPotential { get; set; }

    /// <summary> Which value model produced <see cref="RemainingPotential"/>,
    /// and which unit <see cref="DataMits"/> is really in. See <see
    /// cref="ScienceValueModels"/>.
    ///
    /// <para>Stock's rollup is a snapshot: one summed data figure and one "how
    /// much is left". A provider with a full per-subject ledger (collected vs
    /// retrieved, in-flight split, times completed) projects it down to those
    /// two and carries the ledger in <see cref="Extensions"/>: stock's pair is
    /// a lossy view of the richer set, never the other way round.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? ValueModel { get; set; }

    /// <summary>
    /// The provider-namespaced extension bag, per-subject-rollup half. Same
    /// mechanism and same rule as <see cref="ExperimentEntry.Extensions"/>.
    /// </summary>
    // AppendProviderExtensions omits the key when no provider filled a bag, so a
    // payload no provider extended carries no trace of the mechanism.
    [SitrepOmittedWhenNull]
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}

/// <summary>
/// One entry in the <c>science.archive</c> channel payload: a single SUBJECT
/// out of the whole-career R&amp;D archive
/// (<c>ResearchAndDevelopment.GetSubjects()</c>). That is every subject the
/// career has ever collected or recovered, across every mission and every
/// body, not scoped to the active vessel.
///
/// <para>The channel payload is a BARE ARRAY (<c>ArchiveEntry[]</c>), or
/// <c>null</c> when the save has no R&amp;D to walk (Sandbox mode). A save
/// with R&amp;D but nothing collected yet emits an EMPTY array, so an empty
/// array and <c>null</c> mean different things here.</para>
///
/// <para>Distinct from <see cref="ExperimentBreakdownEntry"/>: that one rolls
/// up the ACTIVE VESSEL's currently stored results and is null with no vessel
/// flying; this one is career-wide and streams at the Space Center with
/// nothing flying at all.</para>
/// <internal>
/// Typing-only mirror of
/// <c>Sitrep.Host.ScienceViewProvider.BuildArchiveEntry</c>: see
/// <see cref="ExperimentEntry"/> for the "no wire change, all fields
/// nullable" rationale. <see cref="RemainingPotential"/> is computed by
/// <c>Gonogo.KSP.KspHost.BuildScienceArchive</c> the same way
/// <see cref="ExperimentBreakdownEntry.RemainingPotential"/> is, and this
/// layer only passes it through.
/// </internal>
/// </summary>
/// <category>Science</category>
[SitrepContract]
[SitrepTopic("science.archive", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ArchiveEntry
{
    /// <summary>The subject's id (KSP's <c>ScienceSubject.id</c>, in the form
    /// <c>experimentId@BodySituationBiome</c>), unique within the array. Joins
    /// to <see cref="ExperimentEntry.SubjectId"/> and
    /// <see cref="ExperimentBreakdownEntry.SubjectId"/>.</summary>
    [SitrepUnit(Units.Id)]
    public string? SubjectId { get; set; }

    /// <summary>The experiment id: the part of <see cref="SubjectId"/> before
    /// the <c>@</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string? ExperimentId { get; set; }

    /// <summary>The experiment's display title from R&amp;D. Falls back to
    /// <see cref="ExperimentId"/> when the experiment is no longer defined (for
    /// example a modded experiment that has been uninstalled).</summary>
    [SitrepUnit(Units.Text)]
    public string? ExperimentTitle { get; set; }

    /// <summary>The body the subject belongs to, parsed from
    /// <see cref="SubjectId"/> by KSP's
    /// <c>ScienceUtil.GetExperimentBodyName</c>.</summary>
    [SitrepUnit(Units.Text)]
    public string? Body { get; set; }

    /// <summary>The situation part of <see cref="SubjectId"/> (a KSP
    /// <c>ExperimentSituations</c> name such as
    /// <c>SrfLanded</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string? Situation { get; set; }

    /// <summary>The biome part of <see cref="SubjectId"/>.</summary>
    [SitrepUnit(Units.Text)]
    public string? Biome { get; set; }

    /// <summary>The subject's display title (KSP's
    /// <c>ScienceSubject.title</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }

    /// <summary>Science banked for this subject so far.</summary>
    [SitrepUnit(Units.Science)]
    public double? Science { get; set; }

    /// <summary>Max science this subject can ever yield.</summary>
    [SitrepUnit(Units.Science)]
    public double? ScienceCap { get; set; }

    /// <summary>Absolute science still recoverable from this subject
    /// (<c>scienceCap - science</c>).</summary>
    [SitrepUnit(Units.Science)]
    public double? RemainingPotential { get; set; }

    /// <summary>Region multiplier KSP applies to this subject's yield.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? SubjectValue { get; set; }
}
