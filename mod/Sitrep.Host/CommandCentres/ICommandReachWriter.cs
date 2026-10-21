using System.Collections.Generic;

namespace Sitrep.Host.CommandCentres
{
    /// <summary>
    /// Tells the engine, once per pass, which centres reach which subjects: the
    /// delay rows a centre is quoted against each craft, and the subjects it
    /// cannot send to or hear from, so a command it cannot send is refused and a
    /// craft it cannot hear is sent nothing.
    ///
    /// <para>Off <c>IUplinkHost</c> because its only writer is gonogo's own
    /// command-centre pass, which already references this assembly.</para>
    /// </summary>
    public interface ICommandReachWriter
    {
        /// <summary>
        /// Replace every centre's delay to each named craft. The set is the
        /// whole pass: a (centre, craft) pair named last pass and not this one
        /// loses its row.
        /// </summary>
        void SetAuthorityDelays(IReadOnlyCollection<(string CentreId, string VesselId, double OneWaySeconds)> rows);

        /// <summary>
        /// Replace the whole set. Each key is a centre as a vantage, and its
        /// values are the subject nodes whose route from that centre does not
        /// carry both ways, with the directions it does carry:
        /// <see cref="Sitrep.Contract.CommsDirection.Forward"/> is a command
        /// sent to the node, <see cref="Sitrep.Contract.CommsDirection.Reverse"/>
        /// is telemetry heard from it, and none is no route at all. A centre or
        /// node not listed carries both.
        /// </summary>
        void SetCarried(IReadOnlyDictionary<string, IReadOnlyDictionary<string, Sitrep.Contract.CommsDirection>> nodesByCentre);

        /// <summary>
        /// Replace the whole set of craft, by bare guid, whose route ends
        /// somewhere other than a ground station. The home centre hears a craft
        /// through every ground station, so it cannot hear one of these.
        /// </summary>
        void SetOffTheGround(IReadOnlyCollection<string> vesselIds);
    }
}
