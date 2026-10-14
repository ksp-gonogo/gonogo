#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// When the active craft is next predicted to drop out of contact with one
/// command centre, on <c>comms.nextLoss</c>: the first moment its contact plan
/// has no open route between the two, relays included.
///
/// <para>A prediction, and the receiving centre's own, made over the
/// <c>comms.contacts</c> plan that centre holds. A craft held in contact by one
/// relay after another stays in contact across a handover, so this is the end
/// of the whole route and never the end of one window. The live link the game
/// reports decides what actually gets through.</para>
///
/// <para>Each session is sent only the figure of the centre it sits at.</para>
/// <internal>
/// Made by Sitrep.Host.Comms.ContactLoss from the same ContactPlan the router
/// uses, in ContactPlanSource, and delivered with Courier.RecordAddressed.
/// </internal>
/// </summary>
/// <category>Comms</category>
[SitrepContract]
[SitrepTopic("comms.nextLoss")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommsNextLoss
{
    /// <summary>
    /// The universal time the plan first has no open route between the centre
    /// and the active craft, or null when none is predicted: see
    /// <see cref="Basis"/> for which.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? Ut { get; set; }

    /// <summary>
    /// What <see cref="Ut"/> rests on. One of <c>predicted-loss</c> (the plan
    /// closes the last open route at <see cref="Ut"/>), <c>no-loss-in-window</c>
    /// (in contact through <see cref="CoveredToUt"/>), <c>out-of-contact</c> (no
    /// route is open now; the craft's <c>trackingStation.catalog</c> entry says when it is expected back),
    /// <c>not-planned</c> (the centre holds no plan that includes the craft) or
    /// <c>no-craft</c> (there is no active craft).
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public string Basis { get; set; } = "not-planned";

    /// <summary>The last universal time the plan reaches. A null <see cref="Ut"/> with <c>no-loss-in-window</c> means no loss before it.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double CoveredToUt { get; set; }

    /// <summary>
    /// True while an end of the route was last heard of with its orbit still
    /// changing, so the instant is a rough guide until its next report.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool LowConfidence { get; set; }
}
