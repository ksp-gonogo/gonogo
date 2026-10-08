using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.CompilerServices;

namespace Sitrep.Host
{
    /// <summary>
    /// What a tree costs in managed heap, in bytes: the recorder's charge for a
    /// sample it cannot pack (see <see cref="HeldSampleCodec"/>), and the
    /// reference the pack's saving is measured against.
    ///
    /// <para>The held value is the flattened wire tree a channel source returns:
    /// <c>Dictionary&lt;string, object?&gt;</c> nodes, <c>List&lt;object?&gt;</c>
    /// runs, strings and boxed scalars. That shape is far larger in memory than
    /// the JSON it becomes (every node carries a dictionary, its buckets and a
    /// boxed value per field), so an unpacked tree is charged at this figure and
    /// never at its wire size.</para>
    ///
    /// <para>The sizes are those of a 64-bit runtime (16 byte object header, 8 byte
    /// references), which is what KSP runs on every platform it is built for. The
    /// walk counts each distinct instance once per sample, ignores the garbage a
    /// sample's construction left behind, and models the capacity a dictionary
    /// or list grows to when built by adding items, so it tracks what the sample
    /// retains: <c>HeldSampleSizeTests</c> checks it against the collector's own
    /// count.</para>
    /// </summary>
    internal static class HeldSampleSize
    {
        private const int ObjectHeader = 16;
        private const int Reference = 8;
        private const int ArrayHeader = 24;
        private const int DictionaryFixed = 80;
        private const int ListFixed = 32;

        private static readonly Dictionary<Type, FieldInfo[]> FieldsByType = new Dictionary<Type, FieldInfo[]>();

        /// <summary>The managed-heap bytes <paramref name="value"/> and everything it references retain.</summary>
        public static long Of(object? value)
        {
            if (value == null)
            {
                return 0;
            }
            var seen = new HashSet<object>(ReferenceComparer.Instance);
            return Walk(value, seen);
        }

        private static long Walk(object? value, HashSet<object> seen)
        {
            if (value == null)
            {
                return 0;
            }

            var type = value.GetType();
            if (type.IsValueType)
            {
                // A boxed scalar or struct: header plus the payload, as an object.
                return Align(ObjectHeader + InlineSize(value, seen));
            }
            if (!seen.Add(value))
            {
                return 0;
            }

            if (value is string text)
            {
                return Align(22 + 2L * text.Length);
            }
            if (type.IsArray)
            {
                return ArrayBytes((Array)value, seen);
            }
            if (value is IDictionary dictionary)
            {
                long total = DictionaryBytes(dictionary.Count);
                foreach (DictionaryEntry entry in dictionary)
                {
                    total += Walk(entry.Key, seen) + Walk(entry.Value, seen);
                }
                return total;
            }
            if (value is IList list)
            {
                long total = ListFixed + (list.Count == 0 ? 0 : ArrayHeader + (long)Reference * ListCapacity(list.Count));
                foreach (var item in list)
                {
                    total += Walk(item, seen);
                }
                return Align(total);
            }
            if (value is IEnumerable sequence)
            {
                long total = ListFixed;
                foreach (var item in sequence)
                {
                    total += Reference + Walk(item, seen);
                }
                return Align(total);
            }
            return Align(ObjectHeader + InlineSize(value, seen));
        }

        /// <summary>
        /// A dictionary built by adding entries grows through the primes 3, 7, 17,
        /// 37, 79 and on, each the first prime past double the last, so up to
        /// roughly half of what it allocates can be slack. Counted, because the
        /// slack is memory the process holds all the same.
        /// </summary>
        private static long DictionaryBytes(int count)
        {
            if (count == 0)
            {
                return DictionaryFixed;
            }
            long capacity = 3;
            while (capacity < count)
            {
                capacity = NextPrime(capacity * 2);
            }
            return DictionaryFixed + (ArrayHeader + 4 * capacity) + (ArrayHeader + 24 * capacity);
        }

        /// <summary>A list built by adding items doubles from four.</summary>
        private static long ListCapacity(int count)
        {
            long capacity = 4;
            while (capacity < count)
            {
                capacity *= 2;
            }
            return capacity;
        }

        private static long NextPrime(long from)
        {
            for (var candidate = from | 1; ; candidate += 2)
            {
                var prime = true;
                for (long divisor = 3; divisor * divisor <= candidate; divisor += 2)
                {
                    if (candidate % divisor == 0)
                    {
                        prime = false;
                        break;
                    }
                }
                if (prime)
                {
                    return candidate;
                }
            }
        }

        private static long ArrayBytes(Array array, HashSet<object> seen)
        {
            var element = array.GetType().GetElementType()!;
            if (element.IsPrimitive)
            {
                return Align(ArrayHeader + (long)array.Length * PrimitiveSize(element));
            }
            long total = ArrayHeader + (long)array.Length * (element.IsValueType ? InlineSize(Activator.CreateInstance(element)!, seen) : Reference);
            foreach (var item in array)
            {
                total += element.IsValueType ? 0 : Walk(item, seen);
            }
            return Align(total);
        }

        /// <summary>The bytes an instance's own fields take, plus whatever its references retain.</summary>
        private static long InlineSize(object instance, HashSet<object> seen)
        {
            var type = instance.GetType();
            if (type.IsPrimitive)
            {
                return PrimitiveSize(type);
            }
            if (type.IsEnum)
            {
                return PrimitiveSize(Enum.GetUnderlyingType(type));
            }
            if (type == typeof(decimal))
            {
                return 16;
            }

            long total = 0;
            foreach (var field in FieldsOf(type))
            {
                var fieldType = field.FieldType;
                if (fieldType.IsValueType)
                {
                    var inline = field.GetValue(instance);
                    total += inline == null ? TypeSize(fieldType) : InlineSize(inline, seen);
                    continue;
                }
                total += Reference + Walk(field.GetValue(instance), seen);
            }
            return total;
        }

        /// <summary>The bytes a value type takes inline, from its shape alone: a <c>Nullable</c> with no value has no instance to read.</summary>
        private static long TypeSize(Type type)
        {
            var underlying = Nullable.GetUnderlyingType(type);
            if (underlying != null)
            {
                return Align(TypeSize(underlying) + 1);
            }
            if (type.IsPrimitive)
            {
                return PrimitiveSize(type);
            }
            if (type.IsEnum)
            {
                return PrimitiveSize(Enum.GetUnderlyingType(type));
            }
            if (type == typeof(decimal))
            {
                return 16;
            }
            long total = 0;
            foreach (var field in FieldsOf(type))
            {
                total += field.FieldType.IsValueType ? TypeSize(field.FieldType) : Reference;
            }
            return total;
        }

        private static FieldInfo[] FieldsOf(Type type)
        {
            lock (FieldsByType)
            {
                if (FieldsByType.TryGetValue(type, out var cached))
                {
                    return cached;
                }
                var fields = new List<FieldInfo>();
                for (var t = type; t != null && t != typeof(object); t = t.BaseType)
                {
                    fields.AddRange(t.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly));
                }
                cached = fields.ToArray();
                FieldsByType[type] = cached;
                return cached;
            }
        }

        private static int PrimitiveSize(Type type)
        {
            if (type == typeof(bool) || type == typeof(byte) || type == typeof(sbyte))
            {
                return 1;
            }
            if (type == typeof(short) || type == typeof(ushort) || type == typeof(char))
            {
                return 2;
            }
            if (type == typeof(int) || type == typeof(uint) || type == typeof(float))
            {
                return 4;
            }
            return 8;
        }

        private static long Align(long bytes) => (bytes + 7) & ~7L;

        private sealed class ReferenceComparer : IEqualityComparer<object>
        {
            public static readonly ReferenceComparer Instance = new ReferenceComparer();

            bool IEqualityComparer<object>.Equals(object? x, object? y) => ReferenceEquals(x, y);

            int IEqualityComparer<object>.GetHashCode(object obj) => RuntimeHelpers.GetHashCode(obj);
        }
    }
}
