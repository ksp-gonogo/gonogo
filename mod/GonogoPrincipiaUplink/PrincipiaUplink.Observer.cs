namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// The one file in this uplink that reaches the game.
    ///
    /// <para>Split out so the rest of <see cref="PrincipiaUplink"/> compiles with no
    /// KSP, Unity or Harmony reference: this file is simply not included in the
    /// headless test build, the partial method calls disappear, and the publish
    /// logic stays provable against a fake source. Nothing but the wiring belongs
    /// here, because anything that moves in stops being tested.</para>
    /// </summary>
    public sealed partial class PrincipiaUplink
    {
        partial void AttachObserver()
        {
            _settings ??= new PrincipiaSettingsSource();
        }

        partial void AttachGravityModel()
        {
            _gravityModel ??= new PrincipiaGravityModelSource();
        }
    }
}
