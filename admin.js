import { auth, db } from './firebase.js';
// FIXED: Added runTransaction, serverTimestamp, writeBatch, and Timestamp to the imports
import { collection, query, where, orderBy, getDocs, doc, updateDoc, getDoc, runTransaction, serverTimestamp, writeBatch, Timestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    loadGroupStats();
    loadPendingLoans();
    loadMembers();
    loadContributionTracker(); 
    loadGrievances();
    loadExitRequests();
    loadMasterLedger();
    loadActiveLoans();
    loadPendingPayments();
});

async function loadGroupStats() {
    try {
        const statsRef = doc(db, "groupStats", "main");
        const statsSnap = await getDoc(statsRef);
        
        if (statsSnap.exists()) {
            const data = statsSnap.data();
            document.getElementById('totalCapital').textContent = `KSH ${data.capital}`;
            document.getElementById('activeLoans').textContent = `KSH ${data.totalLoans}`;
            document.getElementById('liquidityReserve').textContent = `KSH ${data.liquidityReserve}`;
        }
    } catch (error) {
        console.error("Error loading stats:", error);
    }
}

export async function loadMembers() {
    const tableBody = document.getElementById('membersTableBody');
    tableBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-gray-500">Loading members...</td></tr>';

    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        tableBody.innerHTML = ''; 

        querySnapshot.forEach((userDoc) => {
            const user = userDoc.data();
            const userId = userDoc.id;

            let statusBadge = '';
            switch(user.status) {
                case 'approved': statusBadge = '<span class="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">Approved</span>'; break;
                case 'pending': statusBadge = '<span class="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-semibold">Pending</span>'; break;
                case 'suspended': statusBadge = '<span class="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold">Suspended</span>'; break;
                case 'restricted': statusBadge = '<span class="px-2 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-semibold">Restricted</span>'; break;
                default: statusBadge = `<span class="px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-semibold">${user.status}</span>`;
            }

            const verifiedBadge = user.verified 
                ? '<span class="text-blue-500 font-bold" title="Verified">✓</span>' 
                : `<button onclick="verifyMember('${userId}')" class="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100">Verify Now</button>`;

            // --- CRITICAL FIX: Sanitize strings for inline HTML injection ---
            const safeName = (user.name || '').replace(/'/g, "\\'").replace(/"/g, "&quot;");
            const safeWarning = (user.warningMessage || '').replace(/'/g, "\\'").replace(/"/g, "&quot;").replace(/(\r\n|\n|\r)/gm, "\\n");
            const safeInfo = (user.infoMessage || '').replace(/'/g, "\\'").replace(/"/g, "&quot;").replace(/(\r\n|\n|\r)/gm, "\\n");

            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="p-3">
                    <div class="font-bold text-gray-800">${user.name}</div>
                    <div class="text-xs text-gray-500">${user.email}</div>
                    <div class="text-xs text-gray-400 uppercase mt-1">${user.role}</div>
                </td>
                <td class="p-3">
                    <div class="text-sm">Savings: <span class="font-semibold text-green-600">KSH ${user.savings || 0}</span></div>
                    <div class="text-sm">Active Loans: <span class="font-semibold text-red-500">KSH ${user.loansActive || 0}</span></div>
                </td>
                <td class="p-3 text-center">${verifiedBadge}</td>
                <td class="p-3">${statusBadge}</td>
                <td class="p-3">
                    <select onchange="handleStatusChange('${userId}', this.value)" class="text-xs border-gray-300 rounded shadow-sm focus:ring-blue-500 focus:border-blue-500 p-1 mb-1 block w-full">
                        <option value="" disabled selected>Change Status...</option>
                        <option value="approved">Approve</option>
                        <option value="pending">Set Pending</option>
                        <option value="restricted">Restrict</option>
                        <option value="suspended">Suspend</option>
                    </select>
                    
                    <button onclick="issueWarning('${userId}', '${safeName}', '${safeWarning}')" class="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-1 rounded hover:bg-red-100 font-medium transition block w-full text-left mt-1">
                        ${user.warningMessage ? 'Update Warning' : 'Issue Warning'}
                    </button>
                    
                    <button onclick="issueUpdate('${userId}', '${safeName}', '${safeInfo}')" class="text-xs bg-green-50 text-green-600 border border-green-200 px-2 py-1 rounded hover:bg-green-100 font-medium transition block w-full text-left mt-1">
                        ${user.infoMessage ? 'Edit Update' : 'Send Update'}
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
        });
    } catch (error) {
        console.error("Error loading members:", error);
        tableBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-red-500">Failed to load members.</td></tr>';
    }
}

window.verifyMember = async function(userId) {
    if(confirm("Mark this user as verified?")) {
        try {
            await updateDoc(doc(db, "users", userId), { verified: true });
            loadMembers(); 
        } catch (error) {
            console.error("Error verifying member:", error);
            alert("Failed to verify member.");
        }
    }
};

window.issueWarning = async function(userId, userName, currentWarning) {
    // Prompt the admin to type a message
    const message = prompt(`Issue a warning/note to ${userName}:\n(Leave blank and click OK to clear existing warning)`, currentWarning);
    
    // If user clicked cancel, message will be null
    if (message === null) return; 

    try {
        // Update the specific user's document in Firestore
        await updateDoc(doc(db, "users", userId), { 
            warningMessage: message.trim() 
        });
        
        if (message.trim() === "") {
            alert(`Warning cleared for ${userName}.`);
        } else {
            alert(`Warning successfully sent to ${userName}. They will see this on their portal immediately.`);
        }
        
        loadMembers(); // Refresh the table so the button text updates
        
    } catch (error) {
        console.error("Error issuing warning:", error);
        alert("Failed to update warning message.");
    }
};

window.issueUpdate = async function(userId, userName, currentInfo) {
    // Prompt the admin to type a positive message
    const message = prompt(`Send a positive update/note to ${userName} (e.g., "Payment recorded", "Issue resolved"):\n(Leave blank and click OK to clear existing message)`, currentInfo);
    
    // If user clicked cancel
    if (message === null) return; 

    try {
        await updateDoc(doc(db, "users", userId), { 
            infoMessage: message.trim() 
        });
        
        if (message.trim() === "") {
            alert(`Update cleared for ${userName}.`);
        } else {
            alert(`Update successfully sent to ${userName}.`);
        }
        
        loadMembers(); // Refresh the table
        
    } catch (error) {
        console.error("Error issuing update:", error);
        alert("Failed to send update.");
    }
};

window.handleStatusChange = async function(userId, newStatus) {
    if (!newStatus) return;
    
    if(confirm(`Are you sure you want to change this member's status to ${newStatus.toUpperCase()}?`)) {
        try {
            await updateDoc(doc(db, "users", userId), { status: newStatus });
            loadMembers(); 
        } catch (error) {
            console.error("Error updating status:", error);
            alert("Failed to update status.");
        }
    }
};

async function distributeAnnualProfit() {
    if (!confirm("Are you sure you want to distribute the annual profit? This action cannot be undone.")) {
        return;
    }

    try {
        const statsRef = doc(db, "groupStats", "main");
        const statsSnap = await getDoc(statsRef);
        
        if (!statsSnap.exists()) {
            throw new Error("Group stats not found.");
        }

        const currentProfit = statsSnap.data().totalProfit || 0;

        if (currentProfit <= 0) {
            alert("No profit available for distribution.");
            return;
        }

        const usersRef = collection(db, "users");
        const activeUsersQuery = query(usersRef, where("status", "==", "approved"));
        const usersSnap = await getDocs(activeUsersQuery);
        
        const memberCount = usersSnap.size;
        
        if (memberCount === 0) {
            alert("No active members found to distribute profit to.");
            return;
        }

        const profitPerMember = currentProfit / memberCount;
        const batch = writeBatch(db);

        usersSnap.forEach((userDoc) => {
            const userData = userDoc.data();
            const userRef = doc(db, "users", userDoc.id);
            const transactionRef = doc(collection(db, "transactions"));

            const newSavings = (userData.savings || 0) + profitPerMember;
            batch.update(userRef, { savings: newSavings });

            batch.set(transactionRef, {
                userId: userDoc.id,
                type: "profit_distribution",
                amount: profitPerMember,
                status: "completed",
                createdAt: serverTimestamp(),
                description: "Annual equal profit split"
            });
        });

        batch.update(statsRef, {
            totalProfit: 0, 
            lastDistributionDate: serverTimestamp()
        });

        await batch.commit();

        alert(`Success! KSH ${profitPerMember.toFixed(2)} has been distributed to ${memberCount} members.`);
        
        loadGroupStats(); 
        loadMembers();

    } catch (error) {
        console.error("Error distributing profit: ", error);
        alert("A critical error occurred while distributing profits. The transaction has been aborted.");
    }
}

window.distributeAnnualProfit = distributeAnnualProfit;

window.handleDeposit = async function(userId) {
    const inputField = document.getElementById(`depositAmount-${userId}`);
    const amount = Number(inputField.value);

    if (!amount || amount <= 0) {
        alert("Please enter a valid deposit amount.");
        return;
    }

    if (!confirm(`Confirm deposit of KSH ${amount} for this member?`)) return;

    const userRef = doc(db, "users", userId);
    const statsRef = doc(db, "groupStats", "main");
    const newTransactionRef = doc(collection(db, "transactions"));

    try {
        await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(userRef);
            const statsDoc = await transaction.get(statsRef);

            const newSavings = (userDoc.data().savings || 0) + amount;
            const newCapital = (statsDoc.data().capital || 0) + amount;
            const newLiquidity = (statsDoc.data().liquidityReserve || 0) + amount; 

            transaction.update(userRef, { savings: newSavings });

            transaction.update(statsRef, { 
                capital: newCapital,
                liquidityReserve: newLiquidity
            });

            transaction.set(newTransactionRef, {
                userId: userId,
                type: "deposit",
                amount: amount,
                status: "completed",
                createdAt: serverTimestamp(),
                description: "Manual admin deposit"
            });
        });

        inputField.value = '';
        alert("Deposit successfully recorded!");
        
        loadContributionTracker(); 
        loadGroupStats(); 

    } catch (error) {
        console.error("Deposit transaction failed: ", error);
        alert("Failed to save deposit. Check console.");
    }
};

async function loadPendingLoans() {
    const tableBody = document.getElementById('pendingLoansTable');
    tableBody.innerHTML = ''; 

    const q = query(collection(db, "loans"), where("status", "==", "pending"));
    const querySnapshot = await getDocs(q);

    querySnapshot.forEach(async (loanDoc) => {
        const loan = loanDoc.data();
        
        const userSnap = await getDoc(doc(db, "users", loan.userId));
        const userName = userSnap.exists() ? userSnap.data().name : 'Unknown';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="p-3">${userName}</td>
            <td class="p-3 font-semibold">KSH ${loan.amount}</td>
            <td class="p-3 text-red-500">KSH ${loan.interest}</td>
            <td class="p-3">${loan.durationWeeks} Weeks</td>
            <td class="p-3">
                <button onclick="approveLoan('${loanDoc.id}')" class="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600 text-xs">Approve</button>
                <button onclick="rejectLoan('${loanDoc.id}')" class="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600 text-xs ml-2">Reject</button>
            </td>
        `;
        tableBody.appendChild(row);
    });
}

window.approveLoan = async function(loanId) {
    if (!confirm("Approve this loan and disburse the funds?")) return;

    const loanRef = doc(db, "loans", loanId);
    const statsRef = doc(db, "groupStats", "main");

    try {
        await runTransaction(db, async (transaction) => {
            const loanDoc = await transaction.get(loanRef);
            const statsDoc = await transaction.get(statsRef);
            
            const loanData = loanDoc.data();
            const userRef = doc(db, "users", loanData.userId);
            const userDoc = await transaction.get(userRef);

            const loanAmount = loanData.amount;
            const currentLiquidity = statsDoc.data().liquidityReserve || 0;
            const currentCapital = statsDoc.data().capital || 0;

            // ==========================================
            // RULE ENFORCEMENT: 30% Liquidity Minimum
            // ==========================================
            const minimumRequiredLiquidity = currentCapital * 0.30;
            const projectedLiquidity = currentLiquidity - loanAmount;

            if (projectedLiquidity < minimumRequiredLiquidity) {
                // If this throws, the entire transaction aborts automatically!
                throw new Error(`Approval Blocked: Disbursing KSH ${loanAmount} drops liquidity to KSH ${projectedLiquidity}. The Constitution requires a strict minimum of KSH ${minimumRequiredLiquidity} (30% of total capital).`);
            }

            // 1. Deduct from Liquidity & Add to Active Group Loans
            transaction.update(statsRef, {
                liquidityReserve: currentLiquidity - loanAmount,
                totalLoans: (statsDoc.data().totalLoans || 0) + loanAmount
            });

            // 2. Add the debt to the specific user's profile
            transaction.update(userRef, {
                loansActive: (userDoc.data().loansActive || 0) + loanData.repayment
            });

            // 3. Mark the loan document as approved
            transaction.update(loanRef, {
                status: "approved",
                approvedAt: serverTimestamp()
            });

            // 4. Log the disbursement in the Master Ledger
            const newTransactionRef = doc(collection(db, "transactions"));
            transaction.set(newTransactionRef, {
                userId: loanData.userId,
                type: "loan",
                amount: loanAmount,
                status: "completed",
                description: "Approved loan disbursement",
                createdAt: serverTimestamp()
            });
        });

        alert("Loan officially approved and disbursed!");
        
        // Refresh the UI to show the new balances
        loadPendingLoans();
        loadGroupStats();
        loadMembers();
        loadMasterLedger();

    } catch (error) {
        console.error("Loan Approval Failed:", error);
        // This alerts the admin if the 30% rule was triggered
        alert(error.message || "Failed to process loan. Check console.");
    }
};

window.rejectLoan = async function(loanId) {
    await updateDoc(doc(db, "loans", loanId), { status: "rejected" });
    loadPendingLoans(); 
};
// Helper: Calculate mathematically exact target for ANY month
function calculateTargetForMonth(year, monthIndex) {
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate(); 
    const fullWeeks = Math.floor(daysInMonth / 7);
    const extraDays = daysInMonth % 7;
    return (fullWeeks * 70) + (extraDays * 10);
}

// Helper: Run the Waterfall Algorithm to determine cleared months
function calculateWaterfall(totalSavings) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    
    let remaining = totalSavings || 0;
    let arrearsTotal = 0;
    let unclearedMonths = [];
    let currentMonthAllocated = 0;
    let currentMonthTarget = calculateTargetForMonth(currentYear, currentMonth);

    // Loop from January (0) to Current Month
    for (let i = 0; i <= currentMonth; i++) {
        const target = calculateTargetForMonth(currentYear, i);
        const monthName = new Date(currentYear, i, 1).toLocaleString('default', { month: 'short' });

        if (remaining >= target) {
            // Month is fully cleared
            remaining -= target;
            if (i === currentMonth) currentMonthAllocated = target;
        } else {
            // Month is partially cleared or empty
            if (i === currentMonth) {
                currentMonthAllocated = remaining;
            } else {
                // It's a PAST month that is uncleared!
                unclearedMonths.push(monthName);
                arrearsTotal += (target - remaining);
            }
            remaining = 0; // Pool is empty
        }
    }
    
    return { unclearedMonths, arrearsTotal, currentMonthAllocated, currentMonthTarget };
}

export async function loadContributionTracker() {
    const now = new Date();
    const currentTarget = calculateTargetForMonth(now.getFullYear(), now.getMonth());
    const monthName = now.toLocaleString('default', { month: 'long' });

    document.getElementById('monthTargetText').innerHTML = 
        `Target for <strong>${monthName} ${now.getFullYear()}</strong> is <strong>KSH ${currentTarget}</strong>`;

    const tableBody = document.getElementById('contributionsTableBody');
    tableBody.innerHTML = '<tr><td colspan="4" class="p-4 text-center">Loading tracker...</td></tr>';

    try {
        const usersQuery = query(collection(db, "users"), where("status", "==", "approved"));
        const usersSnapshot = await getDocs(usersQuery);
        tableBody.innerHTML = ''; 

        for (const userDoc of usersSnapshot.docs) {
            const user = userDoc.data();
            const userId = userDoc.id;

            // Run our new algorithm!
            const waterfall = calculateWaterfall(user.savings);

            // Calculate progress bar for CURRENT month based on remaining waterfall allocation
            let progressPercentage = (waterfall.currentMonthAllocated / waterfall.currentMonthTarget) * 100;
            if (progressPercentage > 100) progressPercentage = 100;

            let barColor = 'bg-blue-500';
            if (progressPercentage === 100) barColor = 'bg-green-500';
            if (progressPercentage === 0) barColor = 'bg-slate-300';

            // Arrears UI
            let arrearsHTML = `<span class="text-green-600 font-bold text-xs bg-green-50 px-2 py-1 rounded">All Past Months Cleared</span>`;
            if (waterfall.unclearedMonths.length > 0) {
                arrearsHTML = `
                    <div class="text-red-600 font-bold text-xs bg-red-50 px-2 py-1 rounded inline-block border border-red-200">
                        Owes KSH ${waterfall.arrearsTotal}
                    </div>
                    <div class="text-xs text-red-500 mt-1 font-medium">Pending: ${waterfall.unclearedMonths.join(', ')}</div>
                `;
            }

            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="p-4 w-1/4">
                    <div class="font-semibold text-gray-800">${user.name}</div>
                    <div class="w-full bg-slate-200 rounded-full h-1.5 mt-2">
                        <div class="${barColor} h-1.5 rounded-full transition-all duration-500" style="width: ${progressPercentage}%"></div>
                    </div>
                    <div class="text-xs text-slate-500 mt-1 font-medium">
                        ${waterfall.currentMonthAllocated} / ${waterfall.currentMonthTarget} KSH this month
                    </div>
                </td>
                
                <td class="p-4 w-1/4">${arrearsHTML}</td>
                <td class="p-4 text-green-600 font-bold" id="savings-${userId}">KSH ${user.savings || 0}</td>
                
                <td class="p-4">
                    <div class="flex items-center space-x-2">
                        <input type="number" id="depositAmount-${userId}" placeholder="Amt (e.g. 70)" class="w-24 px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-blue-500 focus:border-blue-500">
                        <button onclick="handleDeposit('${userId}')" class="bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 text-xs font-bold shadow-sm transition">
                            Save
                        </button>
                    </div>
                </td>
            `;
            tableBody.appendChild(row);
        }
    } catch (error) {
        console.error("Error loading tracker:", error);
        tableBody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-red-500">Failed to load tracker.</td></tr>';
    }
}
// ==========================================
// NEW FEATURE: INBOX, GRIEVANCES & EXITS
// ==========================================

// --- 1. Load Grievances ---
export async function loadGrievances() {
    const container = document.getElementById('grievancesContainer');
    container.innerHTML = '<p class="text-sm text-slate-500">Loading messages...</p>';

    try {
        const q = query(
            collection(db, "messages"), 
            where("type", "==", "grievance"),
            where("status", "==", "unread"),
            orderBy("createdAt", "asc") // Oldest unresolved first
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            container.innerHTML = '<p class="text-sm text-slate-500 italic">No pending grievances.</p>';
            return;
        }

        // Build the HTML string first (much better for browser performance than appending inside the loop)
        let htmlContent = '';

        for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            const userSnap = await getDoc(doc(db, "users", data.userId));
            const userName = userSnap.exists() ? userSnap.data().name : 'Unknown User';
            const dateStr = data.createdAt ? data.createdAt.toDate().toLocaleDateString() : 'Just now';

            // Sanitize the message: escape HTML tags to prevent broken layouts, and convert enters/returns to <br> tags
            const safeMessage = (data.message || '')
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/\n/g, "<br>");

            // docSnap.id and data.userId are Firebase IDs (alphanumeric), so they are naturally safe inside the onclick
            htmlContent += `
                <div class="bg-slate-50 p-4 rounded border border-slate-200 mb-3">
                    <div class="flex justify-between items-start mb-2">
                        <span class="font-bold text-sm text-slate-800">${userName}</span>
                        <span class="text-xs text-slate-500">${dateStr}</span>
                    </div>
                    <p class="text-sm text-slate-700 mb-3">${safeMessage}</p>
                    <button onclick="resolveGrievance('${docSnap.id}', '${data.userId}')" class="bg-green-600 text-white px-3 py-1.5 rounded hover:bg-green-700 text-xs font-bold shadow-sm transition">
                        Mark as Resolved
                    </button>
                </div>
            `;
        }

        // Inject everything at once
        container.innerHTML = htmlContent;

    } catch (error) {
        console.error("Error loading grievances:", error);
        container.innerHTML = '<p class="text-sm text-red-500">Error loading messages. Check index.</p>';
    }
}
window.resolveGrievance = async function(messageId, userId) {
    if (!confirm("Mark this grievance as resolved and notify the member?")) return;

    try {
        // 1. Mark the message as resolved
        await updateDoc(doc(db, "messages", messageId), { status: "resolved" });
        
        // 2. Automatically send a Green Update to the user
        await updateDoc(doc(db, "users", userId), {
            infoMessage: "Your recent support ticket/grievance has been reviewed and resolved by the Admins."
        });

        alert("Grievance resolved! The member has been notified on their portal.");
        loadGrievances(); // Refresh inbox
        loadMembers();    // Refresh members table to show the new active update
        
    } catch (error) {
        console.error(error);
        alert("Failed to resolve message.");
    }
};

// --- 2. Load Exit Requests ---
export async function loadExitRequests() {
    const container = document.getElementById('exitRequestsContainer');
    container.innerHTML = '<p class="text-sm text-slate-500">Loading exit requests...</p>';

    try {
        const q = query(
            collection(db, "exitRequests"), 
            where("status", "==", "pending_review"),
            orderBy("createdAt", "asc")
        );
        const snapshot = await getDocs(q);
        container.innerHTML = '';

        if (snapshot.empty) {
            container.innerHTML = '<p class="text-sm text-slate-500 italic">No exit applications pending.</p>';
            return;
        }

        for (const docSnap of snapshot.docs) {
            const request = docSnap.data();
            const userRef = doc(db, "users", request.userId);
            const userSnap = await getDoc(userRef);
            
            if (!userSnap.exists()) continue;
            const user = userSnap.data();
            
            // Check for active loans just to be absolutely sure
            const loansQuery = query(collection(db, "loans"), where("userId", "==", request.userId), where("status", "in", ["pending", "approved"]));
            const loansSnap = await getDocs(loansQuery);
            let activeLoansTotal = 0;
            loansSnap.forEach(l => activeLoansTotal += l.data().repayment);

            const loanWarning = activeLoansTotal > 0 
                ? `<p class="text-xs font-bold text-red-600 mt-2">WARNING: Member still owes KSH ${activeLoansTotal}. Do not approve until cleared.</p>` 
                : `<p class="text-xs font-bold text-green-600 mt-2">Clearance: No active loans detected.</p>`;

            const isEmergency = request.type === 'emergency' ? '<span class="text-red-600 font-bold uppercase text-xs ml-2">[EMERGENCY]</span>' : '';

            container.innerHTML += `
                <div class="bg-red-50 p-4 rounded border border-red-200">
                    <div class="mb-2 border-b border-red-200 pb-2">
                        <div class="font-bold text-red-900">${user.name} ${isEmergency}</div>
                        <div class="text-xs text-red-700 font-medium">Reason: "${request.reason}"</div>
                        ${loanWarning}
                        <div class="text-sm font-bold text-slate-800 mt-2">Payout Owed: KSH ${user.savings}</div>
                    </div>
                    <div class="flex space-x-2 mt-3">
                        <button onclick="processExit('${docSnap.id}', '${request.userId}', ${user.savings}, '${user.name}')" class="bg-red-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-red-700 shadow-sm transition">
                            Approve & Pay Out
                        </button>
                        <button onclick="rejectExit('${docSnap.id}')" class="bg-white border border-slate-300 text-slate-700 px-3 py-1.5 rounded text-xs font-bold hover:bg-slate-100 shadow-sm transition">
                            Reject Request
                        </button>
                    </div>
                </div>
            `;
        }
    } catch (error) {
        console.error("Error loading exit requests:", error);
        container.innerHTML = '<p class="text-sm text-red-500">Error loading requests.</p>';
    }
}

// --- 3. Process the Exit Payout (Batched Transaction) ---
window.rejectExit = async function(requestId) {
    if(!confirm("Are you sure you want to reject this exit application?")) return;
    await updateDoc(doc(db, "exitRequests", requestId), { status: "rejected" });
    loadExitRequests();
};

window.processExit = async function(requestId, userId, payoutAmount, userName) {
    if (!confirm(`WARNING: You are about to officially terminate ${userName}'s membership and remove KSH ${payoutAmount} from the master capital. Proceed?`)) return;

    const userRef = doc(db, "users", userId);
    const statsRef = doc(db, "groupStats", "main");
    const requestRef = doc(db, "exitRequests", requestId);
    const transactionRef = doc(collection(db, "transactions"));

    try {
        await runTransaction(db, async (transaction) => {
            const statsDoc = await transaction.get(statsRef);
            
            // 1. Deduct payout from Master Capital and Liquidity Reserve
            const currentCapital = statsDoc.data().capital || 0;
            const currentLiquidity = statsDoc.data().liquidityReserve || 0;
            
            transaction.update(statsRef, {
                capital: currentCapital - payoutAmount,
                liquidityReserve: currentLiquidity - payoutAmount
            });

            // 2. Set user status to 'exited' and zero their savings
            transaction.update(userRef, {
                status: "exited",
                savings: 0
            });

            // 3. Mark request as approved
            transaction.update(requestRef, {
                status: "approved_paid",
                payoutAmount: payoutAmount,
                resolvedAt: serverTimestamp()
            });

            // 4. Log the payout in the master ledger
            transaction.set(transactionRef, {
                userId: userId,
                type: "exit_payout",
                amount: payoutAmount,
                status: "completed",
                description: "Full savings refund upon formal exit",
                createdAt: serverTimestamp()
            });
        });

        alert(`Exit processed successfully. KSH ${payoutAmount} has been deducted from group capital. Please transfer the funds to ${userName}.`);
        
        // Refresh all relevant UI components
        loadExitRequests();
        loadGroupStats();
        loadMembers();

    } catch (error) {
        console.error("Exit transaction failed: ", error);
        alert("CRITICAL ERROR: Failed to process exit payout. Database state has been preserved.");
    }
};

// ==========================================
// MASTER LEDGER & CSV EXPORT
// ==========================================

export async function loadMasterLedger() {
    const tableBody = document.getElementById('ledgerTableBody');
    if (!tableBody) return; // Safety check
    
    tableBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500">Loading master ledger...</td></tr>';

    try {
        // 1. Fetch all users once to map their IDs to their Names efficiently
        const usersSnap = await getDocs(collection(db, "users"));
        const userMap = {};
        usersSnap.forEach(doc => { 
            userMap[doc.id] = doc.data().name; 
        });

        // 2. Fetch all transactions, newest first
        const q = query(collection(db, "transactions"), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        
        tableBody.innerHTML = '';

        if (snapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500">No transactions recorded yet.</td></tr>';
            return;
        }

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const userName = userMap[data.userId] || 'Unknown Member';
            const dateStr = data.createdAt ? data.createdAt.toDate().toLocaleDateString() : 'Pending';
            
            // Color code the transaction type
            let typeStyle = 'text-slate-600';
            if (data.type === 'deposit') typeStyle = 'text-green-600 font-medium';
            if (data.type === 'loan' || data.type === 'exit_payout') typeStyle = 'text-blue-600 font-medium';
            if (data.type === 'repayment') typeStyle = 'text-purple-600 font-medium';
            if (data.type === 'penalty') typeStyle = 'text-red-600 font-medium';

            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="p-3 text-slate-700">${dateStr}</td>
                <td class="p-3 font-bold text-slate-800">${userName}</td>
                <td class="p-3 capitalize ${typeStyle}">${data.type.replace('_', ' ')}</td>
                <td class="p-3 font-semibold">KSH ${data.amount}</td>
                <td class="p-3"><span class="bg-slate-100 text-slate-700 px-2 py-1 rounded text-xs uppercase">${data.status}</span></td>
            `;
            tableBody.appendChild(row);
        });
    } catch (error) {
        console.error("Error loading master ledger:", error);
        tableBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-red-500">Error loading ledger. Check console/indexes.</td></tr>';
    }
}

// --- CSV Export Logic ---
window.exportLedgerCSV = function() {
    // Grab the table HTML element
    const table = document.querySelector("#ledger table");
    if (!table) return;

    let csvContent = "";
    
    // Loop through all rows and columns to build the CSV string
    for (let row of table.rows) {
        let rowData = [];
        for (let cell of row.cells) {
            // Clean the text to prevent commas or line breaks from breaking the CSV layout
            let text = cell.innerText.replace(/,/g, "").replace(/\n/g, " ").trim();
            rowData.push(text);
        }
        csvContent += rowData.join(",") + "\n";
    }
    
    // Trigger the file download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    
    link.setAttribute("href", url);
    link.setAttribute("download", `BM_Group_Master_Ledger_${new Date().toLocaleDateString()}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// ==========================================
// ACTIVE LOANS & REPAYMENT PROCESSING
// ==========================================

export async function loadActiveLoans() {
    const tableBody = document.getElementById('activeLoansTableBody');
    if (!tableBody) return;
    
    tableBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500">Loading active loans...</td></tr>';

    try {
        // Query loans that are currently "approved" (meaning disbursed but not yet repaid)
        const q = query(collection(db, "loans"), where("status", "==", "approved"));
        const snapshot = await getDocs(q);
        tableBody.innerHTML = '';

        if (snapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500 italic">No active loans outstanding.</td></tr>';
            return;
        }

        for (const loanDoc of snapshot.docs) {
            const loan = loanDoc.data();
            
            // Fetch the user's name
            const userSnap = await getDoc(doc(db, "users", loan.userId));
            const userName = userSnap.exists() ? userSnap.data().name : 'Unknown User';

            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="p-3 font-bold text-slate-800">${userName}</td>
                <td class="p-3 text-slate-600">KSH ${loan.amount}</td>
                <td class="p-3 text-red-500 font-medium">+ KSH ${loan.interest}</td>
                <td class="p-3 font-bold text-purple-700">KSH ${loan.repayment}</td>
                <td class="p-3">
                    <button onclick="processRepayment('${loanDoc.id}', '${loan.userId}', ${loan.amount}, ${loan.interest}, '${userName}')" class="bg-purple-600 text-white px-3 py-1.5 rounded hover:bg-purple-700 text-xs font-bold shadow-sm transition">
                        Confirm Repayment
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
        }
    } catch (error) {
        console.error("Error loading active loans:", error);
        tableBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-red-500">Error loading loans. Check console.</td></tr>';
    }
}

window.processRepayment = async function(loanId, userId, principal, interest, userName) {
    const totalRepayment = principal + interest;
    
    if (!confirm(`Confirm that ${userName} has fully paid KSH ${totalRepayment} (Principal + Interest)?`)) return;

    const loanRef = doc(db, "loans", loanId);
    const userRef = doc(db, "users", userId);
    const statsRef = doc(db, "groupStats", "main");
    const transactionRef = doc(collection(db, "transactions"));

    try {
        await runTransaction(db, async (transaction) => {
            const statsDoc = await transaction.get(statsRef);
            const userDoc = await transaction.get(userRef);
            
            // 1. Calculate new Master Stats
            const currentLiquidity = statsDoc.data().liquidityReserve || 0;
            const currentCapital = statsDoc.data().capital || 0;
            const currentTotalLoans = statsDoc.data().totalLoans || 0;
            const currentProfit = statsDoc.data().totalProfit || 0;

            transaction.update(statsRef, {
                liquidityReserve: currentLiquidity + totalRepayment, // Cash comes back
                capital: currentCapital + interest, // Net worth increases by profit only
                totalLoans: currentTotalLoans - principal, // Outstanding debt shrinks
                totalProfit: currentProfit + interest // Add to the year-end dividend pool
            });

            // 2. Clear User's Debt
            const currentUserDebt = userDoc.data().loansActive || 0;
            // Ensure we don't go below 0 due to float math
            let newDebt = currentUserDebt - totalRepayment;
            if (newDebt < 0) newDebt = 0; 
            
            transaction.update(userRef, {
                loansActive: newDebt
            });

            // 3. Mark Loan as Repaid
            transaction.update(loanRef, {
                status: "repaid",
                repaidAt: serverTimestamp()
            });

            // 4. Log to Master Ledger
            transaction.set(transactionRef, {
                userId: userId,
                type: "repayment",
                amount: totalRepayment,
                principal: principal,
                interest: interest,
                status: "completed",
                description: "Full loan repayment including 15% interest",
                createdAt: serverTimestamp()
            });
        });

        alert(`Success! KSH ${totalRepayment} recorded. The group capital has grown by KSH ${interest}.`);
        
        // Refresh all Admin UI components to reflect the new wealth
        loadActiveLoans();
        loadGroupStats();
        loadMembers();
        loadMasterLedger(); // If you have the ledger loaded!

    } catch (error) {
        console.error("Repayment failed:", error);
        alert("CRITICAL ERROR: Failed to process repayment. Database preserved.");
    }
};

// ==========================================
// PENDING PAYMENT VERIFICATIONS (M-PESA)
// ==========================================

export async function loadPendingPayments() {
    const tableBody = document.getElementById('pendingPaymentsTable');
    if (!tableBody) return;
    
    tableBody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-500">Loading pending payments...</td></tr>';

    try {
        const q = query(collection(db, "paymentClaims"), where("status", "==", "pending"), orderBy("createdAt", "asc"));
        const snapshot = await getDocs(q);
        tableBody.innerHTML = '';

        if (snapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-500 italic">No pending payments to verify.</td></tr>';
            return;
        }

        for (const docSnap of snapshot.docs) {
            const claim = docSnap.data();
            const userSnap = await getDoc(doc(db, "users", claim.userId));
            const userName = userSnap.exists() ? userSnap.data().name : 'Unknown';

            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="p-3 font-bold text-slate-800">${userName}</td>
                <td class="p-3 font-mono text-xs bg-slate-100 rounded px-2">${claim.mpesaCode}</td>
                <td class="p-3 font-bold text-green-600">KSH ${claim.amount}</td>
                <td class="p-3 flex gap-2">
                    <button onclick="verifyPayment('${docSnap.id}', '${claim.userId}', ${claim.amount}, '${claim.mpesaCode}', '${userName}')" class="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 text-xs font-bold transition">
                        Verify & Credit
                    </button>
                    <button onclick="rejectPayment('${docSnap.id}', '${claim.userId}', '${claim.mpesaCode}')" class="bg-white border border-red-300 text-red-600 px-3 py-1 rounded hover:bg-red-50 text-xs font-bold transition">
                        Reject
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
        }
    } catch (error) {
        console.error("Error loading pending payments:", error);
        tableBody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-red-500">Error loading data. Check console.</td></tr>';
    }
}

window.rejectPayment = async function(claimId, userId, mpesaCode) {
    // 1. Ask the Admin for a reason so the member isn't left guessing
    const reason = prompt(`You are rejecting payment Ref: ${mpesaCode}.\nEnter a brief reason for the member (e.g., "Code already used", "Invalid code", "Amount mismatch"):`);
    
    // If the admin clicks "Cancel" on the prompt, abort the process
    if (reason === null) return; 

    try {
        // 2. Mark the claim as rejected in the database
        await updateDoc(doc(db, "paymentClaims", claimId), { 
            status: "rejected", 
            resolvedAt: serverTimestamp(),
            rejectReason: reason 
        });

        // 3. Automatically trigger a Red Warning Banner on the Member's Portal
        const warningText = `PAYMENT REJECTED: Your submission for M-Pesa Ref [${mpesaCode}] was declined by the Admin. ${reason ? 'Reason: ' + reason : 'Please verify your code and submit again.'}`;
        
        await updateDoc(doc(db, "users", userId), { 
            warningMessage: warningText 
        });

        alert("Payment rejected! The member has been automatically notified on their portal.");
        loadPendingPayments(); // Refresh the table
        
    } catch (error) {
        console.error("Error rejecting payment:", error);
        alert("Failed to reject payment.");
    }
};

window.verifyPayment = async function(claimId, userId, amount, mpesaCode, userName) {
    if (!confirm(`Are you absolutely sure you received KSH ${amount} (Ref: ${mpesaCode}) from ${userName}?`)) return;

    const claimRef = doc(db, "paymentClaims", claimId);
    const userRef = doc(db, "users", userId);
    const statsRef = doc(db, "groupStats", "main");
    const newTransactionRef = doc(collection(db, "transactions"));

    try {
        await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(userRef);
            const statsDoc = await transaction.get(statsRef);

            const newSavings = (userDoc.data().savings || 0) + amount;
            const newCapital = (statsDoc.data().capital || 0) + amount;
            const newLiquidity = (statsDoc.data().liquidityReserve || 0) + amount; 

            // 1. Update User Savings
            transaction.update(userRef, { savings: newSavings });

            // 2. Update Group Capital
            transaction.update(statsRef, { 
                capital: newCapital,
                liquidityReserve: newLiquidity
            });

            // 3. Mark the claim as verified
            transaction.update(claimRef, {
                status: "verified",
                resolvedAt: serverTimestamp()
            });

            // 4. Log to Master Ledger
            transaction.set(newTransactionRef, {
                userId: userId,
                type: "deposit",
                amount: amount,
                status: "completed",
                createdAt: serverTimestamp(),
                description: `Verified M-Pesa Deposit (Ref: ${mpesaCode})`
            });
        });

        alert("Payment verified and credited successfully!");
        
        // Refresh all UIs
        loadPendingPayments();
        loadContributionTracker(); 
        loadGroupStats(); 
        loadMasterLedger();

    } catch (error) {
        console.error("Payment verification failed: ", error);
        alert("Transaction failed. Check console.");
    }
};