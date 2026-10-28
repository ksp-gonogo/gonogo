using System;

namespace Gonogo.KSP
{
    /// <summary>
    /// One snapshot group kept between samples and handed on again while nothing it
    /// is read from can have moved: no game event that touches it has fired, its
    /// inputs' signature is the same, the save is the same, and it is younger than
    /// <see cref="MaxAgeSeconds"/> in both game and real time. Every sample that
    /// builds everything builds it again. Main thread only.
    /// </summary>
    internal sealed class ReusedGroup<T>
        where T : class
    {
        /// <summary>The oldest a kept group may be, so a change no event announces is late by at most this.</summary>
        public const double MaxAgeSeconds = 5.0;

        private T? _value;
        private double _builtUt;
        private double _builtWall;
        private int _epoch;
        private string? _signature;
        private object? _save;

        /// <summary>
        /// The kept group, when it still answers at <paramref name="ut"/> and
        /// <paramref name="wallSeconds"/> for the current event <paramref name="epoch"/>,
        /// inputs <paramref name="signature"/> and <paramref name="save"/>, and the sample
        /// is not one that builds everything.
        /// </summary>
        public bool TryReuse(double ut, double wallSeconds, int epoch, string signature, object? save, bool fullSample, out T? value)
        {
            value = _value;
            return _value != null
                && !fullSample
                && epoch == _epoch
                && string.Equals(signature, _signature, StringComparison.Ordinal)
                && ReferenceEquals(save, _save)
                && ut >= _builtUt
                && ut - _builtUt < MaxAgeSeconds
                && wallSeconds >= _builtWall
                && wallSeconds - _builtWall < MaxAgeSeconds;
        }

        /// <summary>Keeps a group just built, with what it was built under; a null keeps nothing.</summary>
        public void Keep(T? value, double ut, double wallSeconds, int epoch, string signature, object? save)
        {
            _value = value;
            _builtUt = ut;
            _builtWall = wallSeconds;
            _epoch = epoch;
            _signature = signature;
            _save = save;
        }
    }
}
