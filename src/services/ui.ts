import { Host } from "@/adapters";
import type { ActionBehavior } from "@/adapters/base";

export type { ActionBehavior } from "@/adapters/base";

export const keyActionBehavior = "ui.actionBehavior";
export const defaultActionBehavior: ActionBehavior = "popup";

/** What a click on the toolbar icon opens: the popup unless chosen otherwise. */
export async function getActionBehavior(): Promise<ActionBehavior> {
  return Host.getWithDefault<ActionBehavior>(keyActionBehavior, defaultActionBehavior);
}

export async function setActionBehavior(behavior: ActionBehavior) {
  await Host.set<ActionBehavior>(keyActionBehavior, behavior);
}

/** Subscribe to changes of the setting, made in any extension context. */
export function onActionBehaviorChanged(
  callback: (behavior: ActionBehavior) => void
): () => void {
  return Host.onLocalStorageChanged((changes) => {
    if (keyActionBehavior in changes) {
      callback(
        (changes[keyActionBehavior].newValue as ActionBehavior) ?? defaultActionBehavior
      );
    }
  });
}

export const keyFailureBadge = "ui.failureBadge";
export const defaultFailureBadge = true;

/** Whether the badge alternates with the count of failed resources. */
export async function getFailureBadge(): Promise<boolean> {
  return Host.getWithDefault<boolean>(keyFailureBadge, defaultFailureBadge);
}

export async function setFailureBadge(enabled: boolean) {
  await Host.set<boolean>(keyFailureBadge, enabled);
}

/** Subscribe to changes of the setting, made in any extension context. */
export function onFailureBadgeChanged(
  callback: (enabled: boolean) => void
): () => void {
  return Host.onLocalStorageChanged((changes) => {
    if (keyFailureBadge in changes) {
      callback(
        (changes[keyFailureBadge].newValue as boolean) ?? defaultFailureBadge
      );
    }
  });
}
