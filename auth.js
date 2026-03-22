import { auth, db } from './firebase.js';
// Added sendPasswordResetEmail for the Forgot Password feature
import { signInWithEmailAndPassword, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Grab all the new UI elements
const loginForm = document.getElementById('loginForm');
const errorMessageContainer = document.getElementById('errorMessage');
const errorText = document.querySelector('.error-text');
const submitBtn = document.getElementById('submitBtn');
const btnText = document.getElementById('btnText');
const btnIcon = document.getElementById('btnIcon');
const btnSpinner = document.getElementById('btnSpinner');
const forgotPasswordLink = document.getElementById('forgotPasswordLink');

// --- Helper Functions for the UI ---
function showError(message) {
    errorText.textContent = message;
    errorMessageContainer.classList.remove('hidden');
    errorMessageContainer.classList.add('flex'); // Applies Tailwind flexbox
}

function hideError() {
    errorMessageContainer.classList.add('hidden');
    errorMessageContainer.classList.remove('flex');
}

// --- 1. Forgot Password Feature ---
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

// --- 2. Main Login Flow ---
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    // 🌟 MAKE IT SING: Trigger the Loading State
    submitBtn.disabled = true;
    btnText.textContent = "Authenticating...";
    btnIcon.classList.add('hidden');
    btnSpinner.classList.remove('hidden');

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Fetch user role from Firestore
        const userDocRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
            const userData = userDoc.data();
            
            // SECURITY: Check status before allowing entry
            if(userData.status === 'suspended') {
                await signOut(auth); // Boot them out of Firebase session
                throw new Error("Your account has been suspended pending review.");
            }

            // 🌟 MAKE IT SING: Success State before redirect
            btnText.textContent = "Redirecting...";
            btnSpinner.classList.add('hidden');
            
            // Route based on role
            if (userData.role === 'admin') {
                window.location.href = 'admin.html';
            } else {
                window.location.href = 'member.html';
            }
        } else {
            await signOut(auth); // Clean up broken auth states
            throw new Error("User profile not found in database.");
        }

    } catch (error) {
        // 🌟 MAKE IT SING: Revert UI state on failure
        submitBtn.disabled = false;
        btnText.textContent = "Access Portal";
        btnIcon.classList.remove('hidden');
        btnSpinner.classList.add('hidden');

        // Translate ugly Firebase errors into human text
        let friendlyMessage = "An unexpected error occurred. Please try again.";
        
        if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
            friendlyMessage = "Incorrect email or password.";
        } else if (error.code === 'auth/too-many-requests') {
            friendlyMessage = "Account temporarily locked due to multiple failed attempts. Reset your password or try again later.";
        } else if (error.code === 'auth/network-request-failed') {
            friendlyMessage = "Network error. Please check your internet connection.";
        } else if (error.message) {
            friendlyMessage = error.message; // Catches our custom "suspended" error
        }

        showError(friendlyMessage);
    }
});