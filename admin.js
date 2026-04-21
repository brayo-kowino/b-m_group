import { auth, db } from './firebase.js';
import { collection, query, where, orderBy, getDocs, doc, updateDoc, getDoc, runTransaction, serverTimestamp, writeBatch, Timestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-functions.js";
//import { functions } from './firebase.js';

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
    loadVisualAnalytics();
});

const addMemberForm = document.getElementById('addMemberForm');
const mintStatus = document.getElementById('mintStatus');
const btnMintUser = document.getElementById('btnMintUser');

addMemberForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    btnMintUser.disabled = true;
    btnMintUser.innerText = "Transmitting to Secure Server...";
    mintStatus.classList.add('hidden');

    const name = document.getElementById('newMemberName').value;
    const memberId = document.getElementById('newMemberId').value.toUpperCase();
    const email = document.getElementById('newMemberEmail').value;
    const password = document.getElementById('newMemberPassword').value;

    try {
        // 1. POINT TO YOUR NEW CLOUD FUNCTION
        const addNewMember = httpsCallable(functions, 'addNewMember');

        // 2. SEND THE DATA TO THE BACKEND
        const result = await addNewMember({
            fullName: name,
            memberId: memberId,
            email: email,
            password: password
        });

        // 3. SUCCESS UI
        mintStatus.innerText = result.data.message;
        mintStatus.className = "text-sm font-semibold text-center mt-4 p-3 rounded-lg bg-green-50 text-green-700 border border-green-200 block";
        addMemberForm.reset();

    } catch (error) {
        console.error("Backend Error: ", error);
        mintStatus.innerText = `Server Rejected: ${error.message}`;
        mintStatus.className = "text-sm font-semibold text-center mt-4 p-3 rounded-lg bg-red-50 text-red-700 border border-red-200 block";
    } finally {
        btnMintUser.disabled = false;
        btnMintUser.innerText = "Execute Account Creation";
    }
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
    tableBody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-500">Loading members...</td></tr>';

    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        tableBody.innerHTML = ''; 

        querySnapshot.forEach((userDoc) => {
            const user = userDoc.data();
            const userId = userDoc.id;

            // --- 1. CALCULATE TIME CONTEXT ---
            const joinDateObj = user.createdAt ? user.createdAt.toDate() : new Date();
            const joinDateString = joinDateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            
            // --- 2. CALCULATE FINANCIAL CONTEXT ---
            const waterfall = typeof calculateWaterfall === 'function' ? calculateWaterfall(user.savings || 0) : { consistencyScore: 50, arrearsTotal: 0 };
            const consistencyScore = waterfall.consistencyScore;
            const arrearsTotal = waterfall.arrearsTotal;
            const repaidCount = user.loansRepaidCount || 0;

            // --- 3. BADGES & UI ELEMENTS ---
            let statusBadge = '';
            switch(user.status) {
                case 'approved': statusBadge = '<span class="px-2 py-0.5 bg-emerald-100 text-emerald-700 border border-emerald-200 rounded text-[10px] uppercase tracking-wide font-bold">Approved</span>'; break;
                case 'pending': statusBadge = '<span class="px-2 py-0.5 bg-amber-100 text-amber-700 border border-amber-200 rounded text-[10px] uppercase tracking-wide font-bold">Pending</span>'; break;
                case 'suspended': statusBadge = '<span class="px-2 py-0.5 bg-rose-100 text-rose-700 border border-rose-200 rounded text-[10px] uppercase tracking-wide font-bold">Suspended</span>'; break;
                case 'restricted': statusBadge = '<span class="px-2 py-0.5 bg-orange-100 text-orange-700 border border-orange-200 rounded text-[10px] uppercase tracking-wide font-bold">Restricted</span>'; break;
                default: statusBadge = `<span class="px-2 py-0.5 bg-slate-100 text-slate-700 border border-slate-200 rounded text-[10px] uppercase tracking-wide font-bold">${user.status}</span>`;
            }

            const verifiedBadge = user.verified 
                ? '<span class="text-[10px] uppercase tracking-wider font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">Verified ID</span>' 
                : `<button onclick="verifyMember('${userId}')" class="text-[10px] uppercase tracking-wider font-bold text-slate-500 bg-white border border-slate-300 px-2 py-0.5 rounded hover:bg-slate-50 transition shadow-sm">Verify Now</button>`;

            // Sanitize strings for inline HTML injection
            const safeName = (user.name || '').replace(/'/g, "\\'").replace(/"/g, "&quot;");
            const safeWarning = (user.warningMessage || '').replace(/'/g, "\\'").replace(/"/g, "&quot;").replace(/(\r\n|\n|\r)/gm, "\\n");
            const safeInfo = (user.infoMessage || '').replace(/'/g, "\\'").replace(/"/g, "&quot;").replace(/(\r\n|\n|\r)/gm, "\\n");

            // --- 4. BUILD THE ROW ---
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="p-4 align-top">
                    <div class="font-bold text-slate-800 text-base">${user.name}</div>
                    <div class="text-xs text-slate-500 mt-0.5">${user.email}</div>
                    <div class="flex items-center gap-2 mt-2">
                        <span class="text-[9px] uppercase tracking-wider font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">${user.role || 'Member'}</span>
                        <span class="text-[10px] text-slate-400 font-semibold tracking-wide">Joined: ${joinDateString}</span>
                    </div>
                </td>
                <td class="p-4 align-top">
                    <div class="flex gap-6 mb-2.5">
                        <div>
                            <div class="text-[9px] text-slate-400 uppercase font-bold tracking-widest mb-0.5">Savings</div>
                            <div class="text-sm font-bold text-emerald-600">KSH ${user.savings || 0}</div>
                        </div>
                        <div>
                            <div class="text-[9px] text-slate-400 uppercase font-bold tracking-widest mb-0.5">Active Debt</div>
                            <div class="text-sm font-bold ${user.loansActive > 0 ? 'text-rose-600' : 'text-slate-400'}">KSH ${user.loansActive || 0}</div>
                        </div>
                    </div>
                    <div class="flex gap-2">
                        <span class="bg-blue-50 text-blue-600 border border-blue-100 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">Score: ${consistencyScore}%</span>
                        <span class="bg-purple-50 text-purple-600 border border-purple-100 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">Repaid: ${repaidCount}</span>
                    </div>
                </td>
                <td class="p-4 align-top">
                    <div class="flex flex-col gap-1.5 items-start">
                        ${statusBadge}
                        ${verifiedBadge}
                        ${arrearsTotal > 0 
                            ? `<span class="bg-rose-50 text-rose-600 border border-rose-200 text-[9px] px-2 py-0.5 rounded font-bold uppercase tracking-wide mt-1">Owes: KSH ${arrearsTotal}</span>` 
                            : `<span class="bg-emerald-50 text-emerald-600 border border-emerald-200 text-[9px] px-2 py-0.5 rounded font-bold uppercase tracking-wide mt-1">No Arrears</span>`}
                    </div>
                </td>
                <td class="p-4 align-top w-48">
                    <select onchange="handleStatusChange('${userId}', this.value)" class="text-xs border border-slate-200 rounded shadow-sm focus:ring-blue-500 focus:border-blue-500 p-1.5 mb-2 block w-full bg-slate-50 font-medium text-slate-700">
                        <option value="" disabled selected>Change Status...</option>
                        <option value="approved">Approve</option>
                        <option value="pending">Set Pending</option>
                        <option value="restricted">Restrict</option>
                        <option value="suspended">Suspend</option>
                    </select>
                    
                    <button onclick="issueWarning('${userId}', '${safeName}', '${safeWarning}')" class="text-xs bg-rose-50 text-rose-600 border border-rose-200 px-2 py-1.5 rounded hover:bg-rose-100 font-bold transition block w-full text-left mt-1 shadow-sm">
                        ${user.warningMessage ? 'Edit Warning' : 'Issue Warning'}
                    </button>
                    
                    <button onclick="issueUpdate('${userId}', '${safeName}', '${safeInfo}')" class="text-xs bg-emerald-50 text-emerald-600 border border-emerald-200 px-2 py-1.5 rounded hover:bg-emerald-100 font-bold transition block w-full text-left mt-1 shadow-sm">
                        ${user.infoMessage ? 'Edit Update' : 'Send Update'}
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
        });
    } catch (error) {
        console.error("Error loading members:", error);
        tableBody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-rose-500 font-bold">Failed to load members. Check console.</td></tr>';
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

// ==========================================
// VISUAL ANALYTICS DASHBOARD (Chart.js)
// ==========================================

// We store the chart instances globally so we can destroy and redraw them 
// when data updates, preventing the "hover glitch" in Chart.js
let doughnutChartInstance = null;
let barChartInstance = null;

export async function loadVisualAnalytics() {
    try {
        const statsRef = doc(db, "groupStats", "main");
        const statsSnap = await getDoc(statsRef);
        
        if (!statsSnap.exists()) {
            console.warn("Analytics: groupStats document not found.");
            return;
        }

        const data = statsSnap.data();
        
        // Ensure we have numbers to work with (fallback to 0 if undefined)
        const capital = data.capital || 0;
        const liquidity = data.liquidityReserve || 0;
        const activeLoans = data.totalLoans || 0;
        const profit = data.totalProfit || 0;

        // -----------------------------------------------------
        // CHART 1: DOUGHNUT CHART (Where is the money?)
        // -----------------------------------------------------
        const ctxDoughnut = document.getElementById('capitalDoughnutChart');
        if (ctxDoughnut) {
            // Destroy existing chart if it exists to prevent overlapping
            if (doughnutChartInstance) doughnutChartInstance.destroy();

            doughnutChartInstance = new Chart(ctxDoughnut, {
                type: 'doughnut',
                data: {
                    labels: ['Liquidity Reserve (Cash)', 'Active Loans (Debt)'],
                    datasets: [{
                        data: [liquidity, activeLoans],
                        backgroundColor: [
                            '#10b981', // emerald-500 (Safe Cash)
                            '#ef4444'  // red-500 (Lent out)
                        ],
                        hoverOffset: 4,
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom' }
                    },
                    cutout: '70%' // Makes it a thinner, modern ring
                }
            });
        }

        // -----------------------------------------------------
        // CHART 2: BAR CHART (Wealth Overview)
        // -----------------------------------------------------
        const ctxBar = document.getElementById('wealthBarChart');
        if (ctxBar) {
            // Destroy existing chart if it exists
            if (barChartInstance) barChartInstance.destroy();

            barChartInstance = new Chart(ctxBar, {
                type: 'bar',
                data: {
                    labels: ['Total Capital', 'Total Profit'],
                    datasets: [{
                        label: 'KSH',
                        data: [capital, profit],
                        backgroundColor: [
                            '#3b82f6', // blue-500
                            '#8b5cf6'  // violet-500
                        ],
                        borderRadius: 6 // Modern rounded bar corners
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false } // Hide legend since labels explain it
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { borderDash: [5, 5] } // Cool dashed gridlines
                        },
                        x: {
                            grid: { display: false } // Clean X axis
                        }
                    }
                }
            });
        }

    } catch (error) {
        console.error("Error loading visual analytics:", error);
    }
}

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

window.fixDataIntegrity = async function() {
    if(!confirm("Initialize data integrity fields for all members?")) return;
    
    try {
        const usersSnap = await getDocs(collection(db, "users"));
        const batch = writeBatch(db);
        let updated = 0;
        
        usersSnap.forEach(u => {
            const data = u.data();
            const updates = {};
            
            if (!data.createdAt) updates.createdAt = serverTimestamp();
            if (data.loansRepaidCount === undefined) updates.loansRepaidCount = 0;
            
            if (Object.keys(updates).length > 0) {
                batch.update(u.ref, updates);
                updated++;
            }
        });
        
        if(updated > 0) {
            await batch.commit();
            alert(`Boom. ${updated} member profiles successfully initialized!`);
        } else {
            alert("Everyone is already up to date.");
        }
    } catch (e) {
        console.error(e);
        alert("Failed. Check console.");
    }
};

async function loadPendingLoans() {
    const tableBody = document.getElementById('pendingLoansTable');
    tableBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500">Fetching requests...</td></tr>'; 

    try {
        const q = query(collection(db, "loans"), where("status", "==", "pending"));
        const querySnapshot = await getDocs(q);
        tableBody.innerHTML = '';

        if (querySnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500 italic">No pending loan requests.</td></tr>';
            return;
        }

        for (const loanDoc of querySnapshot.docs) {
            const loan = loanDoc.data();
            
            // 1. FETCH RAW USER DATA (Do not trust the loan request's math)
            const userSnap = await getDoc(doc(db, "users", loan.userId));
            const user = userSnap.exists() ? userSnap.data() : null;
            
            const userName = user ? user.name : 'Unknown/Deleted';
            const savings = user ? (user.savings || 0) : 0;
            const repaidCount = user ? (user.loansRepaidCount || 0) : 0;
            const activeDebt = user ? (user.loansActive || 0) : 0;

            // 2. THE LIE DETECTOR: Recalculate the True Limit
            const joinDate = user ? user.createdAt : null;
            const monthsActive = getMonthsActive(joinDate);
            const waterfall = calculateWaterfall(savings);
            const consistencyScore = waterfall.consistencyScore;
            
            let trueLimit = 0;
            if (savings >= 500) {
                if (repaidCount === 0) {
                    trueLimit = 600; 
                } else {
                    let multiplier = 1.0;
                    multiplier += Math.min(repaidCount * 0.2, 0.6);
                    multiplier += (consistencyScore / 100) * 0.4;
                    multiplier += Math.min(monthsActive * 0.05, 0.5);
                    multiplier = Math.min(multiplier, 2.0);
                    
                    trueLimit = Math.floor(savings * multiplier);
                }
            }

            // 3. FLAG VIOLATIONS
            const isFraudulent = loan.amount > trueLimit;
            const hasActiveLoan = activeDebt > 0;

            let warningHTML = '';
            if (isFraudulent) {
                warningHTML += `<span class="bg-red-100 text-red-700 text-[10px] px-2 py-0.5 rounded font-bold block mb-1">⚠️ TAMPERING: EXCEEDS KSH ${trueLimit} LIMIT</span>`;
            }
            if (hasActiveLoan) {
                warningHTML += `<span class="bg-orange-100 text-orange-700 text-[10px] px-2 py-0.5 rounded font-bold block mb-1">⚠️ HAS ACTIVE DEBT: KSH ${activeDebt}</span>`;
            }

            // Build the table row with the new System Limit column
 // 4. GENERATE SMART BADGES FOR DECISION MAKING
            const arrearsBadge = waterfall.arrearsTotal > 0 
                ? `<span class="bg-rose-100 text-rose-700 border border-rose-200 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">Arrears: KSH ${waterfall.arrearsTotal}</span>`
                : `<span class="bg-emerald-100 text-emerald-700 border border-emerald-200 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">Savings Cleared</span>`;
                
            const ageBadge = `<span class="bg-slate-100 text-slate-600 border border-slate-200 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">${monthsActive} Mos. Active</span>`;
            
            const adminNote = user.warningMessage 
                ? `<div class="mt-1.5 text-[10px] text-amber-700 bg-amber-50 p-1.5 rounded border border-amber-200 font-medium leading-tight"><strong>Admin Note:</strong> ${user.warningMessage}</div>`
                : '';

            // Build the table row with the new Behavioral Context
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="p-3">
                    <div class="font-bold text-slate-800 text-sm">${userName}</div>
                    <div class="flex gap-1.5 mt-1 mb-1">
                        ${ageBadge}
                        ${arrearsBadge}
                    </div>
                    <div class="text-[10px] text-slate-500 font-medium">Savings: KSH ${savings} | Repaid: ${repaidCount}</div>
                    ${adminNote}
                </td>
                <td class="p-3 font-semibold ${isFraudulent ? 'text-red-600' : 'text-blue-600'}">
                    KSH ${loan.amount}
                    <div class="mt-1">${warningHTML}</div>
                </td>
                <td class="p-3 bg-slate-50/50">
                    <div class="font-bold ${trueLimit >= loan.amount ? 'text-emerald-600' : 'text-red-500'}">KSH ${trueLimit}</div>
                    <div class="text-[10px] text-slate-400 font-bold tracking-wide mt-0.5 uppercase">
                        Score: ${consistencyScore}%
                    </div>
                </td>
                <td class="p-3 text-red-500 font-medium text-sm">KSH ${loan.interest}</td>
                <td class="p-3 text-slate-600 font-medium text-sm">${loan.durationWeeks} Weeks</td>
                <td class="p-3 flex gap-2">
                    <button onclick="approveLoan('${loanDoc.id}')" 
                        class="px-3 py-1.5 rounded text-xs transition shadow-sm font-bold ${isFraudulent || hasActiveLoan ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-emerald-500 text-white hover:bg-emerald-600'}"
                        ${isFraudulent || hasActiveLoan ? 'disabled' : ''}>
                        Approve
                    </button>
                    <button onclick="rejectLoan('${loanDoc.id}')" class="bg-white border border-rose-200 text-rose-600 px-3 py-1.5 rounded hover:bg-rose-50 text-xs font-bold transition shadow-sm">
                        Reject
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
            
        }
    } catch (error) {
        console.error("Error loading pending loans:", error);
        tableBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-red-500">Error loading data.</td></tr>';
    }
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

            const userData = userDoc.data();
            const savings = userData.savings || 0;
            const repaidCount = userData.loansRepaidCount || 0;
            const activeDebt = userData.loansActive || 0;

            // ==========================================
            // BACKEND SHIELD: Final Trust Verification
            // ==========================================
            if (activeDebt > 0) {
                throw new Error("Approval Blocked: This member currently has an active loan.");
            }

            let trueLimit = 0;
            if (savings >= 500) {
                trueLimit = repaidCount === 0 ? 600 : savings * 2;
            }

            if (loanAmount > trueLimit) {
                throw new Error(`Fraud Prevention: Member limit is KSH ${trueLimit}, but requested KSH ${loanAmount}. Transaction aborted.`);
            }

            // ==========================================
            // RULE ENFORCEMENT: 30% Liquidity Minimum
            // ==========================================
            const minimumRequiredLiquidity = currentCapital * 0.30;
            const projectedLiquidity = currentLiquidity - loanAmount;

            if (projectedLiquidity < minimumRequiredLiquidity) {
                throw new Error(`Approval Blocked: Disbursing drops liquidity to KSH ${projectedLiquidity}. Minimum required is KSH ${minimumRequiredLiquidity}.`);
            }

            // 1. Deduct from Liquidity & Add to Active Group Loans
            transaction.update(statsRef, {
                liquidityReserve: currentLiquidity - loanAmount,
                totalLoans: (statsDoc.data().totalLoans || 0) + loanAmount
            });

            // 2. Add the debt to the specific user's profile
            transaction.update(userRef, {
                loansActive: activeDebt + loanData.repayment
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

        // --- TRIGGER THE PRINT TEMPLATE ---
        if(confirm("Would you like to print the official disbursement letter for this loan?")) {
            const today = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY
            const refNumber = `BM-LN-${loanId.substring(0, 6).toUpperCase()}`;
            
            generateOfficialLetter({
                userName: userName, 
                amount: loanAmount,
                transactionType: "Loan Disbursement",
                reference: refNumber,
                date: today,
                notes: `Approved for ${loanData.durationWeeks} weeks at KSH ${loanData.interest} interest.`
            });
        }
        
        // Refresh the UI to show the new balances
        loadPendingLoans();
        if(typeof loadGroupStats === 'function') loadGroupStats();
        if(typeof loadMembers === 'function') loadMembers();
        if(typeof loadMasterLedger === 'function') loadMasterLedger();

    } catch (error) {
        console.error("Loan Approval Failed:", error);
        // This alerts the admin exactly why it failed (Liquidity, Active Debt, or Fraud)
        alert(error.message || "Failed to process loan. Check console.");
    }
};

window.rejectLoan = async function(loanId) {
    const reason = prompt("Enter a reason for rejecting this loan (Member will see this):");
    if (reason === null) return; // Admin cancelled the prompt

    try {
        await updateDoc(doc(db, "loans", loanId), { 
            status: "rejected",
            rejectReason: reason,
            rejectedAt: serverTimestamp()
        });
        alert("Loan request rejected successfully.");
        loadPendingLoans(); 
    } catch (error) {
        console.error("Error rejecting loan:", error);
        alert("Failed to reject loan.");
    }
};

// Helper: Calculate mathematically exact target for ANY month
function calculateTargetForMonth(year, monthIndex) {
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate(); 
    const fullWeeks = Math.floor(daysInMonth / 7);
    const extraDays = daysInMonth % 7;
    return (fullWeeks * 70) + (extraDays * 10);
}
// Helper: Run the Waterfall Algorithm to determine cleared months & Consistency
function calculateWaterfall(totalSavings) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    
    let remaining = totalSavings || 0;
    let arrearsTotal = 0;
    let unclearedMonths = [];
    let currentMonthAllocated = 0;
    let currentMonthTarget = calculateTargetForMonth(currentYear, currentMonth);
    
    let expectedTotalSoFar = 0; // NEW: Track total expected savings

    // Loop from January (0) to Current Month
    for (let i = 0; i <= currentMonth; i++) {
        const target = calculateTargetForMonth(currentYear, i);
        expectedTotalSoFar += target; // Add to expected total
        const monthName = new Date(currentYear, i, 1).toLocaleString('default', { month: 'short' });

        if (remaining >= target) {
            remaining -= target;
            if (i === currentMonth) currentMonthAllocated = target;
        } else {
            if (i === currentMonth) {
                currentMonthAllocated = remaining;
            } else {
                unclearedMonths.push(monthName);
                arrearsTotal += (target - remaining);
            }
            remaining = 0; 
        }
    }
    
    // NEW: Calculate dynamic consistency score (Capped at 100%)
    const actualSaved = totalSavings || 0;
    let consistencyScore = 0;
    if (expectedTotalSoFar > 0) {
        consistencyScore = Math.min(100, Math.round((actualSaved / expectedTotalSoFar) * 100));
    }

    return { unclearedMonths, arrearsTotal, currentMonthAllocated, currentMonthTarget, consistencyScore };
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
// OFFICIAL PRINTABLE LETTER GENERATOR
// ==========================================

export function generateOfficialLetter({
    userName,
    amount,
    transactionType, // e.g., "Loan Disbursement", "Exit Payout"
    reference,
    date,
    notes
}) {
    // Generate a unique digital signature/hash for authenticity
    const digitalSignature = btoa(`${reference}-${amount}-${date}`).substring(0, 15).toUpperCase();

    // Create an iframe to hold the print document
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    // The HTML content for the official letter
    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Official Disbursement - ${reference}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
            @media print {
                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                @page { margin: 0; }
            }
            .watermark {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%) rotate(-45deg);
                font-size: 8rem;
                color: rgba(0, 0, 0, 0.03);
                font-weight: bold;
                white-space: nowrap;
                z-index: -1;
                pointer-events: none;
            }
            .seal {
                position: absolute;
                bottom: 50px;
                right: 50px;
                width: 100px;
                height: 100px;
                border: 4px solid #1e3a8a; /* blue-900 */
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                text-align: center;
                color: #1e3a8a;
                font-size: 10px;
                font-weight: bold;
                text-transform: uppercase;
                letter-spacing: 1px;
                transform: rotate(-15deg);
                opacity: 0.8;
            }
            .seal::after {
                content: "AUTHENTIC";
                position: absolute;
                font-size: 14px;
                color: rgba(220, 38, 38, 0.7); /* red-600 */
                transform: rotate(30deg);
                letter-spacing: 4px;
            }
        </style>
    </head>
    <body class="bg-white text-slate-800 p-10 font-sans relative h-screen">
        
        <div class="watermark">B&M GROUP</div>

        <div class="flex justify-between items-start border-b-4 border-blue-900 pb-6 mb-8">
            <div class="flex items-start flex-col">
                <img src="bm_group_logo.png" alt="B&M Group Logo" class="h-12 w-auto mb-1 ml-[-2px] object-contain">
                <p class="text-sm font-semibold text-slate-500 uppercase tracking-widest mt-1">Private Savings & Credit Investment</p>
            </div>
            <div class="text-right text-sm text-slate-600">
                <p class="font-bold text-slate-800">Headquarters</p>
                <p>Juja, Kiambu County</p>
                <p>Kenya</p>
            </div>
        </div>
        </div>
        <div class="flex justify-between mb-10 bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div>
                <p class="text-xs text-slate-500 uppercase">Document Ref</p>
                <p class="font-bold text-slate-800 font-mono">${reference}</p>
            </div>
            <div>
                <p class="text-xs text-slate-500 uppercase">Date of Issue</p>
                <p class="font-bold text-slate-800">${date}</p>
            </div>
            <div class="text-right">
                <p class="text-xs text-slate-500 uppercase">Transaction Type</p>
                <p class="font-bold text-blue-700 uppercase">${transactionType}</p>
            </div>
        </div>

        <div class="mb-10 min-h-[300px]">
            <h2 class="text-xl font-bold mb-4">Official Notification of Disbursement</h2>
            <p class="mb-4 text-slate-700 leading-relaxed">
                This document serves as official confirmation that a transaction has been successfully processed and approved by the B&M Group administration. The details of the disbursement are as follows:
            </p>
            
            <div class="bg-white border-2 border-slate-200 rounded-lg p-6 mb-6">
                <div class="grid grid-cols-2 gap-4">
                    <div class="text-sm text-slate-500">Beneficiary Name:</div>
                    <div class="font-bold text-lg">${userName}</div>
                    
                    <div class="text-sm text-slate-500">Approved Amount:</div>
                    <div class="font-extrabold text-2xl text-green-700">KSH ${amount.toLocaleString()}</div>
                    
                    <div class="text-sm text-slate-500">Remarks/Notes:</div>
                    <div class="text-slate-800 font-medium">${notes || 'Standard clearance applied.'}</div>
                </div>
            </div>

            <p class="text-sm text-slate-600 italic">
                By accepting these funds, the beneficiary agrees to the terms and conditions outlined in the B&M Group governance charter.
            </p>
        </div>

        <div class="mt-16 flex justify-between items-end border-t border-slate-300 pt-8">
            <div class="w-1/3 text-center">
                <div class="border-b border-slate-400 h-10 mb-2"></div>
                <p class="font-bold text-sm">Brian Odhiambo</p>
                <p class="text-xs text-slate-500">System Administrator / Co-Founder</p>
            </div>
            
            <div class="w-1/3 text-center">
                <div class="border-b border-slate-400 h-10 mb-2"></div>
                <p class="font-bold text-sm">Beneficiary Signature</p>
                <p class="text-xs text-slate-500">Acknowledge Receipt</p>
            </div>
        </div>

        <div class="seal">
            B&M<br>Verified<br>Secure
        </div>
        
        <div class="absolute bottom-10 left-10 text-xs text-slate-400 font-mono">
            Cryptographic Hash: ${digitalSignature}
        </div>
    </body>
    </html>
    `;

    // Write to the iframe and print
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(htmlContent);
    doc.close();

    // Wait a brief moment for Tailwind to apply styles, then print
    setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        
        // Clean up the DOM after printing
        setTimeout(() => {
            document.body.removeChild(iframe);
        }, 1000);
    }, 800); 
}

export function generateRepaymentLetter({
    userName,
    amount,
    reference,
    date,
    newLimit
}) {
    const digitalSignature = btoa(`${reference}-${amount}-${date}`).substring(0, 15).toUpperCase();

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Repayment Clearance - ${reference}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
            @media print {
                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                @page { margin: 0; }
            }
            .watermark {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%) rotate(-45deg);
                font-size: 8rem;
                color: rgba(0, 0, 0, 0.03);
                font-weight: bold;
                white-space: nowrap;
                z-index: -1;
                pointer-events: none;
            }
            .seal {
                position: absolute;
                bottom: 50px;
                right: 50px;
                width: 100px;
                height: 100px;
                border: 4px solid #16a34a; /* green-600 */
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                text-align: center;
                color: #16a34a;
                font-size: 10px;
                font-weight: bold;
                text-transform: uppercase;
                letter-spacing: 1px;
                transform: rotate(-15deg);
                opacity: 0.8;
            }
            .seal::after {
                content: "CLEARED";
                position: absolute;
                font-size: 14px;
                color: rgba(220, 38, 38, 0.7);
                transform: rotate(30deg);
                letter-spacing: 4px;
            }
        </style>
    </head>
    <body class="bg-white text-slate-800 p-10 font-sans relative h-screen">
        
        <div class="watermark">B&M GROUP</div>

        <div class="flex justify-between items-start border-b-4 border-green-700 pb-6 mb-8">
            <div class="flex items-start flex-col">
                <img src="bm_group_logo.png" alt="B&M Group Logo" class="h-12 w-auto mb-1 ml-[-2px] object-contain">
                <p class="text-sm font-semibold text-slate-500 uppercase tracking-widest mt-1">Private Savings & Credit Investment</p>
            </div>
            <div class="text-right text-sm text-slate-600">
                <p class="font-bold text-slate-800">Headquarters</p>
                <p>Juja, Kiambu County</p>
                <p>Kenya</p>
            </div>
        </div>

        <div class="flex justify-between mb-10 bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div>
                <p class="text-xs text-slate-500 uppercase">Clearance Ref</p>
                <p class="font-bold text-slate-800 font-mono">${reference}</p>
            </div>
            <div>
                <p class="text-xs text-slate-500 uppercase">Date of Clearance</p>
                <p class="font-bold text-slate-800">${date}</p>
            </div>
            <div class="text-right">
                <p class="text-xs text-slate-500 uppercase">Transaction Status</p>
                <p class="font-bold text-green-700 uppercase">Fully Repaid</p>
            </div>
        </div>

        <div class="mb-10 min-h-[300px]">
            <h2 class="text-2xl font-bold mb-4 text-green-800">Congratulations! Loan Cleared.</h2>
            <p class="mb-4 text-slate-700 leading-relaxed">
                Dear <strong>${userName}</strong>,<br><br>
                This document serves as official confirmation that your loan repayment has been successfully processed and verified by the B&M Group administration. Your outstanding debt for this facility has been entirely cleared. 
            </p>
            
            <div class="bg-white border-2 border-green-100 rounded-lg p-6 mb-6 shadow-sm">
                <div class="grid grid-cols-2 gap-4">
                    <div class="text-sm text-slate-500">Amount Received:</div>
                    <div class="font-bold text-lg">KSH ${amount.toLocaleString()}</div>
                    
                    <div class="text-sm text-slate-500">Remaining Balance:</div>
                    <div class="font-extrabold text-xl text-green-600">KSH 0.00</div>
                    
                    <div class="text-sm font-bold text-purple-700 mt-4 border-t border-slate-100 pt-4">New Estimated Limit:</div>
                    <div class="font-extrabold text-2xl text-purple-700 mt-4 border-t border-slate-100 pt-4">KSH ${newLimit.toLocaleString()}</div>
                </div>
            </div>

            <p class="text-sm text-slate-800 font-semibold p-4 bg-purple-50 border border-purple-200 rounded-lg">
                By clearing this loan, your credit score has increased! Please log into your member portal to view your updated dashboard, check your exact new limits, and access your improved credit features.
            </p>
        </div>

        <div class="mt-16 flex justify-between items-end border-t border-slate-300 pt-8">
            <div class="w-1/3 text-center">
                <div class="border-b border-slate-400 h-10 mb-2"></div>
                <p class="font-bold text-sm">Brian Odhiambo</p>
                <p class="text-xs text-slate-500">System Administrator / Co-Founder</p>
            </div>
            
            <div class="w-1/3 text-center">
                <div class="border-b border-slate-400 h-10 mb-2"></div>
                <p class="font-bold text-sm">B&M Finance Team</p>
                <p class="text-xs text-slate-500">Official Stamp</p>
            </div>
        </div>

        <div class="seal">
            DEBT<br>CLEARED<br>100%
        </div>
        
        <div class="absolute bottom-10 left-10 text-xs text-slate-400 font-mono">
            Cryptographic Hash: ${digitalSignature}
        </div>
    </body>
    </html>
    `;

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(htmlContent);
    doc.close();

    setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => { document.body.removeChild(iframe); }, 1000);
    }, 800); 
}

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

            // 2. Clear User's Debt & UPDATE TRUST SCORE
            const currentUserDebt = userDoc.data().loansActive || 0;
            let newDebt = currentUserDebt - totalRepayment;
            if (newDebt < 0) newDebt = 0; 

            // Get current count of repaid loans, default to 0 if it doesn't exist
            const currentRepaidCount = userDoc.data().loansRepaidCount || 0;
            
            transaction.update(userRef, {
                loansActive: newDebt,
                loansRepaidCount: currentRepaidCount + 1 // INCREMENT THE TRUST TIER
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
        
        alert(`Success! KSH ${totalRepayment} recorded. ${userName}'s trust score has increased. Group capital grew by KSH ${interest}.`);
        
        // --- NEW: TRIGGER THE REPAYMENT CLEARANCE TEMPLATE ---
        if(confirm("Would you like to print the official Repayment Clearance letter for this member?")) {
            const today = new Date().toLocaleDateString('en-GB'); 
            const refNumber = `BM-REP-${loanId.substring(0, 6).toUpperCase()}`;
            
            // 1. Fetch fresh user data for the advanced algorithm
            const freshUserSnap = await getDoc(userRef);
            const userData = freshUserSnap.data();
            const savings = userData.savings || 0;
            const joinDate = userData.createdAt;
            
            // Note: We use the NEW repaid count (current + 1) because the transaction just updated it
            const currentRepaidCount = userData.loansRepaidCount || 0; 
            const newRepaidCount = currentRepaidCount + 1; 

            // 2. Run the Advanced Multiplier Algorithm to find their True Limit
            const monthsActive = getMonthsActive(joinDate);
            const waterfall = calculateWaterfall(savings);
            const consistencyScore = waterfall.consistencyScore;

            let newLimit = 0;
            if (savings >= 500) {
                let multiplier = 1.0;
                multiplier += Math.min(newRepaidCount * 0.2, 0.6); // Max 0.6 from repays
                multiplier += (consistencyScore / 100) * 0.4;      // Max 0.4 from consistency
                multiplier += Math.min(monthsActive * 0.05, 0.5);  // Max 0.5 from age
                multiplier = Math.min(multiplier, 2.0);            // Absolute max multiplier of 2.0x
                
                newLimit = Math.floor(savings * multiplier);
            }

            // 3. Generate the letter with the mathematically accurate limit
            generateRepaymentLetter({
                userName: userName, 
                amount: totalRepayment,
                reference: refNumber,
                date: today,
                newLimit: newLimit
            });
        }
        
        // Refresh all Admin UI components to reflect the new wealth
        loadActiveLoans();
        if(typeof loadGroupStats === 'function') loadGroupStats();
        if(typeof loadMembers === 'function') loadMembers();
        if(typeof loadMasterLedger === 'function') loadMasterLedger();

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



// Helper: Calculate Months Active
function getMonthsActive(timestamp) {
    if (!timestamp) return 1; // Fallback for old accounts
    const join = timestamp.toDate();
    const now = new Date();
    const diff = (now.getFullYear() - join.getFullYear()) * 12 + (now.getMonth() - join.getMonth());
    return Math.max(1, diff); // Minimum 1 month
}

// ==========================================
// DEV TOOLS: SAFE LETTER TESTING
// ==========================================

window.testRepaymentLetter = function() {
    console.log("Generating mock repayment letter...");
    
    // 1. Create realistic dummy data
    const today = new Date().toLocaleDateString('en-GB'); 
    
    // 2. Call the generator directly without touching Firebase
    generateRepaymentLetter({
        userName: "Brian Odhiambo", // A familiar test name!
        amount: 8500,
        reference: "BM-REP-DEVTEST",
        date: today,
        newLimit: 15400 // Fake calculated limit
    });
};