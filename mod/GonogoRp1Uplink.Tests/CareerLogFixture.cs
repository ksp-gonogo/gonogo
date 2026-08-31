// A stand-in for RP-1's career log, declared in RP-1's own namespace with RP-1's
// own type and member names.
//
// The ACCESSIBILITIES are the load-bearing part and are copied deliberately: all
// six event lists are PRIVATE on the real CareerLog, whose public surface is only
// Instance, IsEnabled, Scenario and a few period markers. A fixture that exposed
// them publicly would let a walk pass here that resolves nothing in a running
// game, which is the one thing this fixture family exists to prevent.
//
// The monthly financial ledger (_periodDict of LogPeriod, about thirty figures a
// period) is deliberately NOT modelled. Nothing reads it: it is a balance sheet
// rather than a timeline and belongs on a budget surface, so a fixture for it here
// would be scaffolding for a reading that does not exist.
using System;
using System.Collections.Generic;

namespace RP0
{
    /// <summary>The base every logged event derives from. UT is public on the real one.</summary>
    public abstract class CareerEvent
    {
#pragma warning disable IDE1006
        public double UT;
#pragma warning restore IDE1006
    }

    public class ContractEvent : CareerEvent
    {
        public string? InternalName;
        public string? DisplayName;
        public double RepChange;
        public ContractEventType Type;
    }

    public enum ContractEventType
    {
        Offered,
        Accepted,
        Completed,
        Failed,
        Cancelled,
    }

    public class LaunchEvent : CareerEvent
    {
        public string? VesselName;
        public string? VesselUID;
        public string? LaunchID;
        public EditorFacility BuiltAt;
    }

    public class FailureEvent : CareerEvent
    {
        public string? VesselUID;
        public string? LaunchID;
        public string? Part;

        /// <summary>A plain STRING on the real type, not an enum, unlike its siblings.</summary>
        public string? Type;
    }

    public class TechResearchEvent : CareerEvent
    {
        public string? NodeName;
        public double YearMult;
        public double ResearchRate;
    }

    public class LeaderEvent : CareerEvent
    {
        public string? LeaderName;
        public double Cost;
        public bool IsAdd;
    }

    /// <summary>
    /// The sixth kind, which this fixture did not model at all until the reading it
    /// feeds was found to produce a nameless row for it. Its absence was invisible:
    /// production walks <c>_facilityConstructionEvents</c> by NAME, a fixture
    /// without that field yields null, and an empty walk asserts nothing.
    /// </summary>
    public class FacilityConstructionEvent : CareerEvent
    {
        public FacilityType Facility;
        public ConstructionState State;
        public Guid FacilityID;
    }

    /// <summary>RP-1's own, powers of two on the real one.</summary>
    public enum FacilityType
    {
        Administration = 1,
        AstronautComplex = 2,
        LaunchPad = 4,
        MissionControl = 8,
    }

    public enum ConstructionState
    {
        Started = 1,
        Cancelled = 2,
        Completed = 4,
        Dismantled = 8,
    }


    /// <summary>
    /// RP-1's career log. A ScenarioModule on the real type, so a null
    /// <see cref="Instance"/> stands for a save it is not running in.
    /// </summary>
    public class CareerLog
    {
        public static CareerLog? Instance;

        /// <summary>
        /// Whether the career is being logged. FALSE is not an empty log, and the
        /// reading has to keep the two apart.
        /// </summary>
        public bool IsEnabled = true;

        // PRIVATE, exactly as the real ones are. The builders below are the test's
        // way in; production reaches these by name through the same non-public
        // path it uses in the game.
#pragma warning disable IDE0044, CS0414
        private readonly List<ContractEvent> _contractDict = new List<ContractEvent>();
        private readonly List<LaunchEvent> _launchedVessels = new List<LaunchEvent>();
        private readonly List<FailureEvent> _failures = new List<FailureEvent>();
        private readonly List<TechResearchEvent> _techEvents = new List<TechResearchEvent>();
        private readonly List<LeaderEvent> _leaderEvents = new List<LeaderEvent>();
        private readonly List<FacilityConstructionEvent> _facilityConstructionEvents =
            new List<FacilityConstructionEvent>();
#pragma warning restore IDE0044, CS0414

        public CareerLog AddLaunch(
            double ut,
            string vesselName,
            string launchId,
            EditorFacility builtAt = EditorFacility.VAB)
        {
            _launchedVessels.Add(new LaunchEvent
            {
                UT = ut,
                VesselName = vesselName,
                LaunchID = launchId,
                BuiltAt = builtAt,
            });
            return this;
        }

        public CareerLog AddFailure(double ut, string launchId, string part, string type)
        {
            _failures.Add(
                new FailureEvent { UT = ut, LaunchID = launchId, Part = part, Type = type });
            return this;
        }

        public CareerLog AddContract(double ut, string displayName, double repChange)
        {
            _contractDict.Add(new ContractEvent
            {
                UT = ut,
                DisplayName = displayName,
                RepChange = repChange,
                Type = ContractEventType.Completed,
            });
            return this;
        }

        public CareerLog AddLeader(double ut, string name, double cost, bool isAdd = true)
        {
            _leaderEvents.Add(
                new LeaderEvent { UT = ut, LeaderName = name, Cost = cost, IsAdd = isAdd });
            return this;
        }

        public CareerLog AddFacilityConstruction(
            double ut,
            FacilityType facility = FacilityType.LaunchPad,
            ConstructionState state = ConstructionState.Started)
        {
            _facilityConstructionEvents.Add(new FacilityConstructionEvent
            {
                UT = ut,
                Facility = facility,
                State = state,
                FacilityID = Guid.NewGuid(),
            });
            return this;
        }

        public CareerLog AddTech(double ut, string nodeName)
        {
            _techEvents.Add(new TechResearchEvent { UT = ut, NodeName = nodeName });
            return this;
        }
    }
}
