using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// The orbit a centre holds for a craft, with what says how far it may be
    /// carried: the elements, the body they are around, the next change of
    /// sphere of influence and the propagation provider's horizon.
    /// </summary>
    public sealed class ConicOrbit
    {
        /// <param name="referenceBodyIndex">The body the orbit is around, as a <c>trackingStation.bodies</c> index.</param>
        /// <param name="elements">The elements in radians. An ascending node or argument of periapsis the game leaves undefined is 0; any other figure that is absent is NaN, never 0.</param>
        /// <param name="encounterTransitionUt">When the current patch ends at a change of sphere of influence. Null when there is none or the save cannot compute one.</param>
        /// <param name="horizon">How far the provider vouches for the elements. Null when nothing stated one.</param>
        public ConicOrbit(int referenceBodyIndex, OrbitElements elements, double? encounterTransitionUt, PropagationHorizon? horizon)
        {
            ReferenceBodyIndex = referenceBodyIndex;
            Elements = elements;
            EncounterTransitionUt = encounterTransitionUt;
            Horizon = horizon;
        }

        public int ReferenceBodyIndex { get; }

        public OrbitElements Elements { get; }

        public double? EncounterTransitionUt { get; }

        public PropagationHorizon? Horizon { get; }
    }

    /// <summary>One sample of a craft's orbit: the instant it holds at and whether the game was simulating the craft in full.</summary>
    public sealed class ConicSample
    {
        /// <param name="validAt">The UT the sample is true at.</param>
        /// <param name="quality">Whether the craft was on rails or loaded when the sample was taken.</param>
        /// <param name="orbit">The orbit, or null when the game confirmed there is none.</param>
        public ConicSample(double validAt, Quality quality, ConicOrbit? orbit)
        {
            ValidAt = validAt;
            Quality = quality;
            Orbit = orbit;
        }

        public double ValidAt { get; }

        public Quality Quality { get; }

        public ConicOrbit? Orbit { get; }
    }

    /// <summary>
    /// What is known of one body for deciding where a conic stops holding. Each
    /// figure is null where nothing stated it; a figure that is not finite, or a
    /// sphere of influence or atmosphere depth that is not above zero, counts as
    /// absent.
    /// </summary>
    public sealed class ConicBody
    {
        /// <param name="index">The body's <c>trackingStation.bodies</c> index.</param>
        /// <param name="radius">Surface radius, in metres.</param>
        /// <param name="atmosphereDepth">How high the atmosphere reaches above sea level, in metres.</param>
        /// <param name="sphereOfInfluence">Radius of the sphere of influence, in metres.</param>
        public ConicBody(int index, double? radius, double? atmosphereDepth, double? sphereOfInfluence)
        {
            Index = index;
            Radius = radius;
            AtmosphereDepth = atmosphereDepth;
            SphereOfInfluence = sphereOfInfluence;
        }

        public int Index { get; }

        public double? Radius { get; }

        public double? AtmosphereDepth { get; }

        public double? SphereOfInfluence { get; }
    }

    /// <summary>
    /// The engines' last stated condition, as <c>vessel.propulsion</c> carries it.
    /// A thrust that is null or not a number counts as firing, and a burn start
    /// that is present, whatever its value, is a burn in progress.
    /// </summary>
    public sealed class ConicThrust
    {
        /// <param name="currentThrust">The thrust now.</param>
        /// <param name="thrustStartedUt">When the current burn began. Null when no burn is in progress.</param>
        /// <param name="lastThrustEndUt">When the last burn ended. Null when none has.</param>
        public ConicThrust(double? currentThrust, double? thrustStartedUt, double? lastThrustEndUt)
        {
            CurrentThrust = currentThrust;
            ThrustStartedUt = thrustStartedUt;
            LastThrustEndUt = lastThrustEndUt;
        }

        public double? CurrentThrust { get; }

        public double? ThrustStartedUt { get; }

        public double? LastThrustEndUt { get; }
    }

    /// <summary>A command one centre has sent the craft and not yet heard answered.</summary>
    public sealed class ConicPendingCommand
    {
        /// <param name="dispatchedAt">The UT the command left the centre.</param>
        /// <param name="oneWaySeconds">How long it takes to reach the craft. Null while the centre knows no route, so the command is held and reaches nothing.</param>
        public ConicPendingCommand(double? dispatchedAt, double? oneWaySeconds)
        {
            DispatchedAt = dispatchedAt;
            OneWaySeconds = oneWaySeconds;
        }

        public double? DispatchedAt { get; }

        public double? OneWaySeconds { get; }
    }

    /// <summary>What carrying a loaded craft's orbit forward needs: whether its engines are firing, and which commands will reach it.</summary>
    public sealed class LoadedCoastEvidence
    {
        /// <param name="thrust">The engines' last stated condition, null where nothing has said.</param>
        /// <param name="pending">The commands in flight from the centre asking, null where the queue is not known.</param>
        public LoadedCoastEvidence(ConicThrust? thrust, IReadOnlyList<ConicPendingCommand>? pending)
        {
            Thrust = thrust;
            Pending = pending;
        }

        public ConicThrust? Thrust { get; }

        public IReadOnlyList<ConicPendingCommand>? Pending { get; }
    }

    /// <summary>
    /// Why an orbit may not be carried to a view time: a <see cref="Reason"/> to
    /// branch on, the input responsible, and a sentence for the operator whose
    /// wording may change.
    /// </summary>
    public sealed class ConicDecline
    {
        public const string InputAbsent = "input-absent";
        public const string BeyondHorizon = "beyond-horizon";
        public const string ModelInapplicable = "model-inapplicable";
        public const string UnderPhysics = "under-physics";

        public ConicDecline(string reason, string input, string? note)
        {
            Reason = reason;
            Input = input;
            Note = note;
        }

        public string Reason { get; }

        public string Input { get; }

        public string? Note { get; }
    }

    /// <summary>
    /// Whether a craft's orbit may be carried forward to a view time by a two-body
    /// model, decided the same way the browser's <c>keplerAdmissibility</c>
    /// decides it, so the mod and every screen agree on where the conic ends.
    /// <c>mod/golden-fixtures/kepler-admissibility.json</c> holds both to the same
    /// answers.
    /// </summary>
    public static class KeplerAdmissibility
    {
        internal const string PatchEndNote = "this patch ends at the SOI transition";

        private const double UndefinedAngleTolerance = 1e-9;

        /// <summary>
        /// The ascending node, in radians, as <see cref="ConicOrbit"/> carries it: the
        /// stated figure, 0 when none is stated and the orbit has no inclination to
        /// anchor one, and NaN (absent) otherwise.
        /// </summary>
        public static double NodeRadians(double? lanRadians, double incRadians) =>
            lanRadians ?? (Math.Abs(Math.Sin(incRadians)) < UndefinedAngleTolerance ? 0.0 : double.NaN);

        /// <summary>
        /// The argument of periapsis, in radians, as <see cref="ConicOrbit"/> carries it:
        /// the stated figure, 0 when none is stated and the orbit is circular, and NaN
        /// (absent) otherwise.
        /// </summary>
        public static double PeriapsisRadians(double? argPeRadians, double ecc) =>
            argPeRadians ?? (Math.Abs(ecc) < UndefinedAngleTolerance ? 0.0 : double.NaN);

        /// <summary>
        /// Null when the orbit may be carried to <paramref name="viewUt"/>, or the
        /// decline naming the input that rules it out. It declines when:
        /// <list type="bullet">
        /// <item>the provider says the orbit holds forever but is not a fixed conic, or does not say what it is</item>
        /// <item>an element is absent or not a number, or the elements describe no orbit: a negative eccentricity, a gravitational parameter of zero or below, or a semi-major axis that does not fit the eccentricity</item>
        /// <item>the craft is loaded, and <paramref name="coast"/> does not show that its engines are cold, that the elements were taken after the last burn ended, that it is above the atmosphere, and that no command reaches it before <paramref name="viewUt"/></item>
        /// <item><paramref name="viewUt"/> is at or past the next change of sphere of influence</item>
        /// <item><paramref name="viewUt"/> is past the provider's horizon, or no horizon was stated</item>
        /// <item>the orbit is outside its body's sphere of influence at <paramref name="viewUt"/></item>
        /// <item>the orbit is inside the atmosphere at <paramref name="viewUt"/>, or under the surface of a body with none, or passed through either since the sample</item>
        /// <item>no position can be solved at <paramref name="viewUt"/>, as for parabolic elements</item>
        /// </list>
        /// Missing <paramref name="bodies"/> or a missing encounter is not a reason to decline.
        /// </summary>
        public static ConicDecline? Decline(ConicSample? sample, IReadOnlyList<ConicBody>? bodies, double viewUt, LoadedCoastEvidence? coast)
        {
            var orbit = sample?.Orbit;
            if (sample == null || orbit == null)
            {
                return new ConicDecline(ConicDecline.InputAbsent, "@vessel.orbit", null);
            }
            var authority = TrajectoryAuthority(orbit.Horizon);
            if (authority != null)
            {
                return authority;
            }
            var unsolvable = UnsolvableElements(orbit.Elements);
            if (unsolvable != null)
            {
                return unsolvable;
            }
            if (sample.Quality != Quality.OnRails)
            {
                var loaded = LoadedCoastDecline(sample, orbit, bodies, viewUt, coast);
                if (loaded != null)
                {
                    return loaded;
                }
            }
            if (orbit.EncounterTransitionUt is double transitionUt && IsFinite(transitionUt) && viewUt >= transitionUt)
            {
                return new ConicDecline(ConicDecline.BeyondHorizon, "@vessel.orbit", PatchEndNote);
            }
            if (!WithinHorizon(orbit.Horizon, viewUt))
            {
                return new ConicDecline(
                    ConicDecline.BeyondHorizon,
                    "@vessel.orbit",
                    "past the reach the propagation provider states for these elements");
            }
            var elements = Finite(orbit.Elements);
            var radius = RadiusAt(elements, viewUt);
            if (!IsFinite(radius))
            {
                return elements.Ecc == 1.0
                    ? new ConicDecline(ConicDecline.ModelInapplicable, "@vessel.orbit#ecc", "parabolic elements: there is no position to carry forward")
                    : new ConicDecline(ConicDecline.ModelInapplicable, "@vessel.orbit", "no position can be solved for these elements at that time");
            }
            var reach = SphereOfInfluenceRadius(bodies, orbit.ReferenceBodyIndex);
            if (reach is double soi && radius > soi)
            {
                return new ConicDecline(
                    ConicDecline.BeyondHorizon,
                    "@trackingStation.bodies",
                    "outside the body's sphere of influence, where another body's gravity takes over");
            }
            if (EntryInterfaceRadius(bodies, orbit.ReferenceBodyIndex) is double floor)
            {
                if (radius <= floor)
                {
                    return new ConicDecline(
                        ConicDecline.BeyondHorizon,
                        "@trackingStation.bodies",
                        "below the atmosphere interface, where drag the conic does not model takes over");
                }
                /*
                 * A conic whose periapsis is under the floor climbs back above it on
                 * the far side, so where it is at the view time does not say whether
                 * it went through the floor on the way there.
                 */
                if (elements.Sma * (1 - elements.Ecc) <= floor && PeriapsisPassedBy(elements, sample.ValidAt, viewUt))
                {
                    return new ConicDecline(
                        ConicDecline.BeyondHorizon,
                        "@trackingStation.bodies",
                        "the conic passed below the atmosphere interface or the surface before then");
                }
            }
            return null;
        }

        /// <summary>
        /// The n-body rule. An unbounded reach is a conic only when the provider
        /// says the elements are analytic: an integrating provider in a quiet
        /// regime can honestly report no limit, and its elements are a snapshot of
        /// a path, not the path. A bounded reach is a window the provider measured
        /// and vouched for, which the horizon check enforces.
        /// </summary>
        private static ConicDecline? TrajectoryAuthority(PropagationHorizon? horizon)
        {
            if (horizon == null || horizon.Kind != PropagationHorizonKind.Unbounded || horizon.TrajectoryKind == TrajectoryKind.Analytic)
            {
                return null;
            }
            if (horizon.TrajectoryKind == TrajectoryKind.Integrated)
            {
                return new ConicDecline(
                    ConicDecline.ModelInapplicable,
                    "@vessel.orbit#horizon",
                    "the provider integrates these elements and bounded nothing, so there is no window in which they are a conic to advance");
            }
            return new ConicDecline(
                ConicDecline.ModelInapplicable,
                "@vessel.orbit#horizon",
                "no provider stated what kind of answer these elements are, so nothing vouches for carrying them forever as a conic");
        }

        /// <summary>
        /// Why the elements place the craft nowhere, or null when every one is a
        /// number and together they describe an orbit. Parabolic elements pass, so
        /// that a burn through an eccentricity of 1 still reaches the coast checks,
        /// and are declined where their position is asked for.
        /// </summary>
        private static ConicDecline? UnsolvableElements(OrbitElements e)
        {
            var fields = new (string Key, string Name, double Value)[]
            {
                ("sma", "semi-major axis", e.Sma),
                ("ecc", "eccentricity", e.Ecc),
                ("inc", "inclination", e.Inc),
                ("lan", "longitude of the ascending node", e.Lan),
                ("argPe", "argument of periapsis", e.ArgPe),
                ("meanAnomalyAtEpoch", "mean anomaly at epoch", e.MeanAnomalyAtEpoch),
                ("epoch", "epoch", e.Epoch),
                ("mu", "gravitational parameter", e.Mu),
            };
            foreach (var field in fields)
            {
                if (!IsFinite(field.Value))
                {
                    return new ConicDecline(
                        ConicDecline.InputAbsent,
                        "@vessel.orbit#" + field.Key,
                        "the orbit's " + field.Name + " is absent, so there is no position to carry forward");
                }
            }
            if (e.Ecc < 0)
            {
                return new ConicDecline(ConicDecline.ModelInapplicable, "@vessel.orbit#ecc", "a negative eccentricity describes no orbit");
            }
            if (!(e.Mu > 0))
            {
                return new ConicDecline(ConicDecline.ModelInapplicable, "@vessel.orbit#mu", "a gravitational parameter of zero or below describes no orbit");
            }
            if (e.Sma == 0 || (e.Ecc < 1 && e.Sma < 0))
            {
                return new ConicDecline(
                    ConicDecline.ModelInapplicable,
                    "@vessel.orbit#sma",
                    "the semi-major axis does not fit the eccentricity, so the elements describe no orbit");
            }
            return null;
        }

        private static bool WithinHorizon(PropagationHorizon? horizon, double viewUt)
        {
            if (horizon == null)
            {
                return false;
            }
            if (horizon.Kind == PropagationHorizonKind.Unbounded)
            {
                return true;
            }
            if (horizon.Kind != PropagationHorizonKind.Until || !(horizon.UntilUt is double untilUt) || !IsFinite(untilUt))
            {
                return false;
            }
            return !(viewUt > untilUt);
        }

        /// <summary>
        /// The coast evidence. A loaded craft's elements are rebuilt from the
        /// integrated state every frame, so in vacuum with the engines cold they
        /// are the two-body orbit it is on. A loaded craft is the one most likely
        /// to be in air or under thrust, so a missing fact here refuses.
        /// </summary>
        private static ConicDecline? LoadedCoastDecline(ConicSample sample, ConicOrbit orbit, IReadOnlyList<ConicBody>? bodies, double viewUt, LoadedCoastEvidence? coast)
        {
            var thrust = coast?.Thrust;
            if (thrust == null)
            {
                return UnderPhysics("@vessel.propulsion", "the craft is under physics and nothing says whether its engines are firing");
            }
            if (IsUnderThrust(thrust))
            {
                return UnderPhysics("@vessel.propulsion", "the craft is under thrust, so its elements are not a coast a conic can advance");
            }
            if (thrust.LastThrustEndUt != null && Mag(thrust.LastThrustEndUt) > sample.ValidAt)
            {
                return UnderPhysics("@vessel.propulsion", "these elements were taken before the last burn ended");
            }
            return LoadedRegimeDecline(sample, orbit, bodies, viewUt, coast?.Pending);
        }

        private static bool IsUnderThrust(ConicThrust thrust) =>
            !(Mag(thrust.CurrentThrust) == 0.0) || thrust.ThrustStartedUt != null;

        /// <summary>
        /// The craft is above the atmosphere at the elements' own epoch, and no
        /// command reaches it after the sample and by the view time. One that
        /// arrived by the sample has had its effect observed.
        /// </summary>
        private static ConicDecline? LoadedRegimeDecline(ConicSample sample, ConicOrbit orbit, IReadOnlyList<ConicBody>? bodies, double viewUt, IReadOnlyList<ConicPendingCommand>? pending)
        {
            if (!(EntryInterfaceRadius(bodies, orbit.ReferenceBodyIndex) is double floor))
            {
                return UnderPhysics("@trackingStation.bodies", "the craft is under physics and nothing places the air it might be in");
            }
            var elements = Finite(orbit.Elements);
            if (elements.Ecc == 1.0)
            {
                return UnderPhysics("@vessel.orbit", "parabolic elements: there is no position to show the craft clear of the air");
            }
            if (!(RadiusAt(elements, elements.Epoch) > floor))
            {
                return UnderPhysics("@trackingStation.bodies", "the craft is inside the atmosphere, where drag the conic does not model acts on it");
            }
            if (pending != null)
            {
                foreach (var command in pending)
                {
                    if (command.OneWaySeconds == null)
                    {
                        continue;
                    }
                    var arrival = Mag(command.DispatchedAt) + Mag(command.OneWaySeconds);
                    if (arrival > sample.ValidAt && arrival <= viewUt)
                    {
                        return UnderPhysics("@system.uplink.pending", "a command reaches the craft before then, and what it does there is not modelled");
                    }
                }
            }
            return null;
        }

        private static ConicDecline UnderPhysics(string input, string note) =>
            new ConicDecline(ConicDecline.UnderPhysics, input, note);

        /// <summary>
        /// Distance from the body's centre at <paramref name="ut"/>, or NaN where the
        /// elements have no position: a parabola, or elements the solver cannot place.
        /// </summary>
        private static double RadiusAt(OrbitElements elements, double ut)
        {
            if (elements.Ecc == 1.0)
            {
                return double.NaN;
            }
            // Only the size of the semi-major axis is read on an open orbit, whose sign the solver checks.
            if (elements.Ecc > 1.0)
            {
                elements.Sma = -Math.Abs(elements.Sma);
            }
            try
            {
                return Sitrep.Propagation.KeplerProvider.StateFrom(elements, ut).Position.Magnitude();
            }
            catch (ArgumentOutOfRangeException)
            {
                return double.NaN;
            }
        }

        /// <summary>
        /// Whether the orbit passes periapsis after <paramref name="fromUt"/> and at
        /// or before <paramref name="toUt"/>. A closed orbit does so once a period;
        /// an open one once, and only while still inbound at <paramref name="fromUt"/>.
        /// </summary>
        private static bool PeriapsisPassedBy(OrbitElements elements, double fromUt, double toUt)
        {
            if (elements.Ecc == 1.0)
            {
                return false;
            }
            var open = elements.Ecc > 1.0;
            var sma = open ? Math.Abs(elements.Sma) : elements.Sma;
            var meanMotion = Math.Sqrt(elements.Mu / (sma * sma * sma));
            if (!(meanMotion > 0))
            {
                return false;
            }
            var advanced = elements.MeanAnomalyAtEpoch + meanMotion * (fromUt - elements.Epoch);
            if (open)
            {
                return advanced < 0 && fromUt - advanced / meanMotion <= toUt;
            }
            return fromUt + (2 * Math.PI - WrapTwoPi(advanced)) / meanMotion <= toUt;
        }

        private static double WrapTwoPi(double angle)
        {
            var twoPi = 2.0 * Math.PI;
            var wrapped = angle % twoPi;
            return wrapped < 0 ? wrapped + twoPi : wrapped;
        }

        private static ConicBody? Find(IReadOnlyList<ConicBody>? bodies, int index)
        {
            if (bodies == null)
            {
                return null;
            }
            foreach (var body in bodies)
            {
                if (body.Index == index)
                {
                    return body;
                }
            }
            return null;
        }

        /// <summary>The top of the atmosphere, or the surface of a body with none, in metres from the centre. Null when the body or its radius is not known.</summary>
        private static double? EntryInterfaceRadius(IReadOnlyList<ConicBody>? bodies, int index)
        {
            var body = Find(bodies, index);
            if (body == null || !(body.Radius is double radius) || !IsFinite(radius))
            {
                return null;
            }
            var depth = body.AtmosphereDepth is double d && IsFinite(d) && d > 0 ? d : 0.0;
            return radius + depth;
        }

        private static double? SphereOfInfluenceRadius(IReadOnlyList<ConicBody>? bodies, int index)
        {
            var soi = Find(bodies, index)?.SphereOfInfluence;
            return soi is double radius && IsFinite(radius) && radius > 0 ? radius : (double?)null;
        }

        private static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);

        /// <summary>A figure as the conic computes on it: NaN when it is absent or not finite, never zero.</summary>
        private static double Mag(double? value) => value is double v && IsFinite(v) ? v : double.NaN;

        private static OrbitElements Finite(OrbitElements e) =>
            new OrbitElements(Mag(e.Sma), Mag(e.Ecc), Mag(e.Inc), Mag(e.Lan), Mag(e.ArgPe), Mag(e.MeanAnomalyAtEpoch), Mag(e.Epoch), Mag(e.Mu));
    }
}
