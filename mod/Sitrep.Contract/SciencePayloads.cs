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
/// <c>scienceValueRatio</c> with another's gets a wrong answer with no error. The tag says
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

/// <summary> One entry in the <c>science.experiments</c> Topic payload: a
/// single stored science result on the active vessel, held either by the
/// science module that collected it or by a container part. The channel
/// payload is a bare array of these (<c>ExperimentEntry[]</c>) or <c>null</c>,
/// never a wrapper object. The whole array is <c>null</c> when there is no
/// active vessel or the vessel holds no stored science data; there is no
/// separate empty-array state.
///
/// <para>One row per stored <c>ScienceData</c>: a module that holds no data
/// produces no row (see <see cref="InstrumentEntry"/> for one row per module).
/// Every field is nullable, and is <c>null</c> whenever the raw value is
/// absent or non-finite.</para>
/// <internal>
/// What <c>Sitrep.Host.ScienceViewProvider.BuildExperimentEntry</c> returns and
/// <c>JsonWriter</c> writes: the camelCase wire keys of
/// <c>RtConfig.CamelCaseForProperties</c>, in the order the wire has always
/// carried them, with the same units. Every field is nullable because each is
/// read through <c>SnapshotDict.Get*</c>, which yields <c>null</c> (not a
/// sentinel) whenever the raw value is absent or non-finite, and the wire text
/// is held by <c>Sitrep.Host.Tests.ScienceWireGoldenTests</c> (the "no wire
/// change, all fields nullable" rationale the sibling types point to).
/// </internal>
/// </summary>
/// <category>Science</category>
/// <categoryDescription>
/// Science aboard a craft and on the ground: stored results and the instruments
/// that take them, labs, sensors, deployed surface experiments, results being
/// transmitted, and the archive of every subject the career has studied.
/// </categoryDescription>
[SitrepContract]
[SitrepTopic("science.experiments", isArray: true, DisplayName = "Science experiments")]
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

    /// <summary>The active vessel's current situation, KSP's
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
    /// option.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? ValueModel { get; set; }

    /// <summary>
    /// Per-experiment facts the science mod in use reports beyond this shape,
    /// keyed by that mod's name.
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
/// One entry in the <c>science.instruments</c> Topic payload: a single
/// <c>ModuleScienceExperiment</c> on the active vessel, as an inventory and
/// status row keyed by <see cref="PartId"/> (the part's flight id, a number the
/// game assigns each part of a flight, written as a string).
///
/// <para>Distinct from <see cref="ExperimentEntry"/>:
/// <c>science.experiments</c> walks the same modules but yields one row per
/// stored result (a module with no data produces no row), whereas
/// <c>science.instruments</c> yields one row per module whether or not it
/// holds data. It is the operability picture (deployed, inoperable,
/// rerunnable, resettable, collectable) an operator needs to decide what to run
/// next.</para>
///
/// <para>The Topic payload is a bare array (<c>InstrumentEntry[]</c>) or
/// <c>null</c> when there is no active vessel or it carries no experiment
/// module. Every field is nullable, and is <c>null</c> whenever the raw value
/// is absent.</para>
/// <internal>
/// What <c>Sitrep.Host.ScienceViewProvider.BuildInstrumentEntry</c> returns: see
/// <see cref="ExperimentEntry"/> for the "no wire change, all fields
/// nullable" rationale.
/// </internal>
/// </summary>
/// <category>Science</category>
[SitrepContract]
[SitrepTopic("science.instruments", isArray: true, DisplayName = "Science instruments")]
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

    /// <summary>The experiment's own display title (KSP's
    /// <c>ScienceExperiment.experimentTitle</c>, or the providing mod's title
    /// for the experiment). Never the part's title: several experiments on one
    /// part have different titles. <c>null</c> when the experiment definition
    /// has not resolved, and a client then names the experiment by
    /// <c>experimentId</c>.</summary>
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
    /// reset (KSP's <c>ModuleScienceExperiment.rerunnable</c>). <c>null</c>
    /// when the providing mod has no such notion, which is neither answer: a
    /// client does not present it as a one-shot experiment.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Rerunnable { get; set; }

    /// <summary>Whether the experiment can be reset (KSP's
    /// <c>ModuleScienceExperiment.resettable</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Resettable { get; set; }

    /// <summary>Whether a kerbal on EVA can take the experiment's data out of
    /// the part (KSP's <c>ModuleScienceExperiment.dataIsCollectable</c>). A
    /// part-config setting that says nothing about whether data is stored now:
    /// see <see cref="HoldsData"/>.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? DataIsCollectable { get; set; }

    /// <summary>Whether the experiment module stores data right now, from at
    /// least one result being held (KSP's
    /// <c>ModuleScienceExperiment.GetData()</c> is not empty). This, not
    /// <see cref="DataIsCollectable"/>, is what a client branches on to offer
    /// transmitting the data. <c>null</c> where the module's store could not be
    /// read.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? HoldsData { get; set; }

    /// <summary>
    /// Whether the instrument runs over time once switched on, rather than
    /// being deployed once. A continuous instrument has no deploy or transmit:
    /// it is started and stopped with <c>science.experiment.start</c> and
    /// <c>science.experiment.stop</c>, and its <see cref="Deployed"/> is
    /// <c>null</c>. Stock writes <c>false</c> for every experiment. <c>null</c>
    /// is the one-shot model, so a provider that never sets it changes
    /// nothing.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Continuous { get; set; }

    /// <summary>
    /// Whether a continuous instrument is switched on, whether or not it is
    /// producing right now. <c>null</c> on an instrument that is not
    /// continuous or whose state is unknown, which is neither answer: a client
    /// then offers neither Start nor Stop.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Running { get; set; }

    /// <summary>
    /// Whether a continuous instrument is generating science right now. An
    /// instrument can be <see cref="Running"/> and not producing, for example
    /// with no electric charge or with its subject exhausted, so this is the
    /// field a client branches on to tell a working instrument from an idle
    /// one. <c>null</c> where the provider cannot say.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Producing { get; set; }

    /// <summary>
    /// Why a switched-on instrument is not producing, in the provider's own
    /// words, for display. <c>null</c> when nothing is in the way. Prose in
    /// the game's language, so never branch on it, and never a signal or
    /// return fact: it answers why nothing is being generated, not why
    /// nothing is arriving home.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? RunIssue { get; set; }

    /// <summary>
    /// The science subject this instrument would record against if run now,
    /// from its experiment and the vessel's current situation, body and biome
    /// (the id <see cref="ArchiveEntry.SubjectId"/> lists it under). <c>null</c>
    /// where the experiment cannot run in the vessel's current situation, where
    /// the save has no R&amp;D (Sandbox), or where the experiment definition has
    /// not resolved.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? SubjectId { get; set; }

    /// <summary>
    /// Science banked for <see cref="SubjectId"/> so far. <c>0</c> when the
    /// career has not yet recovered or transmitted that subject. <c>null</c>
    /// whenever <see cref="SubjectId"/> is.
    /// </summary>
    [SitrepUnit(Units.Science)]
    public double? Science { get; set; }

    /// <summary>
    /// The most science <see cref="SubjectId"/> can ever yield.
    /// <see cref="Science"/> over this is how much of what the instrument can
    /// give here has been collected. <c>null</c> whenever
    /// <see cref="SubjectId"/> is.
    /// </summary>
    [SitrepUnit(Units.Science)]
    public double? ScienceCap { get; set; }

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
/// One entry in the <c>science.lab</c> Topic payload: a Mobile Processing
/// Lab (KSP's <c>ModuleScienceLab</c>) on the active vessel. The channel
/// payload is a bare array (<c>LabEntry[]</c>) or <c>null</c> when there is no
/// active vessel or it carries no lab. Every field is nullable, and is
/// <c>null</c> whenever the raw value is absent or non-finite.
/// <internal>
/// What <c>Sitrep.Host.ScienceViewProvider.BuildLabEntry</c> returns: see <see cref="ExperimentEntry"/> for the "no wire change, all fields
/// nullable" rationale.
/// </internal>
/// </summary>
/// <category>Science</category>
[SitrepContract]
[SitrepTopic("science.lab", isArray: true, DisplayName = "Science lab")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class LabEntry
{
    /// <summary>The part's KSP <c>flightID</c> as a string: the stable join
    /// key for this lab, and what tells one lab from another across samples.
    /// <c>null</c> when the part has no flight id yet (KSP's unset value,
    /// 0).</summary>
    [SitrepUnit(Units.Id)]
    [SitrepEntryKey]
    public string? PartId { get; set; }

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
    [SitrepSampleKind(SampleKind.Discrete)]
    public double? DataStorage { get; set; }

    /// <summary>Science the lab has generated and is holding, not yet
    /// transmitted (KSP's <c>ModuleScienceLab.storedScience</c>). While the lab
    /// is processing it grows at <see cref="ScienceRate"/> up to
    /// <see cref="ScienceCap"/>, so a model carries it forward from there; a
    /// lab that is not processing holds it exactly as observed.</summary>
    [SitrepUnit(Units.Science)]
    [SitrepReckonable(ReckoningBases.RateIntegration, "scienceRate", "scienceCap")]
    public double? StoredScience { get; set; }

    /// <summary>The most science the lab holds: generation stops once
    /// <see cref="StoredScience"/> reaches it (KSP's
    /// <c>ModuleScienceConverter.scienceCap</c>). <c>null</c> when the lab has
    /// no converter or it could not be read.</summary>
    [SitrepUnit(Units.Science)]
    public double? ScienceCap { get; set; }

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
    /// Science generated per game day, not per second, at the lab's current
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
    /// Whether the lab's research is switched on (KSP's
    /// <c>BaseConverter.IsActivated</c> on the lab's converter), whether or
    /// not it is producing. <see cref="ProcessingData"/> is not this: it
    /// means a data transfer into the lab is in progress. <c>null</c> when the
    /// lab has no converter or it could not be read. Switched with
    /// <c>science.lab.start</c> and <c>science.lab.stop</c>.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Running { get; set; }

    /// <summary>
    /// Whether the lab is turning stored data into science right now: switched
    /// on, operational, holding data and below its science cap. <c>null</c>
    /// where it could not be read.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Producing { get; set; }

    /// <summary>
    /// Why a switched-on lab is not producing, in the game's own words, for
    /// display. <c>null</c> when nothing is in the way. Never branch on it.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? RunIssue { get; set; }

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

/// <summary>
/// One Breaking Ground deployed-science station on
/// <c>deployed.station.&lt;controllerVesselId&gt;.report</c>: the cluster a control
/// unit runs, its power, whether its science has a path home, and each
/// experiment it carries. The key is the id of the cluster's controller vessel,
/// the same guid its <c>trackingStation.catalog</c> entry carries (type
/// <c>DeployedScienceController</c>), so a client finds every station by
/// listing that catalog.
///
/// <para>Delayed and frozen on the station's own link, not the active craft's:
/// the controller is its own vessel with its own path home, so a station out of
/// contact holds its last-known reading while the others, and the craft being
/// flown, carry on. The reading's own age says when the station was last
/// heard. A station whose controller vessel cannot be placed has no topic.</para>
///
/// <para>Every field is nullable, and is <c>null</c> whenever the raw value is
/// absent or could not be read. A backlog is each experiment's
/// <see cref="DeployedStationExperiment.StoredData"/>; whether it can get home is
/// <see cref="SendPathHome"/>.</para>
/// <internal>
/// Typing-only mirror of
/// <c>Sitrep.Host.BreakingGroundViewProvider.BuildDeployedStation</c>; the wire is
/// written by walking its dictionary. Only the controller vessel carries a
/// CommNet connection, the experiment vessels (type
/// <c>DeployedSciencePart</c>) have none, which is why the link is the
/// controller's.
/// </internal>
/// </summary>
/// <category>Science</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class DeployedStation
{
    /// <summary>Name of the controller vessel (KSP's <c>Vessel.vesselName</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string? StationName { get; set; }

    /// <summary>Name of the body the cluster is deployed on (<c>DeployedScienceCluster.DeployedBody</c>), or of the controller's orbit's reference body when the cluster does not name one.</summary>
    [SitrepUnit(Units.Text)]
    public string? Body { get; set; }

    /// <summary>The controller vessel's situation, KSP's <c>Vessel.situation</c> enum name (for example <c>LANDED</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string? Situation { get; set; }

    /// <summary>Biome at the controller vessel's position on <see cref="Body"/>. <c>null</c> when the body has no biome map.</summary>
    [SitrepUnit(Units.Text)]
    public string? Biome { get; set; }

    /// <summary>
    /// The cluster's power state, derived from the facts the game's own readout
    /// branches on rather than from its localised sentence.
    ///
    /// <para><c>null</c> when the cluster could not be read at all, which is a
    /// third state and must not be read as either powered or unpowered.</para>
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public DeployedPowerState? Power { get; set; }

    /// <summary>
    /// Power units the cluster's parts produce
    /// (<c>DeployedScienceCluster.PowerAvailable</c>), against
    /// <see cref="PowerRequired"/>. Breaking Ground's own integral power scale
    /// summed over the cluster's parts: not electric charge, and not a rate.
    /// Available at or above required is what makes the cluster powered.
    ///
    /// <para><c>null</c> when the cluster could not be read. Zero is a real
    /// reading a live cluster holds while its panels are dark, so it must not
    /// stand in for absence.</para>
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? PowerAvailable { get; set; }

    /// <summary>Power units the cluster's parts require (<c>DeployedScienceCluster.PowerRequired</c>). Same scale and same null rule as <see cref="PowerAvailable"/>.</summary>
    [SitrepUnit(Units.Count)]
    public int? PowerRequired { get; set; }

    /// <summary>
    /// Whether the controller has a path home that can carry science, by the
    /// rule the game applies when an experiment sends: a connection with signal
    /// and a last hop to a home command centre. Always <c>true</c> in a save with
    /// no CommNet. <c>null</c> when the controller's link could not be read.
    ///
    /// <para>This is the figure at the sample's own time. A station that has since
    /// lost its path stops updating, so read how old the reading is before trusting
    /// a <c>true</c>.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? SendPathHome { get; set; }

    /// <summary>
    /// Whether the cluster's last attempt to send its science home failed
    /// (<c>DeployedScienceCluster.DataSendFailed</c>). <c>null</c> when it
    /// could not be read.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? DataSendFailed { get; set; }

    /// <summary>Every experiment in the cluster, in the cluster's part order. Never null on a published station; an empty list is a cluster with no experiment attached.</summary>
    public List<DeployedStationExperiment> Experiments { get; set; } = new();
}

/// <summary>
/// One experiment of a <see cref="DeployedStation"/>: a science instrument set
/// down on the surface, with how far it has progressed and how much data it is
/// holding that has not yet been sent home.
/// </summary>
/// <category>Science</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class DeployedStationExperiment
{
    /// <summary>Display title of the experiment part (the part's <c>partInfo.title</c>, or its internal name when that is missing).</summary>
    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    /// <summary>The experiment's id (<c>DeployedScienceExperiment.ExperimentId</c>).</summary>
    [SitrepUnit(Units.Id)]
    public string? ExperimentId { get; set; }

    /// <summary>How far the experiment has progressed, in percent of its science limit.</summary>
    [SitrepUnit(Units.Percent)]
    public double? ScienceCompletedPercentage { get; set; }

    /// <summary>How much of the experiment's science has been transmitted, in percent of its science limit.</summary>
    [SitrepUnit(Units.Percent)]
    public double? ScienceTransmittedPercentage { get; set; }

    /// <summary>The science value the experiment reports (<c>DeployedScienceExperiment.ScienceValue</c>).</summary>
    [SitrepUnit(Units.Science)]
    public double? ScienceValue { get; set; }

    /// <summary>The experiment's science limit. Compare against <see cref="ScienceValue"/>.</summary>
    [SitrepUnit(Units.Science)]
    public double? ScienceLimit { get; set; }

    /// <summary>
    /// Data the experiment holds that has not been transmitted
    /// (<c>DeployedScienceExperiment.StoredScienceData</c>): the backlog waiting
    /// for a path home. <c>null</c> when it could not be read, and zero is a real
    /// empty store.
    /// </summary>
    [SitrepUnit(Units.Mits)]
    public double? StoredData { get; set; }

    /// <summary>
    /// Whether the experiment has reached its science limit with data still
    /// stored. An experiment switches itself off at its limit and never sends
    /// again, so what it still holds then stays until a kerbal retrieves it,
    /// whether or not the station has a path home. <c>false</c> while the
    /// experiment is still collecting, or when its store is empty. <c>null</c>
    /// when its completion or its store could not be read.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Stranded { get; set; }

    /// <summary>Whether the experiment part is deployed on the ground (<c>DeployedSciencePart.DeployedOnGround</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? DeployedOnGround { get; set; }

    /// <summary>
    /// Whether the experiment is switched on (<c>DeployedSciencePart.Enabled</c>).
    /// An experiment that is off collects and sends nothing. Off is not always
    /// somebody's switch: the game also turns an experiment off by itself, see
    /// <see cref="OffReason"/>.
    ///
    /// <para>Read for a cluster whether or not its vessel is loaded. <c>null</c>
    /// when it could not be read, which is a third state and must not be shown
    /// as off.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Enabled { get; set; }

    /// <summary>
    /// Why the experiment is off, where the game's own state says. <c>null</c>
    /// whenever the experiment is on, or <see cref="Enabled"/> could not be read.
    /// <see cref="DeployedOffReason.Unknown"/> is an experiment that is off with
    /// no automatic cause to be found, and it does not say who or what turned it
    /// off.
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public DeployedOffReason? OffReason { get; set; }
}

/// <summary>
/// Why a deployed experiment is switched off, defined by this contract rather
/// than by KSP.
///
/// <para>KSP stores only the off state. The two automatic shut-offs are told
/// apart from the facts each one tests: an experiment switches itself off when
/// its situation is no longer valid for the experiment, and when it has
/// generated all the science it can. It is an ordinal on the wire and a closed
/// union on the client like every other enum in this contract.</para>
/// <internal>
/// Being ours, it needs no mirror test: nobody else owns its numbering.
/// </internal>
/// </summary>
/// <category>Science</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum DeployedOffReason
{
    /// <summary>The experiment has generated all the science it can and the game switched it off.</summary>
    Completed,

    /// <summary>The experiment's situation is not one it can run in and the game switched it off.</summary>
    InvalidSituation,

    /// <summary>Off, with neither automatic cause present.</summary>
    Unknown,
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

    /// <summary>The cluster's controller is switched off, so nothing is
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
/// One entry in the <c>science.sensors</c> Topic payload: a single
/// environmental-sensor module (<c>ModuleEnviroSensor</c>: thermometer,
/// barometer, gravioli detector, accelerometer, and any modded sensor
/// sharing the module) on the active vessel. The Topic payload is a bare
/// array (<c>SensorEntry[]</c>) or <c>null</c> when there is no active vessel
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
/// What <c>Sitrep.Host.ScienceViewProvider.BuildSensorEntry</c> returns: see
/// <see cref="ExperimentEntry"/> for the "no wire change, all fields nullable"
/// rationale.
/// </internal>
/// </summary>
/// <category>Science</category>
[SitrepContract]
[SitrepTopic("science.sensors", isArray: true, DisplayName = "Science sensors")]
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
/// One entry in the <c>science.experimentBreakdown</c> Topic payload: a
/// per-subject rollup of the stored science results that
/// <c>science.experiments</c> lists one row per result. One row per distinct
/// subject id: several stored results for the same subject (for example two
/// crew reports from the same biome) collapse into one entry with
/// <see cref="DataMits"/> summed across them.
///
/// <para>The Topic payload is a bare array
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
/// What <c>Sitrep.Host.ScienceViewProvider.BuildExperimentBreakdownEntry</c> returns: see
/// <see cref="ExperimentEntry"/> for the "no wire change, all fields nullable"
/// rationale.
/// </internal>
/// </summary>
/// <category>Science</category>
[SitrepContract]
[SitrepTopic("science.experimentBreakdown", isArray: true, DisplayName = "Science experiment breakdown")]
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
/// One entry in the <c>science.archive</c> Topic payload: a single subject
/// out of the whole-career R&amp;D archive
/// (<c>ResearchAndDevelopment.GetSubjects()</c>). That is every subject the
/// career has ever collected or recovered, across every mission and every
/// body, not scoped to the active vessel.
///
/// <para>The Topic payload is a bare array (<c>ArchiveEntry[]</c>), or
/// <c>null</c> when the save has no R&amp;D to walk (Sandbox mode). A save
/// with R&amp;D but nothing collected yet emits an empty array, so an empty
/// array and <c>null</c> mean different things here.</para>
///
/// <para>Distinct from <see cref="ExperimentBreakdownEntry"/>: that one rolls
/// up the active vessel's currently stored results and is null with no vessel
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
[SitrepTopic("science.archive", isArray: true, DisplayName = "Science archive")]
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

/// <summary>
/// One entry of the <c>science.transmissions</c> Topic payload: a science result
/// that has finished leaving the vessel's transmitter. The payload is a bare
/// array of the most recent entries, oldest first, and is delayed like the
/// vessel it comes from: an entry reaches each command centre one signal delay
/// after <see cref="CompletedAt"/>, never earlier, so its presence is the
/// result having arrived at that centre.
///
/// <para>An entry exists only once its transmission is complete. A transmission
/// still being sent has no entry, and a centre that did not start it learns of
/// it on arrival.</para>
/// </summary>
/// <category>Science</category>
[SitrepContract]
[SitrepTopic("science.transmissions", isArray: true, DisplayName = "Science transmissions")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ScienceArrival
{
    /// <summary>The research subject's id (<c>ScienceSubject.id</c>), the same
    /// key <c>science.archive</c> lists it under.</summary>
    [SitrepUnit(Units.Id)]
    public string? SubjectId { get; set; }

    /// <summary>The result's title, for example "Crew Report from Kerbin's
    /// Shores". Null when the transmitter's data could not be read.</summary>
    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }

    /// <summary>The amount of data sent.</summary>
    [SitrepUnit(Units.Mits)]
    public double? DataAmount { get; set; }

    /// <summary>Universal Time at the vessel when the transmitter was handed the
    /// result. Null when the transmission was not started by a command and the
    /// start was not seen.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? StartedAt { get; set; }

    /// <summary>Universal Time at the vessel when the last packet left it. The
    /// entry reaches a command centre one signal delay after this.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double CompletedAt { get; set; }
}
