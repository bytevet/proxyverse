import { BaseAdapter } from "./base";
import { Chrome } from "./chrome";
import { WebBrowser } from "./web";

function chooseAdapter(): BaseAdapter {
  if (chrome?.proxy) {
    return new Chrome();
  }

  return new WebBrowser();
}

export const Host = chooseAdapter();
