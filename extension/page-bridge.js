(() => {
  if (window.__basepaintLiveRoomsWalletBridge) return;
  window.__basepaintLiveRoomsWalletBridge = true;

  const source = "basepaint-live-rooms";
  const responseType = "bpl-wallet-response";
  const signResponseType = "bpl-wallet-sign-response";

  function post(type, payload = {}) {
    window.postMessage({ source, type, ...payload }, "*");
  }

  function providers() {
    return [window.ethereum, window.coinbaseWalletExtension].filter((provider) => provider && typeof provider.request === "function");
  }

  function send(account) {
    post(responseType, { account: account || "" });
  }

  async function readAccount() {
    for (const provider of providers()) {
      try {
        const accounts = await provider.request({ method: "eth_accounts" });
        const account = Array.isArray(accounts) ? accounts.find((value) => /^0x[a-f0-9]{40}$/i.test(String(value))) : "";
        if (account) return send(account);
      } catch {
        // Another provider may still be available.
      }
    }
    send("");
  }

  async function signMessage(message, requestedAddress) {
    const normalizedRequested = String(requestedAddress || "").toLowerCase();
    for (const provider of providers()) {
      try {
        const accounts = await provider.request({ method: "eth_accounts" });
        const account = Array.isArray(accounts) ? accounts.find((value) => String(value).toLowerCase() === normalizedRequested) : "";
        if (!account) continue;
        const signature = await provider.request({ method: "personal_sign", params: [message, account] });
        post(signResponseType, { signature, address: account });
        return;
      } catch (error) {
        post(signResponseType, { error: String(error?.message || error) });
        return;
      }
    }
    post(signResponseType, { error: "No connected wallet provider found." });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== source) return;
    if (event.data?.type === "bpl-wallet-request") readAccount();
    if (event.data?.type === "bpl-wallet-sign-request") signMessage(event.data.message, event.data.address);
  });

  for (const provider of providers()) {
    try { provider.on?.("accountsChanged", (accounts) => send(Array.isArray(accounts) ? accounts[0] : "")); } catch {}
  }
})();
