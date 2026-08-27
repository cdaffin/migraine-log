// Passphrase gate, and the credential the server copy is fetched with.
//
// Two jobs. Locally it gates the screen, so someone who picks up an unlocked
// device doesn't read the log. Remotely it is the passphrase sent to /api/log,
// where the function compares it against LOG_PASSWORD — that check is the real
// one, since it runs on a server the browser can't talk past.
//
// Only the SHA-256 hash is compiled in, so the repo being public doesn't hand
// the passphrase to a reader. The passphrase itself is kept in this browser's
// localStorage after a correct entry, because the server needs it on every
// request. To change it, print a new hash, paste it below, and set the same
// new passphrase as LOG_PASSWORD in the Netlify dashboard:
//
//   printf '%s' 'your new passphrase' | shasum -a 256
//
const Lock = (() => {
  const HASH = "0a00bf94b9234290c836681b92c5f70fbc5f3faba8e4fd3bb650286b8bb8dd99";
  const PASS_KEY = "migraine-log.pass";

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // Held in memory too, so a browser that blocks storage still syncs for the
  // life of the tab instead of failing every request.
  let passphrase = "";

  function stored() {
    try {
      return localStorage.getItem(PASS_KEY) || "";
    } catch {
      return ""; // storage blocked — ask every time rather than failing open
    }
  }

  function remember(value) {
    passphrase = value;
    try {
      localStorage.setItem(PASS_KEY, value);
    } catch {
      // Non-fatal: this tab stays unlocked, the next launch asks again.
    }
  }

  function lock() {
    passphrase = "";
    try {
      localStorage.removeItem(PASS_KEY);
    } catch {
      // Nothing to clear if storage is unavailable.
    }
    location.reload();
  }

  // Resolves once the app may show data: immediately when this device has
  // already been unlocked, otherwise when the right passphrase is entered.
  function require() {
    const saved = stored();
    if (saved) {
      passphrase = saved;
      document.getElementById("gate").remove();
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const gate = document.getElementById("gate");
      const input = document.getElementById("gate-input");
      const button = document.getElementById("gate-enter");
      const error = document.getElementById("gate-error");

      gate.classList.remove("hidden");
      setTimeout(() => input.focus(), 100);

      async function attempt() {
        const entered = input.value.trim();
        if (!entered) return;

        button.disabled = true;
        const ok = (await sha256Hex(entered)) === HASH;
        button.disabled = false;

        if (!ok) {
          error.textContent = "That's not it — try again.";
          error.classList.remove("hidden");
          input.select();
          return;
        }

        remember(entered);
        gate.remove();
        resolve();
      }

      button.addEventListener("click", attempt);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          attempt();
        }
      });
      input.addEventListener("input", () => error.classList.add("hidden"));
    });
  }

  return { require, lock, passphrase: () => passphrase };
})();
