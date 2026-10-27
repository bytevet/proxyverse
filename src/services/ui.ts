import { Host } from "@/adapters";
import type { ActionBehavior } from "@/adapters/base";

export type { ActionBehavior } from "@/adapters/base";

export const keyActionBehavior = "ui.actionBehavior";

/** What a click on the toolbar icon opens: the popup unless chosen otherwise. */
export async function getActionBehavior(): Promise<ActionBehavior> {
  return Host.getWithDefault<ActionBehavior>(keyActionBehavior, "popup");
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
      callback((changes[keyActionBehavior].newValue as ActionBehavior) ?? "popup");
    }
  });
}
