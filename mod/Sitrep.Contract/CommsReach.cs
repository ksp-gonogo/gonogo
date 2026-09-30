namespace Sitrep.Contract;

/*
 * The REACH half of the comms contract: how far apart two endpoints can be and
 * still carry a link. The sibling of CommsOcclusion.cs: occlusion says whether
 * a body sits between two endpoints, reach says whether they can hear each
 * other at all. A predictor that models only the first promises reacquisition
 * the instant the craft clears the limb, however far out it is.
 *
 * It is a backend question rather than a core one because the rule differs per
 * backend:
 *
 *   * Stock CommNet gates on antenna power against a range curve:
 *     IRangeModel.GetNormalizedRange(aPower, bPower, distance) > 0, tried over
 *     up to three power pairings in CommNetwork.TryConnect (both relay, a
 *     relays, b relays) and connected if any of them clears. GetMaximumRange
 *     is the same rule solved for distance.
 *   * A replacement backend may gate on something else entirely, such as
 *     whether a link budget closes in dB, and may leave stock's antenna power
 *     fields meaningless, so stock's rule applied under it can report a
 *     maximum range of zero for every craft.
 *
 * So the elected backend declares its own rule (ICommsBackend.ReachModel) and
 * consumers read whatever it declared. The contract forces the SHAPE (one
 * maximum separation in metres for the pair handed over) and leaves the
 * JUDGEMENT of what that maximum is to the backend, which is what lets the
 * comparison and the never-over-promise fallback live here once.
 */

/// <summary>
/// The reach rule one comms backend applies to ONE PAIR of endpoints: a pure,
/// KSP-free statement of how far apart they can be and still carry a link.
///
/// <para>Deliberately a RESOLVED MAXIMUM SEPARATION rather than the antenna
/// properties behind it, for the same reason
/// <see cref="ICommsOcclusionModel"/> carries a radius rather than the
/// multipliers: powers on the wire would push the rule out to every consumer,
/// and each would have to know which of stock's three power pairings to apply,
/// what to do with a backend that has no power concept at all, and how to turn
/// a dB budget into a distance. A maximum separation is what a consumer
/// actually needs, and it is the same shape whatever the
/// backend's internal rule is.</para>
///
/// <para><b>Built PER PAIR, not per install.</b> Unlike an occlusion model,
/// which is one rule for the whole universe, reach depends on which two things
/// are talking: a dish and a whip do not reach the same distance, and RSS/RA
/// fly a dozen ground stations that do not share an antenna. So a backend is
/// handed the two endpoints and returns a model for THEM.</para>
///
/// <para>Pure once built: implementations must not read live KSP state. A
/// backend that needs a live read (both shipped ones do, they read the
/// endpoints' antennas) does it when BUILDING the model, on the main thread
/// during capture, and hands back a model that is thereafter just a number. That is what lets
/// a sweep evaluate it at thousands of future instants off the main
/// thread.</para>
///
/// <para><b>A rule that is not a distance threshold.</b> Both shipped backends'
/// rules are monotone in separation, so a threshold is exact for them. A future
/// backend whose reach genuinely is not (one that gates on pointing direction,
/// say) has the same escape hatch every other model here has: give the
/// threshold that is honest for the pair, or declare
/// <see cref="MaxRangeMeters"/> absent and let the prediction fall back to
/// geometry rather than assert a limit it does not believe.</para>
/// </summary>
/// <category>Propagation and models</category>
public interface ICommsReachModel
{
    /// <summary>Stable id for this rule, e.g. <c>"commnet-range-curve"</c>.</summary>
    string ModelId { get; }

    /// <summary>Human-readable name a UI can show, e.g. <c>"Stock CommNet (antenna power vs range curve)"</c>.</summary>
    string ModelName { get; }

    /// <summary>
    /// The greatest separation, metres, at which this backend carries the pair
    /// this model was built for. Three values, three meanings, and they must
    /// not be collapsed:
    /// <list type="bullet">
    /// <item><description><b>null</b>: ABSENT. This backend does not gate this
    /// pair on range, or cannot say. A consumer applies no reach term and falls
    /// back to whatever else it models, which for a contact predictor is
    /// geometry alone. It is NOT "unlimited range as measured"; it is "nobody
    /// measured".</description></item>
    /// <item><description><b>0</b>: nothing reaches. A real state, and not the
    /// same as absent: an endpoint with no antenna at all, or a budget that
    /// cannot close at any distance, genuinely has a maximum of zero.</description></item>
    /// <item><description>a positive number: the rule, resolved.</description></item>
    /// </list>
    /// </summary>
    double? MaxRangeMeters { get; }
}

/// <summary>
/// The reach rule shape both shipped backends fit: one resolved maximum
/// separation, named. General rather than per-backend, like
/// <see cref="ScaledRadiusOcclusionModel"/>: another comms mod whose rule also
/// resolves to a distance needs no new type.
/// </summary>
/// <category>Propagation and models</category>
public sealed class MaxRangeReachModel : ICommsReachModel
{
    /// <summary>
    /// A reach model with the given id, name and maximum. A NaN or infinite
    /// maximum is stored as absent (null), a negative one as 0, and a null id
    /// or name as an empty string.
    /// </summary>
    /// <param name="modelId">Stable id for the rule, such as <c>"commnet-range-curve"</c>.</param>
    /// <param name="modelName">Human-readable name a UI can show.</param>
    /// <param name="maxRangeMeters">The greatest separation in metres at which the pair is carried, or null when the rule does not say.</param>
    public MaxRangeReachModel(string modelId, string modelName, double? maxRangeMeters)
    {
        ModelId = modelId ?? "";
        ModelName = modelName ?? "";
        MaxRangeMeters = Sane(maxRangeMeters);
    }

    /// <inheritdoc cref="ICommsReachModel.ModelId"/>
    public string ModelId { get; }

    /// <inheritdoc cref="ICommsReachModel.ModelName"/>
    public string ModelName { get; }

    /// <summary>
    /// The greatest separation in metres at which the pair is carried: null when
    /// the rule does not say (including a NaN or infinite input), 0 when nothing
    /// reaches, otherwise a positive distance. See
    /// <see cref="ICommsReachModel.MaxRangeMeters"/>.
    /// </summary>
    public double? MaxRangeMeters { get; }

    /// <summary>
    /// A NaN or infinite maximum becomes ABSENT rather than a number, because
    /// both mean the rule failed to resolve and neither is a separation a
    /// comparison can use: an infinity would silently pass every distance and
    /// read as a measured "reaches everywhere". A negative maximum clamps to
    /// zero, which is what it means.
    /// </summary>
    private static double? Sane(double? maxRangeMeters)
    {
        if (maxRangeMeters == null)
        {
            return null;
        }
        var value = maxRangeMeters.Value;
        if (double.IsNaN(value) || double.IsInfinity(value))
        {
            return null;
        }
        return value < 0.0 ? 0.0 : value;
    }
}

/// <summary>The reach models core itself declares, and the one comparison every consumer shares.</summary>
/// <category>Propagation and models</category>
public static class CommsReachModels
{
    /// <summary><see cref="Unknown"/>'s id, so a consumer can recognise "nobody told me" without string-matching a display name.</summary>
    public const string UnknownModelId = "unknown";

    /// <summary>
    /// The model a consumer gets when no backend is elected, or when the
    /// elected one will not rate the pair it was handed.
    ///
    /// <para>Its maximum is ABSENT, and that asymmetry with
    /// <see cref="CommsOcclusionModels.Unknown"/> is deliberate. The unknown
    /// OCCLUDER can be conservative and still be usable, because the largest
    /// radius any real backend applies is only 33% larger than the smallest.
    /// There is no such conservative reach: a guessed-small maximum predicts
    /// permanent silence for every craft in the game and destroys the
    /// prediction outright, while a guessed-large one over-promises contact.
    /// So an unelected backend asserts nothing and the consumer models what it
    /// can, which leaves the prediction exactly as honest as one that models no
    /// reach at all.</para>
    ///
    /// <para>The state is still DECLARED rather than assumed: the id says
    /// "unknown", so a predictor built on it can report that it modelled
    /// geometry only. That is the difference between an untested assumption and
    /// a stated one, and it is the same distinction the occlusion model already
    /// draws.</para>
    /// </summary>
    public static readonly ICommsReachModel Unknown =
        new MaxRangeReachModel(UnknownModelId, "Unknown (no comms backend elected)", null);

    /// <summary>
    /// Whether a pair separated by <paramref name="separationMeters"/> reaches,
    /// under <paramref name="model"/>. Null when the model asserts no maximum,
    /// which is a THIRD result and not a false: "this rule does not say" must
    /// not be readable as "out of range".
    ///
    /// <para>Reaching AT the maximum counts as reaching, matching stock's own
    /// <c>InRange</c>, which admits the boundary.</para>
    /// <internal>
    /// The comparison lives here, alone, for the reason
    /// <c>ChordOcclusion.Unobstructed</c> gives: two copies that disagreed by one
    /// <c>=</c> would put a refiner on the other side of the limit from the sweep
    /// that bracketed it.
    /// </internal>
    /// </summary>
    /// <param name="model">The reach model for the pair, or null.</param>
    /// <param name="separationMeters">The pair's separation, in metres.</param>
    /// <returns>True when in reach, false when out of reach, null when the model sets no maximum, the model is null, or the separation is NaN.</returns>
    public static bool? Reaches(ICommsReachModel? model, double separationMeters)
    {
        var max = model?.MaxRangeMeters;
        if (max == null || double.IsNaN(separationMeters))
        {
            return null;
        }
        return separationMeters <= max.Value;
    }
}
