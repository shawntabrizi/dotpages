// Pure derivation of the primary deploy-button state. Ported from playground-app.
//
// The button leads with the bounded pre-flight check (name availability / funds
// / storage), then deploys. On a non-passing check it splits into "Check again"
// (primary) + a secondary "Try to deploy anyway" — advice, not a block, since
// deploy.ts re-verifies on-chain before any paid write. Gated only on local,
// network-free conditions (connected account, non-empty name, valid name/size).
//
// Precedence: deploying > checking > (not ready → disabled) > checkAgain >
// deploy > check.

export type DeployButtonMode = "deploying" | "checking" | "check" | "checkAgain" | "deploy";

export interface DeployButtonState {
    mode: DeployButtonMode;
    label: string;
    disabled: boolean;
}

export interface DeployButtonArgs {
    busy: boolean;
    preflightBusy: boolean;
    hasAccount: boolean;
    hasName: boolean;
    /** Local, network-free checks pass (name format valid). */
    localOk: boolean;
    /** The last completed check ran for the CURRENT name. */
    checkFresh: boolean;
    /** preflight.ok from the last completed run, or null when none is fresh. */
    preflightOk: boolean | null;
    /** The last check attempt errored / could not complete. */
    preflightFailed: boolean;
}

const LABELS: Record<DeployButtonMode, string> = {
    deploying: "Deploying…",
    checking: "Checking…",
    check: "Deploy",
    checkAgain: "Check again",
    deploy: "Deploy",
};

export function deployButtonState(args: DeployButtonArgs): DeployButtonState {
    const { busy, preflightBusy, hasAccount, hasName, localOk, checkFresh, preflightOk, preflightFailed } = args;

    if (busy) return { mode: "deploying", label: LABELS.deploying, disabled: true };
    if (preflightBusy) return { mode: "checking", label: LABELS.checking, disabled: true };

    const ready = hasAccount && hasName && localOk;

    const failed = checkFresh && (preflightFailed || preflightOk === false);
    if (failed) return { mode: "checkAgain", label: LABELS.checkAgain, disabled: !ready };

    if (checkFresh && preflightOk === true) return { mode: "deploy", label: LABELS.deploy, disabled: !ready };

    return { mode: "check", label: LABELS.check, disabled: !ready };
}
