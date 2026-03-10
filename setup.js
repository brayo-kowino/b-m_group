import { auth, db } from './firebase.js';
import { createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// --- STEP 1: Initialize Database Stats ---
const initDbBtn = document.getElementById('initDbBtn');
const dbStatus = document.getElementById('dbStatus');

initDbBtn.addEventListener('click', async () => {
    initDbBtn.disabled = true;
    initDbBtn.textContent = "Initializing...";

    try {
        // Create the "main" document in the "groupStats" collection
        await setDoc(doc(db, "groupStats", "main"), {
            capital: 0,
            totalLoans: 0,
            liquidityReserve: 0,
            totalProfit: 0,
            lastDistributionDate: serverTimestamp()
        });
        
        dbStatus.classList.remove('hidden');
        initDbBtn.textContent = "Done";
    } catch (error) {
        console.error("Error initializing DB: ", error);
        alert("Failed to initialize database. Check console for details.");
        initDbBtn.disabled = false;
        initDbBtn.textContent = "Initialize Master Stats";
    }
});

// --- STEP 2: Create Admin Users ---
const adminForm = document.getElementById('adminForm');
const adminError = document.getElementById('adminError');
const adminSuccess = document.getElementById('adminSuccess');

adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    adminError.classList.add('hidden');
    adminSuccess.classList.add('hidden');
    
    const name = document.getElementById('adminName').value;
    const email = document.getElementById('adminEmail').value;
    const password = document.getElementById('adminPassword').value;

    const submitBtn = adminForm.querySelector('button');
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating...";

    try {
        // 1. Create user in Firebase Authentication
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // 2. Create the user's detailed profile in Firestore using their new UID
        // Assigning them executive authority as founders 
        await setDoc(doc(db, "users", user.uid), {
            name: name,
            email: email,
            role: "admin", 
            status: "approved", // Instantly approved
            verified: true,     // Instantly verified
            savings: 0,
            loansActive: 0,
            joinedAt: serverTimestamp()
        });

        // 3. Sign the user out immediately so you can create the next founder
        await signOut(auth);

        adminSuccess.classList.remove('hidden');
        adminForm.reset();

    } catch (error) {
        console.error("Error creating admin: ", error);
        adminError.textContent = error.message;
        adminError.classList.remove('hidden');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Admin Profile";
    }
});