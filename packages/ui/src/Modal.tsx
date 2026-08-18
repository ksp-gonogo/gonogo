// Re-export shim: the modal stack moved to `@ksp-gonogo/ui-kit` so an Uplink can
// open one; an Uplink augment was reaching into this private package for
// `useModal`. Everything the component needed (`GhostButton`,
// `PrimaryButton`, `CloseIcon`, the ModalChrome context) was already on the
// published floor; only core's `safeRandomUuid` was not, and the id it generated
// is an opaque close-handle that a counter serves as well. Every
// `@ksp-gonogo/ui` importer stays byte-identical.
export {
  ModalProvider,
  useModal,
  useModalChrome,
  useModalSaveBar,
} from "@ksp-gonogo/ui-kit";
