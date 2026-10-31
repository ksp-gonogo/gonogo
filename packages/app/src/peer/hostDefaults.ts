import { type ApprovalBook, NO_APPROVALS } from "./approvalBook";

/*
 * Kept apart from the peer host so a test setup file can set these without
 * loading the peer host, and with it PeerJS, ahead of a test file's mocks.
 */
let approvals: ApprovalBook = NO_APPROVALS;
let shareCode = "";

/** The approvals a host uses until the game's are attached. */
export function defaultApprovals(): ApprovalBook {
  return approvals;
}

/** The code a host hosts under until the game gives it one: empty outside a test. */
export function defaultShareCode(): string {
  return shareCode;
}

/**
 * The approvals a host uses until one is attached. A test that drives a host
 * with no game behind it gives it a book of its own here.
 */
export function setDefaultApprovalsForTests(book: ApprovalBook): void {
  approvals = book;
}

/**
 * The code a host with no game behind it hosts under, for a test that starts
 * one without a host record.
 */
export function setDefaultShareCodeForTests(code: string): void {
  shareCode = code;
}
