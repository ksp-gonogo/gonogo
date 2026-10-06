using System;
using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// The health an expansion-gated Uplink reports, read from the install at the moment it is
    /// asked rather than once at Register.
    ///
    /// <para>KSP fills its installed-expansion list while the loading screen runs, after every
    /// <c>Startup.Instantly</c> addon has already registered its Uplinks. A check made in
    /// <c>Register</c> therefore sees an empty list on a machine with the expansion installed
    /// and condemns the Uplink for the whole session. Carries no KSP type, so a headless test
    /// can drive the probe.</para>
    ///
    /// <para>An installed answer is kept for the session, since an expansion never uninstalls
    /// while the game runs, so the poll that asks off the main thread stops reading KSP's
    /// expansion list once it has a yes. An absent answer is never kept: the list may simply
    /// not have been filled yet.</para>
    /// </summary>
    public sealed class ExpansionHealth
    {
        private readonly Func<bool> _isInstalled;
        private readonly string _absentReason;
        private volatile bool _installed;

        /// <param name="isInstalled">Reads the live install, called by <see cref="Report"/> until it first answers true.</param>
        /// <param name="absentReason">The operator-facing reason shown while the expansion is absent.</param>
        public ExpansionHealth(Func<bool> isInstalled, string absentReason)
        {
            _isInstalled = isInstalled;
            _absentReason = absentReason;
        }

        public UplinkHealth Report()
        {
            if (_installed || _isInstalled())
            {
                _installed = true;
                return UplinkHealth.Healthy;
            }
            return new UplinkHealth(UplinkHealthState.Unavailable, _absentReason);
        }
    }
}
