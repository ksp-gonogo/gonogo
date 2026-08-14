using Sitrep.Contract;
#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace GonogoKerbalismUplink;

// ─────────────────────────────────────────────────────────────────────────────
// The Kerbalism namespaces of the four elected science.* payloads' provider
// extension bags.
//
// science.* is a Kernel-ELECTED capability (Sitrep.Contract/ScienceCapability.cs):
// one shared payload shape per channel, filled by whichever backend won. Kerbalism
// WINS that election when installed, because it does not merely add to stock's
// science model, it replaces it: data accrues over time at a rate, lives on drives
// as files or samples with real capacity limits, is gated by a 62-condition
// requirement system, and is transmitted continuously highest-value-first rather
// than sent by a click.
//
// Almost none of that has a stock counterpart to borrow a field from. These four
// types are where it goes: Kerbalism's own sub-trees, declared and typed HERE,
// carried under the provider id "kerbalism". The alternative was ~15 nullable
// members on core payloads that exactly one mod would ever fill, which is the
// hand-curated-superset anti-pattern the bag replaces (see
// Sitrep.Contract/ProviderExtensions.cs, and the ratchet
// Sitrep.Host.Tests.ScienceProviderExtensionRatchetTests).
//
// TYPING-ONLY, exactly like KerbalismPayloads.cs: this adds no wire bytes. The wire
// is written by JsonWriter walking the untyped value tree KerbalismScienceMap
// builds, and the two are kept honest by ScienceExtensionWireTests (the real map
// through the real EnvelopeCodec) plus the golden fixture the client's own test
// reads back.
//
// ── UNITS: MB, MB/s, science/MB are this Uplink's OWN tokens ────────────────
// None of the three is in Sitrep.Contract.Units, and none needs to be:
// SitrepUnitAttribute has always taken an arbitrary string and UnitDescriptor.Collect
// carries an Uplink-declared token into the published vocabulary (Sitrep.Core.Tests
// .UnitDescriptorTests pins that with a deliberate "banana"). That openness is the
// same reason the generated SitrepUnit union is open: an Uplink cannot add a member
// to a const-string class in core, so closing it would mean a third party could
// never declare a unit at all.
//
// ── Why megabytes never land in a mits-typed core field ─────────────────────
// A core field's unit is compile-time baked and cannot vary by elected provider
// (unitsForTopic returns the GENERATED entry first, so a provider registering units
// against a core Topic is ignored by construction). Kerbalism's data figures are
// megabytes. So the Kerbalism backend leaves core's mits-typed DataAmount/DataStored
// /DataMits NULL and puts the real figures here, tagged MB. Absence plus a correct
// number beats a right number under a wrong label: "2.4 Mit" over a megabyte figure
// is the silent mits/MB conflation Kerbalism's own stock-interop bridge already
// makes, and inheriting it was the one thing the superset survey said not to do.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Kerbalism's <c>extensions["kerbalism"]</c> sub-tree of one
/// <c>science.experiments</c> entry: the stored result as Kerbalism actually holds
/// it, on a drive, with a size in megabytes, a per-megabyte science rate, and a
/// physical-vs-transmissible distinction stock does not draw.
///
/// <para>Read client-side through this Uplink's own
/// <c>readKerbalismScienceExperimentExt</c>, never by reaching into the bag and
/// casting at a call site. Absent entirely when Kerbalism is not the elected
/// backend.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KerbalismScienceExperimentExt
{
    /// <summary>
    /// The result's size in megabytes: what core's mits-typed
    /// <c>ExperimentEntry.DataAmount</c> would have held if the unit could vary by
    /// provider. It cannot, so core's field is null and this is the real figure.
    /// </summary>
    [SitrepUnit("MB")]
    public double? DataSizeMB { get; set; }

    /// <summary>
    /// Science per megabyte for this subject (Kerbalism's <c>SciencePerMB</c>):
    /// LINEAR, no diminishing-returns curve, which is why the entry is tagged
    /// <c>valueModel: "kerbalism-linear"</c>. This is also the real answer to
    /// "what is transmitting this worth", the question core's
    /// <c>BaseTransmitValue</c>/<c>TransmitBonus</c> pair answers under stock and
    /// which Kerbalism leaves null rather than filling with the hardcoded 1.0/0.0
    /// its stock-interop bridge uses.
    /// </summary>
    [SitrepUnit("science/MB")]
    public double? SciencePerMB { get; set; }

    /// <summary>
    /// <c>"file"</c> (transmissible) or <c>"sample"</c> (physical, needs analysis
    /// or return). Stock has no type tag: every result is implicitly transmissible
    /// at some scalar. The distinction drives what an operator can DO with the
    /// result, so it is the most consequential Kerbalism-only field here.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Kind { get; set; }

    /// <summary>Physical mass of a sample. Null for a file (a file weighs nothing).</summary>
    [SitrepUnit(Units.Tonnes)]
    public double? SampleMass { get; set; }

    /// <summary>
    /// Whether Kerbalism has this sample flagged for lab analysis
    /// (<c>Sample.analyze</c>). Null for a file.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Analyze { get; set; }

    /// <summary>
    /// Total file capacity of the drive holding this result. Null when the drive is
    /// unlimited (Kerbalism's <c>-1</c> sentinel), which is a real state and must
    /// not arrive as a negative number.
    /// </summary>
    [SitrepUnit("MB")]
    public double? StorageCapacityMB { get; set; }

    /// <summary>Megabytes of that drive currently used by files.</summary>
    [SitrepUnit("MB")]
    public double? StorageUsedMB { get; set; }

    /// <summary>Sample slots on that drive. Null when unlimited.</summary>
    [SitrepUnit(Units.Count)]
    public int? SampleSlotsTotal { get; set; }

    /// <summary>Sample slots currently occupied on that drive.</summary>
    [SitrepUnit(Units.Count)]
    public int? SampleSlotsUsed { get; set; }

    /// <summary>
    /// Live transmission rate for this result. Zero (not null) when transmission is
    /// gated off: no link, no EC, or a higher-value file ahead of it in the queue.
    /// Kerbalism drains files highest-<c>SciencePerMB</c>-first, so a
    /// <c>transmitting: false</c> file on a connected vessel is normal, not a fault.
    /// </summary>
    [SitrepUnit("MB/s")]
    public double? TransmitRateMBps { get; set; }

    /// <summary>Whether this result is being sent right now.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Transmitting { get; set; }

    /// <summary>
    /// Whether this file is flagged for transmission (<c>Drive.GetFileSend</c>),
    /// which is true even when nothing is currently flowing: no link, no EC, or a
    /// higher-value file draining first. This is the state the File Manager's send
    /// toggle actually reflects, distinct from <see cref="Transmitting"/>. Null for
    /// a sample, which has no send flag.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? SendFlagged { get; set; }
}

/// <summary>
/// Kerbalism's sub-tree of one <c>science.instruments</c> entry: the running-state
/// machine and its reason, which is what stock's flat
/// <c>Deployed</c>/<c>Inoperable</c> pair is a lossy projection OF.
///
/// <para>Stock asks "is it deployed, is it spent". Kerbalism's experiment is either
/// stopped, running, forced, or broken, and when it is not producing there is a
/// REASON, one of ten short-circuits it evaluates every tick (shrouded, no EC, no
/// crew, sample depleted, an unmet requirement out of 62, no storage, ...). The
/// reason is the single field that makes a 62-condition gate legible without
/// modelling 62 conditions, and it is the field an operator actually needs: "why is
/// my experiment not running".</para>
///
/// <para>Two DIFFERENT modules land in this one bag, told apart by
/// <see cref="Kind"/>. Kerbalism's own <c>Experiment</c> is the usual one. A SCANsat
/// map scanner is the other: Kerbalism's SCANsat support strips the
/// <c>SCANexperiment</c> module off the part and fits its own
/// <c>KerbalismScansat</c>, which turns coverage growth into files on a drive. That
/// leaves the scanner in nobody's instrument list unless this provider claims it,
/// so it claims it, and the four scanner-only fields below sit null on an
/// <c>Experiment</c> row (and the six experiment-only fields null on a scanner
/// row).</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KerbalismScienceInstrumentExt
{
    /// <summary>
    /// Which Kerbalism module this row came from: <c>experiment</c> or
    /// <c>scanner</c>. Says which of the fields below carry a fact, so a reader
    /// never has to infer it from which ones happen to be null.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Kind { get; set; }

    /// <summary>
    /// Kerbalism's own free-text reason this experiment is not producing, empty
    /// when there is nothing wrong. The collapsed form of the whole requirement
    /// system: gonogo does not re-derive it, it forwards what Kerbalism computed.
    /// Filled for both kinds: a scanner's version is "no storage available" or
    /// "disabled by power failure".
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Issue { get; set; }

    /// <summary>
    /// The SIMULATED state: <c>Stopped</c> | <c>Running</c> | <c>Forced</c> |
    /// <c>Broken</c>. What the vessel is set to do.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? RunningState { get; set; }

    /// <summary>
    /// The DERIVED display state: <c>Stopped</c> | <c>Running</c> | <c>Forced</c> |
    /// <c>Waiting</c> | <c>Issue</c> | <c>Broken</c>. What is actually happening,
    /// which differs from <see cref="RunningState"/> exactly when something is in
    /// the way.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? ExpStatus { get; set; }

    /// <summary>
    /// Nominal data production rate. The field that makes Kerbalism science a
    /// process rather than an instant: stock has no "how far through this run" idea
    /// at all.
    /// </summary>
    [SitrepUnit("MB/s")]
    public double? DataRateMBps { get; set; }

    /// <summary>
    /// Kerbalism's <c>prodFactor</c>, 0..1: the fraction of nominal rate actually
    /// achieved last tick (resource starvation scales it down). 0 with no
    /// <see cref="Issue"/> means throttled, not stopped.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? ProdFactor { get; set; }

    /// <summary>
    /// Sample material left in a finite-sample experiment. Null for an experiment
    /// that takes no material; 0 means depleted, which is Kerbalism's version of
    /// stock's <c>Inoperable</c>.
    /// </summary>
    [SitrepUnit(Units.Tonnes)]
    public double? RemainingSampleMass { get; set; }

    /// <summary>
    /// SCANNER ONLY. Whether SCANsat is sweeping right now. A scanner produces data
    /// as a side effect of coverage growing, so this is the closest thing it has to
    /// an experiment's Running state. Null on older Kerbalism builds, which keep no
    /// such flag: <see cref="PowerDisabled"/> is then the only state available.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Scanning { get; set; }

    /// <summary>
    /// SCANNER ONLY. Kerbalism cut this scanner for want of EC and will restart it
    /// once the vessel is back above a quarter charge. Distinct from an operator
    /// switching it off, which this stays false for.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? PowerDisabled { get; set; }

    /// <summary>
    /// SCANNER ONLY. How much of the current body this sensor type has covered.
    /// The number the produced data is a function of: coverage rising is the event
    /// that writes a file, so a stalled percentage explains a scanner that is on
    /// and yielding nothing.
    /// </summary>
    [SitrepUnit(Units.Percent)]
    public double? BodyCoveragePercent { get; set; }

    /// <summary>
    /// SCANNER ONLY. The EC draw Kerbalism bills for this scanner, loaded or in the
    /// background. Zero means the part was patched without a rate rather than that
    /// scanning is free.
    /// </summary>
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? EcRate { get; set; }
}

/// <summary>
/// Kerbalism's sub-tree of one <c>science.lab</c> entry. The lab is the payload
/// where the two models differ most in KIND, not degree: stock's lab is terminal
/// (stored data becomes science per game-day), Kerbalism's is an intermediate stage
/// (a sample is analysed into a transmissible file, which then still has to be
/// sent). So the Kerbalism backend leaves core's <c>ScienceRate</c> null, tags the
/// entry <c>valueModel: "kerbalism-linear"</c> so a widget can tell that null from
/// "idle", and carries the real rate here.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KerbalismScienceLabExt
{
    /// <summary>Configured analysis rate for the lab part.</summary>
    [SitrepUnit("MB/s")]
    public double? AnalysisRateMBps { get; set; }

    /// <summary>
    /// The rate actually in effect, with the researcher's experience level already
    /// multiplied in. Kerbalism exposes the OUTPUT of its crew bonus, not the
    /// headcount input stock's <c>ScientistCount</c> carries, so the two are not
    /// two views of one number and both are worth having.
    /// </summary>
    [SitrepUnit("MB/s")]
    public double? EffectiveRateMBps { get; set; }

    /// <summary>
    /// Kerbalism's lab status: <c>DISABLED</c> | <c>NO_EC</c> | <c>NO_STORAGE</c> |
    /// <c>NO_SAMPLE</c> | <c>NO_RESEARCHER</c> | <c>RUNNING</c>. A typed reason
    /// where core's <c>StatusText</c> is a display string.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Status { get; set; }
}

/// <summary>
/// Kerbalism's sub-tree of one <c>science.experimentBreakdown</c> entry: the full
/// per-subject ledger, of which stock's two fields (<c>DataMits</c> +
/// <c>RemainingPotential</c>) are a snapshot view.
///
/// <para>Stock answers "how much is stored, and how much is left in this subject".
/// Kerbalism additionally tracks what has been retrieved versus what is still in
/// flight, and how many times the subject has been completed, which is what turns
/// "should I run this again" from a guess into a reading.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KerbalismScienceBreakdownExt
{
    /// <summary>Science still recoverable from this subject across all runs.</summary>
    [SitrepUnit(Units.Science)]
    public double? ScienceRemainingTotal { get; set; }

    /// <summary>
    /// Fraction of this subject's total science already collected, 0..1. A ratio,
    /// not a percent: core's <c>DeployedEntry</c> percentages are the one place the
    /// mod carries hundredths, and copying that here would invite the mistake.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? PercentCollectedTotal { get; set; }

    /// <summary>
    /// Science collected but not yet retrieved: aboard the vessel, not yet in
    /// R&amp;D. Stock has no in-flight-versus-banked split.
    /// </summary>
    [SitrepUnit(Units.Science)]
    public double? ScienceCollectedInFlight { get; set; }

    /// <summary>How many times this subject has been completed.</summary>
    [SitrepUnit(Units.Count)]
    public int? TimesCompleted { get; set; }
}
