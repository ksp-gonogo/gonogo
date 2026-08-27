using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using CommNet;
using UnityEngine;

namespace Gonogo.DevTools
{
    /// <summary>
    /// DEV-ONLY test tooling. Polls a request file
    /// (<c>PluginData/currency-request.cfg</c>, next to this assembly) and, on a
    /// new request, awards funds / science / reputation under a caller-chosen
    /// <c>TransactionReasons</c>, optionally attributed to a named vessel so the
    /// award travels the currency-delay subsystem's AWAY path instead of landing
    /// at KSC. It then samples every balance on a timer and writes the whole
    /// series into the result cfg, so a single request measures whether a credit
    /// lands immediately, at reveal, or twice.
    ///
    /// <para><b>Why this exists.</b> Earning currency in a real career needs a
    /// craft with an instrument and a transmitter, in the right situation, with
    /// a comm link. That makes the delay model expensive to exercise and, in
    /// practice, untested. This awards the same currency through the same stock
    /// entry points the game uses, so the delay subsystem, RP-1's currency
    /// handlers, and anything else on those events all see an ordinary award.</para>
    ///
    /// <para><b>It cannot answer the science question on a Kerbalism install.</b>
    /// <c>ResearchAndDevelopment.AddScience</c> is the stock path, and
    /// GonogoKerbalismUplink sets <c>KERBALISM.API.preventScienceCrediting</c>,
    /// which makes its own Harmony postfix on
    /// <c>KERBALISM.SubjectData.RetrieveScience</c> the only thing that credits
    /// science at all. Use <see cref="GonogoDevKerbalismScience"/> for science
    /// wherever Kerbalism is installed; this tool remains the one for funds,
    /// reputation, and stock-path science.</para>
    ///
    /// <para><b>Attribution: two kinds of mode.</b>
    /// <c>Gonogo.KSP.CurrencyDelay.StockCurrencyInterceptor</c> only delays a change
    /// whose <c>TransactionReasons</c> is ScienceTransmission, VesselRecovery or
    /// VesselLoss AND for which a vessel was resolved from a separate KSP event.</para>
    ///
    /// <para>The <b>award modes</b> (<c>none</c>, <c>lab</c>) credit the currency
    /// themselves. Of the three vessel-bearing events, only
    /// <c>OnTriggeredDataTransmission</c> (the stock-lab transmission path) can be
    /// fired as a pure notification, naming a vessel and nothing else - see
    /// <see cref="NameLabTransmissionOrigin"/> for the two fields that make it one, and
    /// what it did before they were set. The origin needs no lab: the event names a
    /// vessel, it does not simulate a transmission. So <c>attribute = lab</c> is the one
    /// award mode that can attribute anything to a place, and science is the one
    /// currency it can carry.</para>
    ///
    /// <para>The <b>trigger modes</b> (<c>recover</c>, <c>destroy</c>, <c>crewdeath</c>)
    /// credit nothing at all. They call the public, non-UI producer of the real event
    /// and let the game do the crediting under its own reason with its own base
    /// amounts - see <see cref="Trigger"/>. That is how funds and reputation become
    /// measurable without firing a lifecycle event other mods act on destructively: the
    /// event is not fired, it is caused, so every reaction to it is correct. Each of the
    /// three is irreversible, so each is gated by
    /// <see cref="CurrencyProbeVerdicts.RefuseTrigger"/>.</para>
    ///
    /// <para><b>A funds light-time cannot be validated by any of this, because there is
    /// not one.</b> <c>OnFundsChanged</c> gates away purely on a recovery correlation and
    /// then passes <c>KscDelay.Instant</c> unconditionally, so funds has exactly one away
    /// trigger and that trigger is defined to be instant. <c>recover</c> validates the
    /// away classification, the neutralise and the same-frame instant reveal round trip,
    /// which is worth validating because a bug there double-credits or erases funds.
    /// Reputation is the currency with a genuinely delayable away path, and
    /// <c>destroy</c> is its only trigger.</para>
    ///
    /// <para>Request format (mirrors <see cref="GonogoDevTeleport"/>'s TELEPORT node):
    /// <code>
    /// CURRENCY
    /// {
    ///     id = 2026-08-26-sci-away-1   // unique per request; a repeat is ignored
    ///     attribute = lab              // none | lab | recover | destroy | crewdeath
    ///     origin = active              // active | ksc | vessel name | vessel GUID
    ///     watchSeconds = 600           // 0 (default) writes one before/after pair
    ///     watchIntervalSeconds = 5
    ///
    ///     // award modes (none, lab) only; a trigger mode REFUSES these three
    ///     currency = Science           // Funds | Science | Reputation
    ///     amount = 25                  // signed; a penalty is negative
    ///     reason = ScienceTransmission // any TransactionReasons member name
    ///
    ///     // trigger modes only
    ///     confirm = Probe Odyssey 3    // must repeat the resolved vessel's exact name
    ///     crew = Jebediah Kerman       // crewdeath only; default is the first aboard
    /// }
    /// </code>
    /// In an award mode the reason is what decides whether the award delays at all: the
    /// interceptor's away set is ScienceTransmission, VesselRecovery and VesselLoss, and
    /// everything else reveals instantly.</para>
    ///
    /// <para>The result cfg carries one SAMPLE node per reading, labelled
    /// <c>before</c>, <c>after</c>, then <c>watch</c>. Each carries all three balances
    /// with a per-currency MOVEMENT verdict beside them (WITHHELD / LANDED / LANDED AND
    /// STILL PENDING / no movement), because a raw balance column cannot tell a withheld
    /// credit from an award that never happened, and cannot tell a credit that landed
    /// from one that landed and is queued to land again.</para>
    ///
    /// <para><b>And each sample reports whether the delay LEAKED.</b> Measured on
    /// 2026-08-27: 25 science was withheld with one pending row while RP-1's confidence
    /// went 700 to 800 and confidenceEarned 200 to 300, both at earn time. An operator
    /// watching confidence therefore knows the science arrived before it does, and in
    /// RP-1 confidence gates real career decisions. The leak lines report that
    /// co-occurrence per derived quantity; the causal reading is left as an inference,
    /// since RP-1 crediting confidence off a science award is a belief about RP0.dll and
    /// not something this probe reads.</para>
    ///
    /// <para><b>An id fires once, ever.</b> Applying a request writes its id to
    /// <c>PluginData/currency-applied.cfg</c>, and a request whose id matches that
    /// stamp is skipped, so leaving the request cfg on disk (which is the normal
    /// state of affairs, it is synced) no longer re-awards on the next KSP start.
    /// Re-running a request means bumping the id, or deleting the stamp.</para>
    ///
    /// <para><b>Every sample also reports what the delay subsystem itself did</b>,
    /// read off the live <c>CurrencyDelayScenario</c> by reflection: whether the
    /// subsystem is in the loaded Gonogo assembly at all, whether the interceptor
    /// subscribed, how many rows the pending-credit ledger holds, and the
    /// interceptor's shadow science. Balances alone cannot tell a delay that did
    /// not engage from a delay that engaged and revealed instantly, and both look
    /// like "the science landed at once" - the first run of this tool produced
    /// exactly that ambiguity. A neutralised award shows shadowScience below the
    /// live balance and a non-zero pendingRows; an award the interceptor classed
    /// HOME shows shadowScience tracking the live balance and pendingRows at
    /// zero.</para>
    ///
    /// <para><b>And every sample reports the ROUTE DECISION and its inputs</b>, in
    /// the ROUTE node: what the currency arm's own read of
    /// <c>vessel.connection.ControlPath</c> actually saw (hop count, how many hops
    /// touch a home node, total path length), what
    /// <c>KscLightTime.ForVessel</c> made of it, what
    /// <c>KscDelayPolicy.DelaySeconds</c> would therefore add, and - when the answer
    /// is Unroutable - WHICH of those tests failed. Before that node existed, a run
    /// reported an unexplained "nothing revealed" and cost a night: an
    /// <c>Unroutable</c> with no reason behind it is indistinguishable from broken
    /// arithmetic, and the two want opposite fixes. Every figure in it is READ, not
    /// inferred, and the derived reading beside it (the CLASSIFICATION on each ledger
    /// row, from the row's own reveal offset) is labelled as derived precisely so a
    /// disagreement between the two is visible rather than smoothed over.</para>
    ///
    /// <para><b>Not production behaviour.</b> Lives in the Deck-only
    /// GonogoDevTools assembly and is never shipped. With no request file (the
    /// production default), this addon does nothing at all.</para>
    ///
    /// <c>once: false</c> re-instantiates this every time the flight scene
    /// loads. <see cref="_lastAppliedId"/> is <b>static</b> so a request is
    /// applied once per KSP process even across scene reloads, and
    /// <see cref="_stampPath"/> carries the same id ACROSS processes so a request
    /// cfg left on disk does not silently re-award on the next KSP start.
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Flight, once: false)]
    public sealed class GonogoDevCurrency : MonoBehaviour
    {
        private const string LogPrefix = "[GonogoDevCurrency] ";

        /// <summary>Process-wide last-applied request id. Requests whose id
        /// matches this are ignored, so writing the same file twice (or a scene
        /// reload re-reading it) never re-awards.</summary>
        private static string? _lastAppliedId;

        /// <summary>
        /// The last-applied id as last STAMPED to disk, so the guard above survives
        /// the process it was set in.
        ///
        /// <para><b>The replay this closes.</b> A request cfg persists and the guard
        /// above did not, so every KSP start re-read whatever request was still on
        /// disk and awarded it again. On 2026-08-27 that fabricated a ledger row
        /// twice and polluted two before/after pairs, and the fabricated row was then
        /// the one the probe reported, because the probe named the OLDEST row rather
        /// than the one the run had just made.</para>
        ///
        /// <para><b>Why a stamp rather than consuming the request.</b> The request
        /// file is the operator's, written over SSH or through syncthing; deleting or
        /// rewriting it takes their input away and races the sync. A separate stamp
        /// this addon owns changes nothing on their side, and re-running the same
        /// request stays a deliberate act: bump the id, which is what the id is
        /// for.</para>
        /// </summary>
        private string? _stampPath;

        /// <summary>The force-comms request cfg, read here for REPORTING only. The
        /// override itself is applied by <c>Gonogo.KSP.DevCommsOverride</c>, which
        /// polls this same file independently (see that class); this addon is a third
        /// reader of it, so the result file can say what mode was in force while the
        /// award was made.</summary>
        private string? _forceCommsRequestPath;

        private const float PollIntervalSeconds = 1f;
        private const double DefaultWatchSeconds = 0.0;
        private const double DefaultWatchIntervalSeconds = 5.0;

        /// <summary>An hour of samples is long enough for any light-time inside
        /// the Kerbol/Sol system and for the unroutable case's silence
        /// declaration to be visibly pending, and short enough that the result
        /// file stays readable.</summary>
        private const double MaxWatchSeconds = 3600.0;

        private float _sinceLastPoll;

        private string? _requestPath;
        private string? _resultPath;

        /// <summary>The request currently being watched, held so every sample
        /// rewrites one coherent result file rather than appending to a stale
        /// header.</summary>
        private WatchState? _watch;

        private sealed class WatchState
        {
            public string Id = "";
            public string Summary = "";
            public bool Ok;
            public double StartRealtime;
            public double EndRealtime;
            public double IntervalSeconds;
            public double NextSampleRealtime;
            public readonly List<Sample> Samples = new List<Sample>();

            /// <summary>The vessel the award was attributed to, as a guid, re-resolved
            /// on every sample rather than held: a vessel destroyed mid-watch must
            /// read as gone, not as a stale handle that still answers.</summary>
            public string ProbeVesselId = "";

            public string ProbeVesselName = "";

            /// <summary>Game UT at the moment of the award, so a row's reveal offset is
            /// a difference against the event that made it rather than against the
            /// sample that happened to notice it.</summary>
            public double AwardUt;

            /// <summary>
            /// Every ledger row that existed BEFORE the award, by reference.
            ///
            /// <para>This is what makes the run's own row nameable. The ledger persists
            /// across saves and every previous run's rows are still in it, so
            /// "the first pending row" is somebody else's award and reporting it told
            /// an operator nothing about what they had just done. Reference identity,
            /// not a synthesised key: the ledger hands out the live row objects, and a
            /// key built from currency+amount+origin would collapse two identical
            /// awards into one.</para>
            /// </summary>
            public readonly List<object> PreAwardRows = new List<object>();

            public bool PreAwardRowsCaptured;

            /// <summary>The <c>attribute</c> mode this request ran in, so the result file
            /// says whether the tool awarded the currency or the game did.</summary>
            public string Mode = "none";

            /// <summary>What a trigger mode was expected to produce, recorded before the
            /// trigger fired. A run that produced nothing and a run that could never have
            /// produced anything read identically without it.</summary>
            public string TriggerForecast = "";

            /// <summary>What the trigger call itself reported, which is not the same as
            /// what the game then did with it.</summary>
            public string TriggerOutcome = "";

            /// <summary>-1 until read, so an unread crew count never renders as an empty
            /// craft.</summary>
            public int OriginCrewCount = -1;

            /// <summary>Which crew member <c>attribute = crewdeath</c> names, empty for
            /// the first one aboard.</summary>
            public string CrewName = "";
        }

        private readonly struct Sample
        {
            public Sample(string label, double sinceAwardSeconds, double ut, Balances balances, DelaySubsystem delay)
            {
                Label = label;
                SinceAwardSeconds = sinceAwardSeconds;
                Ut = ut;
                Balances = balances;
                Delay = delay;
            }

            public string Label { get; }
            public double SinceAwardSeconds { get; }
            public double Ut { get; }
            public Balances Balances { get; }
            public DelaySubsystem Delay { get; }
        }

        /// <summary>
        /// What the currency-delay subsystem itself is doing, read off the live
        /// <c>CurrencyDelayScenario</c>. <see cref="Fault"/> names the first thing
        /// that could not be read rather than leaving a zero to be misread as a
        /// measurement.
        /// </summary>
        private readonly struct DelaySubsystem
        {
            public DelaySubsystem(bool present, bool scenarioLive, int scenarioInstances, bool subscribed, int pendingRows, Shadows shadows, int labVessels, int scienceDefers, Correlations correlations, List<LedgerRowReading>? rows, RouteProbe route, string fault)
            {
                Present = present;
                ScenarioLive = scenarioLive;
                ScenarioInstances = scenarioInstances;
                Subscribed = subscribed;
                PendingRows = pendingRows;
                Shadows = shadows;
                LabVessels = labVessels;
                ScienceDefers = scienceDefers;
                Correlations = correlations;
                Rows = rows ?? new List<LedgerRowReading>();
                Route = route;
                Fault = fault ?? "";
            }

            public bool Present { get; }
            public bool ScenarioLive { get; }

            /// <summary>How many live CurrencyDelayScenario objects exist. Anything but 1
            /// makes every other figure here a reading of one arbitrary instance, so the
            /// count is reported rather than assumed.</summary>
            public int ScenarioInstances { get; }

            public bool Subscribed { get; }
            public int PendingRows { get; }

            /// <summary>All three shadow balances, not just science. Funds and
            /// reputation have shadows of their own and neither was being read, which
            /// is why an unmoved funds balance could not be told from a neutralised
            /// one.</summary>
            public Shadows Shadows { get; }

            /// <summary>Unclaimed lab-vessel pushes, and science changes still
            /// waiting for one. Together they say which half of the
            /// correlation failed: a change deferred with no lab vessel means
            /// the push never reached the interceptor, whereas both non-zero
            /// means it arrived and was not claimed.</summary>
            public int LabVessels { get; }
            public int ScienceDefers { get; }

            /// <summary>The recovery and death correlation state, which is the same
            /// which-half-failed reading as LabVessels/ScienceDefers, for the two
            /// currencies that had none.</summary>
            public Correlations Correlations { get; }

            /// <summary>EVERY row in the ledger, not the first one. See
            /// <see cref="WatchState.PreAwardRows"/> for why one was never enough.</summary>
            public List<LedgerRowReading> Rows { get; }

            public RouteProbe Route { get; }

            public string Fault { get; }

            public static DelaySubsystem Absent(string fault) =>
                new DelaySubsystem(false, false, 0, false, -1, Shadows.Unreadable, -1, -1, Correlations.Unreadable, null,
                    RouteProbe.NotAttempted("delay subsystem absent"), fault);

            /// <summary>How many rows this run's own award put in the ledger.</summary>
            public int NewRows
            {
                get
                {
                    var count = 0;
                    foreach (var row in Rows)
                    {
                        if (row.IsNew)
                        {
                            count++;
                        }
                    }
                    return count;
                }
            }

            /// <summary>
            /// How many rows this run put in the ledger for one currency, or -1 when the
            /// ledger itself could not be read.
            ///
            /// <para>Per currency, because that is what makes a matrix cell. A run that
            /// triggers a real recovery moves all three balances at once, so a single
            /// total says nothing about which of the three was actually withheld.</para>
            /// </summary>
            public int NewRowsFor(string currency)
            {
                if (PendingRows < 0)
                {
                    return -1;
                }

                var count = 0;
                foreach (var row in Rows)
                {
                    if (row.IsNew && string.Equals(row.Currency, currency, StringComparison.Ordinal))
                    {
                        count++;
                    }
                }
                return count;
            }
        }

        /// <summary>The interceptor's three shadow balances. NaN where a read failed, so
        /// a shadow that could not be reached never renders as a shadow sitting at
        /// zero.</summary>
        private readonly struct Shadows
        {
            public Shadows(double funds, double science, double reputation)
            {
                Funds = funds;
                Science = science;
                Reputation = reputation;
            }

            public double Funds { get; }
            public double Science { get; }
            public double Reputation { get; }

            public static Shadows Unreadable =>
                new Shadows(double.NaN, double.NaN, double.NaN);
        }

        /// <summary>
        /// The interceptor's recovery and death correlation state, which is what tells
        /// a push that never arrived from one that arrived in the wrong order.
        ///
        /// <para>Both matter and the second is not hypothetical. Stock <c>Funding</c>,
        /// <c>ResearchAndDevelopment</c> and <c>Reputation</c> all credit recovery
        /// currency from <c>onVesselRecoveryProcessing</c>, the same event the
        /// interceptor pushes its recovery vessel from, so whether the away path
        /// engages depends on GameEvents dispatch order. If stock runs first, the
        /// change is classed HOME and lands instantly, which is indistinguishable
        /// from the recovery arms' by-design instant reveal unless these counters are
        /// read: a vessel HELD with no row made says the push landed and nothing
        /// claimed it, and a vessel never held says the push came too late.</para>
        /// </summary>
        private readonly struct Correlations
        {
            public Correlations(int recoveryVesselsHeld, int deathLightTimesHeld, int recoveryPushesPending, int deathPushesPending, int reputationDefersPending)
            {
                RecoveryVesselsHeld = recoveryVesselsHeld;
                DeathLightTimesHeld = deathLightTimesHeld;
                RecoveryPushesPending = recoveryPushesPending;
                DeathPushesPending = deathPushesPending;
                ReputationDefersPending = reputationDefersPending;
            }

            /// <summary>Entries in the interceptor's <c>_recoveryVesselsById</c>. Never
            /// pruned by design, so this only ever grows: what matters is whether it
            /// grew across the trigger.</summary>
            public int RecoveryVesselsHeld { get; }

            /// <summary>Entries in <c>_deathLightTimesById</c>, captured at the instant of
            /// destruction. Also never pruned.</summary>
            public int DeathLightTimesHeld { get; }

            /// <summary>Unclaimed pushes still inside the state machine's attribution
            /// window.</summary>
            public int RecoveryPushesPending { get; }
            public int DeathPushesPending { get; }

            /// <summary>VesselLoss reputation changes waiting for a destruction to
            /// explain them. Non-zero with no death push is the crew-died-but-the-craft-
            /// survived case, which settles HOME and lands the penalty instantly.</summary>
            public int ReputationDefersPending { get; }

            public static Correlations Unreadable =>
                new Correlations(-1, -1, -1, -1, -1);
        }

        /// <summary>
        /// One row of the pending-credit ledger as the probe reads it, with the two
        /// figures a reader actually needs beside the raw ones: how far the reveal
        /// still is from NOW, and whether this run created it.
        /// </summary>
        private readonly struct LedgerRowReading
        {
            public LedgerRowReading(int index, bool isNew, string currency, double baseAmount, double revealUt, double revealInSeconds, string classification, string origin)
            {
                Index = index;
                IsNew = isNew;
                Currency = currency ?? "";
                BaseAmount = baseAmount;
                RevealUt = revealUt;
                RevealInSeconds = revealInSeconds;
                Classification = classification ?? "";
                Origin = origin ?? "";
            }

            public int Index { get; }
            public bool IsNew { get; }
            public string Currency { get; }
            public double BaseAmount { get; }
            public double RevealUt { get; }
            public double RevealInSeconds { get; }

            /// <summary>DERIVED from the reveal offset, never read off the row: the row
            /// does not record which branch produced it. Reported beside the ROUTE
            /// node's directly-observed answer so the two can disagree in public.</summary>
            public string Classification { get; }

            public string Origin { get; }
        }

        /// <summary>
        /// The route decision the currency arm makes, with every input it made it
        /// from.
        ///
        /// <para>Two independent readings sit side by side here on purpose. The RAW
        /// half walks <c>vessel.connection.ControlPath</c> directly, in this assembly,
        /// with no production code involved; the PRODUCTION half invokes
        /// <c>KscLightTime.ForVessel</c> by reflection and reports what the subsystem
        /// itself concluded. A probe that only asked the code under test what it
        /// thought would agree with itself in every world, including a broken one.
        /// Disagreement between the two halves is the finding.</para>
        /// </summary>
        private sealed class RouteProbe
        {
            public bool Attempted;
            public string VesselName = "";
            public string VesselId = "";
            public bool VesselFound;
            public bool Loaded;
            public bool ConnectionPresent;

            /// <summary>What the LIVE CommNet connection says, before any dev override.</summary>
            public bool RawConnected;

            /// <summary>A null ControlPath is an ABSENT path; an empty one is a path
            /// with nothing on it. The two are different claims and are reported
            /// separately, exactly as FleetCommsReader's own comment insists.</summary>
            public bool ControlPathPresent;

            /// <summary>-1 wherever a count could not be read, never 0: a measured
            /// "no hops" and an unreadable path are opposite conclusions.</summary>
            public int HopCount = -1;

            public int HomeHopCount = -1;
            public string LastHopIsHome = "";
            public double TotalPathMeters = double.NaN;

            /// <summary>Home nodes in the scene at all. Zero means CommNet itself has
            /// no ground station, which is a different failure from a craft that
            /// cannot reach one.</summary>
            public int HomeNodesInScene = -1;

            public double NearestHomeMeters = double.NaN;

            /// <summary>Straight-line seconds to the nearest home node at the config's
            /// scaled c. NOT what the subsystem uses, and deliberately so - the
            /// straight-line arm was deleted because a chord through a planet is not a
            /// signal path. It is here as a SCALE CHECK: if a routed answer is orders
            /// off this, the arithmetic is wrong rather than the routing.</summary>
            public double StraightLineSeconds = double.NaN;

            public string ProductionKind = "";
            public string ProductionSeconds = "";
            public string PolicySeconds = "";

            /// <summary>Which raw precondition was false, when the answer is Unroutable.
            /// A bare "unroutable" with nothing behind it is what cost this subsystem a
            /// night.</summary>
            public string FailedTest = "";

            public string Fault = "";

            public DelayConfigReadout Config = DelayConfigReadout.Unreadable("not read");

            public string OverrideMode = "";
            public string OverrideReach = "";

            /// <summary>Whether the route read produced a light-time at all, which is
            /// the observation <see cref="CurrencyProbeVerdicts.JudgeOverrideReach"/>
            /// weighs against the override.</summary>
            public bool FoundAPath;

            public static RouteProbe NotAttempted(string why) =>
                new RouteProbe { Attempted = false, Fault = why ?? "" };
        }

        /// <summary>
        /// The signal-delay config the currency arm actually reads, which is the
        /// EFFECTIVE one: a live simulation cuts the delay, and a run where every
        /// credit landed instantly for that reason looks exactly like a subsystem that
        /// never engaged. The authored flag is reported beside it so the cut is
        /// visible rather than inferred.
        /// </summary>
        private readonly struct DelayConfigReadout
        {
            public DelayConfigReadout(bool readable, bool enabled, double lightSpeedScale, double silenceSeconds, bool cutForSimulation, bool authoredEnabled, string fault)
            {
                Readable = readable;
                Enabled = enabled;
                LightSpeedScale = lightSpeedScale;
                SilenceSeconds = silenceSeconds;
                CutForSimulation = cutForSimulation;
                AuthoredEnabled = authoredEnabled;
                Fault = fault ?? "";
            }

            public bool Readable { get; }
            public bool Enabled { get; }
            public double LightSpeedScale { get; }
            public double SilenceSeconds { get; }
            public bool CutForSimulation { get; }
            public bool AuthoredEnabled { get; }
            public string Fault { get; }

            public static DelayConfigReadout Unreadable(string fault) =>
                new DelayConfigReadout(false, false, 0.0, 0.0, false, false, fault);
        }

        /// <summary>
        /// Every balance the delay model can move, plus RP-1's two confidence
        /// readings, which are the ones the double-credit question turns on.
        ///
        /// <para><b>Each currency carries its own readable flag.</b> The three stock
        /// balances live on separate ScenarioModules and any of them can be absent
        /// (a sandbox save has no Funding, a no-science career has no
        /// ResearchAndDevelopment). This used to read a missing instance as
        /// <c>0.0</c>, which is also what an unmoved balance reads, so "reputation
        /// did not move" and "there is no Reputation instance to ask" arrived in the
        /// result file as the same line.</para>
        /// </summary>
        private readonly struct Balances
        {
            public Balances(
                double funds, bool hasFunds,
                double science, bool hasScience,
                double reputation, bool hasReputation,
                bool hasConfidence, double confidence, double confidenceEarned, string confidenceFault)
            {
                Funds = funds;
                HasFunds = hasFunds;
                Science = science;
                HasScience = hasScience;
                Reputation = reputation;
                HasReputation = hasReputation;
                HasConfidence = hasConfidence;
                Confidence = confidence;
                ConfidenceEarned = confidenceEarned;
                ConfidenceFault = confidenceFault ?? "";
            }

            public double Funds { get; }
            public bool HasFunds { get; }
            public double Science { get; }
            public bool HasScience { get; }
            public double Reputation { get; }
            public bool HasReputation { get; }
            public bool HasConfidence { get; }
            public double Confidence { get; }
            public double ConfidenceEarned { get; }

            /// <summary>Why confidence is unreadable, so "RP-1 is not installed" and
            /// "RP-1 is installed and a property this probe names has moved" stop
            /// sharing an answer. The second is a broken instrument and the first is
            /// not, and the leak verdict must not report either as a clean run.</summary>
            public string ConfidenceFault { get; }

            public bool Has(CurrencyKindRead kind)
            {
                switch (kind)
                {
                    case CurrencyKindRead.Funds: return HasFunds;
                    case CurrencyKindRead.Science: return HasScience;
                    default: return HasReputation;
                }
            }

            public double Of(CurrencyKindRead kind)
            {
                switch (kind)
                {
                    case CurrencyKindRead.Funds: return Funds;
                    case CurrencyKindRead.Science: return Science;
                    default: return Reputation;
                }
            }

            public static string FaultFor(CurrencyKindRead kind)
            {
                switch (kind)
                {
                    case CurrencyKindRead.Funds: return "no Funding instance on this save";
                    case CurrencyKindRead.Science: return "no ResearchAndDevelopment instance on this save";
                    default: return "no Reputation instance on this save";
                }
            }
        }

        /// <summary>The three stock balances, as something iterable, so the movement
        /// verdict and the withheld-set are computed once per currency instead of
        /// written out three times with one of the three quietly wrong.</summary>
        private enum CurrencyKindRead
        {
            Funds,
            Science,
            Reputation,
        }

        private static readonly CurrencyKindRead[] AllCurrencies =
        {
            CurrencyKindRead.Funds,
            CurrencyKindRead.Science,
            CurrencyKindRead.Reputation,
        };

        private void Start()
        {
            try
            {
                var assemblyDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                if (string.IsNullOrEmpty(assemblyDir))
                {
                    enabled = false;
                    return;
                }

                var pluginData = Path.Combine(assemblyDir, "PluginData");
                _requestPath = Path.Combine(pluginData, "currency-request.cfg");
                _resultPath = Path.Combine(pluginData, "currency-result.cfg");
                _stampPath = Path.Combine(pluginData, "currency-applied.cfg");
                _forceCommsRequestPath = Path.Combine(pluginData, "force-comms-request.cfg");
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "Start failed: " + ex.Message);
                enabled = false;
            }
        }

        /// <summary>The id the last process to apply a request stamped, or null when
        /// nothing has been stamped. An unreadable stamp reads as null, which retries
        /// the request rather than silently swallowing it: a probe that cannot tell
        /// "nothing applied" from "cannot say" would go quiet on a filesystem
        /// hiccup.</summary>
        private string? ReadStampedId()
        {
            try
            {
                if (string.IsNullOrEmpty(_stampPath) || !File.Exists(_stampPath))
                {
                    return null;
                }
                var root = ConfigNode.Load(_stampPath);
                return root?.GetNode("APPLIED")?.GetValue("id");
            }
            catch (Exception ex)
            {
                Debug.LogWarning(LogPrefix + "could not read the applied stamp (treating as nothing applied): " + ex.Message);
                return null;
            }
        }

        private void WriteStamp(string id)
        {
            if (string.IsNullOrEmpty(_stampPath))
            {
                return;
            }

            try
            {
                var dir = Path.GetDirectoryName(_stampPath);
                if (!string.IsNullOrEmpty(dir))
                {
                    Directory.CreateDirectory(dir!);
                }

                var sb = new StringBuilder();
                sb.AppendLine("APPLIED");
                sb.AppendLine("{");
                sb.AppendLine("\tid = " + id);
                sb.AppendLine("\ttime = " + DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture));
                sb.AppendLine("\tnote = delete this file to let the request with this id fire again");
                sb.AppendLine("}");
                File.WriteAllText(_stampPath, sb.ToString());
            }
            catch (Exception ex)
            {
                // A failed stamp costs a duplicate award on the NEXT start, not this
                // one, so it is a warning rather than a refusal to proceed.
                Debug.LogWarning(LogPrefix + "failed writing the applied stamp (a restart may re-award id=" + id + "): " + ex.Message);
            }
        }

        private void Update()
        {
            try
            {
                PollWatch();
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "sampling failed: " + ex.Message);
                _watch = null;
            }

            // Modest cadence - NOT every frame, matching the other dev addons.
            _sinceLastPoll += Time.unscaledDeltaTime;
            if (_sinceLastPoll < PollIntervalSeconds)
            {
                return;
            }
            _sinceLastPoll = 0f;

            try
            {
                Poll();
            }
            catch (Exception ex)
            {
                // Never throw out of the poll.
                Debug.LogError(LogPrefix + "poll failed: " + ex.Message);
            }
        }

        private void PollWatch()
        {
            var watch = _watch;
            if (watch == null)
            {
                return;
            }

            var now = Time.realtimeSinceStartup;
            if (now < watch.NextSampleRealtime)
            {
                return;
            }

            watch.NextSampleRealtime = now + (float)watch.IntervalSeconds;
            watch.Samples.Add(new Sample("watch", RoundSeconds(now - watch.StartRealtime), CurrentUt(), ReadBalances(), ReadDelaySubsystem(watch)));
            WriteResult(watch);

            if (now >= watch.EndRealtime)
            {
                Debug.Log(LogPrefix + "watch complete for id=" + watch.Id + " (" + watch.Samples.Count + " samples)");
                _watch = null;
            }
        }

        private void Poll()
        {
            if (string.IsNullOrEmpty(_requestPath) || !File.Exists(_requestPath))
            {
                // No request file is the PRODUCTION-SAFE default.
                return;
            }

            var root = ConfigNode.Load(_requestPath);
            var node = root?.GetNode("CURRENCY");
            if (node == null)
            {
                return;
            }

            var id = node.GetValue("id");
            if (string.IsNullOrEmpty(id))
            {
                Debug.LogError(LogPrefix + "request has no 'id'; ignoring");
                return;
            }

            // Already applied - by this process, or by an earlier one that left a
            // stamp. The second half is what stops a request cfg still on disk from
            // silently re-awarding on every KSP start.
            if (!CurrencyProbeVerdicts.ShouldApply(id, _lastAppliedId, ReadStampedId()))
            {
                return;
            }

            ApplyRequest(id!, node);
        }

        private void ApplyRequest(string id, ConfigNode node)
        {
            // Claim the id up-front, in the process AND on disk: a request that throws
            // must not be retried every second, and a currency award is not something
            // to retry - across a restart least of all.
            _lastAppliedId = id;
            WriteStamp(id);

            var watch = new WatchState { Id = id };
            _watch = null;

            try
            {
                var attribute = (node.GetValue("attribute") ?? "none").Trim().ToLowerInvariant();
                if (Array.IndexOf(KnownAttributes, attribute) < 0)
                {
                    Finish(watch, ok: false, "unrecognised 'attribute' '" + attribute + "' (want "
                        + string.Join("|", KnownAttributes) + ")");
                    return;
                }
                watch.Mode = attribute;

                var originRaw = node.GetValue("origin");
                var isTrigger = Array.IndexOf(TriggerAttributes, attribute) >= 0;

                // The award modes' three fields, parsed only where an award happens. In
                // a trigger mode the game decides all three, so naming them is a
                // refusal (see CurrencyProbeVerdicts.RefuseTrigger) rather than
                // something to parse and ignore.
                var currency = Currency.Science;
                var amount = 0.0;
                var reason = TransactionReasons.None;
                Vessel? origin = null;

                if (isTrigger)
                {
                    origin = ResolveVessel(originRaw);
                    var refusal = CurrencyProbeVerdicts.RefuseTrigger(
                        attribute,
                        originResolved: origin != null,
                        originSelector: originRaw ?? "",
                        originIsActiveVessel: origin != null && ReferenceEquals(origin, FlightGlobals.ActiveVessel),
                        originName: origin != null ? origin.vesselName ?? "" : "",
                        confirm: node.GetValue("confirm"),
                        currencyGiven: node.HasValue("currency"),
                        amountGiven: node.HasValue("amount"),
                        reasonGiven: node.HasValue("reason"));
                    if (refusal != null)
                    {
                        Finish(watch, ok: false, refusal);
                        return;
                    }

                    watch.OriginCrewCount = CountCrew(origin!);
                    watch.TriggerForecast = CurrencyProbeVerdicts.ForecastTrigger(attribute, watch.OriginCrewCount);

                    if (attribute == "crewdeath")
                    {
                        watch.CrewName = (node.GetValue("crew") ?? "").Trim();
                    }
                }
                else
                {
                    var currencyRaw = node.GetValue("currency");
                    if (!TryParseCurrency(currencyRaw, out currency))
                    {
                        Finish(watch, ok: false, "unrecognised 'currency' " + Describe(currencyRaw) + " (want Funds|Science|Reputation)");
                        return;
                    }

                    if (!TryGetDouble(node, "amount", out amount) || amount == 0.0)
                    {
                        Finish(watch, ok: false, "missing/zero 'amount'");
                        return;
                    }

                    var reasonRaw = node.GetValue("reason");
                    if (!TryParseReason(reasonRaw, out reason))
                    {
                        Finish(watch, ok: false, "unrecognised 'reason' " + Describe(reasonRaw) + " (want a TransactionReasons member name, e.g. ScienceTransmission)");
                        return;
                    }

                    if (attribute == "lab")
                    {
                        if (currency != Currency.Science)
                        {
                            Finish(watch, ok: false, "attribute=lab attributes a science transmission and cannot carry " + currency
                                + "; the interceptor's lab correlation is science-only");
                            return;
                        }

                        origin = ResolveVessel(originRaw);
                        if (origin == null)
                        {
                            Finish(watch, ok: false, "attribute=lab needs a resolvable 'origin' vessel; " + Describe(originRaw) + " matched nothing");
                            return;
                        }
                    }
                }

                var watchSeconds = TryGetDouble(node, "watchSeconds", out var ws)
                    ? Math.Max(0.0, Math.Min(MaxWatchSeconds, ws))
                    : DefaultWatchSeconds;
                var watchInterval = TryGetDouble(node, "watchIntervalSeconds", out var wi) && wi > 0.0
                    ? wi
                    : DefaultWatchIntervalSeconds;

                // The vessel the ROUTE node probes. It is the attributed origin where
                // there is one, and otherwise the active vessel: a run that delays
                // nothing still wants the route reading, because "the craft was in
                // contact and it revealed instantly" and "the probe never looked" are
                // the two readings that must not share a shape.
                var probeVessel = origin ?? ResolveVessel("active");
                if (probeVessel != null)
                {
                    watch.ProbeVesselId = probeVessel.id.ToString();
                    watch.ProbeVesselName = probeVessel.vesselName ?? "";
                }

                watch.AwardUt = CurrentUt();

                var before = ReadBalances();
                watch.Samples.Add(new Sample("before", 0.0, watch.AwardUt, before, ReadDelaySubsystem(watch)));

                string summary;
                if (isTrigger)
                {
                    // Logged BEFORE the trigger, because the trigger destroys a craft or
                    // kills a kerbal and a run that then throws must still leave behind
                    // what it was about to do.
                    Debug.LogWarning(LogPrefix + "request id=" + id + ": attribute=" + attribute
                        + " is about to trigger a REAL game event on " + origin!.vesselName
                        + " [" + origin.id + "], " + watch.TriggerForecast);

                    watch.TriggerOutcome = Trigger(attribute, origin!, watch.CrewName);
                    summary = "triggered " + attribute + " on " + origin.vesselName + " [" + origin.id + "]: "
                        + watch.TriggerOutcome;
                }
                else
                {
                    if (origin != null)
                    {
                        NameLabTransmissionOrigin(origin);
                    }

                    Award(currency, amount, reason);

                    summary = string.Format(CultureInfo.InvariantCulture,
                        "awarded {0:+0.###;-0.###} {1} reason={2} attribute={3} origin={4}",
                        amount, currency, reason, attribute,
                        origin != null ? origin.vesselName + " [" + origin.id + "]" : "(none)");
                }

                var after = ReadBalances();
                watch.Samples.Add(new Sample("after", 0.0, CurrentUt(), after, ReadDelaySubsystem(watch)));

                Debug.Log(LogPrefix + "request id=" + id + ": " + summary);

                watch.Summary = summary;
                watch.Ok = true;

                if (watchSeconds <= 0.0)
                {
                    WriteResult(watch);
                    return;
                }

                watch.StartRealtime = Time.realtimeSinceStartup;
                watch.EndRealtime = watch.StartRealtime + watchSeconds;
                watch.IntervalSeconds = watchInterval;
                watch.NextSampleRealtime = watch.StartRealtime + watchInterval;
                WriteResult(watch);
                _watch = watch;
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "request id=" + id + " failed: " + ex);
                Finish(watch, ok: false, "exception: " + ex.Message);
            }
        }

        private void Finish(WatchState watch, bool ok, string message)
        {
            watch.Ok = ok;
            watch.Summary = message;
            if (!ok)
            {
                Debug.LogError(LogPrefix + "id=" + watch.Id + ": " + message);
            }
            WriteResult(watch);
        }

        /// <summary>
        /// Fires <c>OnTriggeredDataTransmission</c> with a <c>sciencelab@</c>
        /// subject, which is the signature the currency-delay interceptor keys
        /// its lab-vessel correlation on. The event exists purely to name the
        /// vessel the science came from; the value actually credited is the
        /// separate AddScience call that follows.
        ///
        /// <para><b>The zero <c>dataAmount</c> is load-bearing.</b> Every other
        /// subscriber to this event in the installed GameData is stock
        /// (decompile-checked: CelestialBodyScience, Contracts.Parameters'
        /// CollectScience, FinePrint's CometScienceParameter,
        /// ModuleOrbitalSurveyor - no third-party assembly references it at
        /// all), and the first two bail on <c>dataAmount &lt;= 0f</c> before
        /// completing anything, while the surveyor additionally requires a
        /// <c>survey@</c> subject in its own part's container and the comet
        /// parameter matches its subject id exactly.</para>
        ///
        /// <para><b>So is the unmatchable <c>container</c>, and that list missed
        /// the subscriber it mattered for.</b> <c>ModuleScienceLab.OnAwake</c>
        /// subscribes to this event and <c>OnDestroy</c> unsubscribes, so every
        /// lab PART PREFAB in the game is a permanent subscriber with no vessel
        /// and no crew behind it. Its handler opens with
        /// <c>if (data.container != part.flightID) return;</c>, a prefab's
        /// flightID is 0, and <c>ScienceData</c>'s container defaults to 0 - so a
        /// marker fired without one passed that gate on every lab prefab at once,
        /// matched the <c>sciencelab@</c> prefix check on the next line, and
        /// died in <c>updateModuleUI()</c> dereferencing a UI event the prefab
        /// never started. That is the NRE storm that blocked the whole away arm.
        /// A container no part can hold turns the first line of that handler back
        /// into the early return it is there to be.</para>
        ///
        /// <para>It also stops something worse than a log full of NREs. Past
        /// <c>updateModuleUI</c>, the same handler calls
        /// <c>AddScience(storedScience, ScienceTransmission)</c>: a REAL loaded
        /// lab whose flightID this marker happened to name would empty its whole
        /// stored science into the balance mid-measurement, under the very reason
        /// the tool is measuring.</para>
        /// </summary>
        private static void NameLabTransmissionOrigin(Vessel origin)
        {
            var data = new ScienceData(
                amount: 0f,
                xmitValue: 1f,
                xmitBonus: 0f,
                id: "sciencelab@GonogoDevCurrencyProbe",
                dataName: "Gonogo dev currency award",
                triggered: false,
                container: NoSuchPartFlightId);

            GameEvents.OnTriggeredDataTransmission.Fire(data, origin, false);
        }

        /// <summary>
        /// A part flightID no part holds. KSP hands them out from a counter
        /// (<c>FlightGlobals.CheckFlightID</c>), so the top of the range is
        /// unreachable, and a prefab's is 0 - which is what makes 0 the one value
        /// this marker must never carry.
        /// </summary>
        private const uint NoSuchPartFlightId = uint.MaxValue;

        /// <summary>Every accepted <c>attribute</c> value, listed once so the refusal
        /// message and the parse cannot drift apart.</summary>
        private static readonly string[] KnownAttributes = { "none", "lab", "recover", "destroy", "crewdeath" };

        /// <summary>The modes that award nothing and cause a real game event instead.</summary>
        private static readonly string[] TriggerAttributes = { "recover", "destroy", "crewdeath" };

        /// <summary>
        /// Causes the real game event whose currency changes attribute to a place, and
        /// awards nothing itself.
        ///
        /// <para><b>Why a real event rather than a fired one.</b> The interceptor's away
        /// set is ScienceTransmission, VesselRecovery and VesselLoss. Only the first can
        /// be attributed by a pure notification (<see cref="NameLabTransmissionOrigin"/>),
        /// and it is science-only, which is why funds and reputation were unmeasurable.
        /// The other two are lifecycle events other mods act on destructively, so firing
        /// them by hand is out. But both have a public, non-UI producer, and calling that
        /// makes the event fire from inside stock's own code with every consequence
        /// intact - which is the only way to exercise what the game exercises.</para>
        ///
        /// <para><b>And a fired event could not have found the ordering bug.</b> Stock
        /// <c>Funding</c>, <c>ResearchAndDevelopment</c> and <c>Reputation</c> all credit
        /// recovery currency from <c>onVesselRecoveryProcessing</c>, the same event the
        /// interceptor pushes its recovery vessel from, so whether the away path engages
        /// at all depends on GameEvents dispatch order. A test seam that pushed the
        /// vessel directly would be in the right order by construction and could never
        /// see it. The correlation counters in <see cref="Correlations"/> are what make
        /// it visible.</para>
        ///
        /// <para><b>None of these is undoable</b>, which is why every guard on them lives
        /// in <see cref="CurrencyProbeVerdicts.RefuseTrigger"/> and runs before this is
        /// called: a resolvable non-active origin, no award fields, and a <c>confirm</c>
        /// repeating the resolved vessel's own name.</para>
        /// </summary>
        private static string Trigger(string mode, Vessel origin, string crewName)
        {
            switch (mode)
            {
                case "recover":
                    return TriggerRecovery(origin);
                case "destroy":
                    return TriggerDestruction(origin);
                default:
                    return TriggerCrewDeath(origin, crewName);
            }
        }

        /// <summary>
        /// <c>ShipConstruction.RecoverVesselFromFlight</c>, whose whole body is: fire
        /// <c>onVesselRecovered</c>, drop the protovessel from the flight state, then
        /// unload and destroy the vessel object. The first step reaches stock
        /// <c>VesselRecovery.OnVesselRecovered</c>, which computes the real great-circle
        /// recovery factor, recovers the crew, and fires
        /// <c>onVesselRecoveryProcessing</c> - the event the interceptor keys its
        /// recovery correlation on, and the event stock's own three currency modules
        /// credit from.
        ///
        /// <para>A null <c>protoVessel</c> is reported rather than worked around. Every
        /// vessel KSP tracks has one, so its absence means the handle this resolved is
        /// not a vessel in the state it looks like being in, and inventing a ProtoVessel
        /// to recover would be fabricating the input the whole run measures.</para>
        /// </summary>
        private static string TriggerRecovery(Vessel origin)
        {
            var proto = origin.protoVessel;
            if (proto == null)
            {
                return "REFUSED at the call: this vessel has no protoVessel, and ShipConstruction.RecoverVesselFromFlight"
                    + " takes one; nothing was triggered";
            }

            var flightState = HighLogic.CurrentGame?.flightState;
            if (flightState == null)
            {
                return "REFUSED at the call: no HighLogic.CurrentGame.flightState to recover out of; nothing was triggered";
            }

            ShipConstruction.RecoverVesselFromFlight(proto, flightState);
            return "called ShipConstruction.RecoverVesselFromFlight; stock fired onVesselRecovered, and whether the"
                + " away path engaged is the correlation counters' answer, not this one";
        }

        /// <summary>
        /// <c>Vessel.Die()</c>, which fires <c>onVesselWillDestroy</c> itself at the very
        /// start of its own teardown, while the vessel is still intact - which is exactly
        /// the moment the interceptor captures its light-time. Its <c>MurderCrew()</c>
        /// then kills every crew member, each firing <c>onCrewKilled</c> and so one
        /// <c>VesselLoss</c> reputation penalty.
        /// </summary>
        private static string TriggerDestruction(Vessel origin)
        {
            var crew = CountCrew(origin);
            origin.Die();
            return "called Vessel.Die(); stock fired onVesselWillDestroy and killed "
                + (crew < 0 ? "an unreadable number of" : crew.ToString(CultureInfo.InvariantCulture))
                + " crew";
        }

        /// <summary>
        /// <c>ProtoCrewMember.Die()</c> on ONE crew member, leaving the vessel alive.
        ///
        /// <para><b>This mode exists to show a gap, not to pass.</b>
        /// <c>Reputation.OnCrewKilled</c> is the only site in the stock assembly that
        /// uses <c>TransactionReasons.VesselLoss</c>, and it fires off
        /// <c>GameEvents.onCrewKilled</c>, whose only producer is
        /// <c>ProtoCrewMember.Die()</c>. So a crew death is the whole cause of that
        /// penalty - and a crew death does NOT require the vessel to die.
        /// <c>Part.Die()</c> kills the crew in its own part while the rest of the stack
        /// flies on, which is what an overheat, a structural failure or a collision that
        /// takes the pod off a surviving craft all do, and life support, G-force and
        /// drowning deaths take the same path.</para>
        ///
        /// <para>In every one of those <c>onVesselWillDestroy</c> never fires, so the
        /// interceptor has nothing to correlate the penalty against, defers it, and
        /// settles it HOME once the attribution window passes. The reputation hit lands
        /// immediately, however far out of contact the kerbal died. This mode reproduces
        /// that against the real path.</para>
        /// </summary>
        private static string TriggerCrewDeath(Vessel origin, string crewName)
        {
            var crew = origin.GetVesselCrew();
            if (crew == null || crew.Count == 0)
            {
                return "REFUSED at the call: this craft has no crew, and a crew death is the only producer of a"
                    + " VesselLoss reputation change; nothing was triggered";
            }

            ProtoCrewMember? victim = null;
            if (crewName.Length == 0)
            {
                victim = crew[0];
            }
            else
            {
                foreach (var member in crew)
                {
                    if (member != null && string.Equals(member.name, crewName, StringComparison.OrdinalIgnoreCase))
                    {
                        victim = member;
                        break;
                    }
                }
            }

            if (victim == null)
            {
                return "REFUSED at the call: no crew member named '" + crewName + "' aboard; nothing was triggered";
            }

            victim.Die();
            return "called ProtoCrewMember.Die() on " + victim.name + ", leaving the vessel alive, so no"
                + " onVesselWillDestroy fires and the interceptor has nothing to attribute the penalty to";
        }

        /// <summary>
        /// Crew aboard, loaded or not, or -1 when it cannot be read.
        /// <c>Vessel.GetVesselCrew()</c> rather than <c>GetCrewCount()</c>: the latter
        /// returns the cached <c>crew</c> list, which is empty on an unloaded vessel, so
        /// a crewed craft out on a mission would have forecast as an empty one.
        /// </summary>
        private static int CountCrew(Vessel vessel)
        {
            try
            {
                var crew = vessel.GetVesselCrew();
                return crew != null ? crew.Count : -1;
            }
            catch (Exception ex)
            {
                Debug.LogWarning(LogPrefix + "could not read the crew of " + vessel.vesselName + ": " + ex.Message);
                return -1;
            }
        }

        private static void Award(Currency currency, double amount, TransactionReasons reason)
        {
            switch (currency)
            {
                case Currency.Funds:
                    if (Funding.Instance == null)
                    {
                        throw new InvalidOperationException("no Funding instance (not a career game?)");
                    }
                    Funding.Instance.AddFunds(amount, reason);
                    break;
                case Currency.Science:
                    if (ResearchAndDevelopment.Instance == null)
                    {
                        throw new InvalidOperationException("no ResearchAndDevelopment instance (not a career/science game?)");
                    }
                    ResearchAndDevelopment.Instance.AddScience((float)amount, reason);
                    break;
                default:
                    if (Reputation.Instance == null)
                    {
                        throw new InvalidOperationException("no Reputation instance (not a career game?)");
                    }
                    Reputation.Instance.AddReputation((float)amount, reason);
                    break;
            }
        }

        /// <summary>
        /// Matches <c>origin</c> against every vessel KSP knows about, by id
        /// first (a GUID is unambiguous) then by name. <c>active</c> names the
        /// active vessel; an empty or <c>ksc</c> value means no origin at all.
        /// Unloaded vessels are included: the interceptor resolves light-time
        /// from a live <c>Vessel</c> object, which an unloaded craft still has.
        /// </summary>
        private static Vessel? ResolveVessel(string? origin)
        {
            var wanted = (origin ?? "").Trim();
            if (wanted.Length == 0 || string.Equals(wanted, "ksc", StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }
            if (string.Equals(wanted, "active", StringComparison.OrdinalIgnoreCase))
            {
                return FlightGlobals.ActiveVessel;
            }

            var vessels = FlightGlobals.Vessels;
            if (vessels == null)
            {
                return null;
            }

            foreach (var v in vessels)
            {
                if (v != null && string.Equals(v.id.ToString(), wanted, StringComparison.OrdinalIgnoreCase))
                {
                    return v;
                }
            }
            foreach (var v in vessels)
            {
                if (v != null && string.Equals(v.vesselName, wanted, StringComparison.OrdinalIgnoreCase))
                {
                    return v;
                }
            }
            return null;
        }

        private static Balances ReadBalances()
        {
            var funding = Funding.Instance;
            var rnd = ResearchAndDevelopment.Instance;
            var reputation = Reputation.Instance;
            var (hasConfidence, confidence, earned, confidenceFault) = ReadRp1Confidence();
            return new Balances(
                funding != null ? funding.Funds : double.NaN, funding != null,
                rnd != null ? rnd.Science : double.NaN, rnd != null,
                reputation != null ? reputation.reputation : double.NaN, reputation != null,
                hasConfidence, confidence, earned, confidenceFault);
        }

        /// <summary>
        /// Reads RP-1's <c>Confidence.CurrentConfidence</c> and
        /// <c>AllConfidenceEarned</c> by reflection. GonogoDevTools references
        /// only KSP/Unity, so RP0.dll cannot be a compile-time dependency, and
        /// on a career without RP-1 the type simply is not there.
        /// </summary>
        private static (bool has, double confidence, double earned, string fault) ReadRp1Confidence()
        {
            try
            {
                var type = ResolveType("RP0.Confidence");
                if (type == null)
                {
                    return (false, double.NaN, double.NaN, "RP0.Confidence is not in any loaded assembly (RP-1 not installed)");
                }

                var confidence = type.GetProperty("CurrentConfidence", BindingFlags.Public | BindingFlags.Static);
                var earned = type.GetProperty("AllConfidenceEarned", BindingFlags.Public | BindingFlags.Static);
                if (confidence == null || earned == null)
                {
                    // RP-1 IS loaded and a property this probe names by string has
                    // moved. That is a broken instrument, not an absent one, and it
                    // must not arrive in the result file as the same "(RP-1 not
                    // loaded)" line an uninstalled RP-1 produces.
                    var missing = confidence == null
                        ? (earned == null ? "CurrentConfidence and AllConfidenceEarned" : "CurrentConfidence")
                        : "AllConfidenceEarned";
                    return (false, double.NaN, double.NaN,
                        "RP0.Confidence is loaded but " + missing + " could not be found on it, so this probe's"
                        + " confidence reads are broken rather than inapplicable");
                }

                return (true,
                    Convert.ToDouble(confidence.GetValue(null, null), CultureInfo.InvariantCulture),
                    Convert.ToDouble(earned.GetValue(null, null), CultureInfo.InvariantCulture),
                    "");
            }
            catch (Exception ex)
            {
                Debug.LogWarning(LogPrefix + "could not read RP-1 confidence: " + ex.Message);
                return (false, double.NaN, double.NaN, "reading RP0.Confidence threw: " + ex.Message);
            }
        }

        /// <summary>
        /// Reads the live <c>CurrencyDelayScenario</c>'s own state by reflection:
        /// the interceptor's subscription flag and shadow science, and the
        /// pending-credit ledger's depth. GonogoDevTools references only
        /// KSP/Unity, so Gonogo.dll cannot be a compile-time dependency, and on a
        /// build without the subsystem the type simply is not there.
        ///
        /// <para>Field names are private implementation detail of the production
        /// assembly, so each miss is reported in <c>Fault</c> rather than
        /// degrading to a zero. A renamed field must read as "could not measure",
        /// never as "measured nothing pending".</para>
        ///
        /// <para><b>One instance is assumed and no longer taken on trust.</b> All the
        /// figures below come off ONE scenario object, so a second live one makes them a
        /// reading of whichever happened to come first, indistinguishable from a subsystem
        /// that did nothing. The count is reported and a count other than 1 is a fault.
        /// <c>Resources.FindObjectsOfTypeAll</c>, not <c>FindObjectOfType</c>, because the
        /// latter returns one arbitrary match and skips an inactive object entirely.
        /// <see cref="GonogoDevKerbalismScience"/> carries the fuller version of this,
        /// including which instance the crediting path actually talks to.</para>
        /// </summary>
        private DelaySubsystem ReadDelaySubsystem(WatchState? watch)
        {
            try
            {
                var scenarioType = ResolveType("Gonogo.KSP.CurrencyDelay.CurrencyDelayScenario");
                if (scenarioType == null)
                {
                    return DelaySubsystem.Absent("CurrencyDelayScenario not in any loaded assembly");
                }

                var all = UnityEngine.Resources.FindObjectsOfTypeAll(scenarioType);
                var instances = all != null ? all.Length : 0;
                var scenario = instances > 0 ? all![0] : null;
                if (scenario == null)
                {
                    return new DelaySubsystem(true, false, 0, false, -1, Shadows.Unreadable, -1, -1, Correlations.Unreadable, null,
                        RouteProbe.NotAttempted("no live CurrencyDelayScenario to read a route for"),
                        "scenario type present but no live instance");
                }

                var instanceFault = instances == 1
                    ? ""
                    : instances + " live CurrencyDelayScenario instances - every figure below is from one of them";

                const BindingFlags Instance = BindingFlags.NonPublic | BindingFlags.Instance;

                var subscribed = false;
                var shadows = Shadows.Unreadable;
                var labVessels = -1;
                var scienceDefers = -1;
                var correlations = Correlations.Unreadable;
                var fault = instanceFault;

                var interceptor = scenarioType.GetField("_interceptor", Instance)?.GetValue(scenario);
                if (interceptor == null)
                {
                    fault = Append(fault, "could not read _interceptor");
                }
                else
                {
                    var interceptorType = interceptor.GetType();
                    var subscribedField = interceptorType.GetField("_subscribed", Instance);
                    if (subscribedField == null)
                    {
                        fault = Append(fault, "could not read _subscribed");
                    }
                    else
                    {
                        subscribed = (bool)subscribedField.GetValue(interceptor);
                    }

                    var state = interceptorType.GetField("_state", Instance)?.GetValue(interceptor);
                    var missingShadows = "";
                    shadows = new Shadows(
                        ReadShadow(state, "ShadowFunds", ref missingShadows),
                        ReadShadow(state, "ShadowScience", ref missingShadows),
                        ReadShadow(state, "ShadowReputation", ref missingShadows));
                    if (missingShadows.Length > 0)
                    {
                        fault = Append(fault, "could not read " + missingShadows);
                    }

                    labVessels = CountPrivateList(state, "_labVessels");
                    scienceDefers = CountPrivateList(state, "_scienceDefers");
                    if (labVessels < 0 || scienceDefers < 0)
                    {
                        fault = Append(fault, "could not read the science correlation lists");
                    }

                    correlations = new Correlations(
                        CountPrivateList(interceptor, "_recoveryVesselsById"),
                        CountPrivateList(interceptor, "_deathLightTimesById"),
                        CountPrivateList(state, "_recoveryVessels"),
                        CountPrivateList(state, "_deathVessels"),
                        CountPrivateList(state, "_reputationDefers"));
                    if (correlations.RecoveryVesselsHeld < 0 || correlations.DeathLightTimesHeld < 0
                        || correlations.RecoveryPushesPending < 0 || correlations.DeathPushesPending < 0
                        || correlations.ReputationDefersPending < 0)
                    {
                        fault = Append(fault, "could not read the funds/reputation correlation state");
                    }
                }

                var route = ReadRouteProbe(watch);

                var pendingRows = -1;
                List<LedgerRowReading>? readings = null;
                var ledger = scenarioType.GetField("_ledger", Instance)?.GetValue(scenario);
                var pending = ledger?.GetType().GetProperty("Pending", BindingFlags.Public | BindingFlags.Instance)?.GetValue(ledger, null);
                if (pending is System.Collections.IEnumerable rows)
                {
                    pendingRows = 0;
                    readings = new List<LedgerRowReading>();

                    // The pre-award snapshot is taken on the FIRST read of a request,
                    // which is the "before" sample: everything already in the ledger at
                    // that moment belongs to some earlier award and must not be
                    // reported as this run's.
                    var capturing = watch != null && !watch.PreAwardRowsCaptured;

                    foreach (var row in rows)
                    {
                        if (capturing)
                        {
                            watch!.PreAwardRows.Add(row);
                        }

                        readings.Add(DescribePendingRow(
                            row, pendingRows, IsNewRow(watch, row), CurrentUt(), watch?.AwardUt ?? 0.0, route.Config));
                        pendingRows++;
                    }

                    if (capturing)
                    {
                        watch!.PreAwardRowsCaptured = true;
                    }
                }
                else
                {
                    fault = Append(fault, "could not read the pending ledger");
                }

                if (route.Fault.Length > 0)
                {
                    fault = Append(fault, "route probe: " + route.Fault);
                }

                return new DelaySubsystem(true, true, instances, subscribed, pendingRows, shadows, labVessels, scienceDefers, correlations, readings, route, fault);
            }
            catch (Exception ex)
            {
                return DelaySubsystem.Absent("probe threw: " + ex.Message);
            }
        }

        /// <summary>
        /// Whether a ledger row was created by THIS run's award, by reference against
        /// the pre-award snapshot. Before the snapshot exists (the "before" sample
        /// itself), nothing is new, which is the honest answer at that moment.
        /// </summary>
        private static bool IsNewRow(WatchState? watch, object row)
        {
            if (watch == null || !watch.PreAwardRowsCaptured)
            {
                return false;
            }

            foreach (var known in watch.PreAwardRows)
            {
                if (ReferenceEquals(known, row))
                {
                    return false;
                }
            }
            return true;
        }

        /// <summary>
        /// One public shadow-balance property off the state machine, NaN when it cannot
        /// be read, appending the property's name to <paramref name="missing"/> so the
        /// fault says which of the three went unread rather than that one did.
        /// </summary>
        private static double ReadShadow(object? state, string propertyName, ref string missing)
        {
            var property = state?.GetType().GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance);
            if (property == null)
            {
                missing = missing.Length == 0 ? propertyName : missing + ", " + propertyName;
                return double.NaN;
            }

            try
            {
                return Convert.ToDouble(property.GetValue(state, null), CultureInfo.InvariantCulture);
            }
            catch (Exception ex)
            {
                missing = (missing.Length == 0 ? propertyName : missing + ", " + propertyName) + " (" + ex.Message + ")";
                return double.NaN;
            }
        }

        /// <summary>Element count of a private List or Dictionary field, or -1 when it
        /// cannot be read.</summary>
        private static int CountPrivateList(object? owner, string fieldName)
        {
            if (owner == null)
            {
                return -1;
            }

            var value = owner.GetType().GetField(fieldName, BindingFlags.NonPublic | BindingFlags.Instance)?.GetValue(owner);
            if (!(value is System.Collections.ICollection collection))
            {
                return -1;
            }
            return collection.Count;
        }

        private static LedgerRowReading DescribePendingRow(
            object row, int index, bool isNew, double nowUt, double awardUt, DelayConfigReadout config)
        {
            try
            {
                var type = row.GetType();
                var currency = type.GetProperty("Currency")?.GetValue(row, null);
                var amount = Convert.ToDouble(type.GetProperty("BaseAmount")?.GetValue(row, null) ?? 0.0, CultureInfo.InvariantCulture);
                var revealUt = Convert.ToDouble(type.GetProperty("RevealUt")?.GetValue(row, null) ?? 0.0, CultureInfo.InvariantCulture);
                var origin = type.GetProperty("OriginVesselId")?.GetValue(row, null);

                // A row this run made is measured against the AWARD, which is the event
                // it was created from. An older row has no such anchor here, so it is
                // classified against nothing and only its distance from NOW is
                // reported: pretending this run's award UT explains somebody else's row
                // is exactly the misreading that made the old firstPending useless.
                var classification = isNew && awardUt > 0.0 && config.Readable
                    ? CurrencyProbeVerdicts.ClassifyRevealOffset(revealUt, awardUt, config.SilenceSeconds)
                    : "(not this run's row, or no config to classify against)";

                return new LedgerRowReading(
                    index, isNew,
                    currency != null ? currency.ToString() : "(unreadable)",
                    amount, revealUt, revealUt - nowUt, classification,
                    origin != null ? origin.ToString() : "");
            }
            catch (Exception ex)
            {
                return new LedgerRowReading(index, isNew, "(unreadable)", 0.0, 0.0, 0.0, "unreadable row: " + ex.Message, "");
            }
        }

        private static string Append(string existing, string addition) =>
            existing.Length == 0 ? addition : existing + "; " + addition;

        /// <summary>Speed of light in vacuum, m/s. The same constant
        /// <c>Sitrep.Host.Comms.SignalDelay</c> divides by; written down here because
        /// GonogoDevTools cannot reference that assembly, and a straight-line scale
        /// check computed against a different c would be worse than none.</summary>
        private const double SpeedOfLightMetersPerSecond = 299792458.0;

        /// <summary>
        /// The ROUTE node: what the currency arm's route read saw, what it concluded,
        /// and where the two came apart.
        ///
        /// <para><b>Two readings, taken independently.</b> The RAW half walks
        /// <c>vessel.connection.ControlPath</c> here, in this assembly, using nothing
        /// of the production code; the PRODUCTION half invokes
        /// <c>KscLightTime.ForVessel</c> and <c>KscDelayPolicy.DelaySeconds</c> by
        /// reflection and reports their answers verbatim. Asking only the code under
        /// test what it thinks would produce a probe that agrees with itself in a
        /// broken world as readily as a working one.</para>
        ///
        /// <para><b>What each outcome means.</b> hops &gt; 0, a home hop, a sane total
        /// distance and a Routed production answer whose seconds match
        /// totalPathMeters / (c * scale) is a working subsystem. hops = 0 with the
        /// production answer Unroutable is a craft genuinely out of contact and a
        /// CORRECT refusal, not a defect. hops &gt; 0 with an Unroutable production
        /// answer is the route read broken. A Routed answer whose seconds do not
        /// follow from the distance is the arithmetic broken.</para>
        /// </summary>
        private RouteProbe ReadRouteProbe(WatchState? watch)
        {
            var probe = new RouteProbe { Attempted = true };

            try
            {
                probe.Config = ReadDelayConfig(out var configObject);
                probe.OverrideMode = ReadForceCommsMode(out var overrideMode);

                probe.VesselId = watch?.ProbeVesselId ?? "";
                probe.VesselName = watch?.ProbeVesselName ?? "";

                var vessel = FindVesselById(probe.VesselId);
                probe.VesselFound = vessel != null;
                if (vessel == null)
                {
                    probe.FailedTest = probe.VesselId.Length == 0
                        ? "no origin vessel was resolved for this request, so there is nothing to route"
                        : "the origin vessel is no longer in FlightGlobals (destroyed or unloaded away)";
                    probe.OverrideReach = CurrencyProbeVerdicts.JudgeOverrideReach(overrideMode, false, false);
                    return probe;
                }

                probe.Loaded = vessel.loaded;

                var connection = vessel.connection;
                probe.ConnectionPresent = connection != null;
                if (connection == null)
                {
                    probe.FailedTest = "vessel.connection is null: the craft has no CommNetVessel at all";
                }
                else
                {
                    probe.RawConnected = connection.IsConnected;

                    var path = connection.ControlPath;
                    probe.ControlPathPresent = path != null;
                    if (path == null)
                    {
                        probe.FailedTest = "vessel.connection.ControlPath is NULL: CommNet holds no solved path for this craft";
                    }
                    else
                    {
                        var hops = 0;
                        var homeHops = 0;
                        var total = 0.0;
                        var lastWasHome = false;
                        foreach (var link in path)
                        {
                            if (link == null || link.a == null || link.b == null)
                            {
                                continue;
                            }
                            hops++;
                            total += (link.a.precisePosition - link.b.precisePosition).magnitude;
                            lastWasHome = link.a.isHome || link.b.isHome;
                            if (lastWasHome)
                            {
                                homeHops++;
                            }
                        }

                        probe.HopCount = hops;
                        probe.HomeHopCount = homeHops;
                        probe.TotalPathMeters = total;
                        probe.LastHopIsHome = hops == 0 ? "(no hops to ask about)" : (lastWasHome ? "True" : "False");

                        if (hops == 0)
                        {
                            probe.FailedTest = "vessel.connection.ControlPath is EMPTY: CommNet solved no route home for this craft";
                        }
                        else if (homeHops == 0)
                        {
                            probe.FailedTest = "the control path has hops but none of them touches a home node";
                        }
                    }
                }

                ReadSceneHomeNodes(vessel, probe);

                if (probe.Config.Readable && probe.Config.LightSpeedScale > 0.0 && !double.IsNaN(probe.NearestHomeMeters))
                {
                    probe.StraightLineSeconds = probe.NearestHomeMeters
                        / (SpeedOfLightMetersPerSecond * probe.Config.LightSpeedScale);
                }

                ReadProductionRouteAnswer(vessel, configObject, probe);

                if (!probe.Config.Readable)
                {
                    probe.FailedTest = Append(probe.FailedTest, "the signal-delay config could not be read: " + probe.Config.Fault);
                }
                else if (!probe.Config.Enabled)
                {
                    probe.FailedTest = Append(probe.FailedTest, probe.Config.CutForSimulation
                        ? "signal delay is CUT FOR A SIMULATION, so every credit reveals instantly by policy"
                        : "signal delay is switched OFF, so every credit reveals instantly by policy");
                }

                probe.OverrideReach = CurrencyProbeVerdicts.JudgeOverrideReach(
                    overrideMode, probe.RawConnected, probe.FoundAPath);
            }
            catch (Exception ex)
            {
                probe.Fault = Append(probe.Fault, "threw: " + ex.Message);
            }

            return probe;
        }

        /// <summary>
        /// How many home nodes the scene holds and how far the nearest is, straight
        /// line. Zero home nodes is a different failure from a craft that cannot reach
        /// one, and the distance is the SCALE CHECK a routed light-time is sanity-read
        /// against. Reads <c>CommNetHome</c>'s protected <c>comm</c> field the same
        /// way the production command-centre source does.
        /// </summary>
        private static void ReadSceneHomeNodes(Vessel vessel, RouteProbe probe)
        {
            try
            {
                var commField = typeof(CommNetHome).GetField("comm", BindingFlags.NonPublic | BindingFlags.Instance);
                if (commField == null)
                {
                    probe.Fault = Append(probe.Fault, "CommNetHome.comm is no longer readable, so no home-node count");
                    return;
                }

                var homes = UnityEngine.Object.FindObjectsOfType<CommNetHome>();
                if (homes == null)
                {
                    return;
                }

                var count = 0;
                var nearest = double.MaxValue;
                var from = vessel.GetWorldPos3D();
                foreach (var home in homes)
                {
                    if (home == null)
                    {
                        continue;
                    }
                    if (!(commField.GetValue(home) is CommNode comm))
                    {
                        continue;
                    }
                    count++;
                    var distance = (from - comm.precisePosition).magnitude;
                    if (distance < nearest)
                    {
                        nearest = distance;
                    }
                }

                probe.HomeNodesInScene = count;
                probe.NearestHomeMeters = count > 0 ? nearest : double.NaN;
            }
            catch (Exception ex)
            {
                probe.Fault = Append(probe.Fault, "home-node scan threw: " + ex.Message);
            }
        }

        /// <summary>
        /// What the PRODUCTION route read concluded: <c>KscLightTime.ForVessel</c>'s
        /// <c>KscDelay</c> and the seconds <c>KscDelayPolicy</c> would add for it.
        ///
        /// <para><c>KscDelay.Seconds</c> THROWS for an unroutable delay by design, so
        /// <c>IsUnroutable</c> is asked first and the seconds are reported as an
        /// explicit absence rather than a zero - which is the whole reason that type
        /// exists.</para>
        /// </summary>
        private static void ReadProductionRouteAnswer(Vessel vessel, object? configObject, RouteProbe probe)
        {
            try
            {
                var lightTimeType = ResolveType("Gonogo.KSP.CurrencyDelay.KscLightTime");
                var forVessel = lightTimeType?.GetMethod("ForVessel", BindingFlags.Public | BindingFlags.Static);
                if (forVessel == null)
                {
                    probe.ProductionKind = "(unreadable)";
                    probe.ProductionSeconds = "(unreadable)";
                    probe.PolicySeconds = "(unreadable)";
                    probe.Fault = Append(probe.Fault, "KscLightTime.ForVessel not found, so the production answer is unknown");
                    return;
                }

                var delay = forVessel.Invoke(null, new[] { (object)vessel, configObject! });
                var delayType = delay.GetType();

                var kind = delayType.GetProperty("Kind", BindingFlags.Public | BindingFlags.Instance)?.GetValue(delay, null);
                probe.ProductionKind = kind != null ? kind.ToString() : "(unreadable)";

                var unroutable = delayType.GetProperty("IsUnroutable", BindingFlags.Public | BindingFlags.Instance)?.GetValue(delay, null) as bool?;
                if (unroutable == true)
                {
                    probe.ProductionSeconds = "(none: KscDelay.Unroutable carries no light-time)";
                    probe.FoundAPath = false;
                }
                else
                {
                    var seconds = delayType.GetProperty("Seconds", BindingFlags.Public | BindingFlags.Instance)?.GetValue(delay, null);
                    probe.ProductionSeconds = seconds != null
                        ? Convert.ToDouble(seconds, CultureInfo.InvariantCulture).ToString("F3", CultureInfo.InvariantCulture)
                        : "(unreadable)";
                    probe.FoundAPath = probe.ProductionKind == "Routed";
                }

                var policyType = ResolveType("Gonogo.KSP.CurrencyDelay.KscDelayPolicy");
                var delaySeconds = policyType?.GetMethod("DelaySeconds", BindingFlags.NonPublic | BindingFlags.Static);
                if (delaySeconds == null)
                {
                    probe.PolicySeconds = "(unreadable)";
                    probe.Fault = Append(probe.Fault, "KscDelayPolicy.DelaySeconds not found, so the applied seconds are unknown");
                    return;
                }

                var applied = delaySeconds.Invoke(null, new[] { delay, configObject! });
                probe.PolicySeconds = Convert.ToDouble(applied, CultureInfo.InvariantCulture).ToString("F3", CultureInfo.InvariantCulture);
            }
            catch (Exception ex)
            {
                probe.ProductionKind = "(threw)";
                probe.ProductionSeconds = "(threw)";
                probe.PolicySeconds = "(threw)";
                probe.Fault = Append(probe.Fault, "the production route read threw: " + Innermost(ex).Message);
            }
        }

        /// <summary>The exception a reflected call actually raised, not the
        /// TargetInvocationException wrapping it, which names nothing.</summary>
        private static Exception Innermost(Exception ex)
        {
            var current = ex;
            while (current.InnerException != null)
            {
                current = current.InnerException;
            }
            return current;
        }

        /// <summary>
        /// The signal-delay config the currency arm actually consults, which is
        /// <c>CommsCoreUplink.SignalDelayConfig</c> (EFFECTIVE, after a simulation may
        /// have cut it), plus the authored flag beside it so a cut is visible.
        /// </summary>
        private static DelayConfigReadout ReadDelayConfig(out object? configObject)
        {
            configObject = null;
            try
            {
                var uplinkType = ResolveType("Gonogo.KSP.CommsCoreUplink");
                if (uplinkType == null)
                {
                    return DelayConfigReadout.Unreadable("Gonogo.KSP.CommsCoreUplink not in any loaded assembly");
                }

                const BindingFlags Static = BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Static;
                var effective = uplinkType.GetProperty("SignalDelayConfig", Static)?.GetValue(null, null);
                if (effective == null)
                {
                    return DelayConfigReadout.Unreadable("CommsCoreUplink.SignalDelayConfig could not be read");
                }
                configObject = effective;

                var type = effective.GetType();
                const BindingFlags Public = BindingFlags.Public | BindingFlags.Instance;
                var enabled = (bool)(type.GetProperty("Enabled", Public)?.GetValue(effective, null) ?? false);
                var scale = Convert.ToDouble(type.GetProperty("LightSpeedScale", Public)?.GetValue(effective, null) ?? 0.0, CultureInfo.InvariantCulture);
                var silence = Convert.ToDouble(type.GetProperty("SilenceDeclarationSeconds", Public)?.GetValue(effective, null) ?? 0.0, CultureInfo.InvariantCulture);
                var cut = (bool)(type.GetProperty("CutForSimulation", Public)?.GetValue(effective, null) ?? false);

                var authored = uplinkType.GetProperty("AuthoredSignalDelayConfig", Static)?.GetValue(null, null);
                var authoredEnabled = authored != null
                    && (bool)(authored.GetType().GetProperty("Enabled", Public)?.GetValue(authored, null) ?? false);

                return new DelayConfigReadout(true, enabled, scale, silence, cut, authoredEnabled, "");
            }
            catch (Exception ex)
            {
                return DelayConfigReadout.Unreadable("threw: " + Innermost(ex).Message);
            }
        }

        /// <summary>
        /// The force-comms mode currently on disk, reported so a run says what fixture
        /// it was taken under. This is a THIRD independent read of that file (the
        /// GonogoDevForceComms acknowledger and Gonogo.KSP's DevCommsOverride are the
        /// other two); nothing is handed over between them.
        /// </summary>
        private string ReadForceCommsMode(out bool? mode)
        {
            mode = null;
            try
            {
                if (string.IsNullOrEmpty(_forceCommsRequestPath) || !File.Exists(_forceCommsRequestPath))
                {
                    return "(no force-comms request file: the real backend is in force)";
                }

                var raw = ConfigNode.Load(_forceCommsRequestPath)?.GetNode("FORCECOMMS")?.GetValue("mode")?.Trim().ToLowerInvariant();
                switch (raw)
                {
                    case "blackout":
                        mode = false;
                        return "blackout (forcing DISCONNECTED)";
                    case "restore":
                        mode = true;
                        return "restore (forcing CONNECTED)";
                    case "auto":
                    case null:
                    case "":
                        return "auto (no override; the real backend is in force)";
                    default:
                        return "unrecognised mode '" + raw + "' (DevCommsOverride treats this as auto)";
                }
            }
            catch (Exception ex)
            {
                return "(unreadable: " + ex.Message + ")";
            }
        }

        private static Vessel? FindVesselById(string vesselId)
        {
            if (string.IsNullOrEmpty(vesselId))
            {
                return null;
            }

            var vessels = FlightGlobals.Vessels;
            if (vessels == null)
            {
                return null;
            }

            foreach (var vessel in vessels)
            {
                if (vessel != null && string.Equals(vessel.id.ToString(), vesselId, StringComparison.OrdinalIgnoreCase))
                {
                    return vessel;
                }
            }
            return null;
        }

        private static Type? ResolveType(string fullName)
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                Type? found;
                try
                {
                    found = asm.GetType(fullName, throwOnError: false);
                }
                catch (Exception)
                {
                    // A reflection-only or partially-loaded assembly is not
                    // grounds for giving up on the rest of the list.
                    continue;
                }
                if (found != null)
                {
                    return found;
                }
            }
            return null;
        }

        private static double CurrentUt()
        {
            try
            {
                return Planetarium.GetUniversalTime();
            }
            catch (Exception)
            {
                return 0.0;
            }
        }

        private static bool TryParseCurrency(string? raw, out Currency currency)
        {
            currency = Currency.Funds;
            var wanted = (raw ?? "").Trim();
            if (wanted.Length == 0)
            {
                return false;
            }
            return Enum.TryParse(wanted, ignoreCase: true, result: out currency);
        }

        private static bool TryParseReason(string? raw, out TransactionReasons reason)
        {
            reason = TransactionReasons.None;
            var wanted = (raw ?? "").Trim();
            if (wanted.Length == 0)
            {
                return false;
            }
            return Enum.TryParse(wanted, ignoreCase: true, result: out reason);
        }

        private static string Describe(string? raw) =>
            string.IsNullOrEmpty(raw) ? "(absent)" : "'" + raw + "'";

        private static double RoundSeconds(double seconds) => Math.Round(seconds, 1);

        private static bool TryGetDouble(ConfigNode node, string key, out double value)
        {
            value = 0.0;
            var raw = node.GetValue(key);
            return !string.IsNullOrEmpty(raw)
                && double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out value);
        }

        private void WriteResult(WatchState watch)
        {
            if (string.IsNullOrEmpty(_resultPath))
            {
                return;
            }

            try
            {
                var dir = Path.GetDirectoryName(_resultPath);
                if (!string.IsNullOrEmpty(dir))
                {
                    Directory.CreateDirectory(dir!);
                }

                var sb = new StringBuilder();
                sb.AppendLine("RESULT");
                sb.AppendLine("{");
                sb.AppendLine("\tapplied = " + watch.Id);
                sb.AppendLine("\tok = " + (watch.Ok ? "True" : "False"));
                sb.AppendLine("\tmessage = " + watch.Summary);
                sb.AppendLine("\ttime = " + DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture));
                sb.AppendLine("\tawardUt = " + watch.AwardUt.ToString("F3", CultureInfo.InvariantCulture));
                sb.AppendLine("\tprobeVessel = " + (watch.ProbeVesselId.Length > 0
                    ? watch.ProbeVesselName + " [" + watch.ProbeVesselId + "]"
                    : "(none resolved)"));
                sb.AppendLine("\tmode = " + watch.Mode);
                AppendTrigger(sb, watch);

                // The FIRST sample is the pre-award baseline every movement verdict is
                // measured against. It exists whenever a request got as far as awarding
                // or triggering anything; a refused request has no samples at all, and
                // then there is nothing to measure a movement from and the verdicts say
                // so rather than measuring against a fabricated zero.
                var baseline = watch.Samples.Count > 0 ? watch.Samples[0].Balances : (Balances?)null;
                foreach (var sample in watch.Samples)
                {
                    AppendSample(sb, sample, baseline);
                }
                sb.AppendLine("}");
                File.WriteAllText(_resultPath, sb.ToString());
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "failed writing result: " + ex.Message);
            }
        }

        /// <summary>
        /// The TRIGGER node, present only in a trigger mode. The forecast is written
        /// down first and separately from the outcome, because "the run produced no
        /// reputation change" and "this craft had no crew, so there was never a
        /// reputation change to produce" are opposite readings that used to arrive as
        /// the same empty result.
        /// </summary>
        private static void AppendTrigger(StringBuilder sb, WatchState watch)
        {
            if (watch.TriggerForecast.Length == 0 && watch.TriggerOutcome.Length == 0)
            {
                return;
            }

            sb.AppendLine("\tTRIGGER");
            sb.AppendLine("\t{");
            sb.AppendLine("\t\tmode = " + watch.Mode);
            sb.AppendLine("\t\tawardedByThisTool = False (the game credits, under its own reason and its own base amounts)");
            sb.AppendLine("\t\toriginCrew = " + Countable(watch.OriginCrewCount));
            if (watch.CrewName.Length > 0)
            {
                sb.AppendLine("\t\tcrewNamed = " + watch.CrewName);
            }
            sb.AppendLine("\t\tforecast = " + watch.TriggerForecast);
            sb.AppendLine("\t\toutcome = " + (watch.TriggerOutcome.Length > 0
                ? watch.TriggerOutcome
                : "(the trigger did not run: the request was refused before it, see message)"));
            sb.AppendLine("\t}");
        }

        private static void AppendSample(StringBuilder sb, Sample sample, Balances? baseline)
        {
            var b = sample.Balances;
            sb.AppendLine("\tSAMPLE");
            sb.AppendLine("\t{");
            sb.AppendLine("\t\tat = " + sample.Label);
            sb.AppendLine("\t\tsinceAwardSeconds = " + sample.SinceAwardSeconds.ToString("F1", CultureInfo.InvariantCulture));
            sb.AppendLine("\t\tut = " + sample.Ut.ToString("F3", CultureInfo.InvariantCulture));

            foreach (var kind in AllCurrencies)
            {
                var name = kind.ToString().ToLowerInvariant();
                sb.AppendLine("\t\t" + name + " = " + Balance(b, kind));
                sb.AppendLine("\t\t" + name + "Movement = " + MovementVerdict(b, baseline, kind, sample.Delay));
            }

            if (b.HasConfidence)
            {
                sb.AppendLine("\t\tconfidence = " + b.Confidence.ToString("F3", CultureInfo.InvariantCulture));
                sb.AppendLine("\t\tconfidenceEarned = " + b.ConfidenceEarned.ToString("F3", CultureInfo.InvariantCulture));
            }
            else
            {
                sb.AppendLine("\t\tconfidence = (unreadable: " + b.ConfidenceFault + ")");
            }
            AppendLeaks(sb, b, baseline, sample.Delay);

            AppendDelaySubsystem(sb, sample.Delay);
            sb.AppendLine("\t}");
        }

        /// <summary>One balance, or why it could not be read. Never a zero standing in
        /// for an absent ScenarioModule.</summary>
        private static string Balance(Balances b, CurrencyKindRead kind) =>
            b.Has(kind)
                ? b.Of(kind).ToString("F3", CultureInfo.InvariantCulture)
                : "(unreadable: " + Balances.FaultFor(kind) + ")";

        /// <summary>
        /// Tolerance for calling a balance moved. Reputation is curve-normalised and
        /// funds are doubles that stock rounds at several points, so an exact compare
        /// would report a movement on a balance nothing touched.
        /// </summary>
        private const double MovementTolerance = 0.0005;

        private static string MovementVerdict(Balances now, Balances? baseline, CurrencyKindRead kind, DelaySubsystem delay)
        {
            if (!baseline.HasValue)
            {
                return "(indeterminate: no pre-award baseline was taken, so there is nothing to measure against)";
            }

            var readable = now.Has(kind) && baseline.Value.Has(kind);
            var fault = now.Has(kind)
                ? "the pre-award baseline could not read it: " + Balances.FaultFor(kind)
                : Balances.FaultFor(kind);

            return CurrencyProbeVerdicts.JudgeCurrencyMovement(
                readable,
                fault,
                readable ? now.Of(kind) - baseline.Value.Of(kind) : 0.0,
                delay.NewRowsFor(kind.ToString()),
                MovementTolerance);
        }

        /// <summary>
        /// The LEAK lines: whether a quantity DERIVED from a delayed currency moved while
        /// that currency was being withheld.
        ///
        /// <para>Measured on 2026-08-27 with 25 science withheld: RP-1's confidence went
        /// 700 to 800 and confidenceEarned 200 to 300, both at earn time. So an operator
        /// watching confidence learns the science arrived before the science does, and in
        /// RP-1 confidence gates real career decisions. That is the delay leaking through
        /// a channel the subsystem never modelled, and it is the shape of thing the
        /// validation matrix exists to catch.</para>
        ///
        /// <para>RP-1 confidence is the only such quantity this probe can reach today. It
        /// is reported as a co-occurrence rather than a cause: that RP-1 credits
        /// confidence off a science award is a belief about RP0.dll, not something read
        /// here.</para>
        /// </summary>
        private static void AppendLeaks(StringBuilder sb, Balances now, Balances? baseline, DelaySubsystem delay)
        {
            var withheld = WithheldCurrencies(now, baseline, delay);
            sb.AppendLine("\t\twithheldAtThisSample = " + (withheld.Length > 0 ? withheld : "(none)"));

            if (!baseline.HasValue)
            {
                sb.AppendLine("\t\tconfidenceLeak = (indeterminate: no pre-award baseline was taken)");
                return;
            }

            sb.AppendLine("\t\tconfidenceLeak = " + CurrencyProbeVerdicts.JudgeDerivedLeak(
                "confidence", now.HasConfidence && baseline.Value.HasConfidence, now.ConfidenceFault,
                baseline.Value.Confidence, now.Confidence, withheld, MovementTolerance));
            sb.AppendLine("\t\tconfidenceEarnedLeak = " + CurrencyProbeVerdicts.JudgeDerivedLeak(
                "confidenceEarned", now.HasConfidence && baseline.Value.HasConfidence, now.ConfidenceFault,
                baseline.Value.ConfidenceEarned, now.ConfidenceEarned, withheld, MovementTolerance));
        }

        /// <summary>
        /// Which currencies are withheld at this sample: this run put a row in the
        /// ledger for them and the balance has not moved. An unreadable balance is left
        /// OUT rather than assumed either way, because a leak verdict that named a
        /// currency it could not measure would be asserting the thing it is meant to
        /// test.
        /// </summary>
        private static string WithheldCurrencies(Balances now, Balances? baseline, DelaySubsystem delay)
        {
            if (!baseline.HasValue)
            {
                return "";
            }

            var withheld = "";
            foreach (var kind in AllCurrencies)
            {
                if (!now.Has(kind) || !baseline.Value.Has(kind))
                {
                    continue;
                }
                if (delay.NewRowsFor(kind.ToString()) <= 0)
                {
                    continue;
                }
                if (Math.Abs(now.Of(kind) - baseline.Value.Of(kind)) > MovementTolerance)
                {
                    continue;
                }
                withheld = withheld.Length == 0 ? kind.ToString() : withheld + " and " + kind;
            }
            return withheld;
        }

        /// <summary>A negative count means the read failed, which must never render as a measured zero.</summary>
        private static string Countable(int count) =>
            count < 0 ? "(unreadable)" : count.ToString(CultureInfo.InvariantCulture);

        /// <summary>A NaN shadow means the property behind it could not be reached, and a
        /// shadow reported as 0.000 would read as a subsystem holding a zero balance.</summary>
        private static string Shadow(double value) =>
            double.IsNaN(value) ? "(unreadable)" : value.ToString("F3", CultureInfo.InvariantCulture);

        private static void AppendDelaySubsystem(StringBuilder sb, DelaySubsystem delay)
        {
            sb.AppendLine("\t\tDELAY");
            sb.AppendLine("\t\t{");
            sb.AppendLine("\t\t\tsubsystemPresent = " + (delay.Present ? "True" : "False"));
            sb.AppendLine("\t\t\tscenarioLive = " + (delay.ScenarioLive ? "True" : "False"));
            sb.AppendLine("\t\t\tscenarioInstances = " + delay.ScenarioInstances.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("\t\t\tinterceptorSubscribed = " + (delay.Subscribed ? "True" : "False"));
            // -1 means the ledger could not be read; a plain 0 would read as
            // "measured, nothing pending", which is the opposite conclusion.
            sb.AppendLine("\t\t\tpendingRows = " + Countable(delay.PendingRows));
            // The rows THIS run's award made, told from the rest by reference against
            // a pre-award snapshot. The ledger persists, so without this a run reports
            // somebody else's award and reads as a failure that never happened.
            sb.AppendLine("\t\t\tnewRowsThisRun = " + delay.NewRows.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("\t\t\tshadowFunds = " + Shadow(delay.Shadows.Funds));
            sb.AppendLine("\t\t\tshadowScience = " + Shadow(delay.Shadows.Science));
            sb.AppendLine("\t\t\tshadowReputation = " + Shadow(delay.Shadows.Reputation));
            sb.AppendLine("\t\t\tlabVesselsPending = " + Countable(delay.LabVessels));
            sb.AppendLine("\t\t\tscienceDefersPending = " + Countable(delay.ScienceDefers));
            // The recovery/death half of the correlation, which had no readout at all
            // and is the only thing that tells a push that never arrived from one that
            // arrived after stock had already credited the change. Stock's Funding,
            // ResearchAndDevelopment and Reputation modules all credit recovery currency
            // from the same onVesselRecoveryProcessing the interceptor pushes from, so
            // dispatch order decides whether the away path engages, and both outcomes
            // look like an instant reveal from the balances alone.
            sb.AppendLine("\t\t\trecoveryVesselsHeld = " + Countable(delay.Correlations.RecoveryVesselsHeld));
            sb.AppendLine("\t\t\tdeathLightTimesHeld = " + Countable(delay.Correlations.DeathLightTimesHeld));
            sb.AppendLine("\t\t\trecoveryPushesPending = " + Countable(delay.Correlations.RecoveryPushesPending));
            sb.AppendLine("\t\t\tdeathPushesPending = " + Countable(delay.Correlations.DeathPushesPending));
            sb.AppendLine("\t\t\treputationDefersPending = " + Countable(delay.Correlations.ReputationDefersPending));
            AppendRoute(sb, delay.Route);
            foreach (var row in delay.Rows)
            {
                AppendRow(sb, row);
            }
            if (delay.Fault.Length > 0)
            {
                sb.AppendLine("\t\t\tfault = " + delay.Fault);
            }
            sb.AppendLine("\t\t}");
        }

        private static void AppendRow(StringBuilder sb, LedgerRowReading row)
        {
            sb.AppendLine("\t\t\tROW");
            sb.AppendLine("\t\t\t{");
            sb.AppendLine("\t\t\t\tindex = " + row.Index.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("\t\t\t\tmadeByThisRun = " + (row.IsNew ? "True" : "False"));
            sb.AppendLine("\t\t\t\tcurrency = " + row.Currency);
            sb.AppendLine("\t\t\t\tbaseAmount = " + row.BaseAmount.ToString("F3", CultureInfo.InvariantCulture));
            sb.AppendLine("\t\t\t\trevealUt = " + row.RevealUt.ToString("F3", CultureInfo.InvariantCulture));
            sb.AppendLine("\t\t\t\trevealInSeconds = " + row.RevealInSeconds.ToString("F3", CultureInfo.InvariantCulture));
            sb.AppendLine("\t\t\t\tclassificationDERIVED = " + row.Classification);
            sb.AppendLine("\t\t\t\torigin = " + row.Origin);
            sb.AppendLine("\t\t\t}");
        }

        private static void AppendRoute(StringBuilder sb, RouteProbe route)
        {
            sb.AppendLine("\t\t\tROUTE");
            sb.AppendLine("\t\t\t{");
            if (!route.Attempted)
            {
                sb.AppendLine("\t\t\t\tnotAttempted = " + route.Fault);
                sb.AppendLine("\t\t\t}");
                return;
            }

            var config = route.Config;
            sb.AppendLine("\t\t\t\tconfigReadable = " + (config.Readable ? "True" : "False"));
            sb.AppendLine("\t\t\t\tdelayEnabledEFFECTIVE = " + (config.Readable ? (config.Enabled ? "True" : "False") : "(unreadable)"));
            sb.AppendLine("\t\t\t\tdelayEnabledAUTHORED = " + (config.Readable ? (config.AuthoredEnabled ? "True" : "False") : "(unreadable)"));
            sb.AppendLine("\t\t\t\tcutForSimulation = " + (config.Readable ? (config.CutForSimulation ? "True" : "False") : "(unreadable)"));
            sb.AppendLine("\t\t\t\tlightSpeedScale = " + Measured(config.Readable ? config.LightSpeedScale : double.NaN));
            sb.AppendLine("\t\t\t\tsilenceDeclarationSeconds = " + Measured(config.Readable ? config.SilenceSeconds : double.NaN));
            if (config.Fault.Length > 0)
            {
                sb.AppendLine("\t\t\t\tconfigFault = " + config.Fault);
            }

            sb.AppendLine("\t\t\t\tvesselFound = " + (route.VesselFound ? "True" : "False"));
            sb.AppendLine("\t\t\t\tvesselLoaded = " + (route.Loaded ? "True" : "False"));
            sb.AppendLine("\t\t\t\tconnectionPresent = " + (route.ConnectionPresent ? "True" : "False"));
            sb.AppendLine("\t\t\t\trawCommNetConnected = " + (route.RawConnected ? "True" : "False"));
            sb.AppendLine("\t\t\t\tcontrolPathPresent = " + (route.ControlPathPresent ? "True" : "False"));
            sb.AppendLine("\t\t\t\tcontrolPathHops = " + Countable(route.HopCount));
            sb.AppendLine("\t\t\t\thopsTouchingHome = " + Countable(route.HomeHopCount));
            sb.AppendLine("\t\t\t\tlastHopIsHome = " + (route.LastHopIsHome.Length > 0 ? route.LastHopIsHome : "(unread)"));
            sb.AppendLine("\t\t\t\ttotalPathMeters = " + Measured(route.TotalPathMeters));
            sb.AppendLine("\t\t\t\thomeNodesInScene = " + Countable(route.HomeNodesInScene));
            sb.AppendLine("\t\t\t\tnearestHomeMeters = " + Measured(route.NearestHomeMeters));
            // NOT the subsystem's arithmetic - the straight-line arm was deleted on
            // purpose. Here only so a routed answer can be read against the right
            // order of magnitude.
            sb.AppendLine("\t\t\t\tstraightLineSecondsSCALECHECKONLY = " + Measured(route.StraightLineSeconds));
            sb.AppendLine("\t\t\t\tproductionDelayKind = " + (route.ProductionKind.Length > 0 ? route.ProductionKind : "(unread)"));
            sb.AppendLine("\t\t\t\tproductionDelaySeconds = " + (route.ProductionSeconds.Length > 0 ? route.ProductionSeconds : "(unread)"));
            sb.AppendLine("\t\t\t\tsecondsThePolicyWouldAdd = " + (route.PolicySeconds.Length > 0 ? route.PolicySeconds : "(unread)"));
            sb.AppendLine("\t\t\t\tfailedTest = " + (route.FailedTest.Length > 0 ? route.FailedTest : "(none: a route was found)"));
            sb.AppendLine("\t\t\t\tforceCommsMode = " + route.OverrideMode);
            sb.AppendLine("\t\t\t\toverrideReachesCurrencyArm = " + route.OverrideReach);
            if (route.Fault.Length > 0)
            {
                sb.AppendLine("\t\t\t\trouteFault = " + route.Fault);
            }
            sb.AppendLine("\t\t\t}");
        }

        /// <summary>NaN means the figure was never measured, which must never render as
        /// a zero: zero metres and zero seconds are both meaningful readings here.</summary>
        private static string Measured(double value) =>
            double.IsNaN(value) ? "(unmeasured)" : value.ToString("F3", CultureInfo.InvariantCulture);
    }
}
