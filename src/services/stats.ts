import { WebRequestErrorOccurredDetails } from "@/adapters/base";

export class WebRequestStats {
  private stats: Record<number, TabStats> = {};

  addFailedRequest(details: WebRequestErrorOccurredDetails) {
    const tabID = details.tabId;
    const tabStats = this.getTabStats(tabID);
    tabStats.addFailedRequest(details);
  }

  getTabStats(tabID: number) {
    if (!this.stats[tabID]) {
      this.stats[tabID] = new TabStats(tabID);
    }
    return this.stats[tabID];
  }

  closeTab(tabID: number) {
    delete this.stats[tabID];
  }
}

class TabStats {
  // private tabID: number;
  private failedRequests: WebRequestErrorOccurredDetails[] = [];
  private maxRequests: number = 500; // max number of requests to keep in memory

  constructor(_tabID: number) {
    // this.tabID = tabID;
  }

  get failedRequestsCount() {
    return this.failedRequests.length;
  }

  addFailedRequest(details: WebRequestErrorOccurredDetails) {
    this.failedRequests.push(details);
    if (this.failedRequests.length > this.maxRequests) {
      this.failedRequests.shift();
    }
  }
}
