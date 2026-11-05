using System;
using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// The closest approach of two craft close enough to both be simulated, taken from where
    /// their reference points are and how fast they close. Two craft a few tens of metres apart
    /// share almost the same orbit, so a solve from their orbital elements reports the next
    /// drift minimum an orbit later, and the elements belong to the vessels' centres of mass
    /// rather than the docking ports the range is measured between.
    /// </summary>
    internal static class LoadedApproach
    {
        /// <summary>Metres inside which both craft are in the game's physics range and the straight-line figure is used alone.</summary>
        public const double RangeMetres = 2000.0;

        /// <summary>Metres over which the figure passes from the straight-line one to the orbit model's, so it does not step at the edge of <see cref="RangeMetres"/>.</summary>
        public const double HandoverMetres = 500.0;

        /// <summary>
        /// The closest approach to report: the straight-line figure inside <see cref="RangeMetres"/>,
        /// the orbit model's beyond it plus <see cref="HandoverMetres"/>, and a linear blend of the
        /// two (time and distance) between. Null where neither has an answer.
        /// </summary>
        public static ClosestApproach? Combine(double[]? position, double[]? velocity, double ut, ClosestApproach? orbitModel)
        {
            var line = Solve(position, velocity, ut);
            if (line == null)
            {
                return orbitModel;
            }
            var range = Math.Sqrt(position![0] * position[0] + position[1] * position[1] + position[2] * position[2]);
            if (range <= RangeMetres)
            {
                return line;
            }
            if (orbitModel == null || range >= RangeMetres + HandoverMetres)
            {
                return orbitModel;
            }
            var weight = (range - RangeMetres) / HandoverMetres;
            return new ClosestApproach
            {
                Time = line.Time + (orbitModel.Time - line.Time) * weight,
                Distance = line.Distance + (orbitModel.Distance - line.Distance) * weight,
                TrajectoryKind = orbitModel.TrajectoryKind,
            };
        }

        /// <summary>
        /// The key a pair's relative-position window is kept under: the vessel the range is taken
        /// from, the point on it, and the target, so a switch of any of the three starts a new window.
        /// </summary>
        public static string TrackKey(string? vesselId, int originId, string? targetVesselId, uint? partId)
        {
            return vesselId + ":" + originId + ":" + targetVesselId + ":" + partId;
        }

        /// <summary>
        /// The minimum separation of a straight-line relative path from now, or null when the
        /// inputs are not finite. A pair that is not closing reports now as the closest it gets.
        /// </summary>
        public static ClosestApproach? Solve(double[]? position, double[]? velocity, double ut)
        {
            if (position == null || velocity == null || position.Length != 3 || velocity.Length != 3)
            {
                return null;
            }
            var rangeSquared = 0.0;
            var closing = 0.0;
            var speedSquared = 0.0;
            for (var i = 0; i < 3; i++)
            {
                if (double.IsNaN(position[i]) || double.IsInfinity(position[i]) || double.IsNaN(velocity[i]) || double.IsInfinity(velocity[i]))
                {
                    return null;
                }
                rangeSquared += position[i] * position[i];
                closing += position[i] * velocity[i];
                speedSquared += velocity[i] * velocity[i];
            }
            var seconds = speedSquared > 0.0 ? Math.Max(0.0, -closing / speedSquared) : 0.0;
            var missSquared = 0.0;
            for (var i = 0; i < 3; i++)
            {
                var at = position[i] + velocity[i] * seconds;
                missSquared += at * at;
            }
            return new ClosestApproach { Time = ut + seconds, Distance = Math.Sqrt(missSquared), TrajectoryKind = TrajectoryKind.Unspecified };
        }
    }

    /// <summary>
    /// The relative position of one target over the last few seconds of game time, and the
    /// closing velocity those positions give. The velocity the game reports for the pair is
    /// sampled at one instant and carries a few centimetres a second of noise, which at tens of
    /// metres of range moves a straight-line miss by metres and the time to it by tens of seconds;
    /// the slope of the positions over a window does not.
    /// </summary>
    internal sealed class ApproachTrack
    {
        /// <summary>Seconds of game time the slope is taken over.</summary>
        public const double WindowSeconds = 10.0;

        /// <summary>A gap between samples longer than this (a pause, a warp) starts the window again.</summary>
        public const double GapSeconds = 3.0;

        private const int MinSamples = 5;
        private const double MinSpanSeconds = 4.0;

        private readonly System.Collections.Generic.List<double[]> _samples = new System.Collections.Generic.List<double[]>();
        private string? _key;

        /// <summary>Records the pair's relative position at <paramref name="ut"/>; a new key, a step back in time or a gap starts the window again.</summary>
        public void Add(string key, double ut, double[]? position)
        {
            if (position == null || position.Length != 3 || double.IsNaN(ut) || double.IsInfinity(ut))
            {
                _samples.Clear();
                return;
            }
            var last = _samples.Count > 0 ? _samples[_samples.Count - 1][0] : double.NaN;
            if (key != _key || (_samples.Count > 0 && (ut <= last || ut - last > GapSeconds)))
            {
                _samples.Clear();
            }
            _key = key;
            _samples.Add(new[] { ut, position[0], position[1], position[2] });
            while (_samples.Count > 0 && ut - _samples[0][0] > WindowSeconds)
            {
                _samples.RemoveAt(0);
            }
        }

        /// <summary>The least-squares velocity of the windowed positions, or null until the window holds enough to trust.</summary>
        public double[]? Velocity()
        {
            if (_samples.Count < MinSamples || _samples[_samples.Count - 1][0] - _samples[0][0] < MinSpanSeconds)
            {
                return null;
            }
            var meanT = 0.0;
            foreach (var s in _samples)
            {
                meanT += s[0];
            }
            meanT /= _samples.Count;
            var spread = 0.0;
            foreach (var s in _samples)
            {
                spread += (s[0] - meanT) * (s[0] - meanT);
            }
            var velocity = new double[3];
            for (var axis = 0; axis < 3; axis++)
            {
                var mean = 0.0;
                foreach (var s in _samples)
                {
                    mean += s[axis + 1];
                }
                mean /= _samples.Count;
                var cross = 0.0;
                foreach (var s in _samples)
                {
                    cross += (s[0] - meanT) * (s[axis + 1] - mean);
                }
                velocity[axis] = cross / spread;
            }
            return velocity;
        }
    }
}
