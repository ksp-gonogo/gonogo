namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// The one file in this uplink that reaches the game.
    ///
    /// <para>Split out so the rest of <see cref="PrincipiaUplink"/> compiles with no
    /// KSP, Unity or Harmony reference: this file is simply not included in the
    /// headless test build, the partial method call disappears, and the publish
    /// logic stays provable against a fake observer. Nothing but the wiring belongs
    /// here, because anything that moves in stops being tested.</para>
    /// </summary>
    public sealed partial class PrincipiaUplink
    {
        partial void AttachObserver()
        {
            _observer ??= new FlightPlannerHook();
            _settings ??= new PrincipiaSettingsSource();
        }
    }
}
