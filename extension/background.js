const OFFSCREEN_PATH = "extension/offscreen.html";
let creatingOffscreen = null;
let ownerTabId = null;

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  });
  if (contexts.length) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ["USER_MEDIA", "WEB_RTC"],
      justification: "Publish the artist's camera and microphone to their BasePaint Live room.",
    }).finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

async function closeOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (contexts.length) await chrome.offscreen.closeDocument();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "background-event") {
    const tabId = Number(message.tabId || ownerTabId || 0);
    if (tabId && (!ownerTabId || tabId === ownerTabId)) {
      chrome.tabs.sendMessage(tabId, { ...message, target: "content" }).catch(() => {});
    }
    if (message.type === "bpl-media-disconnected" && message.unexpected && (!ownerTabId || tabId === ownerTabId)) {
      ownerTabId = null;
      closeOffscreenDocument().catch(() => {});
    }
    return false;
  }

  if (message?.target !== "background" || !String(message.type || "").startsWith("bpl-media-")) return false;
  const senderTabId = Number(sender.tab?.id || 0);

  (async () => {
    if (!senderTabId) throw new Error("The BasePaint tab could not be identified.");
    if (message.type === "bpl-media-disconnect" && ownerTabId && senderTabId !== ownerTabId) {
      return { ok: true, idle: false, ignored: true };
    }
    if (message.type === "bpl-media-disconnect" && !ownerTabId) {
      return { ok: true, idle: true, cameraEnabled: false, micEnabled: false };
    }
    ownerTabId = senderTabId;
    await ensureOffscreenDocument();
    const result = await chrome.runtime.sendMessage({
      ...message,
      target: "offscreen",
      tabId: ownerTabId,
    });
    if (result?.idle) {
      ownerTabId = null;
      await closeOffscreenDocument();
    }
    return result || { ok: true };
  })()
    .then((result) => sendResponse(result))
    .catch((error) => {
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== ownerTabId) return;
  ownerTabId = null;
  chrome.runtime.sendMessage({ target: "offscreen", type: "bpl-media-disconnect", tabId })
    .catch(() => {})
    .finally(() => closeOffscreenDocument().catch(() => {}));
});
