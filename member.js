import { auth, db } from './firebase.js';
// 🛡️ Added doc and setDoc for Anti-Spam (Idempotency)
import { doc, setDoc, getDoc, collection, serverTimestamp, query, where, getDocs, orderBy } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

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

// --- Load Personal Loan Requests ---
async function loadMyLoans(uid) {
    const container = document.getElementById('myLoansList');
    if (!container) return;

    try {
        const q = query(
            collection(db, "loans"),
            where("userId", "==", uid),
            orderBy("createdAt", "desc")
        );
        const snapshot = await getDocs(q);
        container.innerHTML = '';

        if (snapshot.empty) {
            container.innerHTML = '<div class="text-sm text-slate-500 text-center bg-slate-50 p-3 rounded border border-slate-100">No loan history found.</div>';
            return;
        }

        snapshot.forEach((docSnap) => {
            const loan = docSnap.data();
            const dateStr = loan.createdAt ? loan.createdAt.toDate().toLocaleDateString() : 'Just now';

            let statusBadge = '';
            let extraInfo = '';

            if (loan.status === 'pending') {
                statusBadge = '<span class="bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide">Pending Review</span>';
            } else if (loan.status === 'approved') {
                statusBadge = '<span class="bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide">Active</span>';
            } else if (loan.status === 'repaid') {
                statusBadge = '<span class="bg-green-100 text-green-700 border border-green-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide">Cleared</span>';
            } else if (loan.status === 'rejected') {
                statusBadge = '<span class="bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide">Rejected</span>';
                if (loan.rejectReason) {
                    extraInfo = `
                        <div class="mt-2 text-xs text-red-700 bg-red-50 p-2.5 rounded border border-red-100">
                            <strong>Admin Note:</strong> ${loan.rejectReason}
                        </div>`;
                }
            }

            const card = document.createElement('div');
            card.className = 'border border-slate-200 rounded-md p-3 bg-white shadow-sm transition hover:shadow-md';
            card.innerHTML = `
                <div class="flex justify-between items-start mb-1.5">
                    <div class="font-bold text-slate-800 text-sm">KSH ${loan.amount}</div>
                    ${statusBadge}
                </div>
                <div class="flex justify-between items-center text-xs text-slate-500 mb-1">
                    <span>${dateStr}</span>
                    <span>${loan.durationWeeks} Weeks</span>
                </div>
                <div class="text-xs text-slate-600 font-medium">Repayment: KSH ${loan.repayment}</div>
                ${extraInfo}
            `;
            container.appendChild(card);
        });
    } catch (error) {
        console.error("Error loading personal loans:", error);
        container.innerHTML = '<div class="text-xs text-red-500 text-center p-2 bg-red-50 rounded">Failed to load requests. Please refresh.</div>';
    }
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

async function loadUserData(uid) {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
        currentUserData = userSnap.data();
        
        // 1. Basic UI Updates
        document.getElementById('memberName').textContent = currentUserData.name;
        document.getElementById('mySavings').textContent = `KSH ${currentUserData.savings}`;
        
        if (currentUserData.role === 'admin') {
            document.getElementById('adminReturnBtn').classList.remove('hidden');
        }

        // --- NEW: Fetch Global Stats for Liquidity ---
        let maxGroupLoanable = 0;
        let totalLentOut = 0;
        let globalRemainingLiquidity = 0;

        try {
            const statsRef = doc(db, "groupStats", "main");
            const statsSnap = await getDoc(statsRef);
            if (statsSnap.exists()) {
                const globalData = statsSnap.data();
                
                // Calculate vault math (30% reserve means 70% is loanable)
                const totalGroupCapital = globalData.totalCapital || 0;
                totalLentOut = globalData.totalLentOut || 0;
                maxGroupLoanable = totalGroupCapital * 0.70; 
                globalRemainingLiquidity = Math.max(0, maxGroupLoanable - totalLentOut);

                if (globalData.announcement) {
                    document.getElementById('alertMessage').textContent = globalData.announcement;
                    document.getElementById('systemAlert').classList.remove('hidden');
                }
            }
        } catch(e) { console.error("Could not load global stats", e); }

        const personalInfoBanner = document.getElementById('personalInfoBanner');
        if (currentUserData.infoMessage) {
            document.getElementById('infoMessageText').textContent = currentUserData.infoMessage;
            personalInfoBanner.classList.remove('hidden');
        } else {
            if(personalInfoBanner) personalInfoBanner.classList.add('hidden');
        }

        await loadMyLedger(uid);
        await loadMyLoans(uid);

        // 3. Load Monthly Progress & Calculate Consistency
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        
        // Calculate Months Active on the fly
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
            
            expectedTotalSoFar += target; 

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

            timelineHTML += `
                <div class="border border-slate-200 rounded-md p-3 bg-slate-50 text-center flex flex-col items-center justify-center">
                    <span class="text-sm font-bold text-slate-800 mb-1">${monthName}</span>
                    <span class="text-xs text-slate-500 mb-2">${allocated} / ${target}</span>
                    ${statusBadge}
                </div>
            `;

            let isFocusMonth = false;
            if (allocated < target && !activeTargetMonthFound) {
                isFocusMonth = true;
                activeTargetMonthFound = true;
            } else if (i === currentMonth && !activeTargetMonthFound) {
                isFocusMonth = true;
                activeTargetMonthFound = true;
            }

            if (isFocusMonth) {
                currentMonthAllocated = allocated;
                currentMonthTarget = target;
                
                document.getElementById('monthTitle').textContent = `${monthName} Target Progress`;
                let progressPercentage = (allocated / target) * 100;
                if (progressPercentage > 100) progressPercentage = 100;

                const progressBar = document.getElementById('monthlyProgressBar');
                progressBar.style.width = `${progressPercentage}%`;
                progressBar.className = "h-full rounded-full transition-all duration-1000 ease-out";
                
                if (progressPercentage === 100) {
                    progressBar.classList.add('bg-green-500');
                } else if (progressPercentage === 0) {
                    progressBar.classList.add('bg-slate-300');
                } else {
                    progressBar.classList.add('bg-blue-500');
                }

                document.getElementById('monthlyText').textContent = `${allocated} / ${target} KSH`;
                
                const statusText = document.getElementById('monthlyStatusText');
                if (allocated >= target) {
                    statusText.innerHTML = "✅ <strong>Awesome!</strong> You have successfully met your contribution target.";
                    statusText.className = "text-xs md:text-sm text-green-600 mt-4 font-medium";
                } else {
                    const diff = target - allocated;
                    statusText.innerHTML = `You need <strong>KSH ${diff}</strong> more to clear ${monthName}. Consistent contributions will help you unlock more benefits.`;
                    statusText.className = "text-xs md:text-sm text-slate-500 mt-4 font-medium";
                }
            }
        }

        document.getElementById('clearanceTimeline').innerHTML = timelineHTML;

        const actualSaved = currentUserData.savings || 0;
        const consistencyScore = expectedTotalSoFar > 0 ? Math.min(100, Math.round((actualSaved / expectedTotalSoFar) * 100)) : 50;

        // ==========================================
        // DYNAMIC ALGORITHMIC LOAN LIMIT & AVAILABLE BALANCE
        // ==========================================
        const savings = currentUserData.savings || 0;
        const loansRepaid = currentUserData.loansRepaidCount || 0; 
        const hasArrears = unclearedPastMonths.length - 1 > 0; 
        
        let limit = 0;
        let limitStatus = "Min. KSH 500 savings required to unlock credit.";
        let helperClass = "text-[10px] md:text-xs text-slate-400 mt-2 font-medium"; 

        if (savings >= 500) {
            if (hasArrears || currentUserData.status === 'restricted') {
                limit = 0;
                limitStatus = "Credit locked due to active arrears or account restrictions.";
                helperClass = "text-[10px] md:text-xs text-rose-500 mt-2 font-bold";
            } 
            else if (loansRepaid === 0) {
                limit = 600;
                limitStatus = "Repay 1st loan to unlock more credit.";
                helperClass = "text-[10px] md:text-xs text-amber-500 mt-2 font-semibold";
            } 
            else {
                let multiplier = 1.0;
                multiplier += Math.min(loansRepaid * 0.2, 0.6);
                multiplier += (consistencyScore / 100) * 0.4;
                multiplier += Math.min(monthsActive * 0.05, 0.5);
                multiplier = Math.min(multiplier, 1.5);

                limit = Math.floor(savings * multiplier);

                if (multiplier >= 2.0) {
                    limitStatus = `Excellent credit standing! Your responsible behavior has earned you a higher credit limit.`;
                    helperClass = "text-[10px] md:text-xs text-emerald-500 mt-2 font-bold";
                } else {
                    limitStatus = `Consistent contributions and timely repayments will increase your limit.`;
                    helperClass = "text-[10px] md:text-xs text-blue-500 mt-2 font-semibold";
                }
            }
        }

        let activeLoansTotal = 0;
        try {
            const activeLoansQuery = query(
                collection(db, "loans"),
                where("userId", "==", uid),
                where("status", "in", ["pending", "approved"])
            );
            const activeLoansSnap = await getDocs(activeLoansQuery);
            activeLoansSnap.forEach(docSnap => {
                activeLoansTotal += Number(docSnap.data().amount);
            });
        } catch (error) {
            console.error("Error fetching active loans for limit calc:", error);
        }

        // User's personal available limit
        let personalAvailableLimit = Math.max(0, limit - activeLoansTotal);

        // --- NEW: SMART GLOBAL FILTER ---
        // Pick whichever is lower: the user's limit, or what the vault can afford
        const finalSmartLimit = Math.floor(Math.min(personalAvailableLimit, globalRemainingLiquidity));

        document.getElementById('availableLoanLimit').textContent = `KSH ${finalSmartLimit}`;
        document.getElementById('totalLoanLimit').textContent = limit;
        
        // Override helper text if global liquidity is the bottleneck
        if (globalRemainingLiquidity < personalAvailableLimit && globalRemainingLiquidity > 0) {
            limitStatus = `Note: Your personal limit is KSH ${personalAvailableLimit}, but group vault liquidity caps it at KSH ${Math.floor(globalRemainingLiquidity)}.`;
            helperClass = "text-[10px] md:text-xs text-amber-600 mt-2 font-bold italic";
        } else if (globalRemainingLiquidity <= 0 && personalAvailableLimit > 0) {
            limitStatus = "Loan facility paused: Group vault liquidity has reached the 30% reserve limit.";
            helperClass = "text-[10px] md:text-xs text-rose-600 mt-2 font-black";
        }

        const limitHelper = document.getElementById('limitHelperText');
        if(limitHelper) {
            limitHelper.textContent = limitStatus;
            limitHelper.className = helperClass;
        }

        currentUserData.calculatedLimit = limit;
        currentUserData.availableLimit = finalSmartLimit; // System now uses the smart limit

        // 4. The Smart Warning Engine
        const alertsList = document.getElementById('alertsList');
        const personalAlertsBanner = document.getElementById('personalAlertsBanner');
        let hasWarnings = false;
        alertsList.innerHTML = ''; 

        if (unclearedPastMonths.length > 0) {
            alertsList.innerHTML += `<li><strong>Arrears Detected:</strong> You have uncleared targets for <strong>${unclearedPastMonths.join(', ')}</strong>. Our policies require all prior balances to be fully cleared before June.</li>`;
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

// --- Handle Loan Submission (IMMUNIZED) ---
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
        // 🛡️ ANTI-SPAM: One payment claim per user per day
        const todayString = new Date().toISOString().split('T')[0]; 
        const uniqueClaimId = `${auth.currentUser.uid}_payment_${todayString}`;

        await setDoc(doc(db, "paymentClaims", uniqueClaimId), {
            userId: auth.currentUser.uid,
            amount: amount,
            mpesaCode: mpesaCode,
            status: "pending", 
            createdAt: serverTimestamp() 
        });

        statusDiv.innerHTML = `<strong>Success!</strong> Receipt ${mpesaCode} submitted. It will reflect in your savings once verified by an Admin.`;
        statusDiv.className = "mt-3 text-sm font-medium rounded p-2 bg-green-50 text-green-700";
        statusDiv.classList.remove('hidden');
        
        e.target.reset(); 
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