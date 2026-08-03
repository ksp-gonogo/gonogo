namespace Gonogo.KerbcastUplink
{
    /// <summary>
    /// Debounces kerbcast's raw per-tick <c>SidecarAlive</c> reading into a
    /// "confirmed dead" signal <see cref="KerbcastHealth"/> can degrade on.
    ///
    /// <para>kerbcast auto-restarts the video sidecar process on its own (up
    /// to 5 attempts, roughly 5 seconds apart), during which
    /// <c>SidecarAlive</c> reads false transiently for the length of one
    /// capture tick. A single false tick must NOT degrade
    /// <c>Sitrep.Contract.ISitrepUplink.Health</c>, that would flap the
    /// health state on every routine restart; only TWO CONSECUTIVE false
    /// ticks confirm the sidecar is actually down rather than mid-restart.</para>
    ///
    /// <para>Recovery is immediate, deliberately not itself debounced: the
    /// moment a tick reports alive again, <see cref="ConfirmedDead"/> clears.
    /// There is no operator harm in clearing a moment early (worst case, one
    /// more transient blip re-confirms it two ticks later); the harm is all
    /// on the other side, staying "confirmed dead" after the feed has
    /// genuinely come back.</para>
    ///
    /// <para>Pure and KSP-free by design, same reason
    /// <see cref="KerbcastHealth"/> is a pure function: this is the exact
    /// state machine that decides whether an operator sees a black-feed
    /// diagnosis, and it deserves headless tests. Owned by
    /// <c>KerbcastUplink</c>, which feeds it one <c>SidecarAlive()</c>
    /// reading per main-thread capture tick and publishes
    /// <see cref="ConfirmedDead"/> onward as the volatile state
    /// <c>KerbcastUplink.Health</c> reads on the Courier thread.</para>
    /// </summary>
    public sealed class SidecarDeathDebouncer
    {
        private int _deadStreak;

        /// <summary>
        /// True once two CONSECUTIVE <see cref="Observe"/> calls have reported
        /// not-alive. False otherwise, including after exactly one.
        /// </summary>
        public bool ConfirmedDead { get; private set; }

        /// <summary>
        /// Feed one tick's raw <c>SidecarAlive()</c> reading. Call this once
        /// per capture tick, in tick order; the debounce logic is stateful
        /// and order-dependent.
        /// </summary>
        public void Observe(bool aliveNow)
        {
            if (aliveNow)
            {
                _deadStreak = 0;
                ConfirmedDead = false;
                return;
            }
            _deadStreak++;
            if (_deadStreak >= 2)
            {
                ConfirmedDead = true;
            }
        }
    }
}
