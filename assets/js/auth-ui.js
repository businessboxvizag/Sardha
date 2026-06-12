/* =====================================================================
 * Business Wheels — Auth UI helper
 * Renders a login/register screen before the main app.
 * Resolves with the authenticated user when done.
 * ===================================================================== */
(function (global) {
  "use strict";

  /**
   * Show the login screen for a given role.
   * @param {string} role  "customer" | "merchant" | "admin"
   * @returns {Promise<object>}  Resolves with user object on success.
   */
  async function requireLogin(role) {
    // Already logged in and matching role?
    if (BW.Auth.isLoggedIn()) {
      const user = BW.Auth.getUser();
      if (user && user.role === role) return user;
      // Wrong role — clear and re-authenticate
      BW.Auth.clearSession();
    }

    return new Promise((resolve) => {
      renderLoginScreen(role, resolve);
    });
  }

  function renderLoginScreen(role, resolve) {
    const roleLabel = { customer: "Customer", merchant: "Merchant", admin: "Admin" }[role];
    const root = document.getElementById("root");

    root.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card">
          <div class="auth-logo">🚚</div>
          <h2 class="auth-title">Business Wheels</h2>
          <p class="auth-sub" id="authSub">${roleLabel} sign in</p>

          <div class="field" id="nameField" style="display:none">
            <label>Full name</label>
            <input id="authName" type="text" placeholder="Your name" />
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

          ${role === "customer" ? `
            <p class="auth-toggle">
              <span id="authToggleText">Don't have an account?</span>
              <a href="#" id="authToggleLink">Register</a>
            </p>` : ""}

          <p class="auth-demo">
            <strong>Demo:</strong> ${
              role === "admin"    ? "admin@demo.bw / admin1234" :
              role === "merchant" ? "(use a registered merchant account)" :
              "srinivas@demo.bw / demo1234"
            }
          </p>
        </div>
      </div>
    `;

    let isRegister = false;

    const toggle = document.getElementById("authToggleLink");
    if (toggle) {
      toggle.addEventListener("click", (e) => {
        e.preventDefault();
        isRegister = !isRegister;
        document.getElementById("nameField").style.display  = isRegister ? "" : "none";
        document.getElementById("authToggleText").textContent = isRegister ? "Already have an account?" : "Don't have an account?";
        toggle.textContent = isRegister ? "Sign in" : "Register";
        document.getElementById("authSub").textContent = isRegister ? `${roleLabel} registration` : `${roleLabel} sign in`;
        document.getElementById("authSubmit").textContent = isRegister ? "Create account" : "Sign in";
        document.getElementById("authErr").textContent = "";
      });
    }

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
          data = await BW.register({ email, password, name, role });
        } else {
          data = await BW.login(email, password);
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
