// FINDING (R1 spike): `export * from "react"` does NOT propagate react's named
// exports through Rollup's CJS interop — a runtime importer of `useEffect` etc.
// fails to link ("does not provide an export named 'useEffect'"). react is CJS;
// its named surface must be re-exported EXPLICITLY. This is exactly why the
// design's SDK facade (a curated, explicit re-export surface) is the right shape
// for the shared singletons rather than a blind `export *`.
export {
  Children,
  Component,
  cloneElement,
  createContext,
  createElement,
  createRef,
  default,
  Fragment,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  startTransition,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} from "react";
