namespace Sitrep.Host
{
    /// <summary>
    /// Which client sessions are connected and what each is subscribed to, for an
    /// Uplink that hands something to the session that asked for it and has to
    /// take it back when that session goes. Asked of the host an Uplink is
    /// registered with, as <see cref="Comms.ICraftStateHost"/> is.
    /// </summary>
    public interface ISessionDirectory
    {
        /// <summary>Whether the connection with this id is still connected.</summary>
        bool IsSessionConnected(string sessionId);

        /// <summary>Whether the connection with this id is subscribed to <paramref name="topic"/>.</summary>
        bool IsSessionSubscribed(string sessionId, string topic);
    }
}
