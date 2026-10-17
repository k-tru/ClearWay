import { defineBackground } from 'wxt/utils/define-background';
import { describeImage } from '../src/background/describe';
import type { ToBackground } from '../src/shared/messages';

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((msg: ToBackground, _sender, reply) => {
    if (msg.type !== 'describe') return;
    describeImage(msg.url, msg.context).then(reply);
    return true; // reply asynchronously
  });
});
