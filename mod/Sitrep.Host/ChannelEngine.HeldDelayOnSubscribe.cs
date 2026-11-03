using Sitrep.Contract;

namespace Sitrep.Host
{
    public sealed partial class ChannelEngine
    {
        /*
         * A connection that subscribes to comms.delay while the active craft is out
         * of contact is replayed only the figures recorded inside the outage, and
         * every one of those reports no measurable path. Without a figure its view
         * clock runs on a stand-in zero while every screen that was connected before
         * the loss holds the last in-contact delay, so the new screen's clock sits a
         * whole signal delay ahead of theirs until contact returns.
         *
         * The engine already keeps that last in-contact delay per subject for its own
         * ledger, so it is the one source every screen at this centre can be given.
         * Sent after the replay, on the reliable lane, and marked as the last figure
         * before the blackout. The subscribing client keeps the later null frames
         * from overwriting it.
         */
        private void SendHeldDelayOnSubscribe(ClientSession session, string topic)
        {
            if (topic != CommsDelayTopic
                || SubjectConnected(NodeId)
                || !_subjectLastConnectedDelay.TryGetValue(NodeId, out var held)
                || !(held > 0.0))
            {
                return;
            }

            var payload = new CommsDelay
            {
                OneWaySeconds = held,
                Source = CommsDelaySource.SignalDelay,
                Meta = new PayloadMeta { Source = _lastActiveVesselId != null ? "vessel:" + _lastActiveVesselId : "game" },
            };
            SendKept(session, topic, payload, Staleness.LastBeforeBlackout);
        }
    }
}
