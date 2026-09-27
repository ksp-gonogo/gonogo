/*
 * Everything a story needs before it renders, in the order the app does it.
 * The injected gonogo host comes first: every widget registration and every
 * sdk hook resolves through it.
 */
import "../../components/scripts/probe/probe-install-host";
import "../../app/src/styles/fonts.css";
import "../../app/src/styles/global.css";
import "@ksp-gonogo/components";
import { registerStockBodies } from "@ksp-gonogo/core";

registerStockBodies();
