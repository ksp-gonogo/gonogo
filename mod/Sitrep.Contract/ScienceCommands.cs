#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Args shared by every science-experiment actuation command
/// (<c>science.experiment.deploy</c>/<c>science.experiment.transmit</c>) — the
/// experiment is addressed by <see cref="PartId"/>, the part's
/// <c>flightID.ToString()</c>, the SAME opaque id the read side emits in
/// <c>science.instruments</c> (one entry per <c>ModuleScienceExperiment</c>,
/// keyed by <c>flightID</c>). The host resolves it against the active vessel's
/// live parts; a client never supplies a live array index. An empty
/// <see cref="PartId"/> resolves to nothing and yields
/// <see cref="CommandResult.ErrorCode"/> <see cref="CommandErrorCode.NotFound"/>.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class ExperimentActionArgs
{
    public string PartId { get; set; } = "";
}
