/* =====================================================================
 * Saardha — Auth UI
 * Two-step email flow: enter email → check → sign in or sign up.
 * Google Sign-In available for all non-admin roles.
 * Requires Firebase compat SDK loaded before this script.
 * ===================================================================== */
(function (global) {
  "use strict";

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDXLGmS0x2KUl-HyeC8O_ffYC7XTrrs9ro",
    authDomain: "sardha-b48f1.firebaseapp.com",
    databaseURL: "https://sardha-b48f1-default-rtdb.firebaseio.com",
    projectId: "sardha-b48f1",
    storageBucket: "sardha-b48f1.firebasestorage.app",
    messagingSenderId: "218182475689",
    appId: "1:218182475689:web:497dddcab11aed50e0aeb8",
    measurementId: "G-TXK9W3VVLK",
  };

  function getFirebaseAuth() {
    if (typeof firebase === "undefined") return null;
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      return firebase.auth();
    } catch { return null; }
  }

  const GOOGLE_SVG = `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;margin-right:10px">
    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
    <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/>
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
  </svg>`;

  // Minimal HTML escaper for use in template literals (defence-in-depth)
  function esc(s) {
    return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function renderLoginScreen(role, resolve) {
    const roleLabel = { customer: "Customer", merchant: "Merchant", admin: "Admin", rider: "Saradhi" }[role] || role;
    // Only customers can self-register. Merchants/riders are created by admin.
    const canSelfRegister = role === "customer";
    // Google Sign-In only for customers (merchants use admin-set credentials)
    const showGoogle = role === "customer";
    const root = document.getElementById("root");

    root.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card">
          <img src="../assets/img/logo.png" alt="Saardha" class="auth-logo-img" />
          <p class="auth-sub" id="authSub">${esc(roleLabel)} portal</p>

          ${showGoogle ? `
          <button class="btn google-btn" id="googleSignIn">
            ${GOOGLE_SVG}Continue with Google
          </button>
          <div class="auth-divider"><span>or sign in with email</span></div>` : ""}

          <div id="stepEmail">
            <div class="field">
              <label>Email address</label>
              <input id="authEmail" type="email" placeholder="you@example.com" autocomplete="email" />
            </div>
            <div class="auth-err" id="authErr1"></div>
            <button class="btn primary" id="authContinue" style="width:100%">Continue</button>
          </div>

          <div id="stepCreds" style="display:none">
            <p class="auth-greet" id="authGreet"></p>

            <div class="field" id="nameField" style="display:none">
              <label>Full name</label>
              <input id="authName" type="text" placeholder="Your name" autocomplete="name" />
            </div>

            ${role === "merchant" ? `
            <div id="merchantLocField" style="display:none">
              <div class="field">
                <label>Store location <span class="muted small">(optional)</span></label>
                <div style="display:flex;gap:8px;align-items:center">
                  <button type="button" class="btn ghost sm" id="gpsLocBtn">Use my location</button>
                  <span id="gpsStatus" class="muted small"></span>
                </div>
              </div>
            </div>` : ""}

            <div class="field">
              <label id="pwdLabel">Password</label>
              <input id="authPassword" type="password" placeholder="Enter password" autocomplete="current-password" />
            </div>

            <div class="auth-err" id="authErr2"></div>
            <button class="btn primary" id="authSubmit" style="width:100%">Sign in</button>
            <button type="button" class="btn ghost" id="authBack" style="width:100%;margin-top:8px">Back</button>
          </div>
        </div>
      </div>
    `;

    let isNewUser = false;
    let capturedEmail = "";
    let _merchantLat = null;
    let _merchantLng = null;

    /* ── Google Sign-In ── */
    const googleBtn = document.getElementById("googleSignIn");
    if (googleBtn) {
      googleBtn.addEventListener("click", async () => {
        const errEl = document.getElementById("authErr1");
        errEl.textContent = "";
        const fbAuth = getFirebaseAuth();
        if (!fbAuth) {
          errEl.textContent = "Google Sign-In unavailable. Use email and password.";
          return;
        }
        googleBtn.disabled = true;
        googleBtn.innerHTML = `${GOOGLE_SVG}Signing in...`;
        try {
          const provider = new firebase.auth.GoogleAuthProvider();
          const result = await fbAuth.signInWithPopup(provider);
          const idToken = await result.user.getIdToken();
          const data = await BW.loginWithGoogle(idToken, role);

          if (data.user.role !== role) {
            errEl.textContent = `This Google account is registered as '${data.user.role}'. Please use the ${data.user.role} portal.`;
            googleBtn.disabled = false;
            googleBtn.innerHTML = `${GOOGLE_SVG}Continue with Google`;
            return;
          }
          BW.Auth.setSession(data.token, data.user);
          resolve(data.user);
        } catch (err) {
          errEl.textContent = err.code === "auth/popup-closed-by-user"
            ? "Sign-in cancelled."
            : (err.message || "Google sign-in failed.");
          googleBtn.disabled = false;
          googleBtn.innerHTML = `${GOOGLE_SVG}Continue with Google`;
        }
      });
    }

    /* ── GPS button (merchant registration) ── */
    const gpsBtn = document.getElementById("gpsLocBtn");
    if (gpsBtn) {
      gpsBtn.addEventListener("click", () => {
        const statusEl = document.getElementById("gpsStatus");
        if (!navigator.geolocation) { statusEl.textContent = "GPS not supported"; return; }
        gpsBtn.disabled = true;
        statusEl.textContent = "Acquiring location...";
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            _merchantLat = pos.coords.latitude;
            _merchantLng = pos.coords.longitude;
            statusEl.textContent = `Located (${_merchantLat.toFixed(4)}, ${_merchantLng.toFixed(4)})`;
            gpsBtn.textContent = "Update location";
            gpsBtn.disabled = false;
          },
          (err) => {
            statusEl.textContent = err.code === 1 ? "Permission denied" : "GPS unavailable";
            gpsBtn.disabled = false;
          },
          { enableHighAccuracy: true, timeout: 12000 }
        );
      });
    }

    /* ── Step 1: Continue (check email exists) ── */
    const continueBtn = document.getElementById("authContinue");
    const emailInput  = document.getElementById("authEmail");

    async function handleContinue() {
      const email = emailInput.value.trim();
      const errEl = document.getElementById("authErr1");
      errEl.textContent = "";
      if (!email || !/\S+@\S+\.\S+/.test(email)) {
        errEl.textContent = "Enter a valid email address.";
        return;
      }

      continueBtn.disabled = true;
      continueBtn.textContent = "Checking...";

      try {
        const result = await BW.checkEmail(email, role);
        capturedEmail = email;

        document.getElementById("stepEmail").style.display = "none";
        document.getElementById("stepCreds").style.display = "";

        if (result.exists) {
          isNewUser = false;
          if (result.authProvider === "google") {
            document.getElementById("authGreet").textContent = "";
            document.getElementById("authErr2").textContent =
              "This account uses Google Sign-In. Please use the Google button above.";
            document.getElementById("authSubmit").style.display = "none";
            document.getElementById("authPassword").closest(".field").style.display = "none";
          } else {
            document.getElementById("authGreet").textContent = result.name
              ? `Welcome back, ${result.name.split(" ")[0]}`
              : "Welcome back";
            document.getElementById("authSub").textContent = `${roleLabel} sign in`;
          }
        } else if (canSelfRegister) {
          isNewUser = true;
          document.getElementById("authGreet").textContent = "Create your account";
          document.getElementById("nameField").style.display = "";
          document.getElementById("authSubmit").textContent = "Create account";
          document.getElementById("authSub").textContent = `New ${roleLabel} account`;
          document.getElementById("pwdLabel").textContent = "Choose a password";
          document.getElementById("authPassword").setAttribute("autocomplete", "new-password");
          const locField = document.getElementById("merchantLocField");
          if (locField) locField.style.display = "";
        } else {
          document.getElementById("stepCreds").style.display = "none";
          document.getElementById("stepEmail").style.display = "";
          errEl.textContent = role === "merchant"
            ? "No merchant account found for this email. Contact the admin to create your store account."
            : "No account found. Contact your administrator.";
        }
      } catch (err) {
        const msg = err && err.message;
        errEl.textContent = (!msg || msg === "Failed to fetch")
          ? "Cannot reach server. Please try again in a moment."
          : msg;
      } finally {
        continueBtn.disabled = false;
        continueBtn.textContent = "Continue";
      }
    }

    continueBtn.addEventListener("click", handleContinue);
    emailInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleContinue(); });

    /* ── Back button ── */
    document.getElementById("authBack").addEventListener("click", () => {
      document.getElementById("stepCreds").style.display = "none";
      document.getElementById("stepEmail").style.display = "";
      document.getElementById("authErr2").textContent = "";
      const submitBtn = document.getElementById("authSubmit");
      submitBtn.style.display = "";
      submitBtn.textContent = "Sign in";
      document.getElementById("authPassword").closest(".field").style.display = "";
      document.getElementById("nameField").style.display = "none";
      const locField = document.getElementById("merchantLocField");
      if (locField) locField.style.display = "none";
      isNewUser = false;
    });

    /* ── Step 2: Submit ── */
    const submitBtn = document.getElementById("authSubmit");
    submitBtn.addEventListener("click", async () => {
      const password = document.getElementById("authPassword").value;
      const nameEl   = document.getElementById("authName");
      const name     = nameEl ? nameEl.value.trim() : "";
      const errEl    = document.getElementById("authErr2");

      errEl.textContent = "";
      if (!password) { errEl.textContent = "Password is required."; return; }
      if (isNewUser && !name) { errEl.textContent = "Please enter your full name."; return; }

      submitBtn.disabled = true;
      submitBtn.textContent = "Please wait...";

      try {
        let data;
        if (isNewUser) {
          data = await BW.register({
            email: capturedEmail, password, name, role,
            lat: _merchantLat, lng: _merchantLng,
          });
        } else {
          data = await BW.login(capturedEmail, password, role);
        }

        if (data.user.role !== role) {
          errEl.textContent = `This account belongs to the '${data.user.role}' portal.`;
          submitBtn.disabled = false;
          submitBtn.textContent = isNewUser ? "Create account" : "Sign in";
          return;
        }

        BW.Auth.setSession(data.token, data.user);
        resolve(data.user);
      } catch (err) {
        errEl.textContent = err.message || "Authentication failed. Please try again.";
        submitBtn.disabled = false;
        submitBtn.textContent = isNewUser ? "Create account" : "Sign in";
      }
    });

    document.getElementById("authPassword").addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitBtn.click();
    });

    /* ── "Forgot password?" link — injected below password field ── */
    const pwdField = document.getElementById("authPassword").closest(".field");
    const forgotLink = document.createElement("a");
    forgotLink.href = "#";
    forgotLink.textContent = "Forgot password?";
    forgotLink.style.cssText = "font-size:.8rem;color:var(--brand);display:block;margin-top:4px;text-align:right";
    forgotLink.addEventListener("click", (e) => {
      e.preventDefault();
      showForgotForm(role, capturedEmail || document.getElementById("authEmail").value.trim());
    });
    pwdField.after(forgotLink);
  }

  /* ── Forgot-password screen ─────────────────────────────────── */
  function showForgotForm(role, prefillEmail = "") {
    const root = document.getElementById("root");
    root.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card">
          <div class="auth-brand-mark">S</div>
          <h2 class="auth-title">Reset password</h2>
          <p class="auth-sub">We'll send a reset link to your email</p>
          <div class="field">
            <label>Email address</label>
            <input id="fpEmail" type="email" value="${esc(prefillEmail)}" placeholder="you@example.com" autocomplete="email" />
          </div>
          <div class="auth-err" id="fpErr"></div>
          <button class="btn primary" id="fpSend" style="width:100%">Send reset link</button>
          <button class="btn ghost" id="fpBack" style="width:100%;margin-top:8px">Back to sign in</button>
        </div>
      </div>`;

    document.getElementById("fpBack").addEventListener("click", () => {
      BWAuth.requireLogin(role);
    });

    const sendBtn = document.getElementById("fpSend");
    sendBtn.addEventListener("click", async () => {
      const email = document.getElementById("fpEmail").value.trim();
      const errEl = document.getElementById("fpErr");
      errEl.textContent = "";
      if (!email) { errEl.textContent = "Enter your email address."; return; }

      sendBtn.disabled = true;
      sendBtn.textContent = "Sending...";

      try {
        await fetch((window.BW_API_BASE || "http://localhost:3000") + "/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, role }),
        });
        root.innerHTML = `
          <div class="auth-wrap">
            <div class="auth-card" style="text-align:center">
              <div class="auth-brand-mark">✓</div>
              <h2 class="auth-title">Check your email</h2>
              <p class="auth-sub">If <strong>${esc(email)}</strong> is registered, a reset link has been sent. Check your inbox (and spam folder).</p>
              <button class="btn primary" style="width:100%;margin-top:16px" onclick="BWAuth.requireLogin('${esc(role)}')">Back to sign in</button>
            </div>
          </div>`;
      } catch {
        sendBtn.disabled = false;
        sendBtn.textContent = "Send reset link";
        document.getElementById("fpErr").textContent = "Could not reach server. Please try again.";
      }
    });
  }

  /* ── Reset-password screen (shown when ?reset_token= is in URL) ── */
  function showResetForm(token) {
    const root = document.getElementById("root");
    root.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card">
          <div class="auth-brand-mark">S</div>
          <h2 class="auth-title">New password</h2>
          <p class="auth-sub">Choose a strong password (min. 8 characters)</p>
          <div class="field">
            <label>New password</label>
            <input id="rpPwd" type="password" placeholder="New password" autocomplete="new-password" />
          </div>
          <div class="field">
            <label>Confirm password</label>
            <input id="rpPwd2" type="password" placeholder="Confirm password" autocomplete="new-password" />
          </div>
          <div class="auth-err" id="rpErr"></div>
          <button class="btn primary" id="rpSubmit" style="width:100%">Set new password</button>
        </div>
      </div>`;

    const submitBtn = document.getElementById("rpSubmit");
    submitBtn.addEventListener("click", async () => {
      const pwd  = document.getElementById("rpPwd").value;
      const pwd2 = document.getElementById("rpPwd2").value;
      const errEl = document.getElementById("rpErr");
      errEl.textContent = "";

      if (pwd.length < 8)   { errEl.textContent = "Password must be at least 8 characters."; return; }
      if (pwd !== pwd2)     { errEl.textContent = "Passwords do not match."; return; }

      submitBtn.disabled = true;
      submitBtn.textContent = "Saving...";

      try {
        const res  = await fetch((window.BW_API_BASE || "http://localhost:3000") + "/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, newPassword: pwd }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Reset failed");

        // Clear the token from URL without reloading
        history.replaceState({}, "", location.pathname);

        root.innerHTML = `
          <div class="auth-wrap">
            <div class="auth-card" style="text-align:center">
              <div class="auth-brand-mark">✓</div>
              <h2 class="auth-title">Password updated</h2>
              <p class="auth-sub">You can now sign in with your new password.</p>
              <button class="btn primary" style="width:100%;margin-top:16px" onclick="location.reload()">Sign in</button>
            </div>
          </div>`;
      } catch (err) {
        errEl.textContent = err.message || "Reset failed. The link may have expired.";
        submitBtn.disabled = false;
        submitBtn.textContent = "Set new password";
      }
    });
  }

  /* ── Entry point ────────────────────────────────────────────── */
  async function requireLogin(role) {
    // Check for ?reset_token= in the URL first
    const params = new URLSearchParams(location.search);
    const resetToken = params.get("reset_token");
    if (resetToken) {
      showResetForm(resetToken);
      return new Promise(() => {}); // hold — page will reload on success
    }

    if (BW.Auth.isLoggedIn()) {
      const user = BW.Auth.getUser();
      if (user && user.role === role) return user;
      BW.Auth.clearSession();
    }
    return new Promise((resolve) => renderLoginScreen(role, resolve));
  }

  global.BWAuth = { requireLogin };
})(window);
