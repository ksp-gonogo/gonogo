using System.Collections.Generic;
using System.Linq;
using Gonogo.KerbalismUplink;
using Xunit;

/// <summary>
/// Which Kerbalism resources the life-support ledger actually carries, pinned
/// so the answer is DECLARED rather than discovered.
///
/// <para><b>The shape of the gap.</b> `kerbalism.lifesupport` names its
/// consumables as fixed properties: food, water, oxygen, electricCharge. That
/// is four of the twelve the default profile runs on, and the four are spelled
/// out three times over: as properties on <c>KerbalismLifeSupport</c>, as
/// literal lookups in <c>KerbalismUplink.CaptureOnMain</c>, and as fields on
/// the widget's own consumable type. Nothing about that set is wrong; what is
/// wrong is that it was never written down as a choice, so a Kerbalism player
/// wondering where their CO2 reading went has to read three files to find
/// out.</para>
///
/// <para><b>What is NOT lost.</b> Amounts and capacities reach the app for
/// every resource regardless: <c>vessel.resources</c> is a name-keyed map and
/// <c>KspHost.BuildPartResources</c> iterates every <c>PartResource</c> on
/// every part, so a tank of Nitrogen shows up there like any other. This gate
/// is not about the levels.</para>
///
/// <para><b>What IS lost is the RATE.</b> <c>ResourceAverageRate</c> is
/// Kerbalism's own API, it is the one number the generic path cannot derive,
/// and it is called for exactly the four names below. So the CO2 climb, the
/// waste accumulation and the nitrogen draw are unavailable to any consumer:
/// not stale, not zero, absent. That is the real cost of the omission and the
/// reason it is worth recording.</para>
///
/// <para><b>To carry another one:</b> add the amount/capacity/rate triple to
/// <c>KerbalismSnapshot</c>, the <c>R</c>/<c>Cap</c>/<c>Rate</c> lookups in
/// <c>CaptureOnMain</c>, the property on <c>KerbalismLifeSupport</c>, and the
/// key in <c>BuildLifeSupport</c>; then move its name from
/// <see cref="NotCarried"/> to <see cref="Carried"/> here. The test failing is
/// the prompt to do the last step.</para>
/// </summary>
public class LifeSupportResourceCoverageTests
{
    /// <summary>
    /// The consumables the ledger emits a full amount/capacity/rate triple for.
    /// </summary>
    private static readonly string[] Carried =
    {
        "food", "water", "oxygen", "electricCharge",
    };

    /// <summary>
    /// The life-support resources Kerbalism's default profile actually runs on,
    /// as confirmed from <c>KerbalismConfig/Profiles/Default.cfg</c> and
    /// already written down in <c>GonogoDevKerbalismDump</c>'s candidate list.
    ///
    /// <para>Stock propellants and ores are deliberately absent: those are not
    /// life support and the generic <c>vessel.resources</c> map is their proper
    /// home. <c>Shielding</c> is absent for a different reason, it IS captured,
    /// on the space-weather payload rather than this one.</para>
    /// </summary>
    private static readonly string[] LifeSupportProfile =
    {
        "food", "water", "oxygen", "electricCharge",
        "carbonDioxide", "waste", "wasteWater", "wasteAtmosphere",
        "nitrogen", "ammonia", "hydrogen", "atmosphere",
    };

    /// <summary>
    /// The eight the ledger does not carry a rate for. Listed rather than
    /// implied, so this is a decision on the record instead of an accident
    /// nobody has noticed.
    /// </summary>
    private static readonly string[] NotCarried =
    {
        "carbonDioxide", "waste", "wasteWater", "wasteAtmosphere",
        "nitrogen", "ammonia", "hydrogen", "atmosphere",
    };

    [Fact]
    public void LedgerCarriesExactlyTheDeclaredConsumables()
    {
        var payload = KerbalismCapture.BuildLifeSupport(
            new KerbalismSnapshot(), new List<ProcessRaw>());

        // Everything that is not a consumable entry: the ledger also carries
        // habitat scalars and the process list, and neither is a resource.
        var consumables = payload.Keys
            .Where(k => k != "habitat" && k != "processes")
            .OrderBy(k => k)
            .ToArray();

        Assert.Equal(Carried.OrderBy(k => k).ToArray(), consumables);
    }

    [Fact]
    public void TheOmittedResourcesAreTheOnesWeThinkTheyAre()
    {
        // Not a tautology across the three lists: this fails if the profile
        // list grows, if the carried set changes, or if someone edits one of
        // the two without the other. That is the whole point, the omission has
        // to stay a stated one.
        var expectedOmission = LifeSupportProfile.Except(Carried).OrderBy(k => k);
        Assert.Equal(expectedOmission.ToArray(), NotCarried.OrderBy(k => k).ToArray());
    }

    [Fact]
    public void EveryCarriedResourceIsOneTheProfileActuallyHas()
    {
        // The other direction: carrying a name Kerbalism does not use would be
        // a permanently-zero readout, which reads as a real measurement.
        Assert.All(Carried, name => Assert.Contains(name, LifeSupportProfile));
    }
}
