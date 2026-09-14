using System;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// Reads where KSP's space centre stands, for <see cref="RaHomeCommandProvider"/>,
    /// and remembers the last good reading.
    ///
    /// <para><c>SpaceCenter.Instance</c> is not readable everywhere. It is null until the
    /// component's <c>Awake</c> and again after its <c>OnDestroy</c>, and its body and
    /// coordinates are filled in only by <c>Start</c>; stock itself null-checks it
    /// everywhere but vessel recovery. The space centre does not move within a game,
    /// so the last reading stands in whenever the instance cannot be read.</para>
    ///
    /// <para>Main thread only: it touches a Unity object.</para>
    /// </summary>
    internal sealed class RaSpaceCentre
    {
        private SpaceCentreFix? _last;

        public SpaceCentreFix? Read()
        {
            try
            {
                var spaceCentre = SpaceCenter.Instance;

                // The transform is set by Start, the same call that fills in the body
                // and coordinates, so a null one means those still hold defaults.
                if (spaceCentre != null && spaceCentre.cb != null && spaceCentre.SpaceCenterTransform != null)
                {
                    var bodies = FlightGlobals.Bodies;
                    var index = bodies != null ? bodies.IndexOf(spaceCentre.cb) : -1;
                    var latitude = spaceCentre.Latitude;
                    var longitude = spaceCentre.Longitude;
                    if (index >= 0 && IsReal(latitude) && IsReal(longitude))
                    {
                        _last = new SpaceCentreFix(index, latitude, longitude);
                    }
                }
            }
            catch (Exception)
            {
                // An unreadable space centre keeps the last reading, as an absent one does.
            }

            return _last;
        }

        private static bool IsReal(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
    }
}
