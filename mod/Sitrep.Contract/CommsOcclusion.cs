#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

// ====================================================================
// The OCCLUSION half of the comms contract: how big a body has to be
// treated as, for the purpose of deciding whether it blocks a radio path.
//
// This is VISIBILITY GEOMETRY, not delay. It answers "does this rock sit
// between the two endpoints", and it is the one comms question whose
// answer genuinely differs between backends rather than merely being
// richer under one of them:
//
//   * Stock CommNet shrinks the body before testing, by
//     CommNetParams.occlusionMultiplierVac (0.9) for an airless body and
//     occlusionMultiplierAtm (0.75) for one with an atmosphere. For Kerbin
//     that is a 450 km occluder against a 600 km rock.
//   * RealAntennas tests against the BARE radius, no multiplier at all
//     (FilterCommNodesByOcclusion.Occluded / Precompute.SetupOccluders both
//     take body.Radius straight).
//
// ~11 minutes of predicted low-orbit blackout separate those two answers
// for one Kerbin orbit, so a consumer that guesses is not approximately
// right, it is wrong. Rather than have every consumer branch on which mod
// is installed, the ELECTED backend declares its own model
// (ICommsBackend.OcclusionModel) and consumers read whatever the winner
// declared.
// ====================================================================

/// <summary>
/// The occlusion geometry one comms backend applies: a pure, KSP-free rule
/// mapping a body to the radius that actually blocks a radio path through it.
///
/// <para>Deliberately a RESOLVED RADIUS rather than the multipliers behind
/// it. Multipliers on the wire would push the rule out to every consumer,
/// and each would have to know which of the two to apply (the vac/atm choice
/// is stock's, not a universal one) and what to do when a backend has no
/// multipliers at all. A radius is the answer to the question actually being
/// asked, and it is the same shape whatever the backend's internal rule is:
/// a future backend whose occluder is not a scaled sphere still has a
/// number to give here.</para>
///
/// <para><see cref="ModelId"/>/<see cref="ModelName"/> travel WITH the
/// answer so the assumption stays inspectable: a predictor that says
/// "reacquire in 11 minutes" can also say which geometry it believed.</para>
///
/// <para>Pure: implementations must not read live KSP state. A backend that
/// needs a live read (stock's multipliers come from the game's difficulty
/// settings) does it when BUILDING the model, on the capture seam, and hands
/// back a model that is thereafter just arithmetic.</para>
/// </summary>
public interface ICommsOcclusionModel
{
    /// <summary>Stable id for this model, e.g. <c>"commnet-scaled-radius"</c>.</summary>
    string ModelId { get; }

    /// <summary>Human-readable name a UI can show, e.g. <c>"Stock CommNet (occlusion multipliers)"</c>.</summary>
    string ModelName { get; }

    /// <summary>
    /// The radius, metres, at which this backend treats the body as blocking a
    /// radio path. <paramref name="hasAtmosphere"/> is the only body property
    /// any backend currently discriminates on; a body's bare radius is
    /// <paramref name="bodyRadiusMeters"/>.
    /// </summary>
    double OccludingRadiusMeters(double bodyRadiusMeters, bool hasAtmosphere);
}

/// <summary>
/// The occlusion rule every backend that exists today happens to use: the
/// body's radius scaled by one multiplier for an airless body and another for
/// one with an atmosphere. Both stock CommNet (0.9 / 0.75) and RealAntennas
/// (1.0 / 1.0, i.e. the bare radius) are instances of it, differing only in
/// the two numbers and in what they call themselves.
///
/// <para>General rather than per-backend on purpose: a third comms mod with
/// its own multipliers needs no new type, and one whose rule is NOT a scaled
/// sphere implements <see cref="ICommsOcclusionModel"/> directly instead.</para>
/// </summary>
public sealed class ScaledRadiusOcclusionModel : ICommsOcclusionModel
{
    public ScaledRadiusOcclusionModel(
        string modelId,
        string modelName,
        double vacuumMultiplier,
        double atmosphereMultiplier)
    {
        ModelId = modelId ?? "";
        ModelName = modelName ?? "";
        VacuumMultiplier = Finite(vacuumMultiplier);
        AtmosphereMultiplier = Finite(atmosphereMultiplier);
    }

    public string ModelId { get; }

    public string ModelName { get; }

    /// <summary>Applied to an airless body (stock: <c>occlusionMultiplierVac</c>).</summary>
    public double VacuumMultiplier { get; }

    /// <summary>Applied to a body with an atmosphere (stock: <c>occlusionMultiplierAtm</c>).</summary>
    public double AtmosphereMultiplier { get; }

    public double OccludingRadiusMeters(double bodyRadiusMeters, bool hasAtmosphere)
    {
        if (double.IsNaN(bodyRadiusMeters) || double.IsInfinity(bodyRadiusMeters) || bodyRadiusMeters <= 0)
        {
            return 0.0;
        }
        return bodyRadiusMeters * (hasAtmosphere ? AtmosphereMultiplier : VacuumMultiplier);
    }

    /// <summary>
    /// A non-finite or negative multiplier becomes 1.0 (the bare radius) rather
    /// than propagating into the resolved radius. A NaN occluding radius poisons
    /// every comparison a predictor makes downstream and would read as "never
    /// occluded"; the bare radius is the conservative substitute, it predicts
    /// the longest blackout and so never promises contact that isn't there.
    /// </summary>
    private static double Finite(double multiplier) =>
        double.IsNaN(multiplier) || double.IsInfinity(multiplier) || multiplier < 0
            ? 1.0
            : multiplier;
}

/// <summary>The occlusion models core itself declares.</summary>
public static class CommsOcclusionModels
{
    /// <summary><see cref="Unknown"/>'s id, so a consumer can recognise "nobody told me" without string-matching a display name.</summary>
    public const string UnknownModelId = "unknown";

    /// <summary>
    /// The model a consumer gets when no backend is elected (pre-resolution, or
    /// a pathological install with no comms capability at all). Occludes at the
    /// BARE radius, the same conservative choice a bad multiplier falls back to:
    /// the largest occluder any real backend uses, so a predictor built on it
    /// under-promises contact rather than over-promising it.
    /// </summary>
    public static readonly ICommsOcclusionModel Unknown =
        new ScaledRadiusOcclusionModel(UnknownModelId, "Unknown (no comms backend elected)", 1.0, 1.0);
}

/// <summary>
/// One body's occlusion geometry, as resolved by the elected model.
/// <see cref="Index"/> matches <c>BodyEntry.Index</c> on <c>system.bodies</c>
/// (both are <c>CelestialBody.flightGlobalsIndex</c>), so a consumer joins the
/// two without name-matching.
///
/// <para>Both radii ride the wire: <see cref="RadiusMeters"/> is what the rock
/// measures and <see cref="OccludingRadiusMeters"/> is what the backend treats
/// it as. Carrying both keeps the difference visible (and the multiplier
/// derivable) without asking any consumer to apply one.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommsOcclusionBody
{
    [SitrepUnit(Units.Id)]
    public int Index { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }

    /// <summary>The body's own mean radius (<c>CelestialBody.Radius</c>).</summary>
    [SitrepUnit(Units.Metres)]
    public double RadiusMeters { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool HasAtmosphere { get; set; }

    /// <summary>What the elected backend treats as blocking a radio path through this body.</summary>
    [SitrepUnit(Units.Metres)]
    public double OccludingRadiusMeters { get; set; }
}

/// <summary>
/// The <c>comms.occlusion</c> payload: always-present, sourced from the elected
/// backend (the PROVIDER axis <c>Comms.cs</c>'s header describes). The declared
/// occlusion model, named, with its rule already applied to every celestial
/// body the game knows about.
///
/// <para>TRUE-NOW like the rest of the comms family, and for a stronger reason
/// than most: this is not an observation of the vessel at all, it is a
/// statement about the universe's geometry and the rule the elected backend
/// applies to it. Delaying it would mean a predictor computing tomorrow's
/// blackout from yesterday's model.</para>
///
/// <para>Effectively static within a session: the body set does not change and
/// the multipliers change only if the player edits the difficulty settings. The
/// producer republishes an unchanged instance, which the emitter's change-gate
/// suppresses, so the channel costs a keyframe and nothing else.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.occlusion")]
public class CommsOcclusion
{
    /// <summary>The elected model's <see cref="ICommsOcclusionModel.ModelId"/>; <c>"unknown"</c> when no backend is elected.</summary>
    [SitrepUnit(Units.Id)]
    public string ModelId { get; set; } = "";

    /// <summary>The elected model's display name, so a UI can say which geometry is in play.</summary>
    [SitrepUnit(Units.Text)]
    public string ModelName { get; set; } = "";

    /// <summary>Every known celestial body, with the model applied. Empty before the game has populated a body list, never null.</summary>
    public IReadOnlyList<CommsOcclusionBody> Bodies { get; set; } = new List<CommsOcclusionBody>();

    public PayloadMeta Meta { get; set; } = new();
}
