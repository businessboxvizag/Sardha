/* =====================================================================
 * Business Wheels — Auth UI helper
 * Renders a login/register screen before the main app.
 * Supports Google Sign-In (Firebase popup) + email/password.
 * ===================================================================== */
(function (global) {
  "use strict";

  /* ── Firebase config ─────────────────────────────────────────── */
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAzl0mAALAy6D2l4y9h2Z0CQcn7Uo6uubo",
    authDomain: "businesswheels-9e9e9.firebaseapp.com",
    projectId: "businesswheels-9e9e9",
    storageBucket: "businesswheels-9e9e9.firebasestorage.app",
    messagingSenderId: "523805911607",
    appId: "1:523805911607:web:030e20b64c93decf5aedb2",
  };

  function getFirebaseAuth() {
    if (typeof firebase === "undefined") return null;
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    return firebase.auth();
  }

  /**
   * Show the login screen for a given role.
   * @param {string} role  "customer" | "merchant" | "admin"
   * @returns {Promise<object>}  Resolves with user object on success.
   */
  async function requireLogin(role) {
    if (BW.Auth.isLoggedIn()) {
      const user = BW.Auth.getUser();
      if (user && user.role === role) return user;
      BW.Auth.clearSession();
    }
    return new Promise((resolve) => renderLoginScreen(role, resolve));
  }

  function renderLoginScreen(role, resolve) {
    const roleLabel = { customer: "Customer", merchant: "Merchant", admin: "Admin", rider: "Rider" }[role] || role;
    const root = document.getElementById("root");

    const canSelfRegister = role === "customer" || role === "merchant";

    root.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card">
          <div class="auth-logo">🚚</div>
          <h2 class="auth-title">Business Wheels</h2>
          <p class="auth-sub" id="authSub">${roleLabel} sign in</p>

          ${role !== "admin" ? `<button class="btn google-btn" id="googleSignIn">
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" style="margin-right:8px;vertical-align:middle">
              <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
              <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/>
              <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
            </svg>
            Continue with Google
          </button>

          <div class="auth-divider"><span>or</span></div>` : ""}

          <div class="field" id="nameField" style="display:none">
            <label>Full name</label>
            <input id="authName" type="text" placeholder="Your name" />
          </div>

          <!-- Merchant-only: store location (shown during registration) -->
          <div id="merchantLocField" style="display:none">
            <div class="field">
              <label>Store location</label>
              <div style="display:flex;gap:8px;align-items:center">
                <button type="button" class="btn ghost sm" id="gpsLocBtn" style="white-space:nowrap">📍 Use my location</button>
                <span id="gpsStatus" class="muted small"></span>
              </div>
            </div>
          </div>

          <div class="field">
            <label>Email</label>
            <input id="authEmail" type="email" placeholder="you@example.com" />
          </div>
          <div class="field">
            <label>Password</label>
            <input id="authPassword" type="password" placeholder="••••••••" />
          </div>
          <div class="auth-err" id="authErr"></div>

          <button class="btn primary" id="authSubmit" style="width:100%">Sign in</button>

          ${canSelfRegister ? `
            <p class="auth-toggle">
              <span id="authToggleText">Don't have an account?</span>
              <a href="#" id="authToggleLink">Register</a>
            </p>` : ""}
        </div>
      </div>
    `;

    /* ── Google Sign-In ── */
    const googleBtn = document.getElementById("googleSignIn");
    if (googleBtn) googleBtn.addEventListener("click", async () => {
      const errEl = document.getElementById("authErr");
      errEl.textContent = "";
      const fbAuth = getFirebaseAuth();
      if (!fbAuth) {
        errEl.textContent = "Google Sign-In is not available. Please use email/password.";
        return;
      }
      const btn = document.getElementById("googleSignIn");
      btn.disabled = true;
      btn.textContent = "Signing in…";
      try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await fbAuth.signInWithPopup(provider);
        const idToken = await result.user.getIdToken();
        const data = await BW.loginWithGoogle(idToken, role);

        if (data.user.role !== role) {
          errEl.textContent = `This Google account is registered as '${data.user.role}', not '${role}'.`;
          btn.disabled = false;
          btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" style="margin-right:8px;vertical-align:middle"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/><path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg>Continue with Google`;
          return;
        }

        BW.Auth.setSession(data.token, data.user);
        resolve(data.user);
      } catch (err) {
        errEl.textContent = err.code === "auth/popup-closed-by-user"
          ? "Sign-in cancelled."
          : (err.message || "Google sign-in failed.");
        btn.disabled = false;
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" style="margin-right:8px;vertical-align:middle"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/><path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg>Continue with Google`;
      }
    });

    /* ── GPS location (merchant registration) ── */
    let _merchantLat = null, _merchantLng = null;
    const gpsBtn = document.getElementById("gpsLocBtn");
    if (gpsBtn) {
      gpsBtn.addEventListener("click", () => {
        const statusEl = document.getElementById("gpsStatus");
        if (!navigator.geolocation) { statusEl.textContent = "GPS not supported"; return; }
        gpsBtn.disabled = true;
        statusEl.textContent = "Acquiring…";
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            _merchantLat = pos.coords.latitude;
            _merchantLng = pos.coords.longitude;
            statusEl.textContent = `✅ ${_merchantLat.toFixed(5)}, ${_merchantLng.toFixed(5)}`;
            gpsBtn.textContent = "📍 Update";
            gpsBtn.disabled = false;
          },
          (err) => {
            statusEl.textContent = "⚠️ " + (err.code === 1 ? "Permission denied" : "GPS unavailable");
            gpsBtn.disabled = false;
          },
          { enableHighAccuracy: true, timeout: 12000 }
        );
      });
    }

    /* ── Toggle register/login ── */
    let isRegister = false;
    const toggle = document.getElementById("authToggleLink");
    if (toggle) {
      toggle.addEventListener("click", (e) => {
        e.preventDefault();
        isRegister = !isRegister;
        document.getElementById("nameField").style.display = isRegister ? "" : "none";
        // Merchant-only location field
        const locField = document.getElementById("merchantLocField");
        if (locField) locField.style.display = (isRegister && role === "merchant") ? "" : "none";
        document.getElementById("authToggleText").textContent = isRegister ? "Already have an account?" : "Don't have an account?";
        toggle.textContent = isRegister ? "Sign in" : "Register";
        document.getElementById("authSub").textContent = isRegister ? `${roleLabel} registration` : `${roleLabel} sign in`;
        document.getElementById("authSubmit").textContent = isRegister ? "Create account" : "Sign in";
        document.getElementById("authErr").textContent = "";
      });
    }

    /* ── Email/password submit ── */
    document.getElementById("authPassword").addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("authSubmit").click();
    });

    document.getElementById("authSubmit").addEventListener("click", async () => {
      const email    = document.getElementById("authEmail").value.trim();
      const password = document.getElementById("authPassword").value;
      const name     = document.getElementById("authName") ? document.getElementById("authName").value.trim() : "";
      const errEl    = document.getElementById("authErr");
      const btn      = document.getElementById("authSubmit");

      errEl.textContent = "";
      if (!email || !password) { errEl.textContent = "Email and password required."; return; }
      if (isRegister && !name) { errEl.textContent = "Name required."; return; }

      btn.disabled = true;
      btn.textContent = "Please wait…";

      try {
        let data;
        if (isRegister) {
          data = await BW.register({
            email, password, name, role,
            lat: _merchantLat, lng: _merchantLng,
          });
        } else {
          data = await BW.login(email, password, role);
        }

        if (data.user.role !== role) {
          errEl.textContent = `This account is registered as '${data.user.role}', not '${role}'.`;
          btn.disabled = false;
          btn.textContent = isRegister ? "Create account" : "Sign in";
          return;
        }

        BW.Auth.setSession(data.token, data.user);
        resolve(data.user);
      } catch (err) {
        errEl.textContent = err.message || "Authentication failed.";
        btn.disabled = false;
        btn.textContent = isRegister ? "Create account" : "Sign in";
      }
    });
  }

  global.BWAuth = { requireLogin };
})(window);
