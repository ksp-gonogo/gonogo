#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Args shared by every science-experiment actuation command
/// (<c>science.experiment.deploy</c>/<c>science.experiment.transmit</c>): the
/// experiment is addressed by <see cref="PartId"/>, the part's
/// <c>flightID.ToString()</c>, the SAME opaque id the read side emits in
/// <c>science.instruments</c> (one entry per <c>ModuleScienceExperiment</c>,
/// keyed by <c>flightID</c>). The host resolves it against the active vessel's
/// live parts; a client never supplies a live array index. An empty
/// <see cref="PartId"/> resolves to nothing and yields
/// <see cref="CommandResult.ErrorCode"/> <see cref="CommandErrorCode.NotFound"/>.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("science.experiment.deploy")]
[SitrepCommand("science.experiment.transmit", Payload = typeof(ScienceTransmission))]
public class ExperimentActionArgs
{
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";
}

/// <summary>
/// A science result the craft has started sending home, as
/// <c>science.experiment.transmit</c> answers it: when the stream began at the
/// craft and how long the transmitter needs to send all of it. The result has
/// left the craft at <see cref="StartedAt"/> plus <see cref="StreamSeconds"/>,
/// and it lands one light-time after that.
///
/// <para>Absent from the reply when the backend cannot say, as a modelling mod
/// that drains results continuously cannot. A client then has nothing to draw
/// the transmission from, which is the truth: an absent transmission is never a
/// zero-length one.</para>
/// </summary>
/// <category>Science</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ScienceTransmission
{
    /// <summary>The research subject's id (<c>ScienceSubject.id</c>), the same key <c>currency.&lt;guid&gt;.science</c> credits it under.</summary>
    [SitrepUnit(Units.Id)]
    public string SubjectId { get; set; } = string.Empty;

    /// <summary>The result's human title, e.g. "Crew Report from Kerbin's Shores".</summary>
    [SitrepUnit(Units.Text)]
    public string Title { get; set; } = string.Empty;

    /// <summary>Universal Time at the craft when the transmitter was handed the result.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double StartedAt { get; set; }

    /// <summary>
    /// How long the transmitter takes to send every packet, from its packet size
    /// and interval. A floor: a transmitter starved of charge holds between
    /// packets, and one already busy sends this after what it is holding.
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double StreamSeconds { get; set; }

    /// <summary>The amount of data sent.</summary>
    [SitrepUnit(Units.Mits)]
    public double DataAmount { get; set; }
}
