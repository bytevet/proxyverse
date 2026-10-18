import { Host } from "@/adapters";
import { ProxyProfile, SystemProfile } from "./profile";

export async function setIndicator(
  profile: ProxyProfile | undefined,
  tabID?: number
) {
  if (profile) {
    await Host.setBadge(
      profile.profileName.trimStart().substring(0, 2),
      profile.color,
      tabID
    );
  } else {
    // clear badge
    await Host.setBadge("", SystemProfile.SYSTEM.color, tabID);
  }
}

export const FAILURE_BADGE_COLOR = "#C5221F";
export const FAILURE_BADGE_INTERVAL_MS = 2000;

/**
 * The badge of each tab. It shows the profile used for the tab, and
 * alternates with the number of failed resources while the tab has failures
 * the user hasn't seen yet.
 *
 * Note: updating the badge every couple of seconds keeps the background
 * service worker alive while some tab has unseen failures.
 */
export class TabIndicator {
  private failures = new Map<number, number>(); // tabID → failures to show
  private tabProfiles = new Map<number, ProxyProfile | undefined>();
  private timer?: ReturnType<typeof setInterval>;
  private showingCount = false;
  private refreshing: Promise<void> = Promise.resolve();

  constructor(
    private activeProfile: () => Promise<ProxyProfile | undefined>
  ) {}

  /** Set the profile a tab is using, e.g. a sub-profile of an auto profile. */
  async setTabProfile(tabID: number, profile: ProxyProfile | undefined) {
    this.tabProfiles.set(tabID, profile);
    if (!(this.failures.has(tabID) && this.showingCount)) {
      await setIndicator(profile, tabID);
    }
  }

  /**
   * Show the active profile again, e.g. after it changed. Profiles set per
   * tab are forgotten until the tabs load a page again.
   */
  refresh() {
    // one at a time, so the last trigger shows the latest state
    this.refreshing = this.refreshing
      .catch(() => undefined)
      .then(async () => {
        this.tabProfiles.clear();
        const active = await this.activeProfile();
        await setIndicator(active);
        await this.updateTabs(active);
      });
    return this.refreshing;
  }

  /** Alternate the tab's badge with `count` failures, or stop (0). */
  async setFailures(tabID: number, count: number) {
    if (count > 0) {
      const previous = this.failures.get(tabID);
      this.failures.set(tabID, count);
      this.timer ??= setInterval(() => this.tick(), FAILURE_BADGE_INTERVAL_MS);
      if (previous !== count && this.showingCount) {
        await this.showCount(tabID, count);
      }
      return;
    }

    if (this.failures.delete(tabID)) {
      this.stopIfIdle();
      await this.showProfile(tabID);
    }
  }

  removeTab(tabID: number) {
    this.failures.delete(tabID);
    this.tabProfiles.delete(tabID);
    this.stopIfIdle();
  }

  private stopIfIdle() {
    if (this.failures.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.showingCount = false;
    }
  }

  private async tick() {
    this.showingCount = !this.showingCount;
    await this.updateTabs(
      this.showingCount ? undefined : await this.activeProfile()
    );
  }

  /** Repaint the badges of the tabs with failures, in the current phase. */
  private async updateTabs(active: ProxyProfile | undefined) {
    // a tab may be gone meanwhile: ignore failures
    await Promise.allSettled(
      [...this.failures].map(([tabID, count]) =>
        this.showingCount
          ? this.showCount(tabID, count)
          : setIndicator(this.profileOf(tabID, active), tabID)
      )
    );
  }

  private profileOf(tabID: number, active: ProxyProfile | undefined) {
    return this.tabProfiles.has(tabID) ? this.tabProfiles.get(tabID) : active;
  }

  private async showCount(tabID: number, count: number) {
    await Host.setBadge(
      count > 99 ? "99+" : `${count}`,
      FAILURE_BADGE_COLOR,
      tabID
    );
  }

  private async showProfile(tabID: number) {
    const active = this.tabProfiles.has(tabID)
      ? undefined
      : await this.activeProfile();
    await setIndicator(this.profileOf(tabID, active), tabID);
  }
}
