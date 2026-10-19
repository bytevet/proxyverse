import { afterEach, describe, expect, test, vi } from "vitest";
import { Host } from "@/adapters";
import {
  getActionBehavior,
  onActionBehaviorChanged,
  setActionBehavior,
} from "@/services/ui";

describe("toolbar action behavior", () => {
  afterEach(() => vi.restoreAllMocks());

  test("defaults to the popup", async () => {
    vi.spyOn(Host, "get").mockResolvedValue(undefined);
    expect(await getActionBehavior()).toBe("popup");
  });

  test("stores the choice", async () => {
    const set = vi.spyOn(Host, "set").mockResolvedValue();
    await setActionBehavior("sidebar");
    expect(set).toHaveBeenCalledWith("ui.actionBehavior", "sidebar");
  });

  test("reports changes of the setting only", () => {
    let listener: (changes: Record<string, { newValue?: unknown }>) => void =
      () => {};
    const unsubscribe = vi.fn();
    vi.spyOn(Host, "onLocalStorageChanged").mockImplementation((l) => {
      listener = l;
      return unsubscribe;
    });

    const callback = vi.fn();
    expect(onActionBehaviorChanged(callback)).toBe(unsubscribe);

    listener({ profiles: { newValue: {} } });
    expect(callback).not.toHaveBeenCalled();
    listener({ "ui.actionBehavior": { newValue: "sidebar" } });
    listener({ "ui.actionBehavior": {} }); // removed: back to the default
    expect(callback.mock.calls).toEqual([["sidebar"], ["popup"]]);
  });
});
