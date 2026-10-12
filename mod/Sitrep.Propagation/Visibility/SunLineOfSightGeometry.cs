using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Propagation.Visibility
{
    /// <summary>
    /// Whether a craft can see the star: its line to the star's centre against
    /// every body that can come between, in a frame centred on the craft's
    /// parent body.
    ///
    /// <para>The craft is either swept along an orbit with the elected
    /// provider, or, for a craft sitting on the ground, carried round by its
    /// body's rotation from where it is at a reference instant. Both give a
    /// position at any time in the same frame, and the star's centre is asked
    /// of the provider as a body, so the star's apparent motion is the
    /// provider's own and needs no model here.</para>
    ///
    /// <para>The margin is the worst of the occluders' horizon margins, the same
    /// measure <see cref="ChordOcclusion"/> gives a radio path: non-negative
    /// means the star is in view. The star is a point, so there is no
    /// penumbra.</para>
    /// </summary>
    public sealed class SunLineOfSightGeometry : IVisibilityGeometry, IVisibilityCadence
    {
        private readonly IPropagationProvider _propagator;
        private readonly PropagationFrame _frame;
        private readonly int _starBodyIndex;
        private readonly OccludingBody[] _occluders;
        private readonly PropagationTarget? _vessel;
        private readonly RotatingGroundStation? _surface;

        private SunLineOfSightGeometry(
            IPropagationProvider propagator,
            PropagationFrame frame,
            int starBodyIndex,
            IEnumerable<OccludingBody> occluders,
            PropagationTarget? vessel,
            RotatingGroundStation? surface)
        {
            _propagator = propagator ?? throw new ArgumentNullException(nameof(propagator));
            _frame = frame;
            _starBodyIndex = starBodyIndex;
            _occluders = new List<OccludingBody>(occluders ?? throw new ArgumentNullException(nameof(occluders))).ToArray();
            if (_occluders.Length == 0)
            {
                throw new ArgumentException("at least one occluder is required; none would report the craft permanently lit", nameof(occluders));
            }
            _vessel = vessel;
            _surface = surface;
        }

        /// <summary>A craft on an orbit around the frame's centre body.</summary>
        /// <param name="occluders">The frame's centre body and every ancestor below the star, with the radius each blocks light with.</param>
        public static SunLineOfSightGeometry ForOrbit(
            IPropagationProvider propagator,
            PropagationTarget vessel,
            PropagationFrame frame,
            int starBodyIndex,
            IEnumerable<OccludingBody> occluders) =>
            new SunLineOfSightGeometry(propagator, frame, starBodyIndex, occluders, vessel, null);

        /// <summary>A craft sitting on the surface of the frame's centre body.</summary>
        public static SunLineOfSightGeometry ForSurface(
            IPropagationProvider propagator,
            RotatingGroundStation surface,
            PropagationFrame frame,
            int starBodyIndex,
            IEnumerable<OccludingBody> occluders) =>
            new SunLineOfSightGeometry(propagator, frame, starBodyIndex, occluders, null, surface);

        /// <summary>The orbital period of the craft, or the body's rotation period for a craft on the ground, seconds.</summary>
        public double? ShortestCycleSeconds
        {
            get
            {
                if (_surface != null)
                {
                    var spin = Math.Abs(_surface.Value.RotationPeriodSeconds);
                    return spin > 0.0 && !double.IsInfinity(spin) ? spin : (double?)null;
                }
                return _propagator.CharacteristicCycleSeconds(_vessel!.Value);
            }
        }

        /// <summary>
        /// Whether the provider can place the craft, the star and every occluder
        /// between the two instants. False for an unbound orbit under a provider
        /// that solves only bound conics, which is a craft with nothing to sweep.
        /// </summary>
        public bool CanPropagate(double fromUt, double toUt)
        {
            if (_vessel != null && !_propagator.CanPropagate(_vessel.Value, _frame, fromUt, toUt))
            {
                return false;
            }
            if (!_propagator.CanPropagate(PropagationTarget.Body(_starBodyIndex), _frame, fromUt, toUt))
            {
                return false;
            }
            foreach (var occluder in _occluders)
            {
                if (!_propagator.CanPropagate(PropagationTarget.Body(occluder.BodyIndex), _frame, fromUt, toUt))
                {
                    return false;
                }
            }
            return true;
        }

        public double MarginAt(double ut)
        {
            var craft = PositionAt(ut);
            var star = _propagator.Solve(PropagationTarget.Body(_starBodyIndex), _frame, ut).Position;
            var margin = double.PositiveInfinity;
            for (var i = 0; i < _occluders.Length; i++)
            {
                var centre = _propagator.Solve(PropagationTarget.Body(_occluders[i].BodyIndex), _frame, ut).Position;
                var occluderMargin = ChordOcclusion.HorizonMargin(craft, star, centre, _occluders[i].OccludingRadiusMeters);
                if (occluderMargin < margin)
                {
                    margin = occluderMargin;
                }
            }
            return margin;
        }

        public double SeparationAt(double ut)
        {
            var star = _propagator.Solve(PropagationTarget.Body(_starBodyIndex), _frame, ut).Position;
            return (star - PositionAt(ut)).Magnitude();
        }

        private Vector3d PositionAt(double ut) =>
            _surface != null
                ? _surface.Value.PositionAt(ut)
                : _propagator.Solve(_vessel!.Value, _frame, ut).Position;
    }

    /// <summary>The closed vocabulary of <c>vessel.light</c>'s <c>basis</c>.</summary>
    public static class LightBasis
    {
        /// <summary>The craft was swept along its orbit.</summary>
        public const string Orbit = "orbit";

        /// <summary>The craft was carried round by its body's rotation.</summary>
        public const string Surface = "surface";

        /// <summary>No sound prediction could be made, so both instants are null.</summary>
        public const string Withheld = "withheld";
    }

    /// <summary>What <see cref="LightPrediction"/> found.</summary>
    public sealed class LightPredictionResult
    {
        public bool? Sunlit { get; set; }

        public double? NextSunriseUt { get; set; }

        public double? NextSunsetUt { get; set; }

        public double HorizonUt { get; set; }

        public string Basis { get; set; } = LightBasis.Withheld;
    }

    /// <summary>
    /// The next sunrise and sunset of a craft: a sweep of its line to the star
    /// over two of its own cycles, at half a degree of the cycle a step, with
    /// each crossing refined by bisection.
    /// </summary>
    public static class LightPrediction
    {
        /// <summary>Cycles of forward search, matching the silence tracker's own sweep.</summary>
        public const double SearchWindowCycles = 2.0;

        /// <summary>Steps per cycle, matching the silence tracker's own sweep.</summary>
        public const double StepsPerCycle = 720.0;

        /// <param name="geometry">The craft's line to the star.</param>
        /// <param name="ut">Now.</param>
        /// <param name="surface">True when the craft sits on the ground, which only changes the basis it is reported under.</param>
        /// <param name="limitUt">The last time the craft's orbit holds, such as the end of its patch, or null.</param>
        public static LightPredictionResult Predict(SunLineOfSightGeometry geometry, double ut, bool surface, double? limitUt = null)
        {
            var result = new LightPredictionResult { HorizonUt = ut };
            if (!geometry.CanPropagate(ut, ut))
            {
                return result;
            }
            result.Sunlit = ChordOcclusion.Unobstructed(geometry.MarginAt(ut));
            var cycle = geometry.ShortestCycleSeconds;
            if (!(cycle > 0.0) || double.IsInfinity(cycle!.Value))
            {
                return result;
            }
            var horizon = ut + (SearchWindowCycles * cycle.Value);
            if (limitUt != null && limitUt.Value < horizon)
            {
                horizon = limitUt.Value;
            }
            if (!(horizon > ut))
            {
                return result;
            }
            var step = cycle.Value / StepsPerCycle;
            var sweep = VisibilitySweep.Run(geometry, ut, horizon, step);
            result.HorizonUt = horizon;
            result.Basis = surface ? LightBasis.Surface : LightBasis.Orbit;
            foreach (var change in sweep.Changes)
            {
                if (change.BecameClear)
                {
                    result.NextSunriseUt ??= change.Ut;
                }
                else
                {
                    result.NextSunsetUt ??= change.Ut;
                }
                if (result.NextSunriseUt != null && result.NextSunsetUt != null)
                {
                    break;
                }
            }
            return result;
        }
    }
}
