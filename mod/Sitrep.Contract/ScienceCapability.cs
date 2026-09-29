namespace Sitrep.Contract;

/*
 * Science is a Kernel-elected capability, the same shape comms.* and reliability.* use: one
 * exclusive "science" capability whose active instance is an IScienceBackend. A core registrar
 * owns the capability, ships the stock backend as its Vanilla factory, declares the five
 * science.* channels and two science.experiment.* commands once, and sources them from the
 * elected backend. A modelling mod registers a provider from its own Uplink only when its
 * reflection probe confirms the mod is loaded (registering is the gate), and never declares a
 * science.* channel itself.
 */

/// <summary>
/// The "science" capability's active-instance interface (parallel to
/// <see cref="ICommsBackend"/> / <see cref="IReliabilityBackend"/>): the five
/// science.* read surfaces plus the two experiment commands, which together are
/// everything the science registrar publishes.
///
/// <para>Unlike <see cref="IReliabilityBackend"/>'s parameterless typed reads,
/// each read takes a <see cref="KspSnapshot"/> and returns <c>object?</c>:</para>
///
/// <list type="bullet">
/// <item>The snapshot parameter is the channel-mapper signature
/// (<see cref="IUplinkHost.AddChannelSource"/>: <c>snapshot -&gt; payload</c>).
/// Stock science is already captured on the main thread into
/// <c>KspSnapshot.Values["science"]</c>, so the stock backend is a pure snapshot
/// mapper. A provider whose data is NOT on the shared snapshot reads it on the
/// main thread through its own <c>AddSampledSource</c> capture and hands the
/// bundle forward: a channel mapper runs off the main thread and must never
/// touch a live KSP API.</item>
/// <item><c>object?</c> is the payload the channel carries: a value tree of
/// dictionaries and lists in the shape of <see cref="ExperimentEntry"/> and its
/// siblings, with a non-finite number written as absent.</item>
/// </list>
///
/// <para>Each read returns <c>null</c> (never an empty list) when it has nothing
/// to say: no active vessel, or a sub-group that could not be built. A channel
/// whose mapper has never returned a non-null value emits nothing at all, which
/// is what makes "this vessel has no science lab" silence rather than a false
/// empty list.</para>
/// <internal>
/// Both halves keep the wire byte-identical across this seam. Stock science is
/// captured by <c>Gonogo.KSP.KspHost.BuildScience</c>, which keeps the vanilla
/// backend KSP-free and headlessly testable; the mapper runs on the Courier
/// thread. The <c>Science*Entry</c> classes are typing-only mirrors: the wire is
/// written by <c>JsonWriter</c> walking the live value tree, and the vanilla
/// path's tree comes from <c>SnapshotDict</c>'s non-finite-is-absent readers, so
/// retyping these returns would rewrite that tree and change bytes. A channel
/// that never returned non-null is never "born" (see
/// <c>Sitrep.Host.ChannelEngine</c>'s <c>_born</c>).
/// </internal>
/// </summary>
/// <category>Uplink API</category>
public interface IScienceBackend : ISitrepProvider
{
    /// <summary>One entry per stored science result on the active vessel (<c>science.experiments</c>).</summary>
    /// <param name="snapshot">This tick's capture.</param>
    /// <returns>The payload, or null when there is nothing to report.</returns>
    object? Experiments(KspSnapshot? snapshot);

    /// <summary>One entry per experiment module on the active vessel, data or not (<c>science.instruments</c>).</summary>
    /// <param name="snapshot">This tick's capture.</param>
    /// <returns>The payload, or null when there is nothing to report.</returns>
    object? Instruments(KspSnapshot? snapshot);

    /// <summary>Environmental-sensor readouts on the active vessel (<c>science.sensors</c>).</summary>
    /// <param name="snapshot">This tick's capture.</param>
    /// <returns>The payload, or null when there is nothing to report.</returns>
    object? Sensors(KspSnapshot? snapshot);

    /// <summary>Science-lab processing state on the active vessel (<c>science.lab</c>).</summary>
    /// <param name="snapshot">This tick's capture.</param>
    /// <returns>The payload, or null when there is nothing to report.</returns>
    object? Lab(KspSnapshot? snapshot);

    /// <summary>Per-subject rollup of the stored results (<c>science.experimentBreakdown</c>).</summary>
    /// <param name="snapshot">This tick's capture.</param>
    /// <returns>The payload, or null when there is nothing to report.</returns>
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
    /// A backend that knows when a one-shot send will have left the craft returns
    /// a <see cref="CommandResult{T}"/> of <see cref="ScienceTransmission"/>,
    /// which is what puts the transmission on a client's delay rail.
    /// </summary>
    CommandResult TransmitExperiment(ExperimentActionArgs args);
}
