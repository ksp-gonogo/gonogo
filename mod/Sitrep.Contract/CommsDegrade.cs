#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

// ====================================================================
// The QUALITY half of the comms contract: how bad the link is right
// now, on one scale, for a consumer that has to decide how much of
// something to send over it.
//
// The third sibling of CommsOcclusion.cs and CommsReach.cs, and the
// same wall. Occlusion answers "does a rock sit between these two",
// reach answers "can they hear each other at all", and this answers
// "given that they can, how well". It exists because the consumers of
// that last question are not comms surfaces at all: a video feed
// choosing a bitrate and a voice channel choosing how much noise to mix
// in both need ONE number they can key a ladder on, and neither has any
// business knowing which comms mod is installed.
//
// WHY comms.signalStrength COULD NOT SERVE. That field is 0..1 and
// looks like exactly this number, and it is not, because it means two
// different things depending on which backend filled it:
//
//   * Stock CommNet fills it with a RANGE fraction, how far through the
//     antenna pair's range curve the link currently sits, with the
//     plasma-blackout multiplier already folded in.
//   * RealAntennas fills it with a RATE-LADDER headroom fraction, how
//     much of the negotiated modulation ladder is spare, and applies no
//     plasma multiplier at all.
//
// Those are different quantities in the same slot, under one unit
// annotation, with nothing on the wire to tell them apart. A consumer
// that computes 1 - signalStrength (which is what the camera feed does
// today) is therefore computing two different things on two installs
// and cannot know which. This file does NOT fix that field. It adds a
// separate, honest one beside it: a rating that arrives NAMED, so a
// consumer keying a quality ladder on it can see which rule produced
// the number it is acting on, and a rating that can be ABSENT, so a
// backend with no opinion is not forced to invent one.
//
// WHAT THE CONTRACT FORCES, AND WHAT IT LEAVES ALONE. It forces the
// SHAPE and the SCALE: one number, 0..1, 0 meaning nothing is wrong and
// 1 meaning nothing usable is getting through, or no number at all. It
// does not touch the JUDGEMENT: what degrades a link, and by how much,
// stays entirely the backend's, because that is precisely the thing the
// two shipped backends disagree about. There is deliberately no formula
// here, and adding one later would be the same mistake signalStrength
// already made.
// ====================================================================

/// <summary>
/// How degraded ONE comms link is, as one backend grades it: a pure, KSP-free
/// rating on a fixed scale, with the rule that produced it named alongside.
///
/// <para>Deliberately a RESOLVED RATING rather than the quantities behind it,
/// for the same reason <see cref="ICommsReachModel"/> carries a distance rather
/// than antenna powers. A margin in dB, a range fraction and a rate-ladder
/// position are three incomparable currencies, and a consumer handed any of
/// them would have to know which backend is winning before it could read it.
/// One bounded number is the answer to the question actually being asked, and
/// it is the same shape whatever the backend's internal rule is.</para>
///
/// <para><b>The rule travels WITH the answer.</b>
/// <see cref="ModelId"/>/<see cref="ModelName"/> are not decoration: this is a
/// number a consumer acts on, and the two shipped backends grade a link by
/// genuinely different physics. A feed that drops to a lower bitrate can say
/// which grading told it to, and an operator comparing two installs can see why
/// the same orbit rates differently.</para>
///
/// <para>Pure once built: implementations must not read live game state. A
/// backend that needs a live read (both shipped ones do) does it when BUILDING
/// the model, on the capture seam, and hands back a model that is thereafter
/// just a number.</para>
/// </summary>
public interface ICommsDegradeModel
{
    /// <summary>Stable id for this rule, e.g. <c>"commnet-range-fraction"</c>.</summary>
    string ModelId { get; }

    /// <summary>Human-readable name a UI can show, e.g. <c>"Stock CommNet (range fraction)"</c>.</summary>
    string ModelName { get; }

    /// <summary>
    /// How degraded the link is, 0..1, or absent. Three answers, three meanings,
    /// and they must not be collapsed:
    /// <list type="bullet">
    /// <item><description><b>null</b>: UNRATED. This backend does not grade this
    /// link, or could not this tick. A consumer applies no quality term and
    /// keeps whatever it was already doing. It is NOT a zero: "nobody rated
    /// this" and "this link is perfect" are opposite instructions to a feed
    /// deciding whether to drop a bitrate.</description></item>
    /// <item><description><b>0</b>: PRISTINE. Nothing is wrong with the link, as
    /// a real graded answer. A save that models no comms network at all reports
    /// exactly this, because nothing can attenuate a link that is not
    /// modelled.</description></item>
    /// <item><description><b>1</b>: UNUSABLE. Nothing worth sending gets
    /// through. A disconnected craft rates here.</description></item>
    /// <item><description>anything between: worse as it rises.</description></item>
    /// </list>
    /// </summary>
    double? Level { get; }
}

/// <summary>
/// The degrade rule shape every backend that exists today happens to fit: one
/// resolved rating, named. General rather than per-backend for the same reason
/// <see cref="MaxRangeReachModel"/> is: a third comms mod whose grading also
/// resolves to a single fraction needs no new type.
///
/// <para>This is also the ONE place the 0..1 promise is kept. A backend hands
/// its own arithmetic to the constructor and gets back a value that is either
/// in range or absent, so no consumer has to defend against a rating of 1.4 and
/// no backend has to remember to clamp.</para>
/// </summary>
public sealed class RatedDegradeModel : ICommsDegradeModel
{
    public RatedDegradeModel(string modelId, string modelName, double? level)
    {
        ModelId = modelId ?? "";
        ModelName = modelName ?? "";
        Level = Sane(level);
    }

    public string ModelId { get; }

    public string ModelName { get; }

    public double? Level { get; }

    /// <summary>
    /// The clamp rule, declared rather than assumed.
    ///
    /// <para>A NaN or infinite rating becomes ABSENT rather than a number,
    /// because both mean the arithmetic failed to resolve and neither is a
    /// grading a consumer can act on: a NaN silently fails every comparison and
    /// so reads as "not degraded", which is the most dangerous of the wrong
    /// answers. This is where a reflection read that came back empty stops
    /// being a value.</para>
    ///
    /// <para>A FINITE rating outside 0..1 clamps to the nearer end, and that
    /// asymmetry with the non-finite case is deliberate. An out-of-range finite
    /// number is an arithmetic that ran and overshot (a headroom fraction above
    /// 1, a difference that went slightly negative), so the end it overshot is
    /// the honest answer. A non-finite one is an arithmetic that did not run at
    /// all, and there is no end to pick.</para>
    /// </summary>
    private static double? Sane(double? level)
    {
        if (level == null)
        {
            return null;
        }
        var value = level.Value;
        if (double.IsNaN(value) || double.IsInfinity(value))
        {
            return null;
        }
        if (value < 0.0) return 0.0;
        if (value > 1.0) return 1.0;
        return value;
    }
}

/// <summary>The degrade models core itself declares, and the reads every consumer shares.</summary>
public static class CommsDegradeModels
{
    /// <summary><see cref="Unknown"/>'s id, so a consumer can recognise "nobody told me" without string-matching a display name.</summary>
    public const string UnknownModelId = "unknown";

    /// <summary>
    /// The model a consumer gets when no backend is elected, or when the elected
    /// one will not grade the link it was handed.
    ///
    /// <para>Its rating is ABSENT, and there is deliberately no conservative
    /// substitute, the same conclusion <see cref="CommsReachModels.Unknown"/>
    /// reaches for reach and for a sharper reason. Both ends of this scale are
    /// actionable: a guessed 0 tells a video feed to send full quality down a
    /// link nobody has vouched for, and a guessed 1 blacks out a feed that is
    /// arriving perfectly. There is no midpoint that is honest either, because a
    /// consumer cannot tell a real 0.5 from a shrug. So an unelected backend
    /// rates nothing and the consumer keeps doing what it was doing.</para>
    ///
    /// <para>The state is still DECLARED rather than assumed: the id says
    /// "unknown", so a surface can report that it is running ungraded instead of
    /// silently looking the same as a perfect link.</para>
    /// </summary>
    public static readonly ICommsDegradeModel Unknown =
        new RatedDegradeModel(UnknownModelId, "Unknown (no comms backend elected)", null);

    /// <summary>
    /// The rating under <paramref name="model"/>, or null when it declines to
    /// grade, which is the THIRD answer and not a zero.
    ///
    /// <para>One line, and it exists anyway, for the reason
    /// <see cref="CommsReachModels.Reaches"/> gives at length about its own
    /// comparison: the null-versus-zero branch is the whole discipline of this
    /// file, and a consumer writing <c>model.Level ?? 0</c> by hand has
    /// discarded it without noticing. A null-taking overload is part of that: a
    /// consumer holding no model at all is in the same position as one holding
    /// an unrated one.</para>
    /// </summary>
    public static double? LevelOf(ICommsDegradeModel? model) => model?.Level;

    /// <summary>
    /// Whether the link is AT LEAST as degraded as
    /// <paramref name="threshold"/>, under <paramref name="model"/>. Null when
    /// the model declines to grade, which is a third answer and not a false:
    /// "this rule does not say" must not be readable as "the link is fine".
    ///
    /// <para>The comparison lives here, once, for the reason
    /// <c>CommsReachModels.Reaches</c> gives: two copies that disagreed by one
    /// <c>=</c> would put two surfaces on opposite sides of the same rung of a
    /// quality ladder. Meeting the threshold EXACTLY counts as meeting it, so a
    /// ladder built from ascending thresholds picks the highest rung the rating
    /// reaches. A non-finite threshold answers null rather than a comparison no
    /// consumer could have meant.</para>
    /// </summary>
    public static bool? AtLeast(ICommsDegradeModel? model, double threshold)
    {
        var level = model?.Level;
        if (level == null || double.IsNaN(threshold))
        {
            return null;
        }
        return level.Value >= threshold;
    }

    /// <summary>
    /// One model as the payload its channel carries, stamped with
    /// <paramref name="meta"/>. A null model is <see cref="Unknown"/>, so a
    /// producer that could not resolve a backend publishes an honest "nobody
    /// graded this" rather than nothing at all: the channel is always-present,
    /// and a silent channel is indistinguishable from a stalled one.
    /// </summary>
    public static CommsDegrade ToPayload(ICommsDegradeModel? model, PayloadMeta? meta)
    {
        var rule = model ?? Unknown;
        return new CommsDegrade
        {
            ModelId = rule.ModelId,
            ModelName = rule.ModelName,
            Level = rule.Level,
            Meta = meta ?? new PayloadMeta(),
        };
    }
}

/// <summary>
/// The <c>comms.degrade</c> payload: how degraded the active vessel's link home
/// is right now, on one fixed scale, as the comms backend in force grades it.
///
/// <para><see cref="Level"/> runs from 0, nothing wrong, to 1, nothing usable
/// getting through. It is ABSENT when nothing graded the link, and absent is a
/// third answer rather than a low one: "nobody rated this" and "this link is
/// perfect" are opposite instructions to anything choosing a quality, so a
/// consumer must branch on the absence rather than default it to a
/// number.</para>
///
/// <para><b>Read this rather than deriving a quality from
/// <c>comms.signalStrength</c>.</b> That field is 0..1 too, and it is a
/// different quantity on a stock install than on a RealAntennas one: a range
/// fraction against an antenna curve versus spare room on a data-rate ladder.
/// Nothing on the wire distinguishes them, so <c>1 - signalStrength</c> is two
/// different quality curves on two saves. This channel names its rule, so a
/// consumer acting on the number can see which grading produced it.</para>
///
/// <para>DELAYED, like the link observations it grades and unlike its
/// always-live <c>comms.delay</c> sibling. A rating is an observation of the
/// craft's link, so an operator should learn of a degradation one light-time
/// after it happened, at the same instant the telemetry that suffered it
/// arrives. It is delay-gated on the ordinary terms, so through a blackout it
/// holds at last-known; the disconnect edge itself reaches a client on
/// <c>comms.link</c>, which is the connectivity authority and is exempt from
/// that freeze precisely so it can report it.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.degrade")]
public class CommsDegrade
{
    /// <summary>The grading rule's id; <c>"unknown"</c> when nothing graded the link.</summary>
    [SitrepUnit(Units.Id)]
    public string ModelId { get; set; } = "";

    /// <summary>The grading rule's display name, so a surface can say which grading is in play.</summary>
    [SitrepUnit(Units.Text)]
    public string ModelName { get; set; } = "";

    /// <summary>
    /// The rating: 0 pristine, 1 unusable, absent when unrated. Never outside
    /// that range, and never a NaN: an arithmetic that overshot is clamped to
    /// the end it overshot, and one that failed to resolve arrives absent.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? Level { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
