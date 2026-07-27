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

  /* ── Google Sign-In (popup with mobile redirect fallback) ────── */
  async function doGoogleSignIn(role, resolve, btn, errEl) {
    errEl.textContent = "";
    const fbAuth = getFirebaseAuth();
    if (!fbAuth) { errEl.textContent = "Google Sign-In unavailable. Use email instead."; return; }
    btn.disabled = true; btn.innerHTML = `${GOOGLE_SVG}Signing in...`;
    const reset = () => { btn.disabled = false; btn.innerHTML = `${GOOGLE_SVG}Continue with Google`; };
    const REDIRECT_CODES = ["auth/popup-blocked","auth/operation-not-supported-in-this-environment","auth/cancelled-popup-request","auth/web-storage-unsupported"];
    try {
      const result = await fbAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
      const idToken = await result.user.getIdToken();
      const data = await BW.loginWithGoogle(idToken, role);
      if (data.user.role !== role) { errEl.textContent = `This Google account is registered as '${data.user.role}'. Use the ${data.user.role} portal.`; reset(); return; }
      BW.Auth.setSession(data.token, data.user);
      resolve(data.user);
    } catch (err) {
      if (err && REDIRECT_CODES.includes(err.code)) {
        try { await fbAuth.signInWithRedirect(new firebase.auth.GoogleAuthProvider()); return; }
        catch (e2) { errEl.textContent = (e2 && (e2.code ? e2.code + ": " + e2.message : e2.message)) || "Google sign-in failed."; reset(); return; }
      }
      if (err && err.code === "auth/popup-closed-by-user") errEl.textContent = "Sign-in cancelled.";
      else if (err && err.code === "auth/unauthorized-domain") errEl.textContent = "This domain isn't authorised in Firebase (Authentication → Settings → Authorized domains).";
      else errEl.textContent = (err && (err.code ? err.code + ": " + err.message : err.message)) || "Google sign-in failed.";
      reset();
    }
  }

  function renderLoginScreen(role, resolve) {
    const roleLabel = { customer: "Customer", merchant: "Merchant", admin: "Admin", rider: "Saradhi" }[role] || role;
    const canSelfRegister = role === "customer";   // only customers self-register
    const showGoogle = role === "customer";
    const root = document.getElementById("root");

    const EYE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
    const EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    const pwField = (id, ph, ac) =>
      `<div class="field"><label>Password</label>
        <div class="pw-wrap" style="position:relative">
          <input id="${id}" class="pw-input" type="password" placeholder="${ph}" autocomplete="${ac}" style="padding-right:44px;width:100%" />
          <button type="button" class="pw-eye" data-for="${id}" aria-label="Show password"
            style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--muted);padding:6px;display:flex;align-items:center">${EYE}</button>
        </div></div>`;

    root.innerHTML = `
      <div class="auth-wrap"><div class="auth-card">
        <img src="../assets/img/logo.png" alt="Saardha" class="auth-logo-img" />
        <p class="auth-sub" id="authSub">${canSelfRegister ? "Order from local shops, in minutes" : esc(roleLabel) + " portal"}</p>

        ${canSelfRegister ? `
        <div class="auth-tabs">
          <button type="button" id="tabLogin" class="auth-tab on">Log in</button>
          <button type="button" id="tabSignup" class="auth-tab">Sign up</button>
        </div>` : ""}

        ${showGoogle ? `
        <button class="btn google-btn" id="googleSignIn">${GOOGLE_SVG}Continue with Google</button>
        <div class="auth-divider"><span>or use email</span></div>` : ""}

        <div id="loginPane">
          <div class="field"><label>Email address</label>
            <input id="loginEmail" type="email" placeholder="you@example.com" autocomplete="email" /></div>
          ${pwField("loginPwd", "Enter password", "current-password")}
          <div class="auth-err" id="loginErr"></div>
          <button class="btn primary" id="loginBtn" style="width:100%">Log in</button>
          <a href="#" id="forgotLink" style="font-size:.8rem;color:var(--brand);display:block;margin-top:10px;text-align:right">Forgot password?</a>
        </div>

        ${canSelfRegister ? `
        <div id="signupPane" style="display:none">
          <div class="field"><label>Full name</label>
            <input id="suName" type="text" placeholder="Your name" autocomplete="name" /></div>
          <div class="field"><label>Email address</label>
            <input id="suEmail" type="email" placeholder="you@example.com" autocomplete="email" /></div>
          <div style="display:flex;gap:8px;align-items:center;margin:-4px 0 10px">
            <button type="button" class="btn ghost sm" id="sendEmailOtp">Send code</button>
            <span class="muted small" id="emailOtpStatus"></span>
          </div>
          <div class="field" id="emailOtpField" style="display:none">
            <input id="emailOtpInput" inputmode="numeric" maxlength="6" placeholder="6-digit email code" />
            <button type="button" class="btn ghost sm" id="verifyEmailOtp" style="margin-top:6px;width:100%">Verify email</button>
          </div>
          <div class="field"><label>Phone number <span class="muted small">(optional)</span></label>
            <input id="suPhone" type="tel" placeholder="+91 98765 43210" autocomplete="tel" /></div>
          <div style="display:flex;gap:8px;align-items:center;margin:-4px 0 10px">
            <button type="button" class="btn ghost sm" id="sendPhoneOtp">Verify phone</button>
            <span class="muted small" id="phoneOtpStatus"></span>
          </div>
          <div class="field" id="phoneOtpField" style="display:none">
            <input id="phoneOtpInput" inputmode="numeric" maxlength="6" placeholder="6-digit phone OTP" />
            <button type="button" class="btn ghost sm" id="verifyPhoneOtp" style="margin-top:6px;width:100%">Confirm OTP</button>
          </div>
          <div class="field"><label>Date of birth <span class="muted small">(optional)</span></label>
            <input id="suDob" type="date" /></div>
          <div class="field"><label>Gender <span class="muted small">(optional)</span></label>
            <select id="suGender">
              <option value="">Prefer not to say</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </select></div>
          ${pwField("suPwd", "Choose a password (min 6)", "new-password")}
          <div id="recaptcha-container"></div>
          <label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;color:var(--muted);margin:4px 0 12px;cursor:pointer">
            <input type="checkbox" id="suConsent" style="margin-top:2px;flex-shrink:0" />
            <span>I agree to Saardha's <a href="/privacy/" target="_blank" style="color:var(--brand)">Privacy Policy</a> and consent to my data being used to provide and improve the service.</span>
          </label>
          <div class="auth-err" id="suErr"></div>
          <button class="btn primary" id="signupBtn" style="width:100%">Create account</button>
        </div>` : ""}
      </div></div>`;

    // Password eye toggles
    root.querySelectorAll(".pw-eye").forEach((btn) => {
      btn.addEventListener("click", () => {
        const inp = document.getElementById(btn.dataset.for);
        if (!inp) return;
        const show = inp.type === "password";
        inp.type = show ? "text" : "password";
        btn.innerHTML = show ? EYE_OFF : EYE;
        btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
      });
    });

    // Login / Sign up tabs
    const loginPane = document.getElementById("loginPane");
    const signupPane = document.getElementById("signupPane");
    const tabLogin = document.getElementById("tabLogin");
    const tabSignup = document.getElementById("tabSignup");
    function showTab(which) {
      const login = which === "login";
      if (loginPane) loginPane.style.display = login ? "" : "none";
      if (signupPane) signupPane.style.display = login ? "none" : "";
      if (tabLogin) tabLogin.classList.toggle("on", login);
      if (tabSignup) tabSignup.classList.toggle("on", !login);
    }
    if (tabLogin) tabLogin.addEventListener("click", () => showTab("login"));
    if (tabSignup) tabSignup.addEventListener("click", () => showTab("signup"));

    // Google
    const googleBtn = document.getElementById("googleSignIn");
    if (googleBtn) googleBtn.addEventListener("click", () => doGoogleSignIn(role, resolve, googleBtn, document.getElementById("loginErr")));

    // Forgot password
    const forgot = document.getElementById("forgotLink");
    if (forgot) forgot.addEventListener("click", (e) => { e.preventDefault(); showForgotForm(role, document.getElementById("loginEmail").value.trim()); });

    // ── Login ──
    const loginBtn = document.getElementById("loginBtn");
    async function doLogin() {
      const email = document.getElementById("loginEmail").value.trim();
      const pwd = document.getElementById("loginPwd").value;
      const errEl = document.getElementById("loginErr");
      errEl.textContent = "";
      if (!email || !pwd) { errEl.textContent = "Enter your email and password."; return; }
      loginBtn.disabled = true; loginBtn.textContent = "Logging in…";
      try {
        const data = await BW.login(email, pwd, role);
        if (data.user.role !== role) { errEl.textContent = `This account belongs to the '${data.user.role}' portal.`; loginBtn.disabled = false; loginBtn.textContent = "Log in"; return; }
        BW.Auth.setSession(data.token, data.user);
        resolve(data.user);
      } catch (err) {
        const msg = (err && err.message) || "";
        errEl.innerHTML = /no account|not found|invalid cred|incorrect/i.test(msg)
          ? (canSelfRegister ? "No account or wrong password. New here? Tap <b>Sign up</b>." : "No account found. Contact your administrator.")
          : (msg || "Login failed. Check your details.");
        loginBtn.disabled = false; loginBtn.textContent = "Log in";
      }
    }
    loginBtn.addEventListener("click", doLogin);
    document.getElementById("loginPwd").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });

    // ── Sign up (customers) ──
    if (canSelfRegister) {
      let emailVerifyToken = null, phoneToken = null, phoneConfirmation = null, recaptcha = null;
      const formatE164 = (raw) => { let v = String(raw || "").replace(/[^\d+]/g, ""); if (!v) return ""; if (v[0] === "+") return v; if (v.length === 10) return "+91" + v; return "+" + v; };
      const eStat = () => document.getElementById("emailOtpStatus");
      const pStat = () => document.getElementById("phoneOtpStatus");

      document.getElementById("sendEmailOtp").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const email = document.getElementById("suEmail").value.trim();
        if (!/\S+@\S+\.\S+/.test(email)) { eStat().textContent = "Enter a valid email first."; return; }
        btn.disabled = true; eStat().textContent = "Sending…";
        try { await BW.sendEmailOtp(email); document.getElementById("emailOtpField").style.display = ""; eStat().textContent = "Code sent to " + email; }
        catch (err) { eStat().textContent = (err && err.message) || "Could not send code."; }
        finally { setTimeout(() => { btn.disabled = false; }, 3000); }
      });
      document.getElementById("verifyEmailOtp").addEventListener("click", async () => {
        const email = document.getElementById("suEmail").value.trim();
        const code = document.getElementById("emailOtpInput").value.trim();
        eStat().textContent = "Checking…";
        try {
          const r = await BW.verifyEmailOtp(email, code);
          emailVerifyToken = r.verifyToken;
          eStat().textContent = "✓ Email verified";
          document.getElementById("emailOtpInput").disabled = true;
          document.getElementById("verifyEmailOtp").disabled = true;
          document.getElementById("suEmail").disabled = true;
        } catch (err) { eStat().textContent = (err && err.message) || "Incorrect code."; }
      });

      document.getElementById("sendPhoneOtp").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const fbAuth = getFirebaseAuth();
        const phone = formatE164(document.getElementById("suPhone").value);
        if (!fbAuth) { pStat().textContent = "Phone verification unavailable."; return; }
        if (!phone || phone.length < 10) { pStat().textContent = "Enter a valid phone number."; return; }
        btn.disabled = true; pStat().textContent = "Sending OTP…";
        try {
          if (!recaptcha) recaptcha = new firebase.auth.RecaptchaVerifier("recaptcha-container", { size: "invisible" });
          phoneConfirmation = await fbAuth.signInWithPhoneNumber(phone, recaptcha);
          document.getElementById("phoneOtpField").style.display = "";
          pStat().textContent = "OTP sent to " + phone;
        } catch (err) {
          pStat().textContent = (err && (err.code || err.message)) || "Could not send OTP.";
          try { if (recaptcha) { recaptcha.clear(); recaptcha = null; } } catch (x) {}
        } finally { setTimeout(() => { btn.disabled = false; }, 3000); }
      });
      document.getElementById("verifyPhoneOtp").addEventListener("click", async () => {
        const code = document.getElementById("phoneOtpInput").value.trim();
        if (!phoneConfirmation) { pStat().textContent = "Send the OTP first."; return; }
        pStat().textContent = "Checking…";
        try {
          const cred = await phoneConfirmation.confirm(code);
          phoneToken = await cred.user.getIdToken();
          pStat().textContent = "✓ Phone verified";
          document.getElementById("phoneOtpInput").disabled = true;
          document.getElementById("verifyPhoneOtp").disabled = true;
          try { await getFirebaseAuth().signOut(); } catch (x) {}
        } catch (err) { pStat().textContent = (err && err.message) || "Incorrect OTP."; }
      });

      const signupBtn = document.getElementById("signupBtn");
      async function doSignup() {
        const name = document.getElementById("suName").value.trim();
        const email = document.getElementById("suEmail").value.trim();
        const pwd = document.getElementById("suPwd").value;
        const phone = formatE164(document.getElementById("suPhone").value);
        const dob = document.getElementById("suDob").value;
        const gender = document.getElementById("suGender").value;
        const consent = document.getElementById("suConsent").checked;
        const errEl = document.getElementById("suErr");
        errEl.textContent = "";
        if (!name) { errEl.textContent = "Please enter your full name."; return; }
        if (!/\S+@\S+\.\S+/.test(email)) { errEl.textContent = "Enter a valid email."; return; }
        if (!emailVerifyToken) { errEl.textContent = "Please verify your email with the code we sent."; return; }
        if (pwd.length < 6) { errEl.textContent = "Password must be at least 6 characters."; return; }
        if (!consent) { errEl.textContent = "Please accept the Privacy Policy to continue."; return; }
        signupBtn.disabled = true; signupBtn.textContent = "Creating account…";
        try {
          const data = await BW.register({ email, password: pwd, name, role, phone: phone || null, dob: dob || null, gender: gender || null, consent, emailVerifyToken, phoneToken });
          if (data.user.role !== role) { errEl.textContent = "This account belongs to another portal."; signupBtn.disabled = false; signupBtn.textContent = "Create account"; return; }
          BW.Auth.setSession(data.token, data.user);
          resolve(data.user);
        } catch (err) { errEl.textContent = (err && err.message) || "Could not create account."; signupBtn.disabled = false; signupBtn.textContent = "Create account"; }
      }
      signupBtn.addEventListener("click", doSignup);
      document.getElementById("suPwd").addEventListener("keydown", (e) => { if (e.key === "Enter") doSignup(); });
    }
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

    // Complete a Google redirect sign-in that bounced back to this page (mobile flow)
    const fbAuth = getFirebaseAuth();
    if (fbAuth && fbAuth.getRedirectResult) {
      try {
        const result = await fbAuth.getRedirectResult();
        if (result && result.user) {
          const idToken = await result.user.getIdToken();
          const data = await BW.loginWithGoogle(idToken, role);
          if (data && data.user && data.user.role === role) {
            BW.Auth.setSession(data.token, data.user);
            return data.user;
          }
        }
      } catch (e) { /* fall through to the login screen */ }
    }

    return new Promise((resolve) => renderLoginScreen(role, resolve));
  }

  global.BWAuth = { requireLogin };
})(window);
