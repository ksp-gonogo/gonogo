#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// How degraded one comms link is, as one backend grades it: a rating on a
/// fixed 0..1 scale, with the rule that produced it named alongside. A comms
/// backend returns one of these for a link, and <c>comms.degrade</c> publishes it.
///
/// <para>A resolved rating rather than the quantities behind it: a margin in
/// dB, a range fraction and a rate-ladder position cannot be compared, and a
/// consumer handed any of them would have to know which backend produced it.
/// The judgement of what degrades a link, and by how much, is the backend's;
/// the contract fixes only the shape and the scale.</para>
///
/// <para><see cref="ModelId"/> and <see cref="ModelName"/> name the rule, because
/// different backends grade a link by different physics: a feed that drops to
/// a lower bitrate can say which grading told it to, and an operator comparing
/// two installs can see why the same orbit rates differently.</para>
///
/// <para>Pure once built: an implementation must not read live game state. A
/// backend that needs a live read does it while building the model, on the
/// main thread, and hands back a model that is thereafter just a number.</para>
/// </summary>
/// <category>Propagation and models</category>
public interface ICommsDegradeModel
{
    /// <summary>Stable id for this rule, e.g.
    /// <c>"commnet-range-fraction"</c>.</summary>
    string ModelId { get; }

    /// <summary>Human-readable name a UI can show, e.g. <c>"Stock CommNet
    /// (range fraction)"</c>.</summary>
    string ModelName { get; }

    /// <summary>
    /// How degraded the link is, 0..1, or absent. The three cases mean
    /// different things and must not be collapsed:
    /// <list type="bullet">
    /// <item><description><b>null</b>: UNRATED. This backend does not grade this
    /// link, or could not this tick. A consumer applies no quality term and
    /// keeps whatever it was already doing. It is NOT a zero: "nobody rated
    /// this" and "this link is perfect" are opposite instructions to a feed
    /// deciding whether to drop a bitrate.</description></item>
    /// <item><description><b>0</b>: PRISTINE. Nothing is wrong with the link, as
    /// a real grading. A save that models no comms network at all reports
    /// exactly this, because nothing can attenuate a link that is not
    /// modelled.</description></item>
    /// <item><description><b>1</b>: UNUSABLE. Nothing worth sending gets
    /// through. A disconnected craft rates here.</description></item>
    /// <item><description>anything between: worse as it
    /// rises.</description></item>
    /// </list>
    /// </summary>
    double? Level { get; }
}

/// <summary>
/// A degrade model holding one resolved rating and the name of its rule. Use it
/// for any backend whose grading resolves to a single fraction.
///
/// <para>The constructor enforces the 0..1 range: a finite rating outside it is
/// clamped to the nearer end, and a NaN or infinite rating becomes absent, so
/// <see cref="Level"/> is always in range or <c>null</c>.</para>
/// </summary>
/// <category>Propagation and models</category>
public sealed class RatedDegradeModel : ICommsDegradeModel
{
    /// <summary>Builds a model from a backend's own rating.</summary>
    /// <param name="modelId">Stable id for the rule, e.g. <c>"commnet-range-fraction"</c>. A null id becomes <c>""</c>.</param>
    /// <param name="modelName">Display name for the rule. A null name becomes <c>""</c>.</param>
    /// <param name="level">The rating, 0 pristine to 1 unusable, or <c>null</c> for unrated. Clamped into 0..1 when finite; a NaN or infinite value becomes <c>null</c>.</param>
    public RatedDegradeModel(string modelId, string modelName, double? level)
    {
        ModelId = modelId ?? "";
        ModelName = modelName ?? "";
        Level = Sane(level);
    }

    /// <summary>Stable id for this rule; never null.</summary>
    public string ModelId { get; }

    /// <summary>Display name for this rule; never null.</summary>
    public string ModelName { get; }

    /// <summary>The rating, 0 pristine to 1 unusable, or <c>null</c> when unrated. Never outside 0..1 and never NaN.</summary>
    public double? Level { get; }

    /// <summary>
    /// The clamp rule.
    ///
    /// <para>A NaN or infinite rating becomes absent rather than a number,
    /// because both mean the arithmetic failed to resolve: a NaN silently fails
    /// every comparison and so reads as "not degraded". This is where a
    /// reflection read that came back empty stops being a value.</para>
    ///
    /// <para>A FINITE rating outside 0..1 clamps to the nearer end, and that
    /// asymmetry with the non-finite case is deliberate. An out-of-range finite
    /// number is an arithmetic that ran and overshot (a headroom fraction above
    /// 1, a difference that went slightly negative), so the end it overshot is
    /// the honest value. A non-finite one is an arithmetic that did not run at
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

/// <summary>The built-in <see cref="Unknown"/> degrade model, and the shared
/// reads over any <see cref="ICommsDegradeModel"/>.</summary>
/// <category>Propagation and models</category>
public static class CommsDegradeModels
{
    /// <summary><see cref="Unknown"/>'s id, so a consumer can recognise "nobody
    /// told me" without string-matching a display name.</summary>
    public const string UnknownModelId = "unknown";

    /// <summary>
    /// The model in force when no comms backend is elected, or when the elected
    /// one does not grade the link, or its grading throws.
    ///
    /// <para>Its rating is absent, with no conservative substitute, as for
    /// <see cref="CommsReachModels.Unknown"/>. Both ends of the scale are
    /// actionable: a guessed 0 tells a video feed to send full quality down a
    /// link nobody has vouched for, and a guessed 1 blacks out a feed that is
    /// arriving perfectly. A consumer seeing it applies no quality term and
    /// keeps doing what it was doing.</para>
    ///
    /// <para>Its id is <see cref="UnknownModelId"/>, so a surface can report that
    /// it is running ungraded rather than looking the same as a perfect link.</para>
    /// </summary>
    public static readonly ICommsDegradeModel Unknown =
        new RatedDegradeModel(UnknownModelId, "Unknown (no comms backend elected)", null);

    /// <summary>
    /// The rating under <paramref name="model"/>, or null when it declines to
    /// grade or <paramref name="model"/> is null. Null is not a zero: do not
    /// default it with <c>?? 0</c>, which reads an unrated link as a perfect one.
    /// </summary>
    public static double? LevelOf(ICommsDegradeModel? model) => model?.Level;

    /// <summary>
    /// Whether the link is AT LEAST as degraded as
    /// <paramref name="threshold"/>, under <paramref name="model"/>. Null when
    /// the model declines to grade, or <paramref name="threshold"/> is NaN: null
    /// is not a false, and must not be read as "the link is fine".
    ///
    /// <para>Meeting the threshold exactly counts as meeting it, so a ladder built
    /// from ascending thresholds picks the highest rung the rating reaches. Use
    /// this rather than comparing by hand, so every surface puts a rating on the
    /// same rung.</para>
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
    /// <paramref name="meta"/> (a null <paramref name="meta"/> becomes an empty
    /// one). A null model is published as <see cref="Unknown"/>, so a producer
    /// that could not resolve a backend still publishes "nobody graded this":
    /// the channel is always present, and a silent channel looks the same as a
    /// stalled one.
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
/// getting through. It is absent when nothing graded the link, and absent is a
/// third case rather than a low one: "nobody rated this" and "this link is
/// perfect" are opposite instructions to anything choosing a quality, so branch
/// on the absence rather than defaulting it to a number.</para>
///
/// <para><b>Read this rather than deriving a quality from
/// <c>comms.signal</c>.</b> That field is 0..1 too, and it is a
/// different quantity on a stock install than on a RealAntennas one: a range
/// fraction against an antenna curve versus spare room on a data-rate ladder.
/// Nothing on the wire distinguishes them, so <c>1 - strength</c> is two
/// different quality curves on two saves. This channel names its rule, so a
/// consumer acting on the number can see which grading produced it.</para>
///
/// <para>Delayed, like the link observations it grades and unlike the
/// always-live <c>comms.delay</c>. A rating is an observation of the craft's
/// link, so an operator learns of a degradation one light-time after it
/// happened, at the same instant the telemetry that suffered it arrives.
/// Through a blackout it holds its last-known value; the disconnect itself
/// reaches a client on <c>comms.link</c>, which is not held.</para>
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.degrade")]
public class CommsDegrade
{
    /// <summary>The grading rule's id; <c>"unknown"</c> when nothing graded the
    /// link.</summary>
    [SitrepUnit(Units.Id)]
    public string ModelId { get; set; } = "";

    /// <summary>The grading rule's display name, so a surface can say which
    /// grading is in play.</summary>
    [SitrepUnit(Units.Text)]
    public string ModelName { get; set; } = "";

    /// <summary>
    /// The rating: 0 pristine, 1 unusable, absent when unrated. Never outside
    /// that range, and never a NaN: an arithmetic that overshot is clamped to
    /// the end it overshot, and one that failed to resolve arrives absent.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? Level { get; set; }

    /// <summary>The payload's provenance and quality.</summary>
    public PayloadMeta Meta { get; set; } = new();
}
