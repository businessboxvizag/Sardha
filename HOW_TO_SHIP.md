# Saardha — How to ship a change (cheat-sheet)

The one-time setup (git, Firebase login, Render, CORS, domain, env vars) is **done**.
From now on, going live is just one or two commands. Run them in the project root
(`D:\saardha\Sardha_with_payments`) in a VS Code terminal.

---

## 1. Did you change the APPS? (the look, text, screens, features)
Files in: `customer/`, `merchant/`, `admin/`, `rider/`, `scan/`, `assets/`, or `index.html`

```
firebase deploy --only hosting
```
→ Live in about 1 minute at saardha.com. (Ignore the harmless "Assertion failed…UV_HANDLE_CLOSING" line.)

---

## 2. Did you change the SERVER? (order logic, payments, APIs)
Files in: the `server/` folder

```
git add -A
git commit -m "short note on what changed"
git push
```
→ Render automatically redeploys the backend in ~2–4 minutes.

---

## 3. Changed both? Run the commands from BOTH sections.

---

## Rule of thumb
- Look / text / screens / new app feature  → **frontend** → `firebase deploy --only hosting`
- Payments / orders / login / delivery fee / anything in `server/` → **backend** → `git add -A` + `git commit` + `git push`

## Safety notes
- **Never** commit `server/.env` or `server/firebase-service-account.json` — the `.gitignore` already blocks them. (After any change, a quick `git status` should never list those.)
- Test keys (`rzp_test_…`) = fake money. Switch to live keys (`rzp_live_…`) in Render only at real launch.
- Before touching things once you have real customers: test on `localhost` first, or ask for a Firebase **preview channel** (a temporary test URL that doesn't affect the live site).

## The workflow with Claude
1. You list the changes you want.
2. Claude edits the files directly in this folder.
3. Claude tells you: "frontend" or "backend" or "both".
4. You run the matching command(s) once for the whole batch.
