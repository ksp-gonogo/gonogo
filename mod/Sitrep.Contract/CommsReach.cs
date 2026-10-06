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
/// How far apart one pair of endpoints can be under a comms backend's rules and
/// still carry a link, as a single maximum separation.
///
/// <para>A backend builds one per pair, since reach depends on which two things
/// are talking: a dish and a whip do not reach the same distance. Whatever the
/// backend's own rule (antenna power against a range curve, or a link budget in
/// dB), it is resolved to a distance here.</para>
///
/// <para>Read any live game state, such as the endpoints' antennas, while
/// building the model, on the main thread during capture. Once built it must
/// not read the game: it is evaluated at thousands of future instants off the
/// main thread.</para>
///
/// <para>If the backend's reach is not a distance threshold (it gates on
/// pointing direction, say), give the threshold that holds for the pair, or
/// leave <see cref="MaxRangeMeters"/> null so the prediction falls back to
/// geometry alone.</para>
/// <internal>
/// A resolved separation rather than the antenna properties behind it, for the
/// reason ICommsOcclusionModel carries a radius: powers on the wire would push
/// the rule out to every consumer, each having to know which of stock's three
/// power pairings to apply and how to turn a dB budget into a distance. Both
/// shipped backends' rules are monotone in separation, so a threshold is exact
/// for them.
/// </internal>
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
    /// this model was built for. The three kinds of value mean different things:
    /// <list type="bullet">
    /// <item><description><b>null</b>: the backend does not limit this pair by
    /// range, or cannot say. A consumer applies no reach limit and relies on
    /// whatever else it models, which for a contact prediction is geometry
    /// alone. It does not mean unlimited range.</description></item>
    /// <item><description><b>0</b>: nothing reaches, which is not the same as
    /// null: an endpoint with no antenna, or a link budget that cannot close at
    /// any distance.</description></item>
    /// <item><description>a positive number: the rule, resolved.</description></item>
    /// </list>
    /// </summary>
    double? MaxRangeMeters { get; }
}

/// <summary>
/// A ready-made <see cref="ICommsReachModel"/>: one named maximum separation.
/// A comms backend whose rule resolves to a distance can return one of these
/// rather than implement the interface.
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

/// <summary>The fallback reach model, and the reach comparison.</summary>
/// <category>Propagation and models</category>
public static class CommsReachModels
{
    /// <summary><see cref="Unknown"/>'s id, so a consumer can recognise "nobody told me" without string-matching a display name.</summary>
    public const string UnknownModelId = "unknown";

    /// <summary>
    /// The model a consumer gets when no backend is elected, or when the
    /// elected one will not rate the pair it was handed.
    ///
    /// <para>Its maximum is null, so a consumer applies no reach limit. Its id is
    /// <see cref="UnknownModelId"/>, so a prediction built on it can report that
    /// it modelled geometry only.</para>
    /// <internal>
    /// Null rather than a conservative guess, unlike CommsOcclusionModels.Unknown:
    /// the unknown occluder can be conservative because real radii differ by only
    /// 33%, but a guessed-small reach predicts permanent silence for every craft
    /// and a guessed-large one over-promises contact.
    /// </internal>
    /// </summary>
    public static readonly ICommsReachModel Unknown =
        new MaxRangeReachModel(UnknownModelId, "Unknown (no comms backend elected)", null);

    /// <summary>
    /// Whether a pair separated by <paramref name="separationMeters"/> reaches,
    /// under <paramref name="model"/>. Null when the model sets no maximum, which
    /// is not the same as out of range.
    ///
    /// <para>A separation exactly at the maximum counts as reaching, as in
    /// stock.</para>
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
