namespace Sitrep.Contract
{
    /// <summary>
    /// How serious a line an Uplink writes through <see cref="IUplinkHost.Log"/>
    /// is. Selects the level KSP.log shows it at.
    /// </summary>
    /// <category>Host and Kernel</category>
    public enum UplinkLogLevel
    {
        /// <summary>Something the operator reading the log would want to know happened: a load, a connection.</summary>
        Info = 0,

        /// <summary>Something did not work and the Uplink carried on.</summary>
        Warn = 1,

        /// <summary>Something did not work and a feature is lost.</summary>
        Error = 2,
    }
}
