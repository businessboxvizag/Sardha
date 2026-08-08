/**
 * kycVerify.js — provider-agnostic online KYC verification hook.
 *
 * India's Aadhaar / Driving-Licence / Vehicle-RC checks must go through a licensed
 * KYC provider or DigiLocker (UIDAI does not allow arbitrary Aadhaar lookups). This
 * module keeps the app provider-neutral: point it at whatever provider you sign up
 * with (Signzy, IDfy, Cashfree, Karza/Perfios, Setu/DigiLocker, Digitap, …) by setting
 * two env vars, and the admin "Run online check" button starts working. Until then it
 * cleanly returns { status: "manual_required" } so the offline workflow is the source
 * of truth and nothing breaks.
 *
 * Env:
 *   KYC_PROVIDER_URL   base URL of your provider, e.g. https://api.provider.com/kyc
 *   KYC_PROVIDER_KEY   your API key / token
 *
 * Expected provider contract (adapt endpoints/field names to your provider in mapResult):
 *   POST {base}/dl       { number, dob }        -> { verified, name, validTill, ... }
 *   POST {base}/rc       { number }             -> { verified, owner, vehicleClass, ... }
 *   POST {base}/aadhaar  { number } (OTP flow)  -> { verified, name, ... }
 */

const BASE = (process.env.KYC_PROVIDER_URL || "").replace(/\/$/, "");
const KEY = process.env.KYC_PROVIDER_KEY || "";
const configured = !!(BASE && KEY);

function manual(reason) {
  return { status: "manual_required", verified: false, provider: null, reason: reason || "No KYC provider configured", checkedAt: new Date().toISOString() };
}

async function callProvider(path, payload) {
  if (!configured) return manual();
  try {
    const res = await fetch(BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { status: "failed", verified: false, provider: "configured", error: data.error || ("HTTP " + res.status), checkedAt: new Date().toISOString() };
    // Normalise — most providers return a `verified`/`valid` boolean plus fields.
    const verified = data.verified === true || data.valid === true || data.status === "VALID" || data.status === "SUCCESS";
    return { status: verified ? "verified" : "rejected", verified, provider: "configured", data, checkedAt: new Date().toISOString() };
  } catch (e) {
    return { status: "failed", verified: false, provider: "configured", error: (e && e.message) || "request failed", checkedAt: new Date().toISOString() };
  }
}

const isConfigured = () => configured;
const verifyDL      = ({ number, dob }) => callProvider("/dl", { number, dob });
const verifyRC      = ({ number })      => callProvider("/rc", { number });
const verifyAadhaar = ({ number })      => callProvider("/aadhaar", { number });

module.exports = { isConfigured, verifyDL, verifyRC, verifyAadhaar };
