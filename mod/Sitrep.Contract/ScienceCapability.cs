namespace Sitrep.Contract;

// ─────────────────────────────────────────────────────────────────────────────
// Science as a Kernel-elected capability, the same shape comms.* and
// reliability.* already use (Comms.cs, Reliability.cs):
//
//   • ONE exclusive capability "science" whose active instance is an
//     IScienceBackend (this file).
//   • A core registrar (mod/Gonogo.KSP/ScienceCoreUplink.cs) OWNS the
//     capability, ships the stock backend as its Vanilla factory, declares the
//     five science.* channels + two science.experiment.* commands ONCE, and
//     sources them from whichever backend the election picked
//     (Kernel.Query<IScienceBackend>("science")).
//   • A modelling mod registers a provider from its OWN uplink's Register
//     (host.Kernel.RegisterProvider), only when its reflection probe confirms
//     the mod is loaded: registering IS the gate. No provider declares a
//     science.* channel itself, that is the same
//     shared-namespace-single-declaration rule comms follows.
//
// The provider this exists for is a mod that models science as a data-rate and
// per-subject ledger rather than as stored experiment blobs. Before the election
// such a mod could only ship a parallel topic of its own, which could never
// supersede science.*: two widgets and two mental models, forever.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// The "science" capability's active-instance interface (parallel to
/// <see cref="ICommsBackend"/> / <see cref="IReliabilityBackend"/>): the five
/// science.* read surfaces plus the two experiment commands, which together are
/// everything the science registrar publishes.
///
/// <para><b>Why the reads take a <see cref="KspSnapshot"/> and return
/// <c>object?</c>, unlike <see cref="IReliabilityBackend"/>'s parameterless
/// typed reads.</b> Both halves are deliberate and both are about keeping the
/// wire byte-identical across this seam:</para>
///
/// <list type="bullet">
/// <item>The snapshot parameter is the mapper signature the science channels
/// have always had (<c>IUplinkHost.AddChannelSource</c>: <c>snapshot -&gt;
/// payload</c>). Stock science is already captured on the main thread into
/// <c>KspSnapshot.Values["science"]</c> by <c>Gonogo.KSP.KspHost.BuildScience</c>,
/// so the vanilla backend is a pure snapshot mapper and stays KSP-free and
/// headlessly testable. A provider whose data is NOT on the shared snapshot
/// reads it on the main thread through its own <c>AddSampledSource</c> capture
/// and hands the bundle forward, which is what that seam exists for: a channel
/// mapper runs on the Courier thread and must never touch a live KSP API.</item>
/// <item><c>object?</c> is the payload the channel already carries. The
/// <c>Science*Entry</c> classes in SciencePayloads.cs are TYPING-ONLY mirrors
/// (their own doc comments say so): the wire is written by <c>JsonWriter</c>
/// walking the live value tree, and the vanilla path's tree comes from
/// <c>SnapshotDict</c>'s non-finite-is-absent readers. Retyping these returns
/// would rewrite that tree and change bytes for no gain.</item>
/// </list>
///
/// <para>Each read returns <c>null</c> (never an empty list) when it has nothing
/// to say: no active vessel, or a sub-group that could not be built. That is
/// load-bearing, not a detail. A channel whose mapper has never returned a
/// non-null value is never "born" and emits NOTHING at all, not a tombstone
/// (see <c>Sitrep.Host.ChannelEngine</c>'s <c>_born</c> doc comment), which is
/// what makes "this vessel has no science lab" silence rather than a false
/// empty list.</para>
/// </summary>
public interface IScienceBackend : ISitrepProvider
{
    /// <summary>One entry per stored science result on the active vessel (<c>science.experiments</c>).</summary>
    object? Experiments(KspSnapshot? snapshot);

    /// <summary>One entry per experiment module on the active vessel, data or not (<c>science.instruments</c>).</summary>
    object? Instruments(KspSnapshot? snapshot);

    /// <summary>Environmental-sensor readouts on the active vessel (<c>science.sensors</c>).</summary>
    object? Sensors(KspSnapshot? snapshot);

    /// <summary>Science-lab processing state on the active vessel (<c>science.lab</c>).</summary>
    object? Lab(KspSnapshot? snapshot);

    /// <summary>Per-subject rollup of the stored results (<c>science.experimentBreakdown</c>).</summary>
    object? ExperimentBreakdown(KspSnapshot? snapshot);

    /// <summary>
    /// Run the experiment on the given part (<c>science.experiment.deploy</c>).
    /// Returns an already-typed <see cref="CommandResult"/>, never throws: an
    /// unresolvable part is <see cref="CommandErrorCode.NotFound"/>, an
    /// experiment that cannot run right now is
    /// <see cref="CommandErrorCode.ModeUnavailable"/>.
    /// </summary>
    CommandResult DeployExperiment(ExperimentActionArgs args);

    /// <summary>
    /// Transmit the stored result on the given part
    /// (<c>science.experiment.transmit</c>). Same never-throws contract as
    /// <see cref="DeployExperiment"/>. A backend whose transmission is
    /// continuous rather than a one-shot send (a modelling mod may drain
    /// stored results by value over time) implements this as "flag this for sending".
    /// </summary>
    CommandResult TransmitExperiment(ExperimentActionArgs args);
}
