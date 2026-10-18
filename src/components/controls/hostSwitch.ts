import { h } from "vue";
import { Link, Message } from "@arco-design/web-vue";
import { Host } from "@/adapters";
import { ProfileAutoSwitch } from "@/services/profile";
import {
  ruleConditions,
  switchHostProxy,
  type RuleScope,
} from "@/services/proxy/ruleEditor";

/**
 * Route `host` (or its whole site) to `profileID` in the active auto switch
 * profile, and offer to reload the tab so the change takes effect.
 * Returns the updated auto switch profile, or undefined on failure.
 */
export async function switchHostWithFeedback(
  host: string,
  profileID: string,
  tabID: number | undefined,
  scope: RuleScope
): Promise<ProfileAutoSwitch | undefined> {
  try {
    const updated = await switchHostProxy(host, profileID, scope);
    // the broadest condition, e.g. "*.example.com"
    const target = ruleConditions(host, scope).at(-1);
    const msg = Message.success({
      content: () =>
        h("span", [
          Host.getMessage("mode_auto_switch_rule_saved", target),
          tabID !== undefined &&
            h(
              Link,
              {
                style: { marginLeft: "0.5em" },
                onClick: () => {
                  Host.reloadTab(tabID).catch(console.error);
                  msg.close();
                },
              },
              () => Host.getMessage("action_reload_tab")
            ),
        ]),
      duration: 5000,
    });
    return updated;
  } catch (e: any) {
    Message.error({
      content: Host.getMessage("config_feedback_error_occurred", e.toString()),
    });
  }
}
