using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// Keeps every craft other than the active one saying its link into its own
    /// <c>comms.link</c> lane, so a switch to it shows whether it is in contact as of
    /// what its light has already brought, instead of waiting a whole delay. The link
    /// is the same read the delivery ledger is given for that craft
    /// (<see cref="FleetLinkReader"/>), so the two never disagree; a craft whose link
    /// cannot be read says nothing.
    ///
    /// <para>Needs a host whose publisher for <c>comms.link</c> keeps a reading per
    /// craft (<see cref="ICraftReadingPublisher"/>); with any other host it registers
    /// nothing.</para>
    /// </summary>
    internal sealed class CommsLinkLaneFeed
    {
        private static readonly PerfBudget ReadBudget = new PerfBudget(
            "CommsLinkLaneFeed craft link reads", threshold: 1500, windowSec: 1.0, unit: "craft");

        private ICraftReadingPublisher? _link;

        // Main-thread-only: what each craft's lane was last told, and when.
        private readonly Dictionary<string, (bool Connected, double Ut)> _said = new Dictionary<string, (bool Connected, double Ut)>(StringComparer.Ordinal);

        public void RegisterInto(IUplinkHost host, IChannelPublisher? link)
        {
            _link = link as ICraftReadingPublisher;
            if (_link == null)
            {
                return;
            }
            host.AddSampledSource(CaptureOnMain, HandleOnCourier);
        }

        /// <summary>MAIN-THREAD: each craft's link that is due to be said, or null.</summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            if (!HighLogic.LoadedSceneIsFlight || !FlightGlobals.ready || FlightGlobals.Vessels == null)
            {
                return null;
            }
            // The active craft's link is the capture's own, said through the ordinary publish.
            var active = ActiveVesselScope.Current;
            if (active == null)
            {
                return null;
            }
            var ut = snapshot != null ? snapshot.Ut : Planetarium.GetUniversalTime();
            var config = CommsCoreUplink.SignalDelayConfig;
            var policy = CraftLanePolicy.Current;
            var present = new HashSet<string>(StringComparer.Ordinal);
            var due = new List<(string Id, bool Connected)>();
            foreach (var vessel in FlightGlobals.Vessels)
            {
                if (vessel == null || vessel == active || !policy.Reports(vessel.vesselType.ToString()))
                {
                    continue;
                }
                var id = vessel.id.ToString();
                present.Add(id);
                ReadBudget.Record(1, ut);
                if (FleetLinkReader.Shared.Read(vessel, config, ut) is not bool connected)
                {
                    continue;
                }
                if (CommsLinkLaneScope.Due(_said, id, connected, ut))
                {
                    due.Add((id, connected));
                }
            }
            CommsLinkLaneScope.ForgetGone(_said, present);
            return due.Count == 0 ? null : new LinkReads(ut, due);
        }

        /// <summary>COURIER-THREAD: says each craft's link into its lane. No KSP access.</summary>
        internal void HandleOnCourier(object? captured)
        {
            if (captured is not LinkReads reads || _link == null)
            {
                return;
            }
            foreach (var (id, connected) in reads.Craft)
            {
                _link.PublishFor(
                    id,
                    new CommsLink { Connected = connected, Meta = new PayloadMeta { Source = "vessel:" + id } },
                    reads.Ut);
            }
        }

        private sealed class LinkReads
        {
            public LinkReads(double ut, List<(string Id, bool Connected)> craft)
            {
                Ut = ut;
                Craft = craft;
            }

            public double Ut { get; }
            public List<(string Id, bool Connected)> Craft { get; }
        }
    }
}
