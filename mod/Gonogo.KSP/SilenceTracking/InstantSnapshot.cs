using System;

namespace Gonogo.KSP.SilenceTracking
{
    /// <summary>
    /// A value read once per game instant: every call at the same universal time
    /// gets the same read, and the first call at a later time reads again. A call
    /// with no clock reads every time, and a read <c>keep</c> refuses is not held.
    /// </summary>
    internal sealed class InstantSnapshot<T> where T : class
    {
        private readonly Func<T> _read;
        private readonly Func<T, bool> _keep;
        private T _value;
        private double _readAt = double.NaN;

        public InstantSnapshot(Func<T> read, Func<T, bool> keep)
        {
            _read = read;
            _keep = keep;
        }

        public T At(double? universalTime)
        {
            if (_value != null && universalTime == _readAt)
            {
                return _value;
            }

            var value = _read();
            if (universalTime.HasValue && _keep(value))
            {
                _value = value;
                _readAt = universalTime.Value;
            }
            else
            {
                _value = null;
                _readAt = double.NaN;
            }
            return value;
        }
    }
}
