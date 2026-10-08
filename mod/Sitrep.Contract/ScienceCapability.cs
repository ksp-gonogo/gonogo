using System.Collections.Generic;

namespace Sitrep.Contract;

/*
 * Science is a Kernel-elected capability, the same shape comms.* and isru.* use: one
 * exclusive "science" capability whose active instance is an IScienceBackend. A core registrar
 * owns the capability, ships the stock backend as its Vanilla factory, declares the five
 * science.* channels and two science.experiment.* commands once, and sources them from the
 * elected backend. A modelling mod registers a provider from its own Uplink only when its
 * reflection probe confirms the mod is loaded (registering is the gate), and never declares a
 * science.* channel itself.
 */

/// <summary>
/// A science backend: the active instance of the exclusive <c>"science"</c>
/// capability, supplying the five <c>science.*</c> channels and the two
/// experiment commands. Gonogo declares those channels and commands and
/// publishes what the elected backend returns; a mod's Uplink registers a
/// backend only when its mod is loaded, and never declares a <c>science.*</c>
/// channel itself.
///
/// <para>Each read takes this tick's <see cref="KspSnapshot"/> and returns the
/// channel's payload, like a mapper given to
/// <see cref="IUplinkHost.AddChannelSource"/>. Reads run off the main thread
/// and must never touch the game: read what you need on the main thread with
/// an <see cref="ISnapshotSampler"/> and pick it up from the snapshot.</para>
///
/// <para>The payload is a list of <see cref="ExperimentEntry"/> or its
/// siblings. A field you cannot state is left null, so a number that is not
/// finite is null and never NaN. A provider's own per-entry values go in the
/// entry's <c>Extensions</c> bag. Return <c>null</c>, never an empty list, when
/// there is nothing to say, such as no active vessel. A channel that has never
/// had a non-null payload sends nothing at all, so a vessel with no lab is
/// silence rather than an empty list.</para>
/// <internal>
/// Stock science is captured by <c>Gonogo.KSP.KspHost.BuildScience</c>, which
/// keeps the vanilla backend KSP-free and headlessly testable; the mapper runs
/// on the Courier thread. <c>JsonWriter</c> writes each entry type itself, in
/// the key order the dictionary producers used, and
/// <c>Sitrep.Host.Tests.ScienceWireGoldenTests</c> holds the text. A channel that
/// never returned non-null is never "born" (see
/// <c>Sitrep.Host.ChannelEngine</c>'s <c>_born</c>).
/// </internal>
/// </summary>
/// <category>Uplink API</category>
public interface IScienceBackend : ISitrepProvider
{
    /// <summary>One entry per stored science result on the active vessel (<c>science.experiments</c>).</summary>
    /// <param name="snapshot">This tick's capture.</param>
    /// <returns>The payload, or null when there is nothing to report.</returns>
    IReadOnlyList<ExperimentEntry>? Experiments(KspSnapshot? snapshot);

    /// <summary>One entry per experiment module on the active vessel, data or not (<c>science.instruments</c>).</summary>
    /// <param name="snapshot">This tick's capture.</param>
    /// <returns>The payload, or null when there is nothing to report.</returns>
    IReadOnlyList<InstrumentEntry>? Instruments(KspSnapshot? snapshot);

    /// <summary>Environmental-sensor readouts on the active vessel (<c>science.sensors</c>).</summary>
    /// <param name="snapshot">This tick's capture.</param>
    /// <returns>The payload, or null when there is nothing to report.</returns>
    IReadOnlyList<SensorEntry>? Sensors(KspSnapshot? snapshot);

    /// <summary>Science-lab processing state on the active vessel (<c>science.lab</c>).</summary>
    /// <param name="snapshot">This tick's capture.</param>
    /// <returns>The payload, or null when there is nothing to report.</returns>
    IReadOnlyList<LabEntry>? Lab(KspSnapshot? snapshot);

    /// <summary>Per-subject rollup of the stored results (<c>science.experimentBreakdown</c>).</summary>
    /// <param name="snapshot">This tick's capture.</param>
    /// <returns>The payload, or null when there is nothing to report.</returns>
    IReadOnlyList<ExperimentBreakdownEntry>? ExperimentBreakdown(KspSnapshot? snapshot);

    /// <summary>
    /// Run the experiment on the given part (<c>science.experiment.deploy</c>).
    /// Returns a <see cref="CommandResult"/> and never throws: a part that cannot
    /// be found is <see cref="CommandErrorCode.NotFound"/>, an experiment that
    /// cannot run right now is <see cref="CommandErrorCode.ModeUnavailable"/>.
    /// </summary>
    CommandResult DeployExperiment(ExperimentActionArgs args);

    /// <summary>
    /// Transmit the stored result on the given part
    /// (<c>science.experiment.transmit</c>). Never throws, as for
    /// <see cref="DeployExperiment"/>. A backend that transmits continuously
    /// rather than in one send marks the result for sending. A backend that
    /// knows when a one-shot send will have left the craft returns a
    /// <see cref="CommandResult{T}"/> of <see cref="ScienceTransmission"/>, so a
    /// client can show the transmission in flight.
    /// </summary>
    CommandResult TransmitExperiment(ExperimentActionArgs args);
}
