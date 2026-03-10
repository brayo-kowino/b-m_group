import { auth, db } from './firebase.js';
import { doc, getDoc, collection, addDoc, serverTimestamp, query, where, getDocs, Timestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { orderBy } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

let currentUserData = null;

onAuthStateChanged(auth, async (user) => {
    if (user) {
        await loadUserData(user.uid);
    } else {
        window.location.href = 'login.html';
    }
});

      // ==========================================
// NEW FEATURE LOGIC: LEDGER, SUPPORT & EXIT
// ==========================================

// --- 1. Load Personal Ledger ---
async function loadMyLedger(uid) {
    const tableBody = document.getElementById('myLedgerBody');
    tableBody.innerHTML = '<tr><td colspan="4" class="p-3 text-center text-slate-500">Loading records...</td></tr>';

    try {
        const q = query(
            collection(db, "transactions"),
            where("userId", "==", uid),
            orderBy("createdAt", "desc") // Show newest first
        );
        const snapshot = await getDocs(q);
        tableBody.innerHTML = '';

        if (snapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="4" class="p-3 text-center text-slate-500">No transaction history found.</td></tr>';
            return;
        }

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const dateStr = data.createdAt ? data.createdAt.toDate().toLocaleDateString() : 'Pending';
            
            // Color code the transaction type
            let typeStyle = 'text-slate-600';
            if (data.type === 'deposit') typeStyle = 'text-green-600 font-medium';
            if (data.type === 'loan') typeStyle = 'text-blue-600 font-medium';
            if (data.type === 'repayment') typeStyle = 'text-purple-600 font-medium';
            if (data.type === 'penalty') typeStyle = 'text-red-600 font-medium';

            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="p-3 text-slate-700">${dateStr}</td>
                <td class="p-3 capitalize ${typeStyle}">${data.type.replace('_', ' ')}</td>
                <td class="p-3 font-semibold">KSH ${data.amount}</td>
                <td class="p-3"><span class="bg-slate-100 text-slate-700 px-2 py-1 rounded text-xs uppercase">${data.status}</span></td>
            `;
            tableBody.appendChild(row);
        });
    } catch (error) {
        console.error("Error loading ledger:", error);
        tableBody.innerHTML = '<tr><td colspan="4" class="p-3 text-center text-red-500">Requires index creation. Check console.</td></tr>';
    }
}

// Call this inside your loadUserData function right after updating the UI!
// Just add this line inside loadUserData: await loadMyLedger(uid);

// --- 2. Grievance / Support Form ---
document.getElementById('grievanceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const text = document.getElementById('grievanceText').value;

    btn.disabled = true;
    btn.textContent = "Sending...";

    try {
        await addDoc(collection(db, "messages"), {
            userId: auth.currentUser.uid,
            type: "grievance",
            message: text,
            status: "unread",
            createdAt: serverTimestamp()
        });
        alert("Your message has been securely sent to the administrators.");
        e.target.reset();
    } catch (error) {
        alert("Failed to send message.");
        console.error(error);
    } finally {
        btn.disabled = false;
        btn.textContent = "Send to Admins";
    }
});

// --- 3. Constitution-Compliant Exit Strategy ---
document.getElementById('exitForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorDiv = document.getElementById('exitError');
    errorDiv.classList.add('hidden');

    const exitType = document.getElementById('exitType').value;
    const exitReason = document.getElementById('exitReason').value;

    // RULE ENFORCEMENT: Sec 13.1 - Member must clear all loans before voluntary exit
    if (exitType === 'voluntary') {
        // Query to check if they have any un-repaid loans
        const loansQuery = query(
            collection(db, "loans"),
            where("userId", "==", auth.currentUser.uid),
            where("status", "in", ["pending", "approved"]) // Unpaid states
        );
        const loansSnap = await getDocs(loansQuery);

        if (!loansSnap.empty) {
            errorDiv.innerHTML = "<strong>Exit Blocked:</strong> Constitution Sec 13.1 dictates all loans must be cleared prior to a voluntary exit.";
            errorDiv.classList.remove('hidden');
            return;
        }
    }

    if (!confirm(`Are you absolutely sure you want to submit a formal request for a ${exitType} withdrawal?`)) return;

    const btn = document.getElementById('exitSubmitBtn');
    btn.disabled = true;
    btn.textContent = "Processing...";

    try {
        // Log the exit request into an admin queue
        await addDoc(collection(db, "exitRequests"), {
            userId: auth.currentUser.uid,
            type: exitType,
            reason: exitReason,
            status: "pending_review",
            createdAt: serverTimestamp()
        });
        
        alert("Official exit request submitted. The founders will review this application shortly.");
        e.target.reset();
    } catch (error) {
        errorDiv.textContent = "System error processing exit request.";
        errorDiv.classList.remove('hidden');
        console.error(error);
    } finally {
        btn.disabled = false;
        btn.textContent = "Submit Official Exit Request";
    }
});

// Logout Logic
document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
});

// Helper: Calculate Target
function getMonthlyTarget() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); 
    const monthName = now.toLocaleString('default', { month: 'long' });
    
    const daysInMonth = new Date(year, month + 1, 0).getDate(); 
    const fullWeeks = Math.floor(daysInMonth / 7);
    const extraDays = daysInMonth % 7;
    
    const target = (fullWeeks * 70) + (extraDays * 10);
    return { target, monthName, year, month };
}

// Helper: Get 1st of month
function getStartOfMonth() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
}

async function loadUserData(uid) {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
        currentUserData = userSnap.data();
        
        // 1. Basic UI Updates
        document.getElementById('memberName').textContent = currentUserData.name;
        document.getElementById('mySavings').textContent = `KSH ${currentUserData.savings}`;
        
        const limit = currentUserData.savings >= 500 ? currentUserData.savings * 2 : 0;
        document.getElementById('myLoanLimit').textContent = `KSH ${limit}`;

        if (currentUserData.role === 'admin') {
            document.getElementById('adminReturnBtn').classList.remove('hidden');
        }

        // 2. Fetch Admin Announcements
        try {
            const statsRef = doc(db, "groupStats", "main");
            const statsSnap = await getDoc(statsRef);
            if (statsSnap.exists() && statsSnap.data().announcement) {
                document.getElementById('alertMessage').textContent = statsSnap.data().announcement;
                document.getElementById('systemAlert').classList.remove('hidden');
            }
        } catch(e) { console.error("Could not load announcements", e); }

        // Check for Personal Positive Updates (Green Banner)
        const personalInfoBanner = document.getElementById('personalInfoBanner');
        if (currentUserData.infoMessage) {
            document.getElementById('infoMessageText').textContent = currentUserData.infoMessage;
            personalInfoBanner.classList.remove('hidden');
        } else {
            if(personalInfoBanner) personalInfoBanner.classList.add('hidden');
        }

        await loadMyLedger(uid);

        // 3. Load Monthly Progress (Waterfall Algorithm)
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        
        let remaining = currentUserData.savings || 0;
        let unclearedPastMonths = [];
        let timelineHTML = '';
        
        // Variables to hold the current month's math for the warning engine
        let currentMonthAllocated = 0;
        let currentMonthTarget = 0;

        for (let i = 0; i <= currentMonth; i++) {
            const daysInMonth = new Date(currentYear, i + 1, 0).getDate(); 
            const target = (Math.floor(daysInMonth / 7) * 70) + ((daysInMonth % 7) * 10);
            const monthName = new Date(currentYear, i, 1).toLocaleString('default', { month: 'short' });
            
            let statusBadge = '';
            let allocated = 0;

            if (remaining >= target) {
                allocated = target;
                remaining -= target;
                statusBadge = `<span class="bg-green-100 text-green-700 border border-green-200 px-2 py-0.5 rounded text-xs font-bold">Cleared</span>`;
            } else {
                allocated = remaining;
                remaining = 0;
                
                if (i === currentMonth) {
                    statusBadge = `<span class="bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-xs font-bold">In Progress</span>`;
                } else {
                    statusBadge = `<span class="bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 rounded text-xs font-bold">Pending</span>`;
                    unclearedPastMonths.push(monthName);
                }
            }

            // Build Timeline Card for UI
            timelineHTML += `
                <div class="border border-slate-200 rounded-md p-3 bg-slate-50 text-center flex flex-col items-center justify-center">
                    <span class="text-sm font-bold text-slate-800 mb-1">${monthName}</span>
                    <span class="text-xs text-slate-500 mb-2">${allocated} / ${target}</span>
                    ${statusBadge}
                </div>
            `;

            // If this is the current month, update the main progress bar and save vars for warnings
            if (i === currentMonth) {
                currentMonthAllocated = allocated;
                currentMonthTarget = target;
                
                document.getElementById('monthTitle').textContent = `${monthName} Target Progress`;
                let progressPercentage = (allocated / target) * 100;
                if (progressPercentage > 100) progressPercentage = 100;

                const progressBar = document.getElementById('monthlyProgressBar');
                progressBar.style.width = `${progressPercentage}%`;
                
                if (progressPercentage === 100) progressBar.classList.replace('bg-blue-500', 'bg-green-500');
                if (progressPercentage === 0) progressBar.classList.replace('bg-blue-500', 'bg-slate-300');

                document.getElementById('monthlyText').textContent = `${allocated} / ${target} KSH`;
                
                const statusText = document.getElementById('monthlyStatusText');
                if (allocated >= target) {
                    statusText.innerHTML = "✅ <strong>Awesome!</strong> You have successfully met your contribution target for this month.";
                    statusText.classList.replace('text-slate-500', 'text-green-600');
                } else {
                    const diff = target - allocated;
                    statusText.innerHTML = `You need <strong>KSH ${diff}</strong> more to hit the target. Remember, discipline before access.`;
                }
            }
        }

        document.getElementById('clearanceTimeline').innerHTML = timelineHTML;

        // 4. The Smart Warning Engine
        const alertsList = document.getElementById('alertsList');
        const personalAlertsBanner = document.getElementById('personalAlertsBanner');
        let hasWarnings = false;
        alertsList.innerHTML = ''; 

        // A. Check for uncleared past months
        if (unclearedPastMonths.length > 0) {
            alertsList.innerHTML += `<li><strong>Arrears Detected:</strong> You have uncleared targets for <strong>${unclearedPastMonths.join(', ')}</strong>. As mandated by the admins, all prior balances must be fully cleared before June.</li>`;
            hasWarnings = true;
        }

        const today = new Date().getDate();

        // B. Check for Admin Manual Warning
        if (currentUserData.warningMessage) {
            alertsList.innerHTML += `<li><strong>Admin Note:</strong> ${currentUserData.warningMessage}</li>`;
            hasWarnings = true;
        }

        // C. Check Account Status Restrictions
        if (currentUserData.status === 'restricted') {
            alertsList.innerHTML += `<li>Your account has been restricted. You cannot access credit facilities at this time.</li>`;
            hasWarnings = true;
        } else if (currentUserData.status === 'suspended') {
            alertsList.innerHTML += `<li>Your account is currently suspended pending administrative review.</li>`;
            hasWarnings = true;
        }

        // D. Automated Contribution Warnings (Discipline Check using Waterfall Math)
        if (currentUserData.status === 'approved') {
            // If it's past the 7th of the month and they haven't deposited anything towards this month
            if (today > 7 && currentMonthAllocated === 0) {
                alertsList.innerHTML += `<li>You have missed the first weekly contribution deadline. Please deposit KSH 70 immediately.</li>`;
                hasWarnings = true;
            }
            
            // If it's nearing the end of the month (past the 21st) and they are behind target
            if (today > 21 && currentMonthAllocated < currentMonthTarget) {
                const deficit = currentMonthTarget - currentMonthAllocated;
                alertsList.innerHTML += `<li><strong>Approaching Deadline:</strong> The month is ending soon. You are short KSH ${deficit}. Clear this to maintain good standing.</li>`;
                hasWarnings = true;
            }
        }

        // Display the banner if any rules were triggered
        if (hasWarnings) {
            personalAlertsBanner.classList.remove('hidden');
        } else {
            personalAlertsBanner.classList.add('hidden');
        }
    }
}

// Live Interest Calculation
const amountInput = document.getElementById('loanAmount');
const interestPreview = document.getElementById('interestPreview');
const calcInterest = document.getElementById('calcInterest');

amountInput.addEventListener('input', (e) => {
    const amount = Number(e.target.value);
    if (amount > 0) {
        calcInterest.textContent = (amount * 0.15).toFixed(2); 
        interestPreview.classList.remove('hidden');
    } else {
        interestPreview.classList.add('hidden');
    }
});

// Handle Loan Submission
document.getElementById('loanForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorDiv = document.getElementById('loanError');
    errorDiv.classList.add('hidden');

    const amount = Number(document.getElementById('loanAmount').value);
    const duration = document.getElementById('loanDuration').value;

    if (currentUserData.savings < 500) {
        errorDiv.textContent = "You must have at least KSH 500 in savings to borrow.";
        errorDiv.classList.remove('hidden');
        return;
    }

    if (amount > (currentUserData.savings * 2)) {
        errorDiv.textContent = "Loan amount exceeds your maximum limit (2x savings).";
        errorDiv.classList.remove('hidden');
        return;
    }

    const submitBtn = document.querySelector('#loanForm button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    try {
        const interest = amount * 0.15;
        await addDoc(collection(db, "loans"), {
            userId: auth.currentUser.uid,
            amount: amount,
            interest: interest,
            repayment: amount + interest,
            durationWeeks: Number(duration),
            status: "pending",
            createdAt: serverTimestamp()
        });

        alert("Loan request sent to admin for approval.");
        document.getElementById('loanForm').reset();
        interestPreview.classList.add('hidden');
        
    } catch (error) {
        errorDiv.textContent = "Error submitting request. Please try again.";
        errorDiv.classList.remove('hidden');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Request";
    }
});

// --- Handle Payment Proof Submission ---
document.getElementById('paymentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('paySubmitBtn');
    const statusDiv = document.getElementById('payStatus');
    
    const amount = Number(document.getElementById('payAmount').value);
    const mpesaCode = document.getElementById('payCode').value.trim().toUpperCase();

    if (amount < 10) {
        statusDiv.innerHTML = "Amount must be at least KSH 10.";
        statusDiv.className = "mt-3 text-sm font-medium rounded p-2 bg-red-50 text-red-600";
        statusDiv.classList.remove('hidden');
        return;
    }

    btn.disabled = true;
    btn.textContent = "Submitting...";

    try {
        await addDoc(collection(db, "paymentClaims"), {
            userId: auth.currentUser.uid,
            amount: amount,
            mpesaCode: mpesaCode,
            status: "pending", // Awaiting admin approval
            createdAt: serverTimestamp()
        });

        statusDiv.innerHTML = `<strong>Success!</strong> Receipt ${mpesaCode} submitted. It will reflect in your savings once verified by an Admin.`;
        statusDiv.className = "mt-3 text-sm font-medium rounded p-2 bg-green-50 text-green-700";
        statusDiv.classList.remove('hidden');
        
        e.target.reset(); // Clear the form
    } catch (error) {
        console.error("Payment submission error:", error);
        statusDiv.innerHTML = "Error submitting payment info. Please try again.";
        statusDiv.className = "mt-3 text-sm font-medium rounded p-2 bg-red-50 text-red-600";
        statusDiv.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = "Submit for Verification";
    }
});