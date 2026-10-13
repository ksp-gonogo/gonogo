/**
 * A function that builds a value for a key the first time it is asked and hands back that same value on every later call. Used by scenes that pass a story's fixture and wrap to the widget mount, which rebuilds the widget whenever either changes identity.
 */
export function builtOnce<K, V>(build: (key: K) => V): (key: K) => V {
  const built = new Map<K, V>();
  return (key) => {
    if (!built.has(key)) built.set(key, build(key));
    return built.get(key) as V;
  };
}
