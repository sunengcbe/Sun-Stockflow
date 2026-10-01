/* Connects to Firebase. Uses the settings in config.js. */

firebase.initializeApp(APP_CONFIG.firebase);

const auth = firebase.auth();
const db = firebase.firestore();
const FieldValue = firebase.firestore.FieldValue;
const Timestamp = firebase.firestore.Timestamp;

// Server time (not the phone/computer clock)
const SERVER_TS = () => FieldValue.serverTimestamp();
