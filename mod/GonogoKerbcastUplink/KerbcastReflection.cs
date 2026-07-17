using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace Gonogo.KerbcastUplink
{
    /// <summary>
    /// The arm's-length REFLECTION surface onto kerbcast. NO compile-time
    /// reference to kerbcast's assembly exists anywhere in this project — every
    /// kerbcast member is reached by runtime reflection against the loaded
    /// <c>Kerbcast</c> assembly, so the CC-BY-NC-SA-4.0 NonCommercial/ShareAlike
    /// boundary is never crossed: we USE the running mod's public API, we don't
    /// INCORPORATE its code. This mirrors the arm's-length reflection surface
    /// this repo already maintains against another copyleft-licensed mod's
    /// assembly for the same reason; see the .csproj header and
    /// NOTICE-KERBCAST.txt for the full licence rationale.
    ///
    /// <para>Target surface: kerbcast's <c>Kerbcast.KerbcastControl</c> — a
    /// public STATIC facade the mod already maintains as its in-process
    /// integration seam (it is what kerbcast's own scripting add-on calls, so it is
    /// an intentional public API, not an internal we're prying open). It
    /// exposes <c>IsActive</c>, <c>CamerasFor(Vessel)</c>, <c>ViewOf(uint)</c>,
    /// <c>SetFov(uint,float)</c> and <c>SetPan(uint,float,float)</c>, returning
    /// plain-data <c>KerbcastCameraView</c> objects that carry the owning stock
    /// KSP <c>Part</c>.</para>
    ///
    /// <para><c>KerbcastCameraView</c> exposes public FIELDS (not properties),
    /// hence <c>GetField</c> throughout — a detail worth stating because the
    /// RA precedent this copies uses <c>GetProperty</c> and silently reading
    /// null here would look identical to "kerbcast changed".</para>
    ///
    /// <para>Fail-soft throughout: a missing type/member (a kerbcast version
    /// whose surface moved) degrades to <c>null</c>/typed absence rather than
    /// throwing. <see cref="Reason"/> carries WHY the probe failed so the
    /// uplink can report it as its unavailability reason rather than going
    /// silently dark.</para>
    /// </summary>
    public sealed class KerbcastReflection
    {
        public const string KerbcastAssemblyName = "Kerbcast";
        private const string ControlTypeName = "Kerbcast.KerbcastControl";

        private readonly PropertyInfo? _isActive;
        private readonly MethodInfo? _camerasFor;
        private readonly MethodInfo? _setFov;
        private readonly MethodInfo? _setPan;

        // KerbcastCameraView public fields.
        private readonly FieldInfo? _flightId;
        private readonly FieldInfo? _partFlightId;
        private readonly FieldInfo? _cameraName;
        private readonly FieldInfo? _partName;
        private readonly FieldInfo? _partTitle;
        private readonly FieldInfo? _supportsZoom;
        private readonly FieldInfo? _supportsPan;
        private readonly FieldInfo? _fov;
        private readonly FieldInfo? _fovMin;
        private readonly FieldInfo? _fovMax;
        private readonly FieldInfo? _panYaw;
        private readonly FieldInfo? _panPitch;
        private readonly FieldInfo? _panYawMin;
        private readonly FieldInfo? _panYawMax;
        private readonly FieldInfo? _panPitchMin;
        private readonly FieldInfo? _panPitchMax;
        private readonly FieldInfo? _part;

        /// <summary>Why the probe is unusable, or null when it is usable.</summary>
        public string? Reason { get; }

        /// <summary>Whether the reflection surface resolved well enough to use.</summary>
        public bool IsAvailable => Reason == null;

        /// <summary>
        /// Binds the reflection surface to a specific assembly. The test seam:
        /// <see cref="Probe"/> finds the real kerbcast by name, while the tests
        /// point this at a stand-in carrying the same
        /// <c>Kerbcast.KerbcastControl</c>/<c>Kerbcast.KerbcastCameraView</c>
        /// shape — which is how the licence-boundary code gets exercised at all
        /// without a KSP install (and without linking kerbcast, which is the
        /// whole point).
        /// </summary>
        internal static KerbcastReflection ForAssembly(Assembly assembly) => new KerbcastReflection(assembly);

        private KerbcastReflection(Assembly kerbcastAssembly)
        {
            var control = SafeGetType(kerbcastAssembly, ControlTypeName);
            if (control == null)
            {
                Reason = $"kerbcast assembly loaded but {ControlTypeName} not found — unsupported kerbcast version";
                return;
            }

            _isActive = control.GetProperty("IsActive", BindingFlags.Public | BindingFlags.Static);
            _camerasFor = FindMethod(control, "CamerasFor", 1);
            _setFov = FindMethod(control, "SetFov", 2);
            _setPan = FindMethod(control, "SetPan", 3);

            var view = SafeGetType(kerbcastAssembly, "Kerbcast.KerbcastCameraView");
            if (view == null)
            {
                Reason = "kerbcast assembly loaded but Kerbcast.KerbcastCameraView not found — unsupported kerbcast version";
                return;
            }

            _flightId = Field(view, "FlightId");
            _partFlightId = Field(view, "PartFlightId");
            _cameraName = Field(view, "CameraName");
            _partName = Field(view, "PartName");
            _partTitle = Field(view, "PartTitle");
            _supportsZoom = Field(view, "SupportsZoom");
            _supportsPan = Field(view, "SupportsPan");
            _fov = Field(view, "Fov");
            _fovMin = Field(view, "FovMin");
            _fovMax = Field(view, "FovMax");
            _panYaw = Field(view, "PanYaw");
            _panPitch = Field(view, "PanPitch");
            _panYawMin = Field(view, "PanYawMin");
            _panYawMax = Field(view, "PanYawMax");
            _panPitchMin = Field(view, "PanPitchMin");
            _panPitchMax = Field(view, "PanPitchMax");
            _part = Field(view, "Part");

            // The members this uplink cannot do its job without. Everything else
            // degrades to a null field on one camera; these degrade to "no
            // camera list at all", which is a reason worth surfacing.
            if (_isActive == null || _camerasFor == null || _flightId == null)
            {
                Reason = "kerbcast's KerbcastControl surface has moved (IsActive/CamerasFor/FlightId unreadable) — unsupported kerbcast version";
            }
        }

        /// <summary>
        /// Probe for the loaded kerbcast assembly. Returns null when kerbcast is
        /// not installed/loaded — the caller then reports the uplink unavailable
        /// with that as the reason.
        /// </summary>
        public static KerbcastReflection? Probe()
        {
            try
            {
                var assembly = AppDomain.CurrentDomain
                    .GetAssemblies()
                    .FirstOrDefault(a => string.Equals(
                        a.GetName().Name, KerbcastAssemblyName, StringComparison.OrdinalIgnoreCase));
                return assembly == null ? null : new KerbcastReflection(assembly);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// Whether kerbcast's core is live (a flight scene with the plugin
        /// running). False in the space centre, the editor, or before kerbcast
        /// spins up — the "why isn't my camera list populated" answer.
        /// </summary>
        public bool IsActive()
        {
            if (_isActive == null)
            {
                return false;
            }
            try
            {
                return _isActive.GetValue(null) is true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>
        /// kerbcast's camera views for one vessel, as opaque objects to be read
        /// through <see cref="ReadView"/>. Empty when kerbcast returns nothing
        /// or the call throws.
        /// </summary>
        public IReadOnlyList<object> CamerasFor(object? vessel)
        {
            if (_camerasFor == null || vessel == null)
            {
                return Array.Empty<object>();
            }
            try
            {
                if (_camerasFor.Invoke(null, new[] { vessel }) is not IEnumerable list)
                {
                    return Array.Empty<object>();
                }
                var result = new List<object>();
                foreach (var item in list)
                {
                    if (item != null)
                    {
                        result.Add(item);
                    }
                }
                return result;
            }
            catch (Exception)
            {
                return Array.Empty<object>();
            }
        }

        /// <summary>Reads one kerbcast camera view into a plain, kerbcast-type-free struct.</summary>
        public KerbcastView ReadView(object view) => new KerbcastView
        {
            FlightId = ReadUInt(_flightId, view),
            PartFlightId = ReadUInt(_partFlightId, view),
            CameraName = ReadString(_cameraName, view),
            PartName = ReadString(_partName, view),
            PartTitle = ReadString(_partTitle, view),
            SupportsZoom = ReadBool(_supportsZoom, view),
            SupportsPan = ReadBool(_supportsPan, view),
            Fov = ReadDouble(_fov, view),
            FovMin = ReadDouble(_fovMin, view),
            FovMax = ReadDouble(_fovMax, view),
            PanYaw = ReadDouble(_panYaw, view),
            PanPitch = ReadDouble(_panPitch, view),
            PanYawMin = ReadDouble(_panYawMin, view),
            PanYawMax = ReadDouble(_panYawMax, view),
            PanPitchMin = ReadDouble(_panPitchMin, view),
            PanPitchMax = ReadDouble(_panPitchMax, view),
            Part = ReadObject(_part, view),
        };

        /// <summary>Applies a field-of-view change. False when kerbcast rejected it or the call is unavailable.</summary>
        public bool SetFov(uint flightId, float fov) => InvokeBool(_setFov, new object[] { flightId, fov });

        /// <summary>Applies an absolute pan. False when kerbcast rejected it or the call is unavailable.</summary>
        public bool SetPan(uint flightId, float yaw, float pitch) => InvokeBool(_setPan, new object[] { flightId, yaw, pitch });

        private static bool InvokeBool(MethodInfo? method, object[] args)
        {
            if (method == null)
            {
                return false;
            }
            try
            {
                return method.Invoke(null, args) is true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        // GetMethod(name) would throw AmbiguousMatchException on an overload —
        // the same trap a sibling Uplink's version guard documents. Match on
        // name + arity instead.
        private static MethodInfo? FindMethod(Type type, string name, int parameterCount)
        {
            try
            {
                return type.GetMethods(BindingFlags.Public | BindingFlags.Static)
                    .FirstOrDefault(m => m.Name == name && m.GetParameters().Length == parameterCount);
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static FieldInfo? Field(Type type, string name)
        {
            try
            {
                return type.GetField(name, BindingFlags.Public | BindingFlags.Instance);
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static Type? SafeGetType(Assembly assembly, string fullName)
        {
            try
            {
                return assembly.GetType(fullName, throwOnError: false);
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static object? ReadObject(FieldInfo? field, object? target)
        {
            if (field == null || target == null)
            {
                return null;
            }
            try
            {
                return field.GetValue(target);
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static uint? ReadUInt(FieldInfo? field, object? target) =>
            ReadObject(field, target) switch
            {
                uint u => u,
                int i when i >= 0 => (uint)i,
                _ => (uint?)null,
            };

        private static double? ReadDouble(FieldInfo? field, object? target) =>
            ReadObject(field, target) switch
            {
                double d => d,
                float f => f,
                _ => (double?)null,
            };

        private static bool? ReadBool(FieldInfo? field, object? target) =>
            ReadObject(field, target) is bool b ? b : (bool?)null;

        private static string? ReadString(FieldInfo? field, object? target) =>
            ReadObject(field, target) as string;
    }

    /// <summary>
    /// A plain, kerbcast-type-free reading of one <c>KerbcastCameraView</c>.
    /// Deliberately carries <see cref="Part"/> as a bare <c>object</c>: the
    /// value IS a stock KSP <c>Part</c>, but keeping it untyped here means this
    /// struct's metadata references nothing from kerbcast's assembly.
    ///
    /// <para>Every field is nullable — an unreadable member is typed absence,
    /// never a 0 the wire would misreport as a real reading.</para>
    /// </summary>
    public struct KerbcastView
    {
        public uint? FlightId;
        public uint? PartFlightId;
        public string? CameraName;
        public string? PartName;
        public string? PartTitle;
        public bool? SupportsZoom;
        public bool? SupportsPan;
        public double? Fov;
        public double? FovMin;
        public double? FovMax;
        public double? PanYaw;
        public double? PanPitch;
        public double? PanYawMin;
        public double? PanYawMax;
        public double? PanPitchMin;
        public double? PanPitchMax;
        public object? Part;
    }
}
