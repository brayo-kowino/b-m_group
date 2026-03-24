// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app-check.js";
//import { getFunctions } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-functions.js";

const firebaseConfig = {
    apiKey: "AIzaSyAX5J0R_MwxZ-H0nuDCgfKaodbuAz4H4dE",
    authDomain: "house-of-brian-odhiambo.firebaseapp.com",
    projectId: "house-of-brian-odhiambo",
    storageBucket: "house-of-brian-odhiambo.firebasestorage.app",
    messagingSenderId: "890978044880",
    appId: "1:890978044880:web:4d1ee9e8b189e38eb347d5",
    measurementId: "G-6QL4ZCZNHS"
  };
  

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// ==========================================
// APP CHECK ENVIRONMENT DETECTOR
// ==========================================

// Check if the app is running on the local computer
const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

if (isLocalhost) {
    // DEV MODE: Tell Firebase to use the debug token so you don't get blocked
    
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = "a7a119e2-6501-4276-858a-c552541b2959"; 
    console.log("Running Locally: App Check Debug Mode Enabled");
}

// Initialize App Check (This runs for both local and live, but acts differently based on the line above)
const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider('6LeJPZMsAAAAAMdX6Q0G7Y2KP1HkQisYRd440k2c'),
  isTokenAutoRefreshEnabled: true 
});

export const auth = getAuth(app);
export const db = getFirestore(app);
//export const functions = getFunctions(app);