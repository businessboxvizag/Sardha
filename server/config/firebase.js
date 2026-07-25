const admin = require("firebase-admin");
const path = require("path");

if (!admin.apps.length) {
  let serviceAccount;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    // Production: full JSON stored as an environment variable
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } else {
    // Local development: JSON file on disk
    serviceAccount = require(path.resolve(
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./firebase-service-account.json"
    ));
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.STORAGE_BUCKET || "sardha-b48f1.firebasestorage.app",
  });
}

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

module.exports = { admin, db };
