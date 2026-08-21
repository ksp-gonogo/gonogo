using System;
using System.Collections.Generic;
using Gonogo.KSP.Career;
using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// One of KSP's own launch tests, with the refusal code it becomes and the
    /// comparison behind it.
    ///
    /// <para><c>PreFlightTests.IPreFlightTest</c> answers pass/fail and supplies
    /// the game's sentence, and that is all it supplies: it does not carry a
    /// machine-readable reason, and the numbers it was built with are gone by
    /// the time it says no. So the code and the breach are paired with the test
    /// where it is CONSTRUCTED, which is the one place both are in scope.</para>
    /// </summary>
    internal sealed class LaunchCheck
    {
        public LaunchCheck(PreFlightTests.IPreFlightTest test, CommandErrorCode code, LimitBreach? breach = null)
        {
            Test = test;
            Code = code;
            Breach = breach;
        }

        public PreFlightTests.IPreFlightTest Test { get; }

        public CommandErrorCode Code { get; }

        public LimitBreach? Breach { get; }
    }

    /// <summary>
    /// The launch tests KSP runs on its own Launch button, run before we launch.
    ///
    /// <para><b>What was wrong.</b> Nothing on the console's launch path asked
    /// any of them. Rollout funds still left the player's account:
    /// <c>StartupBehaviours.NEW_FROM_FILE</c> fires
    /// <c>GameEvents.OnVesselRollout</c> and <c>Funding.onVesselRollout</c>
    /// debits the ship's cost, and <c>Funding.OnCurrenciesModified</c> has no
    /// floor at zero. So the money left regardless and only the check was
    /// missing: an operator could put a craft on the pad that the game's own
    /// button refuses to place there, and go negative paying for it.
    /// <c>CraftWithinMassLimits.GetProceedOption()</c> returns null: stock
    /// offers no "launch anyway" for the mass, size and part-count tests, so
    /// these are refusals rather than warnings.</para>
    ///
    /// <para><b>What runs where.</b> The two tests that need no craft
    /// (<c>LaunchSiteClear</c> and <c>FacilityOperational</c> at the launch site)
    /// are DECLARED requirements on <c>ksp.launch</c> (see
    /// <c>GateDeclarations</c>), evaluated by the engine before this handler is
    /// entered, so an occupied pad darkens the control instead of failing the
    /// press. They are not repeated here. Everything below needs the craft, and
    /// the craft is only in scope once the command's own arguments have been
    /// resolved to a file and read; a declared requirement for those would
    /// abstain on an empty bag, which is the answer the two static ones already
    /// give.</para>
    ///
    /// <para><b>The set, and its order,</b> is
    /// <c>KSCFacilityContextMenu.launchChecks</c>'s
    /// (Assembly-CSharp 649054-649172), which builds a <c>ShipTemplate</c> off
    /// the same <c>ConfigNode</c> we already load and passes it to the
    /// template-taking overloads of the four measuring tests. The four
    /// manifest-taking tests take the <c>VesselCrewManifest</c> we already
    /// build. Nothing here needs a <c>ShipConstruct</c>, which is the thing this
    /// mod genuinely cannot have outside the editor.</para>
    /// </summary>
    internal static class LaunchPreflight
    {
        /// <summary>
        /// The first of KSP's launch tests to say no, as the refusal to return,
        /// or null when every one of them passed.
        ///
        /// <para>Order is stock's, and the FIRST failure is the one reported: a
        /// craft that is both too heavy and unaffordable gets told what stock
        /// would have told it, rather than whichever refusal happened to be
        /// checked last.</para>
        ///
        /// <para>A test whose own body throws REFUSES. Every implementation
        /// reaches live scene state, and an unreadable gate is not a passed one;
        /// treating it as a pass is how a gate fails open, and this one guards a
        /// spend.</para>
        /// </summary>
        public static CommandResult? FirstRefusal(IEnumerable<LaunchCheck> checks)
        {
            if (checks == null) return null;
            foreach (var check in checks)
            {
                if (check?.Test == null) continue;

                bool passed;
                try
                {
                    passed = check.Test.Test();
                }
                catch (Exception ex)
                {
                    return CommandResult.Fail(
                        check.Code, "KSP could not run its own launch check: " + ex.Message);
                }

                if (passed) continue;

                return check.Breach != null
                    ? CommandResult.Fail(check.Code, check.Breach)
                    : CommandResult.Fail(check.Code, Words(check.Test));
            }
            return null;
        }

        /// <summary>
        /// The craft-dependent half of stock's launch check set, for one launch.
        ///
        /// <para><paramref name="editorFacility"/> is where the craft was BUILT,
        /// which is the tier the part-count limit is read at.
        /// <paramref name="site"/> is where it is going, which is the tier the
        /// mass and size limits are read at, and those two only exist for the
        /// two KSC sites, exactly as stock guards them with
        /// <c>if (launchSiteName == "LaunchPad")</c>.</para>
        ///
        /// <para>Each check is built through <see cref="Add"/> because several
        /// of these CONSTRUCTORS do live reads of their own
        /// (<c>FacilityOperational</c> resolves through <c>PSystemSetup</c>,
        /// <c>ExperimentalPartsAvailable</c> walks the manifest against
        /// <c>ResearchAndDevelopment</c>). A constructor that throws must lose
        /// its own check and not the other seven, and must never take the launch
        /// command down with it.</para>
        /// </summary>
        public static List<LaunchCheck> CraftChecks(
            ShipTemplate template,
            VesselCrewManifest manifest,
            EditorFacility editorFacility,
            string craftPath,
            string site)
        {
            var checks = new List<LaunchCheck>();
            var gameVariables = GameVariables.Instance;
            var facilities = ScenarioUpgradeableFacilities.Instance;

            var isVab = editorFacility == EditorFacility.VAB;
            var editorSCFacility = isVab
                ? SpaceCenterFacility.VehicleAssemblyBuilding
                : SpaceCenterFacility.SpaceplaneHangar;

            if (template != null && gameVariables != null && facilities != null)
            {
                var editorNorm = ScenarioUpgradeableFacilities.GetFacilityLevel(editorSCFacility);
                var partLimit = gameVariables.GetPartCountLimit(editorNorm, isVab);
                Add(checks, () => new LaunchCheck(
                    new PreFlightTests.CraftWithinPartCountLimit(template, editorSCFacility, partLimit),
                    CommandErrorCode.LimitReached,
                    Breach(editorSCFacility, editorNorm, "partCount", template.partCount, partLimit, Units.Count)));

                if (TryLaunchSiteFacility(site, out var siteFacility, out var isPad))
                {
                    var siteNorm = ScenarioUpgradeableFacilities.GetFacilityLevel(siteFacility);

                    var sizeLimit = gameVariables.GetCraftSizeLimit(siteNorm, isPad);
                    Add(checks, () => new LaunchCheck(
                        new PreFlightTests.CraftWithinSizeLimits(template, siteFacility, sizeLimit),
                        // No breach: the comparison is three-dimensional and
                        // LimitBreach is one number against one number. The
                        // game's own description names every axis that broke,
                        // so quoting it beats picking an axis here.
                        CommandErrorCode.LimitReached));

                    var massLimit = gameVariables.GetCraftMassLimit(siteNorm, isPad);
                    Add(checks, () => new LaunchCheck(
                        new PreFlightTests.CraftWithinMassLimits(template, siteFacility, massLimit),
                        CommandErrorCode.LimitReached,
                        Breach(siteFacility, siteNorm, "mass", template.totalMass, massLimit, Units.Tonnes)));
                }
            }

            if (manifest != null)
            {
                Add(checks, () => new LaunchCheck(
                    new PreFlightTests.ExperimentalPartsAvailable(manifest),
                    CommandErrorCode.NotUnlocked));
            }

            if (template != null)
            {
                // Funding.Instance is null outside career, and the test's own
                // constructor reads that as an unlimited balance, so this is
                // safe to build in any save.
                Add(checks, () => new LaunchCheck(
                    new PreFlightTests.CanAffordLaunchTest(template, Funding.Instance),
                    CommandErrorCode.InsufficientFunds));
            }

            // Stock runs FacilityOperational twice: once for the launch site,
            // once for the building the craft was assembled in. The first is a
            // declared gate; this is the second, which depends on which editor
            // the command named and so cannot be static. PSystemSetup knows the
            // construction facilities as "VAB"/"SPH", not by their
            // SpaceCenterFacility member names.
            var constructionFacility = isVab ? "VAB" : "SPH";
            Add(checks, () => new LaunchCheck(
                new PreFlightTests.FacilityOperational(
                    constructionFacility, FacilityGateName(editorSCFacility)),
                CommandErrorCode.FacilityDamaged));

            if (manifest != null)
            {
                Add(checks, () => new LaunchCheck(
                    new PreFlightTests.NoControlSources(manifest),
                    CommandErrorCode.CapabilityMismatch));
            }

            if (!string.IsNullOrEmpty(craftPath) && TryLaunchSiteEditor(site, out var expectedEditor))
            {
                Add(checks, () => new LaunchCheck(
                    new PreFlightTests.WrongVesselTypeForLaunchSite(
                        expectedEditor, craftPath, template?.shipName ?? "", site),
                    CommandErrorCode.CapabilityMismatch));
            }

            return checks;
        }

        /// <summary>
        /// Builds one check into <paramref name="checks"/>, or drops it if its
        /// constructor threw. Several of these read live scene state as they are
        /// constructed, and losing one of eight is a great deal better than
        /// losing the launch command to an exception. The game still runs its
        /// own copy of every one of them behind us.
        /// </summary>
        private static void Add(List<LaunchCheck> checks, Func<LaunchCheck> make)
        {
            try
            {
                checks.Add(make());
            }
            catch (Exception)
            {
            }
        }

        /// <summary>
        /// The game's own sentence for a refusal: the description when it has
        /// one, else the title. Both go through <c>Localizer</c>, so they arrive
        /// in the player's language. KSP caches several of these lazily and
        /// hands back null until it has, which is why neither is trusted to be
        /// there.
        /// </summary>
        private static string Words(PreFlightTests.IPreFlightTest test)
        {
            try
            {
                var description = test.GetWarningDescription();
                if (!string.IsNullOrWhiteSpace(description)) return description;
                return test.GetWarningTitle() ?? "";
            }
            catch (Exception)
            {
                return "";
            }
        }

        /// <summary>The KSC site a launch-site name names, and whether it is a pad (mass and size scale differently on a runway).</summary>
        private static bool TryLaunchSiteFacility(string site, out SpaceCenterFacility facility, out bool isPad)
        {
            if (string.Equals(site, "LaunchPad", StringComparison.Ordinal))
            {
                facility = SpaceCenterFacility.LaunchPad;
                isPad = true;
                return true;
            }
            if (string.Equals(site, "Runway", StringComparison.Ordinal))
            {
                facility = SpaceCenterFacility.Runway;
                isPad = false;
                return true;
            }
            // A modded or non-KSC site has no GameVariables tier to read, and
            // stock skips both limits there rather than guessing one.
            facility = SpaceCenterFacility.LaunchPad;
            isPad = true;
            return false;
        }

        /// <summary>Which editor a launch site accepts craft from, for <c>WrongVesselTypeForLaunchSite</c>.</summary>
        private static bool TryLaunchSiteEditor(string site, out EditorFacility editor)
        {
            if (string.Equals(site, "LaunchPad", StringComparison.Ordinal))
            {
                editor = EditorFacility.VAB;
                return true;
            }
            if (string.Equals(site, "Runway", StringComparison.Ordinal))
            {
                editor = EditorFacility.SPH;
                return true;
            }
            editor = EditorFacility.None;
            return false;
        }

        private static LimitBreach? Breach(
            SpaceCenterFacility facility, double norm, string quantity, double actual, double limit, string unit)
        {
            var real = CareerRefusals.RealLimit(limit);
            if (real == null) return null;
            return new LimitBreach
            {
                Facility = facility.ToString(),
                FacilityName = FacilityGateName(facility),
                FacilityLevel = norm,
                Quantity = quantity,
                Limit = real,
                Actual = actual,
                Unit = unit,
            };
        }

        /// <summary>The facility as the GAME names it, through <c>Localizer</c>.</summary>
        private static string FacilityGateName(SpaceCenterFacility facility)
        {
            try
            {
                return ScenarioUpgradeableFacilities.GetFacilityName(facility) ?? "";
            }
            catch (Exception)
            {
                return "";
            }
        }
    }
}
