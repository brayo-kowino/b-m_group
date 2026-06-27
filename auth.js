import { auth, db } from './firebase.js';
import { signInWithEmailAndPassword, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const loginForm = document.getElementById('loginForm');
const errorMessageContainer = document.getElementById('errorMessage');
const errorText = document.querySelector('.error-text');
const submitBtn = document.getElementById('submitBtn');
const btnText = document.getElementById('btnText');
const btnIcon = document.getElementById('btnIcon');
const btnSpinner = document.getElementById('btnSpinner');
const forgotPasswordLink = document.getElementById('forgotPasswordLink');

function showError(message) {
    errorText.textContent = message;
    errorMessageContainer.classList.remove('hidden');
    errorMessageContainer.classList.add('flex'); 
}

function hideError() {
    errorMessageContainer.classList.add('hidden');
    errorMessageContainer.classList.remove('flex');
}

forgotPasswordLink.addEventListener('click', async (e) => {
    e.preventDefault();
    hideError();
    const email = document.getElementById('email').value.trim();
    
    if (!email) {
        showError("Please type your email address first, then click 'Forgot password?'.");
        return;
    }

    try {
        await sendPasswordResetEmail(auth, email);
        alert(`Password reset link sent to ${email}. Check your inbox.`);
    } catch (error) {
        console.error(error);
        if (error.code === 'auth/user-not-found') {
            showError("No account found with that email address.");
        } else {
            showError("Failed to send reset email. Please try again.");
        }
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    submitBtn.disabled = true;
    btnText.textContent = "Authenticating...";
    btnIcon.classList.add('hidden');
    btnSpinner.classList.remove('hidden');

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        const userDocRef = doc(db, "users", user.uid);
        const statsDocRef = doc(db, "groupStats", "main");

        const [userDoc, statsDoc] = await Promise.all([
            getDoc(userDocRef),
            getDoc(statsDocRef)
        ]);

        if (userDoc.exists()) {
            const userData = userDoc.data();
            const isAdmin = userData.role === 'admin';
            const isSystemLocked = statsDoc.exists() ? (statsDoc.data().maintenanceMode === true) : false;
            
            if (isSystemLocked && !isAdmin) {
                await signOut(auth);
                throw new Error("SYSTEM LOCKDOWN: The platform is currently under emergency maintenance. Please try again later.");
            }

            if(userData.status === 'suspended') {
                await signOut(auth);
                throw new Error("Your account has been suspended pending review.");
            }
            if(userData.status === 'exited') {
                await signOut(auth);
                throw new Error("Your account is marked as closed/exited.");
            }

            btnText.textContent = "Redirecting...";
            btnSpinner.classList.add('hidden');
            
            if (isAdmin) {
                window.location.href = '/admin';
            } else {
                window.location.href = '/member';
            }
        } else {
            await signOut(auth); 
            throw new Error("User profile not found in database.");
        }

    } catch (error) {

        submitBtn.disabled = false;
        btnText.textContent = "Access Portal";
        btnIcon.classList.remove('hidden');
        btnSpinner.classList.add('hidden');

        let friendlyMessage = "An unexpected error occurred. Please try again.";
        
        if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
            friendlyMessage = "Incorrect email or password.";
        } else if (error.code === 'auth/too-many-requests') {
            friendlyMessage = "Account temporarily locked due to multiple failed attempts. Reset your password or try again later.";
        } else if (error.code === 'auth/network-request-failed') {
            friendlyMessage = "Network error. Please check your internet connection.";
        } else if (error.message) {
            friendlyMessage = error.message;
        }

        showError(friendlyMessage);
    }
});