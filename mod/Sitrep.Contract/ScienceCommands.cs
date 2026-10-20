#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Act on a science experiment or lab on a part. Args shared by every science actuation command
/// (<c>science.experiment.deploy</c>, <c>science.experiment.transmit</c>,
/// <c>science.experiment.start</c>, <c>science.experiment.stop</c>,
/// <c>science.lab.start</c> and <c>science.lab.stop</c>):
/// the part is named by <see cref="PartId"/>, the part's flight id as a
/// string, the same id <c>science.instruments</c> carries
/// on each experiment entry. It is looked up among the active vessel's parts,
/// never by array index. An empty or unknown <see cref="PartId"/> fails with
/// <see cref="CommandErrorCode.NotFound"/>. The lab commands act on the lab on
/// the part and ignore <see cref="ExperimentId"/>.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("science.experiment.deploy", Summary = "Deploy a science experiment on a part.")]
[SitrepCommand("science.experiment.transmit", Payload = typeof(ScienceTransmission), Summary = "Transmit a science experiment's data home.")]
[SitrepCommand("science.experiment.start", Payload = typeof(RunStateChange), Summary = "Switch a continuous science instrument on.")]
[SitrepCommand("science.experiment.stop", Payload = typeof(RunStateChange), Summary = "Switch a continuous science instrument off.")]
[SitrepCommand("science.lab.start", Payload = typeof(RunStateChange), Summary = "Start a Mobile Processing Lab's research.")]
[SitrepCommand("science.lab.stop", Payload = typeof(RunStateChange), Summary = "Stop a Mobile Processing Lab's research.")]
public class ExperimentActionArgs
{
    /// <summary>
    /// The experiment's part, as its flight id in a string: the same id
    /// <c>science.instruments</c> keys its entries by. Resolved against the
    /// active vessel's parts; empty or unknown yields
    /// <see cref="CommandErrorCode.NotFound"/>.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";

    /// <summary>
    /// Which experiment on the part is meant, as the <c>experimentId</c> of its
    /// <c>science.instruments</c> entry. Optional: an empty value means the
    /// part's only candidate. A part can carry several experiments, so
    /// <c>science.experiment.start</c> and <c>science.experiment.stop</c> are
    /// refused with <see cref="CommandErrorCode.NotFound"/> when this is empty
    /// and the part holds more than one continuous experiment. Deploy and
    /// transmit take the first eligible experiment when it is empty. An id the
    /// part does not carry fails with <see cref="CommandErrorCode.NotFound"/>.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? ExperimentId { get; set; }
}

/// <summary>
/// What <c>science.experiment.start</c>, <c>science.experiment.stop</c>,
/// <c>science.lab.start</c> and <c>science.lab.stop</c> answer with: whether
/// the press changed anything. Start and stop are idempotent, so a press on
/// something already in the requested state succeeds with
/// <see cref="Changed"/> false rather than refusing, and a command that
/// reaches the craft after the state changed on its own tells the operator
/// so instead of reporting a start that did nothing.
/// </summary>
/// <category>Science</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class RunStateChange
{
    /// <summary>Whether the command switched the instrument or lab. False when it was already in the requested state ("already running", "already stopped").</summary>
    [SitrepUnit(Units.Flag)]
    public bool Changed { get; set; }

    /// <summary>Whether the instrument or lab is switched on after the command.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Running { get; set; }
}

/// <summary>
/// A science result the craft has started sending home, as
/// <c>science.experiment.transmit</c> returns it: when the stream began at the
/// craft and how long the transmitter needs to send all of it. The result has
/// left the craft at <see cref="StartedAt"/> plus <see cref="StreamSeconds"/>,
/// and it lands one signal delay after that.
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
