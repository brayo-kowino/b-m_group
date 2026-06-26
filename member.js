import { auth, db } from './firebase.js';
import { doc, setDoc, getDoc, collection, serverTimestamp, query, where, getDocs, orderBy } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
//import { signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

let currentUserData = null;

onAuthStateChanged(auth, async (user) => {
    if (user) {
        await loadUserData(user.uid);
    } else {
        window.location.href = 'login.html';
    }
});

// --- Helper: Format Phone Number for Daraja ---
function formatPhoneNumber(phone) {
    let formatted = phone.trim().replace(/\s+/g, '');
    if (formatted.startsWith('+')) formatted = formatted.substring(1);
    if (formatted.startsWith('07') || formatted.startsWith('01')) {
        formatted = '254' + formatted.substring(1);
    }
    return formatted;
}

// Put this inside your initialization logic in member.js
const statsRef = doc(db, "groupStats", "main");

onSnapshot(statsRef, async (docSnap) => {
    if (docSnap.exists() && docSnap.data().maintenanceMode === true) {
        // The admin just flipped the switch! 
        // 1. Instantly sign the user out
        await signOut(auth);
        
        alert("The system has been placed into emergency maintenance mode by the Administrator. You are being logged out.");
        window.location.href = "login.html"; 
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
            orderBy("createdAt", "desc")
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

// --- Theme Switching Logic ---
function triggerDangerZone(isDanger) {
    const dangerBanner = document.getElementById('dangerBanner');
    const nav = document.querySelector('nav');
    
    if (isDanger) {
        document.body.classList.replace('bg-[#F5F5F7]', 'bg-red-50');
        dangerBanner.classList.remove('hidden');
        
        // Turn Nav Red
        nav.classList.remove('nav-polygon-theme', 'bg-white/85');
        nav.classList.add('bg-red-100', 'border-red-300');
    } else {
        document.body.classList.replace('bg-red-50', 'bg-[#F5F5F7]');
        dangerBanner.classList.add('hidden');
        
        // Restore normal Nav
        nav.classList.add('nav-polygon-theme');
        nav.classList.remove('bg-red-100', 'border-red-300');
    }
}

// --- Upgraded Load Personal Loan Requests (With Detailed Financials & Penalty Math) ---
async function loadMyLoans(uid) {
    const container = document.getElementById('myLoansList');
    const lipaSelect = document.getElementById('lipaLoanSelect');
    if (!container) return;

    try {
        const q = query(collection(db, "loans"), where("userId", "==", uid), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        
        container.innerHTML = '';
        if (lipaSelect) lipaSelect.innerHTML = '<option value="">Select a loan to pay...</option>';

        if (snapshot.empty) {
            container.innerHTML = '<div class="text-sm text-slate-500 text-center bg-slate-50 p-3 rounded border border-slate-100">No loan history found.</div>';
            if (lipaSelect) lipaSelect.innerHTML = '<option value="">No active loans</option>';
            triggerDangerZone(false); // Ensure danger zone is off if empty
            return;
        }

        // We only trigger the red banner if there is an UNFROZEN overdue loan
        let hasActiveDailyPenalty = false;

        snapshot.forEach((docSnap) => {
            const loan = docSnap.data();
            const loanId = docSnap.id;
            const dateStr = loan.createdAt ? loan.createdAt.toDate().toLocaleDateString() : 'Just now';

            let statusBadge = '';
            let extraInfo = '';
            let timeInfo = `<span>${loan.durationWeeks} Weeks</span>`;
            let penaltyAmount = 0;
            
            const paidSoFar = loan.amountPaidSoFar || 0;

            // === DATE & DUE TRACKING LOGIC ===
            if (loan.status === 'approved') {
                const startDate = loan.approvedAt ? loan.approvedAt.toDate() : loan.createdAt.toDate();
                const dueDate = new Date(startDate.getTime() + loan.durationWeeks * 7 * 24 * 60 * 60 * 1000);
                const today = new Date();
                
                const timeDiff = dueDate.getTime() - today.getTime();
                const daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));

                if (daysRemaining < 0) {
                    const daysLate = Math.abs(daysRemaining);
                    
                    if (loan.penaltyFrozen) {
                        // User paid the interest, penalty is stopped. Do NOT trigger danger zone.
                        penaltyAmount = loan.frozenPenaltyAmount || 0;
                        statusBadge = '<span class="bg-rose-100 text-rose-700 border border-rose-300 px-2 py-0.5 rounded text-[10px] font-bold uppercase">PENALTY FROZEN</span>';
                        timeInfo = `<span class="text-rose-600 font-bold">${daysLate} Days Late (Frozen)</span>`;
                    } else {
                        // Penalty is active and accumulating!
                        hasActiveDailyPenalty = true; 
                        penaltyAmount = daysLate * 5;
                        statusBadge = '<span class="bg-red-600 text-white border border-red-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase animate-pulse">OVERDUE</span>';
                        timeInfo = `<span class="text-red-600 font-bold">${daysLate} Days Late!</span>`;
                    }

                } else if (daysRemaining <= 3) {
                    statusBadge = '<span class="bg-amber-100 text-amber-700 border border-amber-300 px-2 py-0.5 rounded text-[10px] font-bold uppercase">DUE SOON</span>';
                    timeInfo = `<span class="text-amber-600 font-bold">${daysRemaining} Days Left</span>`;
                } else {
                    statusBadge = '<span class="bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase">Active</span>';
                    timeInfo = `<span class="text-blue-600">${daysRemaining} Days Left</span>`;
                }

                // === MERGED FINANCIAL MATH ===
                const effectiveInterest = loan.interest + penaltyAmount; 
                const totalDue = loan.amount + effectiveInterest; 
                const balance = totalDue - paidSoFar;

                // Populate Lipa Mdogo Dropdown
                if (lipaSelect) {
                    let dropdownText = `KSH ${loan.amount} Loan (Bal: KSH ${balance})`;
                    if (daysRemaining < 0 && !loan.penaltyFrozen) {
                        dropdownText += ` - OVERDUE! New Int: KSH ${effectiveInterest}`;
                    }
                    lipaSelect.innerHTML += `<option value="${loanId}" data-interest="${effectiveInterest}" data-balance="${balance}">${dropdownText}</option>`;
                }

                // Show the complete breakdown to the user
                extraInfo = `
                    <div class="mt-2 space-y-1 bg-slate-50 p-2.5 rounded border border-slate-100">
                        <div class="flex justify-between text-xs text-slate-600">
                            <span>Principal:</span> <span class="font-medium">KSH ${loan.amount}</span>
                        </div>
                        <div class="flex justify-between text-xs ${penaltyAmount > 0 ? 'text-red-600 font-bold' : 'text-slate-600'}">
                            <span>Interest & Fees:</span> 
                            <span>KSH ${effectiveInterest} ${penaltyAmount > 0 ? `<span class="text-[9px] font-medium text-red-500 ml-1">(Inc. KSH ${penaltyAmount} late fee)</span>` : ''}</span>
                        </div>
                        <div class="flex justify-between text-xs text-slate-700 pt-1 border-t border-slate-200 mt-1">
                            <span>Total Expected:</span> <span class="font-bold">KSH ${totalDue}</span>
                        </div>
                        <div class="flex justify-between text-xs text-emerald-600">
                            <span>Paid so far:</span> <span class="font-bold">KSH ${paidSoFar}</span>
                        </div>
                        <div class="flex justify-between text-sm pt-1.5 border-t border-slate-200 mt-1 ${balance > 0 ? 'text-rose-600' : 'text-emerald-600'}">
                            <span class="font-bold">Remaining Balance:</span> <span class="font-black">KSH ${balance}</span>
                        </div>
                    </div>
                `;

            } else if (loan.status === 'pending') {
                statusBadge = '<span class="bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide">Pending Review</span>';
                extraInfo = `<div class="mt-2 text-xs text-slate-600 font-medium bg-slate-50 p-2 rounded border border-slate-100">Total Expected Repayment: KSH ${loan.repayment}</div>`;
            } else if (loan.status === 'repaid') {
                statusBadge = '<span class="bg-green-100 text-green-700 border border-green-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide">Cleared</span>';
                extraInfo = `
                    <div class="mt-2 space-y-1 bg-green-50 p-2.5 rounded border border-green-100 text-green-800">
                        <div class="flex justify-between text-xs"><span>Total Repaid:</span> <span class="font-bold">KSH ${loan.amountPaidSoFar || loan.repayment}</span></div>
                        <div class="text-[10px] font-medium text-green-600 mt-1">Loan successfully closed.</div>
                    </div>
                `;
            }

            // Build UI Card - dynamically style based on severity
            let cardClass = 'border-slate-200 bg-white';
            if (loan.status === 'approved') {
                if (hasActiveDailyPenalty && !loan.penaltyFrozen) cardClass = 'border-red-300 bg-red-50';
                else if (loan.penaltyFrozen) cardClass = 'border-rose-200 bg-rose-50/40';
            } else if (loan.status === 'repaid') {
                cardClass = 'border-green-200 bg-green-50/30 opacity-80'; 
            }
            
            const card = document.createElement('div');
            card.className = `border rounded-md p-3 shadow-sm transition hover:shadow-md mb-3 ${cardClass}`;
            card.innerHTML = `
                <div class="flex justify-between items-start mb-1.5">
                    <div class="font-bold text-slate-800 text-sm">KSH ${loan.amount}</div>
                    ${statusBadge}
                </div>
                <div class="flex justify-between items-center text-xs text-slate-500 mb-1">
                    <span>${dateStr}</span>
                    ${timeInfo}
                </div>
                ${extraInfo}
            `;
            container.appendChild(card);
        });

        // Fire the Danger Zone ONLY if there is an active, accumulating penalty
        triggerDangerZone(hasActiveDailyPenalty);

    } catch (error) {
        console.error("Error loading personal loans:", error);
        container.innerHTML = '<div class="text-xs text-red-500 text-center p-2 bg-red-50 rounded">Failed to load requests. Please refresh.</div>';
    }
}
// --- Auto-Prefill Lipa Mdogo Amount ---
const lipaLoanSelect = document.getElementById('lipaLoanSelect');
const lipaIntent = document.getElementById('lipaIntent');
const lipaAmount = document.getElementById('lipaAmount');

function handlePrefillAmount() {
    if (!lipaLoanSelect || !lipaIntent || !lipaAmount) return;

    // Grab the currently selected option element
    const selectedOption = lipaLoanSelect.options[lipaLoanSelect.selectedIndex];
    
    // If they haven't selected a valid loan, clear it and bail out
    if (!selectedOption || !selectedOption.value) {
        lipaAmount.value = '';
        return;
    }

    const intent = lipaIntent.value;
    const exactInterest = selectedOption.getAttribute('data-interest');
    const exactBalance = selectedOption.getAttribute('data-balance');

    if (intent === 'freeze_penalty') {
        // Prefill the exact interest + penalties
        lipaAmount.value = exactInterest;
    } else if (intent === 'full_balance') { 
        // If you ever add a 'full balance' option, this covers it
        lipaAmount.value = exactBalance;
    } else {
        // Otherwise (mdogo mdogo), clear it so they can type
        lipaAmount.value = '';
    }
}

// Watch both dropdowns for changes
if (lipaLoanSelect && lipaIntent) {
    lipaLoanSelect.addEventListener('change', handlePrefillAmount);
    lipaIntent.addEventListener('change', handlePrefillAmount);
}

// --- Handle Lipa Mdogo Mdogo Submission ---
const lipaForm = document.getElementById('lipaMdogoForm');
if (lipaForm) {
    lipaForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('lipaSubmitBtn');
        const statusDiv = document.getElementById('lipaStatus');
        
        const loanId = document.getElementById('lipaLoanSelect').value;
        const intent = document.getElementById('lipaIntent').value; 
        const amount = Number(document.getElementById('lipaAmount').value);
        const mpesaCode = document.getElementById('lipaMpesaCode').value.toUpperCase().trim();

        if (!loanId) {
            statusDiv.innerHTML = "Please select a valid active loan.";
            statusDiv.className = "mt-3 text-sm font-medium rounded p-2 bg-red-50 text-red-600 border border-red-200";
            statusDiv.classList.remove('hidden');
            return;
        }

        if (mpesaCode.length < 8) {
            statusDiv.innerHTML = "Please enter a valid M-Pesa Reference Code.";
            statusDiv.className = "mt-3 text-sm font-medium rounded p-2 bg-red-50 text-red-600 border border-red-200";
            statusDiv.classList.remove('hidden');
            return;
        }

        btn.disabled = true;
        btn.textContent = "Submitting Code...";

        try {
            // Using the M-Pesa code as the Doc ID prevents duplicate submissions naturally
            await setDoc(doc(db, "paymentClaims", mpesaCode), {
                userId: auth.currentUser.uid,
                amount: amount,
                mpesaCode: mpesaCode,
                type: intent === 'freeze_penalty' ? 'penalty_freeze_request' : 'repayment',
                loanId: loanId,
                status: 'pending',
                createdAt: serverTimestamp()
            });

            statusDiv.innerHTML = `<strong>Submission Successful!</strong> Code ${mpesaCode} has been sent to the admins for verification. Your loan balance will update once approved.`;
            statusDiv.className = "mt-3 text-sm font-medium rounded p-2 bg-green-50 text-green-700 border border-green-200";
            statusDiv.classList.remove('hidden');
            e.target.reset();

        } catch (error) {
            console.error("Installment submission error:", error);
            statusDiv.innerHTML = "System error submitting code. Please check your connection and try again.";
            statusDiv.className = "mt-3 text-sm font-medium rounded p-2 bg-red-50 text-red-600 border border-red-200";
            statusDiv.classList.remove('hidden');
        } finally {
            btn.disabled = false;
            btn.textContent = "Process Repayment";
        }
    });
}

// --- 2. Grievance / Support Form (IMMUNIZED) ---
document.getElementById('grievanceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const text = document.getElementById('grievanceText').value;

    btn.disabled = true;
    btn.textContent = "Sending...";

    try {
        // 🛡️ ANTI-SPAM: One message per user per day
        const todayString = new Date().toISOString().split('T')[0];
        const uniqueMsgId = `${auth.currentUser.uid}_msg_${todayString}`;

        await setDoc(doc(db, "messages", uniqueMsgId), {
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

// --- 3. Constitution-Compliant Exit Strategy (IMMUNIZED) ---
document.getElementById('exitForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorDiv = document.getElementById('exitError');
    errorDiv.classList.add('hidden');

    const exitType = document.getElementById('exitType').value;
    const exitReason = document.getElementById('exitReason').value;

    // RULE ENFORCEMENT: Sec 13.1 - Member must clear all loans before voluntary exit
    if (exitType === 'voluntary') {
        const loansQuery = query(
            collection(db, "loans"),
            where("userId", "==", auth.currentUser.uid),
            where("status", "in", ["pending", "approved"]) 
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
        // 🛡️ ANTI-SPAM: User can only have ONE exit request document ever
        const uniqueExitId = `${auth.currentUser.uid}_exit_request`;

        await setDoc(doc(db, "exitRequests", uniqueExitId), {
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

let contributionChartInstance = null;

async function renderContributionChart(uid) {
    try {
        const q = query(
            collection(db, "transactions"),
            where("userId", "==", uid),
            where("type", "==", "deposit"),
            orderBy("createdAt", "asc")
        );
        
        const snapshot = await getDocs(q);

        // Group data by month
        const groupedData = {};
        
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.createdAt) {
                const date = data.createdAt.toDate();
                const monthYear = date.toLocaleString('default', { month: 'short', year: 'numeric' });
                
                if (!groupedData[monthYear]) {
                    groupedData[monthYear] = 0;
                }
                groupedData[monthYear] += Number(data.amount);
            }
        });

        // If empty, add a placeholder
        if (Object.keys(groupedData).length === 0) {
            const currentMonth = new Date().toLocaleString('default', { month: 'short', year: 'numeric' });
            groupedData[currentMonth] = 0;
        }

        const labels = Object.keys(groupedData);
        const monthlyDeposits = [];
        const cumulativeSavings = [];
        
        let runningTotal = 0;

        // Build the arrays for the chart
        labels.forEach(month => {
            const monthAmount = groupedData[month];
            monthlyDeposits.push(monthAmount);
            
            runningTotal += monthAmount;
            cumulativeSavings.push(runningTotal);
        });

        const ctx = document.getElementById('contributionChart').getContext('2d');
        
        if (contributionChartInstance) {
            contributionChartInstance.destroy();
        }

        contributionChartInstance = new Chart(ctx, {
            // We set the base type to bar, but override the line dataset below
            type: 'bar', 
            data: {
                labels: labels,
                datasets: [
                    {
                        type: 'line',
                        label: 'Total Savings (KSH)',
                        data: cumulativeSavings,
                        borderColor: '#10b981', // Tailwind emerald-500 (Green means money!)
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 3,
                        tension: 0.4,
                        fill: true,
                        yAxisID: 'y', // Bind to main Y axis
                        pointBackgroundColor: '#ffffff',
                        pointBorderColor: '#10b981',
                        pointBorderWidth: 2,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        order: 1 // Draws line on top of bars
                    },
                    {
                        type: 'bar',
                        label: 'Monthly Deposit (KSH)',
                        data: monthlyDeposits,
                        backgroundColor: '#3b82f6', // Tailwind blue-500
                        borderRadius: 4, // Rounded tops on the bars
                        barThickness: 'flex',
                        maxBarThickness: 40,
                        order: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index', // Hovering shows both line and bar data together!
                    intersect: false,
                },
                plugins: {
                    legend: { 
                        display: true, 
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            boxWidth: 8,
                            font: { family: "'Inter', sans-serif", size: 12 }
                        }
                    }, 
                    tooltip: {
                        backgroundColor: '#1e293b',
                        padding: 12,
                        cornerRadius: 8,
                        titleFont: { size: 13, family: "'Inter', sans-serif" },
                        bodyFont: { size: 12, family: "'Inter', sans-serif" },
                        callbacks: {
                            label: function(context) {
                                return `${context.dataset.label}: ${context.parsed.y}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { 
                            borderDash: [4, 4], 
                            color: '#e2e8f0' 
                        },
                        ticks: { 
                            font: { size: 11, family: "'Inter', sans-serif" }, 
                            color: '#64748b' 
                        },
                        border: { display: false }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { 
                            font: { size: 11, family: "'Inter', sans-serif" }, 
                            color: '#64748b' 
                        },
                        border: { display: false }
                    }
                }
            }
        });

        document.getElementById('chartSkeleton')?.classList.add('hidden');

    } catch (error) {
        console.error("Error rendering trend chart:", error);
    }
}
let userUnsubscribe = null;

async function loadUserData(uid) {
    const userRef = doc(db, "users", uid);
    
    // If there's already a listener running, stop it before starting a new one
    if (userUnsubscribe) userUnsubscribe();

    // The Magic Eavesdropper: This runs every single time the database changes!
    userUnsubscribe = onSnapshot(userRef, async (userSnap) => {
        let globalData = null;

        if (userSnap.exists()) {
            currentUserData = userSnap.data();
            
            // 1. Basic UI Updates
            document.getElementById('memberName').textContent = currentUserData.name;
            
            // Add a quick flash animation so the user FEELS the money drop in
            const savingsEl = document.getElementById('mySavings');
            savingsEl.textContent = `KSH ${currentUserData.savings}`;
            savingsEl.classList.add('text-emerald-400', 'scale-105');
            setTimeout(() => savingsEl.classList.remove('text-emerald-400', 'scale-105'), 500);
            
            if (currentUserData.role === 'admin') {
                document.getElementById('adminReturnBtn').classList.remove('hidden');
            }

            // --- Fetch Global Stats for Liquidity ---
            let maxGroupLoanable = 0;
            let totalLentOut = 0;
            let globalRemainingLiquidity = 0;
            let totalGroupCapital = 0;

            try {
                const statsRef = doc(db, "groupStats", "main");
                // We use getDoc here because the group stats don't need to refresh the whole page
                const statsSnap = await getDoc(statsRef);
                if (statsSnap.exists()) {
                    globalData = statsSnap.data();
                    totalGroupCapital = globalData.capital || 0;
                    totalLentOut = globalData.totalLoans || 0;
                    maxGroupLoanable = totalGroupCapital * 0.70; 
                    globalRemainingLiquidity = Math.max(0, maxGroupLoanable - totalLentOut);

                    if (globalData.announcement) {
                        document.getElementById('alertMessage').textContent = globalData.announcement;
                        document.getElementById('systemAlert').classList.remove('hidden');
                    }
                }
            } catch(e) { console.error("Could not load global stats", e); }

            // =========================================================
            // --- SMART SOS LIQUIDITY & QUOTA ENGINE ---
            // =========================================================
            const emBal = currentUserData.emergencySavings || 0;
            const emStatus = currentUserData.emergencyStatus || 'active';
            const totalSosPool = globalData ? (globalData.sosVaultTotal || 0) : 0;

            // 1. Check Monthly Quota (Max 2 per calendar month)
            let monthlySosCount = 0;
            try {
                const now = new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const sosQ = query(collection(db, "sosRequests"), where("userId", "==", uid));
                const sosSnaps = await getDocs(sosQ);
                
                sosSnaps.forEach(doc => {
                    const d = doc.data();
                    if (d.createdAt && d.status !== 'rejected') {
                        if (d.createdAt.toDate() >= startOfMonth) monthlySosCount++;
                    }
                });
            } catch(e) { console.error("Quota check failed", e); }

            // 2. The Smart Algorithm
            let smartAmount = 0;
            let lockReason = "";

            if (emStatus === 'suspended') {
                lockReason = "VAULT ACCESS SUSPENDED BY BOARD";
            } else if (emBal < 100) {
                lockReason = `MIN. KSH 100 SAVINGS REQUIRED (YOU HAVE KSH ${emBal})`;
            } else if (monthlySosCount >= 2) {
                lockReason = "MONTHLY QUOTA EXHAUSTED (2/2 USED)";
            } else {
                const basePersonalCap = Math.min(emBal, 250);
                const maxSafePoolDrain = Math.floor(totalSosPool * 0.40); // Never let 1 draw eat >40% of master pool

                smartAmount = Math.floor(Math.min(basePersonalCap, maxSafePoolDrain));

                // Floor rescue: If pool math pushed them below 100, but vault actually holds >=100, grant 100
                if (smartAmount < 100 && totalSosPool >= 100) smartAmount = 100;
                else if (smartAmount < 100 && totalSosPool < 100) {
                    smartAmount = 0;
                    lockReason = "GROUP VAULT LIQUIDITY TOO LOW";
                }
            }

            // Expose globally so the button function can read it
            window.activeSmartSOS = smartAmount;

            // 3. Drive UI
            const emBalEl = document.getElementById('myEmergencyBalance');
            if (emBalEl) emBalEl.textContent = `KSH ${emBal}`;

            const sosBtn = document.getElementById('btnPullSOS');
            const statusEl = document.getElementById('sosStatusText');

            if (sosBtn && statusEl) {
                if (smartAmount <= 0) {
                    sosBtn.disabled = true;
                    sosBtn.innerText = lockReason;
                    sosBtn.className = "w-auto py-3.5 px-4 bg-transparent border border-slate-300 text-slate-200 font-bold rounded-[2px] cursor-not-allowed text-xs uppercase tracking-wider transition";
                    statusEl.textContent = "Not eligible for emergency request at this time.";
                    statusEl.className = "block text-[10px] font-bold text-rose-300 mt-1.5 text-center";
                } else {
                    sosBtn.disabled = false;
                    sosBtn.innerText = `REQUEST EMERGENCY (KSH ${smartAmount})`;
                    sosBtn.className = "w-auto py-3.5 px-4 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-xl shadow-lg shadow-rose-600/25 active:scale-95 transition text-xs uppercase tracking-wider";
                    
                    const reqLeft = 2 - monthlySosCount;
                    statusEl.innerHTML = `Ready • <strong>${reqLeft} request${reqLeft > 1 ? 's' : ''} left</strong> this month (Max limit: KSH 250)`;
                    statusEl.className = "block text-[10px] font-bold text-emerald-600 mt-1.5 text-center";
                }
            }

            const personalInfoBanner = document.getElementById('personalInfoBanner');
            if (currentUserData.infoMessage) {
                document.getElementById('infoMessageText').textContent = currentUserData.infoMessage;
                personalInfoBanner.classList.remove('hidden');
            } else {
                if(personalInfoBanner) personalInfoBanner.classList.add('hidden');
            }

            // Reload supporting data
            await loadMyLedger(uid);
            await loadMyLoans(uid);
            await renderContributionChart(uid);

            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth();
            
            const joinDateObj = currentUserData.createdAt ? currentUserData.createdAt.toDate() : new Date();
            const diffInMonths = (currentYear - joinDateObj.getFullYear()) * 12 + (currentMonth - joinDateObj.getMonth());
            const monthsActive = Math.max(1, diffInMonths);
            
            let remaining = currentUserData.savings || 0;
            let unclearedPastMonths = [];
            let timelineHTML = '';
            
            let currentMonthAllocated = 0;
            let currentMonthTarget = 0;
            let activeTargetMonthFound = false;
            
            let expectedTotalSoFar = 0; 

            for (let i = 0; i <= currentMonth; i++) {
                const daysInMonth = new Date(currentYear, i + 1, 0).getDate(); 
                const target = (Math.floor(daysInMonth / 7) * 70) + ((daysInMonth % 7) * 10);
                const monthName = new Date(currentYear, i, 1).toLocaleString('default', { month: 'long' });
                const shortMonthName = new Date(currentYear, i, 1).toLocaleString('default', { month: 'short' });
                
                expectedTotalSoFar += target; 

                let statusBadge = '';
                let allocated = 0;

                if (remaining >= target) {
                    allocated = target;
                    remaining -= target;
                    statusBadge = `<span class="bg-green-100 text-green-700 border border-green-200 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">Cleared</span>`;
                } else {
                    allocated = remaining;
                    remaining = 0;
                    
                    if (i === currentMonth) {
                        statusBadge = `<span class="bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">In Progress</span>`;
                    } else {
                        statusBadge = `<span class="bg-rose-100 text-rose-700 border border-rose-200 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">Arrears</span>`;
                        unclearedPastMonths.push(monthName);
                    }
                }

                let isFocusMonth = false;
                if (allocated < target && !activeTargetMonthFound) {
                    isFocusMonth = true;
                    activeTargetMonthFound = true;
                } else if (i === currentMonth && !activeTargetMonthFound) {
                    isFocusMonth = true;
                    activeTargetMonthFound = true;
                }

                if (allocated >= target && !isFocusMonth) {
                    timelineHTML += `
                        <div class="flex flex-col items-center justify-center gap-1.5 min-w-[50px] transition-transform hover:scale-110">
                            <div class="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center shadow-md shadow-green-500/20 text-white relative border-2 border-white">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path>
                                </svg>
                            </div>
                            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${shortMonthName}</span>
                        </div>
                    `;
                } else {
                    let ringGlow = isFocusMonth ? 'ring-2 ring-blue-400 shadow-blue-900/10' : 'border border-slate-200';
                    
                    timelineHTML += `
                        <div class="${ringGlow} rounded-xl p-4 bg-white shadow-sm text-center flex flex-col items-center justify-center min-w-[130px]">
                            <span class="text-sm font-black text-slate-800 mb-1 tracking-tight">${monthName}</span>
                            <span class="text-xs text-slate-500 mb-2 font-medium">${allocated} / ${target} KSH</span>
                            ${statusBadge}
                        </div>
                    `;
                }

                if (isFocusMonth) {
                    currentMonthAllocated = allocated;
                    currentMonthTarget = target;
                    
                    document.getElementById('monthTitle').textContent = `${monthName} Target Progress`;
                    let progressPercentage = (allocated / target) * 100;
                    if (progressPercentage > 100) progressPercentage = 100;

                    const progressBar = document.getElementById('monthlyProgressBar');
                    progressBar.style.width = `${progressPercentage}%`;
                    progressBar.className = "h-full rounded-full transition-all duration-1000 ease-out shadow-inner";
                    
                    if (progressPercentage === 100) {
                        progressBar.classList.add('bg-gradient-to-r', 'from-emerald-400', 'to-green-500');
                    } else if (progressPercentage === 0) {
                        progressBar.classList.add('bg-slate-200');
                    } else {
                        progressBar.classList.add('bg-gradient-to-r', 'from-blue-400', 'to-blue-600');
                    }

                    document.getElementById('monthlyText').textContent = `${allocated} / ${target} KSH`;
                    
                    const statusText = document.getElementById('monthlyStatusText');
                    if (allocated >= target) {
                        statusText.innerHTML = "<strong>Awesome!</strong> You have successfully met your contribution target.";
                        statusText.className = "text-xs md:text-sm text-green-600 mt-4 font-medium";
                    } else {
                        const diff = target - allocated;
                        statusText.innerHTML = `You need <strong>KSH ${diff}</strong> more to clear ${monthName}. Consistent contributions will help you unlock more benefits.`;
                        statusText.className = "text-xs md:text-sm text-slate-500 mt-4 font-medium";
                    }
                }
            }

            document.getElementById('clearanceTimeline').className = "flex flex-row flex-wrap items-center gap-4 py-2";
            document.getElementById('clearanceTimeline').innerHTML = timelineHTML;

            const actualSaved = currentUserData.savings || 0;
            const consistencyScore = expectedTotalSoFar > 0 ? Math.min(100, Math.round((actualSaved / expectedTotalSoFar) * 100)) : 50;

            const savings = currentUserData.savings || 0;
            const loansRepaid = currentUserData.loansRepaidCount || 0; 
            const hasArrears = unclearedPastMonths.length - 1 > 0; 
            
            let limitStatus = "Min. KSH 500 savings required to unlock credit.";
            let helperClass = "text-[10px] md:text-xs text-slate-400 mt-2 font-medium"; 
            
            let activeLoansTotal = 0; 
            let actualOutstandingBalance = 0; 

            try {
                const activeLoansQuery = query(
                    collection(db, "loans"),
                    where("userId", "==", uid),
                    where("status", "in", ["pending", "approved"])
                );
                const activeLoansSnap = await getDocs(activeLoansQuery);
                
                activeLoansSnap.forEach(docSnap => {
                    const loan = docSnap.data();
                    activeLoansTotal += Number(loan.amount); 

                    if (loan.status === 'approved') {
                        const startDate = loan.approvedAt ? loan.approvedAt.toDate() : loan.createdAt.toDate();
                        const dueDate = new Date(startDate.getTime() + loan.durationWeeks * 7 * 24 * 60 * 60 * 1000);
                        const today = new Date();
                        
                        const timeDiff = dueDate.getTime() - today.getTime();
                        const daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));

                        let penaltyAmount = 0;
                        if (daysRemaining < 0) {
                            penaltyAmount = loan.penaltyFrozen ? (loan.frozenPenaltyAmount || 0) : (Math.abs(daysRemaining) * 5);
                        }

                        const paidSoFar = loan.amountPaidSoFar || 0;
                        const totalDue = loan.repayment + penaltyAmount; 
                        
                        actualOutstandingBalance += (totalDue - paidSoFar); 
                    } else if (loan.status === 'pending') {
                        actualOutstandingBalance += loan.repayment;
                    }
                });
            } catch (error) {
                console.error("Error fetching active loans:", error);
            }

            let finalSmartLimit = 0;
            let baseLimit = 0;
            let trueFutureLimit = 0;

            if (savings >= 500) {
                if (hasArrears || currentUserData.status === 'restricted') {
                    limitStatus = "Credit locked due to active arrears or account restrictions.";
                    helperClass = "text-[10px] md:text-xs text-rose-500 mt-2 font-bold";
                } 
                else if (loansRepaid === 0) {
                    baseLimit = 600;
                    trueFutureLimit = 600;
                    limitStatus = "Repay 1st loan to unlock trust multipliers.";
                    helperClass = "text-[10px] md:text-xs text-amber-500 mt-2 font-semibold";
                } 
                else {
                    const equityShare = totalGroupCapital > 0 ? (savings / totalGroupCapital) : 0;
                    const allowedExposureRatio = Math.min(0.95, 0.30 + equityShare);
                    const penaltyResistance = Math.min(1.0, equityShare * 1.5); 

                    let earnedMultiplier = 1.0;
                    earnedMultiplier += Math.min(loansRepaid * 0.2, 0.6);
                    earnedMultiplier += (consistencyScore / 100) * 0.4;
                    earnedMultiplier += Math.min(monthsActive * 0.05, 0.5);
                    earnedMultiplier = Math.min(earnedMultiplier, 1.5); 

                    const currentVaultHealth = totalGroupCapital > 0 ? (globalRemainingLiquidity / maxGroupLoanable) : 0;
                    const currentScaledHealth = currentVaultHealth + ((1 - currentVaultHealth) * penaltyResistance);
                    const currentDynamicMultiplier = Math.max(0.8, earnedMultiplier * currentScaledHealth);
                    
                    baseLimit = Math.floor(savings * currentDynamicMultiplier);
                    let calculatedLimitBeforeVault = Math.max(0, baseLimit - activeLoansTotal);
                    
                    let currentMaxExposure = Math.max(globalRemainingLiquidity * allowedExposureRatio, savings);
                    finalSmartLimit = Math.floor(Math.min(calculatedLimitBeforeVault, globalRemainingLiquidity, currentMaxExposure));

                    const futureTotalLentOut = Math.max(0, totalLentOut - activeLoansTotal);
                    const futureRemainingLiquidity = Math.max(0, maxGroupLoanable - futureTotalLentOut);
                    
                    const futureVaultHealth = totalGroupCapital > 0 ? (futureRemainingLiquidity / maxGroupLoanable) : 0;
                    const futureScaledHealth = futureVaultHealth + ((1 - futureVaultHealth) * penaltyResistance);
                    const futureDynamicMultiplier = Math.max(0.8, earnedMultiplier * futureScaledHealth);
                    
                    const futureBaseLimit = Math.floor(savings * futureDynamicMultiplier);
                    let futureMaxExposure = Math.max(futureRemainingLiquidity * allowedExposureRatio, savings);
                    
                    trueFutureLimit = Math.floor(Math.min(futureBaseLimit, futureRemainingLiquidity, futureMaxExposure));

                    if (equityShare >= 0.20) { 
                        limitStatus = `Your credit limit is healthy based on your contribution performance.`;
                        helperClass = "text-[10px] md:text-xs text-purple-600 mt-2 font-bold";
                    } else if (currentDynamicMultiplier >= 1.2) {
                        limitStatus = `Excellent credit limit is healthy based on group reserves.`;
                        helperClass = "text-[10px] md:text-xs text-emerald-500 mt-2 font-bold";
                    } else {
                        limitStatus = `Note: Multipliers are scaled slightly to protect group reserves.`;
                        helperClass = "text-[10px] md:text-xs text-blue-500 mt-2 font-semibold italic";
                    }
                }
            }

            if (actualOutstandingBalance > 0) {
                finalSmartLimit = 0; 
                limitStatus = `Clear your KSH ${actualOutstandingBalance} outstanding balance to unlock your new KSH ${trueFutureLimit} limit.`;
                helperClass = "text-[10px] md:text-xs text-rose-600 mt-2 font-bold";
            } else if (finalSmartLimit < (baseLimit - activeLoansTotal) && finalSmartLimit > 0) {
                limitStatus = `Limit adjusted to KSH ${finalSmartLimit} because the group reserves are currently low.`;
                helperClass = "text-[10px] md:text-xs text-orange-600 mt-2 font-bold italic";
            } else if (globalRemainingLiquidity <= 0 && savings >= 500) {
                limitStatus = "Loan facility temporarily paused: Group has reached its 30% reserve limit.";
                helperClass = "text-[10px] md:text-xs text-rose-600 mt-2 font-black";
            }

            document.getElementById('availableLoanLimit').textContent = `KSH ${finalSmartLimit}`;
            document.getElementById('totalLoanLimit').textContent = activeLoansTotal > 0 ? trueFutureLimit : baseLimit; 

            document.getElementById('savingsSkeleton')?.classList.add('hidden');
            document.getElementById('loanLimitSkeleton')?.classList.add('hidden');

            const limitHelper = document.getElementById('limitHelperText');
            if(limitHelper) {
                limitHelper.textContent = limitStatus;
                limitHelper.className = helperClass;
            }

            currentUserData.calculatedLimit = baseLimit;
            currentUserData.availableLimit = finalSmartLimit;

            const alertsList = document.getElementById('alertsList');
            const personalAlertsBanner = document.getElementById('personalAlertsBanner');
            let hasWarnings = false;
            alertsList.innerHTML = ''; 

            if (unclearedPastMonths.length > 0) {
                alertsList.innerHTML += `You have uncleared savings for <strong>${unclearedPastMonths.join(', ')}</strong>. Please clear these amounts to maintain good standing.</li>`;
                hasWarnings = true;
            }

            const today = new Date().getDate();

            if (currentUserData.warningMessage) {
                alertsList.innerHTML += `<li><strong>Admin Note:</strong> ${currentUserData.warningMessage}</li>`;
                hasWarnings = true;
            }

            if (currentUserData.status === 'restricted') {
                alertsList.innerHTML += `<li>Your account has been restricted. You cannot access credit facilities at this time.</li>`;
                hasWarnings = true;
            } else if (currentUserData.status === 'suspended') {
                alertsList.innerHTML += `<li>Your account is currently suspended pending administrative review.</li>`;
                hasWarnings = true;
            }

            if (currentUserData.status === 'approved') {
                if (today > 7 && currentMonthAllocated === 0) {
                    alertsList.innerHTML += `<li>You have missed the first weekly contribution deadline. Please deposit KSH 70 immediately.</li>`;
                    hasWarnings = true;
                }
                if (today > 21 && currentMonthAllocated < currentMonthTarget) {
                    const deficit = currentMonthTarget - currentMonthAllocated;
                    alertsList.innerHTML += `<li><strong>Approaching Deadline:</strong> The month is ending soon. You are short KSH ${deficit}. Clear this to maintain good standing.</li>`;
                    hasWarnings = true;
                }
            }

            if (hasWarnings) {
                personalAlertsBanner.classList.remove('hidden');
            } else {
                personalAlertsBanner.classList.add('hidden');
            }
            let notificationCount = 0;
            if (globalData && globalData.announcement) notificationCount++;
            
            if (currentUserData.infoMessage) notificationCount++;
            
            const alertItems = alertsList.querySelectorAll('li').length;
            notificationCount += alertItems;

            const notifBadge = document.getElementById('notifBadge');
            if (notificationCount > 0) {
                notifBadge.textContent = notificationCount;
                notifBadge.classList.remove('hidden');
                notifBadge.classList.add('flex');
            } else {
                notifBadge.classList.add('hidden');
                notifBadge.classList.remove('flex');
            }
        } 
    });
}

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

    if (amount > currentUserData.availableLimit) {
        errorDiv.textContent = `Limit Exceeded: Based on your current credit status, your max is KSH ${currentUserData.availableLimit}.`;
        errorDiv.classList.remove('hidden');
        return;
    }

    const submitBtn = document.querySelector('#loanForm button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    try {
        const interest = amount * 0.15;
        
        // 🛡️ ANTI-SPAM: One loan request per user per day
        const todayString = new Date().toISOString().split('T')[0];
        const uniqueLoanId = `${auth.currentUser.uid}_loan_${todayString}`;

        await setDoc(doc(db, "loans", uniqueLoanId), {
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
        
        // Refresh the UI to show the new pending request immediately
        if (typeof loadMyLoans === 'function') loadMyLoans(auth.currentUser.uid);
        
    } catch (error) {
        errorDiv.textContent = "Error submitting request. Please try again.";
        console.error("Firebase Error: ", error);
        errorDiv.classList.remove('hidden');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Request";
    }
});

// --- Handle Payment Proof Submission (IMMUNIZED) ---
document.getElementById('paymentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('paySubmitBtn');
    const statusDiv = document.getElementById('payStatus');
    
    const amount = Number(document.getElementById('payAmount').value);
    const mpesaCode = document.getElementById('payMpesaCode').value.toUpperCase().trim();

    if (amount < 10) {
        statusDiv.innerHTML = "Amount must be at least KSH 10.";
        statusDiv.className = "mt-3 text-sm font-medium rounded p-2 bg-red-50 text-red-600";
        statusDiv.classList.remove('hidden');
        return;
    }

    if (mpesaCode.length < 8) {
        statusDiv.innerHTML = "Please enter a valid M-Pesa Reference Code.";
        statusDiv.className = "mt-3 text-sm font-medium rounded p-2 bg-red-50 text-red-600";
        statusDiv.classList.remove('hidden');
        return;
    }

    btn.disabled = true;
    btn.textContent = "Submitting Code...";

    try {
        const destination = document.getElementById('payDestination').value; 

        await setDoc(doc(db, "paymentClaims", mpesaCode), {
            userId: auth.currentUser.uid,
            amount: amount,
            mpesaCode: mpesaCode,
            type: destination, 
            status: 'pending',
            createdAt: serverTimestamp()
        });

        statusDiv.innerHTML = `<strong>Submission Successful!</strong> Code ${mpesaCode} is pending admin verification. Your savings will update once approved.`;
        statusDiv.className = "mt-3 text-sm font-medium rounded p-2 bg-green-50 text-green-700 border border-green-200";
        statusDiv.classList.remove('hidden');
        e.target.reset();

    } catch (error) {
        console.error("Payment submission error:", error);
        statusDiv.innerHTML = "Error submitting code. Please check your connection and try again.";
        statusDiv.className = "mt-3 text-sm font-medium rounded p-2 bg-red-50 text-red-600";
        statusDiv.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = "Submit for Verification";
    }
});

window.requestSOS = async function() {
    const dynamicAmount = window.activeSmartSOS || 0;

    if (dynamicAmount < 100) {
        alert("Emergency request currently unavailable based on group safety parameters.");
        return;
    }

    const reason = prompt(`STATE YOUR EMERGENCY FOR KSH ${dynamicAmount}:\n(Be 100% honest. We audit these in real-time.)`);
    if (!reason || reason.trim() === "") return;

    const btn = document.getElementById('btnPullSOS');
    btn.disabled = true;
    btn.innerText = "Sending Request...";

    try {
        const claimId = `SOS-${auth.currentUser.uid.substring(0,5)}-${Date.now().toString().slice(-4)}`;
        
        await setDoc(doc(db, "sosRequests", claimId), {
            userId: auth.currentUser.uid,
            userName: currentUserData.name,
            amount: dynamicAmount,
            reason: reason.trim(),
            status: 'pending',
            createdAt: serverTimestamp()
        });

        alert(`Request for KSH ${dynamicAmount} transmitted to the Board.`);
    } catch(e) {
        alert("Failed to send request.");
    } finally {
        btn.disabled = false;
        btn.innerText = `REQUEST EMERGENCY (KSH ${dynamicAmount})`;
    }
};

// ==========================================
// MISTRAL AI CHAT ASSISTANT ENGINE
// ==========================================

const MISTRAL_API_KEY = 'b2hehoa5XLQ1TDkktz8BtWpg5okdjGKr';

const openChatBtn = document.getElementById('openAiChatBtn');
const closeChatBtn = document.getElementById('closeAiChatBtn');
const chatDrawer = document.getElementById('aiChatDrawer');
const chatForm = document.getElementById('aiChatForm');
const chatInput = document.getElementById('aiChatInput');
const chatMessagesContainer = document.getElementById('aiChatMessages');

// Chat Drawer Controls
if (openChatBtn && chatDrawer) {
    openChatBtn.addEventListener('click', (e) => {
        e.preventDefault();
        chatDrawer.classList.remove('hidden');
        setTimeout(() => {
            chatDrawer.classList.remove('translate-x-full');
        }, 10);
        if (window.innerWidth < 768 && typeof toggleSidebar === 'function') {
            toggleSidebar(); 
        }
    });
}

if (closeChatBtn && chatDrawer) {
    closeChatBtn.addEventListener('click', () => {
        chatDrawer.classList.add('translate-x-full');
        setTimeout(() => {
            chatDrawer.classList.add('hidden');
        }, 300);
    });
}

// Executive Glass Markdown Parser v2.0
function formatAiText(rawText) {
    let text = rawText
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    text = text.replace(/```([\s\S]*?)```/g, '<pre class="block bg-black/60 border border-white/10 p-3 rounded-xl my-2.5 font-mono text-[11px] overflow-x-auto text-emerald-400 shadow-inner"><code>$1</code></pre>');
    text = text.replace(/`([^`]+)`/g, '<code class="bg-purple-950/60 border border-purple-500/30 text-purple-200 px-1.5 py-0.5 rounded font-mono text-[11px]">$1</code>');
    text = text.replace(/^## (.*$)/gim, '<strong class="block text-sm font-extrabold text-blue-400 mt-3.5 mb-1 tracking-wide uppercase">$1</strong>');
    text = text.replace(/^### (.*$)/gim, '<strong class="block text-xs font-bold text-purple-300 mt-2.5 mb-1 tracking-wide">$1</strong>');
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-white">$1</strong>');
    text = text.replace(/\*(.*?)\*/g, '<em class="italic text-slate-300">$1</em>');
    text = text.replace(/^\s*[-*]\s+(.*$)/gim, '<li class="ml-4 list-disc marker:text-purple-400 my-0.5 pl-1">$1</li>');
    text = text.replace(/^\s*(\d+)\.\s+(.*$)/gim, '<li class="ml-4 list-decimal marker:text-blue-400 marker:font-bold my-0.5 pl-1">$2</li>');

    text = text.replace(/\n/g, '<br>');
    text = text.replace(/(<\/li>)<br>/g, '$1');
    text = text.replace(/<br>(<li)/g, '$1');
    text = text.replace(/(<\/pre>)<br>/g, '$1');
    text = text.replace(/<br>(<pre)/g, '$1');

    return text;
}

// Helper to safely extract clean string metrics from DOM elements
function getPortalMetric(elementId, fallback = 'KSH 0') {
    const el = document.getElementById(elementId);
    return el ? el.textContent.trim() : fallback;
}

// Append Chat Bubbles to UI
function appendChatMessage(sender, text) {
    const messageRow = document.createElement('div');
    messageRow.className = sender === 'user' 
        ? 'flex items-start gap-2.5 max-w-[85%] ml-auto justify-end' 
        : 'flex items-start gap-2.5 max-w-[88%]';

    const avatar = sender === 'user'
        ? `<div class="w-7 h-7 shrink-0 bg-slate-800 text-slate-400 border border-slate-700 rounded-full flex items-center justify-center text-[10px] font-bold uppercase shadow-sm">ME</div>`
        : `<div class="w-7 h-7 shrink-0 bg-gradient-to-br from-blue-600/30 to-blue-600/30 text-blue-400 border border-blue-500/40 rounded-full flex items-center justify-center text-[10px] font-black uppercase shadow-sm">BM</div>`;

    const bubbleClass = sender === 'user'
        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 border border-blue-500/40 text-white rounded-2xl rounded-tr-none shadow-md'
        : 'bg-slate-900/80 backdrop-blur-md border border-white/10 text-slate-200 rounded-2xl rounded-tl-none shadow-lg';

    const formattedText = sender === 'ai' ? formatAiText(text) : text;

    messageRow.innerHTML = sender === 'user' 
        ? `<div class="${bubbleClass} p-3.5 text-xs leading-relaxed">${formattedText}</div>${avatar}`
        : `${avatar}<div class="${bubbleClass} p-3.5 text-xs leading-relaxed overflow-x-auto w-full">${formattedText}</div>`;

    chatMessagesContainer.appendChild(messageRow);
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

// Handle AI Queries
if (chatForm) {
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const queryText = chatInput.value.trim();
        if (!queryText) return;

        appendChatMessage('user', queryText);
        chatInput.value = '';

        // 1. EXTRACT EXTENSIVE PORTAL DATA TELEMETRY
        // (Ensure these IDs match the actual balance cards in your HTML layout)
        const profileTelemetry = {
            savings: getPortalMetric('mySavings', 'KSH 0'),
            loanLimit: getPortalMetric('availableLoanLimit', 'KSH 0'),
            activeLoanBalance: getPortalMetric('activeLoanBalance', 'KSH 0'),
            accruedPenalties: getPortalMetric('overduePenalties', 'KSH 0'),
            outstandingInterest: getPortalMetric('outstandingInterest', 'KSH 0'),
            nextDueDate: getPortalMetric('paymentDueDate', 'None Active'),
            totalShares: getPortalMetric('myTotalShares', '0 Shares'),
            accountStatus: getPortalMetric('userAccountStatus', 'Active Member')
        };

        // 2. THE SYSTEM PROMPT - LOGIC & CALCULATION LAYER
        const systemPrompt = `You are BM Assistant, a highly adaptive AI Assistant for the B&M Group platform. Given the following live telemetry data, provide clear, actionable insights and explanations to the user. Use the data below to answer any questions about their financial status, limits, or obligations. Give short, concise, and accurate responses. If the user asks for calculations or reasoning, break down the steps clearly.

YOUR OPERATIONAL FREEDOM:
- You are a world-class, multi-talented generalist AI. You can write clean code, solve math, analyze projects, or chat about personal growth. Never say you are limited to B&M rules.

MEMBER PORTAL DATALOG:
- Total Member Savings: ${profileTelemetry.savings}
- Max Available Credit Limit: ${profileTelemetry.loanLimit}
- Current Active Loan Balance: ${profileTelemetry.activeLoanBalance}
- Unpaid Overdue Penalties: ${profileTelemetry.accruedPenalties}
- Outstanding Unpaid Interest: ${profileTelemetry.outstandingInterest}
- Next Payment Deadline: ${profileTelemetry.nextDueDate}
- Total Investment Shares: ${profileTelemetry.totalShares}
- Status: ${profileTelemetry.accountStatus}

THE "WHY" RULES & MATHEMATICAL FORMULAS:
If a user asks why their numbers are the way they are, use these structural calculations to explain step-by-step:
1. Loan Limit Allocation: A member's maximum credit potential is derived algorithmically from their Total Savings profile and tier multipliers, minus any active principal balances. If savings are low, the limit scales down proportionally to manage liquidity risk.
2. The 15% flat rule: All loans attract a fixed 15% flat interest fee applied directly to the borrowed principal amount upon approval.
3. Penalty Accrual: If a loan goes past its 'Next Payment Deadline', an automated statutory fee of KSH 5 handles compound overhead per day. This penalty can ONLY be frozen by clearing the current accrued outstanding interest first.
4. Exit Policy (Section 13): A user's account cannot be deactivated or funds fully withdrawn voluntarily if 'Active Loan Balance' is greater than KSH 0.

EXECUTIVE OUTPUT COMPLIANCE:
- Analyze their live telemetry context directly whenever they ask about their portfolio status, limits, or financial health.
- Break down multi-step arithmetic transparently using clean lists or headers so they understand exactly how their balances are calculated.`;

        const loader = document.createElement('div');
        loader.className = 'flex items-center gap-2 text-xs text-blue-400 font-semibold animate-pulse my-2 ml-9';
        loader.id = 'ai-typing-loader';
        loader.innerHTML = `<span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span> Analyzing live data...`;
        chatMessagesContainer.appendChild(loader);
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;

        try {
            const response = await fetch('/.netlify/functions/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'mistral-small-latest', 
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: queryText }
                    ],
                    temperature: 0.6,
                    max_tokens: 1000 
                })
            });

            const data = await response.json();
            document.getElementById('ai-typing-loader')?.remove();

            if (data.choices && data.choices[0]) {
                const aiReply = data.choices[0].message.content;
                appendChatMessage('ai', aiReply);
            } else {
                appendChatMessage('ai', 'I lost the connection. Drop your prompt one more time.');
            }

        } catch (error) {
            console.error('AI Comms Fail:', error);
            document.getElementById('ai-typing-loader')?.remove();
            appendChatMessage('ai', 'Communication failure. Serverless endpoint couldn\'t resolve request.');
        }
    });
}