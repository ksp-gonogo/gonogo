#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Deploy or transmit a science experiment on a part. Args shared by every science-experiment actuation command
/// (<c>science.experiment.deploy</c> and <c>science.experiment.transmit</c>):
/// the experiment is named by <see cref="PartId"/>, the part's
/// <c>flightID.ToString()</c>, the same id <c>science.instruments</c> carries
/// on each experiment entry. It is looked up among the active vessel's parts,
/// never by array index. An empty or unknown <see cref="PartId"/> fails with
/// <see cref="CommandErrorCode.NotFound"/>.
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
    /// <summary>
    /// The experiment's part, as <c>Part.flightID.ToString()</c>: the same id
    /// <c>science.instruments</c> keys its entries by. Resolved against the
    /// active vessel's parts; empty or unknown yields
    /// <see cref="CommandErrorCode.NotFound"/>.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";
}

/// <summary>
/// A science result the craft has started sending home, as
/// <c>science.experiment.transmit</c> returns it: when the stream began at the
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
    /// <summary>The research subject's id (<c>ScienceSubject.id</c>), the same
    /// key <c>currency.&lt;guid&gt;.science</c> credits it under.</summary>
    [SitrepUnit(Units.Id)]
    public string SubjectId { get; set; } = string.Empty;

    /// <summary>The result's human title, e.g. "Crew Report from Kerbin's
    /// Shores".</summary>
    [SitrepUnit(Units.Text)]
    public string Title { get; set; } = string.Empty;

    /// <summary>Universal Time at the craft when the transmitter was handed the
    /// result.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double StartedAt { get; set; }

    /// <summary>
    /// How long the transmitter takes to send every packet, from its packet size
    /// and interval. It takes at least this long: a transmitter starved of charge holds between
    /// packets, and one already busy sends this after what it is holding.
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double StreamSeconds { get; set; }

    /// <summary>The amount of data sent.</summary>
    [SitrepUnit(Units.Mits)]
    public double DataAmount { get; set; }
}
