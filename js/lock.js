// Passphrase gate. Everything this app stores lives in this browser, so the
// gate's job is to stop someone who picks up an unlocked device from reading
// the log — not to defend a server, since there isn't one.
//
// The passphrase is never stored anywhere, in this file or on the device. Only
// its SHA-256 hash is compiled in, so the repo being public doesn't hand the
// passphrase to a reader. To change it, print a new hash and paste it below:
//
//   printf '%s' 'your new passphrase' | shasum -a 256
//
const Lock = (() => {
  const HASH = "0a00bf94b9234290c836681b92c5f70fbc5f3faba8e4fd3bb650286b8bb8dd99";
  const UNLOCKED_KEY = "migraine-log.unlocked";

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function isUnlocked() {
    try {
      return localStorage.getItem(UNLOCKED_KEY) === HASH;
    } catch {
      return false; // storage blocked — ask every time rather than failing open
    }
  }

  function remember() {
    try {
      localStorage.setItem(UNLOCKED_KEY, HASH);
    } catch {
      // Non-fatal: the session stays unlocked, the next launch asks again.
    }
  }

  function lock() {
    try {
      localStorage.removeItem(UNLOCKED_KEY);
    } catch {
      // Nothing to clear if storage is unavailable.
    }
    location.reload();
  }

  // Resolves once the app may show data: immediately when this device has
  // already been unlocked, otherwise when the right passphrase is entered.
  function require() {
    if (isUnlocked()) {
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

        remember();
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

  return { require, lock };
})();
