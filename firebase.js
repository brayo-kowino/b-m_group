// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

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
export const auth = getAuth(app);
export const db = getFirestore(app);