import { auth, db } from './firebase.js';
import { collection, query, where, orderBy, limit, getDocs, doc, updateDoc, addDoc, getDoc, runTransaction, serverTimestamp, writeBatch, Timestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-functions.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

onAuthStateChanged(auth, (user) => {
    if (user) {
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
        checkSystemStatus();
        loadSystemLogs();
        
        if (typeof listenToSOSRequests === 'function') listenToSOSRequests();
    } else {
        window.location.href = '/auth/login';
    }
});

document.addEventListener('DOMContentLoaded', () => {

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
        const addNewMember = httpsCallable(functions, 'addNewMember');

        const result = await addNewMember({
            fullName: name,
            memberId: memberId,
            email: email,
            password: password
        });

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
    const totalMembersCount = document.getElementById('totalMembersCount');
    const tableBody = document.getElementById('membersTableBody');
    tableBody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-500">Loading members...</td></tr>';

    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        tableBody.innerHTML = ''; 
        totalMembersCount.textContent = querySnapshot.size;

        querySnapshot.forEach((userDoc) => {
            const user = userDoc.data();
            const userId = userDoc.id;

            // --- 1. CALCULATE TIME CONTEXT ---
            const joinDateObj = (user.createdAt && typeof user.createdAt.toDate === 'function') ? user.createdAt.toDate() : new Date();
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
            
            const emBalance = user.emergencySavings || 0;
            const emState = user.emergencyStatus || 'active';
            const sosBtnClass = emState === 'suspended' ? 'bg-amber-50 text-amber-700 border-amber-300' : 'bg-slate-50 text-slate-600 border-slate-300';
            const sosBtnText = emState === 'suspended' ? 'Restore EF Access' : 'Suspend EF';
            // --- 4. BUILD THE ROW ---
            const row = document.createElement('tr');

            row.className = 'divide-x divide-slate-200';

            row.innerHTML = `
                <td class="p-4 align-top border-b border-slate-200">
                    <div class="font-bold text-slate-800 text-base">${user.name}</div>
                    <div class="text-xs text-slate-500 mt-0.5">${user.email}</div>
                    <div class="flex items-center gap-2 mt-2">
                        <span class="text-[9px] uppercase tracking-wider font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">${user.role || 'Member'}</span>
                        <span class="text-[10px] text-slate-400 font-semibold tracking-wide">Joined: ${joinDateString}</span>
                    </div>
                </td>
                
                <td class="p-4 align-top border-b border-slate-200">
                    <div class="flex gap-6 mb-2.5">
                        <div>
                            <div class="text-[9px] text-slate-400 uppercase font-bold tracking-widest mb-0.5">Savings</div>
                            <div class="text-sm font-bold text-emerald-600">KSH ${user.savings || 0}</div>
                            <div class="text-[9px] text-emerald-800 font-bold tracking-wide">EMERGENCY BAL: KSH ${emBalance}</div>
                        </div>
                        <div>
                            <div class="text-[9px] text-slate-400 uppercase font-bold tracking-widest mb-0.5">Active Debt</div>
                            <div class="text-sm font-bold ${user.loansActive > 0 ? 'text-rose-600' : 'text-slate-400'}">KSH ${user.loansActive || 0}</div>
                        </div>
                    </div>
                    <div class="flex gap-2">
                        <span class="bg-blue-50 text-blue-600 border border-blue-100 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">Score: ${consistencyScore}%</span>
                        <span class="bg-blue-50 text-blue-600 border border-blue-100 text-[9px] px-1.5 py-0.5 rounded font-bold italic uppercase tracking-wide">Loans Repaid: ${repaidCount}</span>
                    </div>
                </td>
                
                <td class="p-4 align-top border-b border-slate-200">
                    <div class="flex flex-col gap-1.5 items-start">
                        ${statusBadge}
                        ${verifiedBadge}
                        ${arrearsTotal > 0 
                            ? `<span class="bg-rose-50 text-rose-600 border border-rose-200 text-[9px] px-2 py-0.5 rounded font-bold uppercase tracking-wide mt-1">Owes: KSH ${arrearsTotal}</span>` 
                            : `<span class="bg-emerald-50 text-emerald-600 border border-emerald-200 text-[9px] px-2 py-0.5 rounded font-bold uppercase tracking-wide mt-1">No Arrears</span>`}
                    </div>
                </td>
                
                <td class="p-4 align-top w-48 border-b border-slate-200">
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

                    <button onclick="toggleSOSAccess('${userId}', '${emState}')" class="text-[10px] w-full text-left font-bold px-2 py-1.5 rounded mt-1 border ${sosBtnClass} hover:bg-slate-200 transition shadow-sm">
                        ${sosBtnText}
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
            await logAdminAction(auth.currentUser?.email || "System Admin", `Manually verified ID for member: ${userId}`, "INFO");
            loadMembers(); 
        } catch (error) {
            console.error("Error verifying member:", error);
            alert("Failed to verify member.");
        }
    }
};

window.issueWarning = async function(userId, userName, currentWarning) {
    const message = prompt(`Issue a warning/note to ${userName}:\n(Leave blank and click OK to clear existing warning)`, currentWarning);
    if (message === null) return; 

    try {
        await updateDoc(doc(db, "users", userId), { 
            warningMessage: message.trim() 
        });
        
        if (message.trim() === "") {
            await logAdminAction(auth.currentUser?.email || "System Admin", `Cleared warning for member: ${userId}`, "INFO");
            alert(`Warning cleared for ${userName}.`);
        } else {
            await logAdminAction(auth.currentUser?.email || "System Admin", `Issued warning to member: ${userId} | Warning: ${message.trim()}`, "WARN");
            alert(`Warning successfully sent to ${userName}. They will see this on their portal immediately.`);
        }
        
        loadMembers(); 
        
    } catch (error) {
        console.error("Error issuing warning:", error);
        alert("Failed to update warning message.");
    }
};

window.issueUpdate = async function(userId, userName, currentInfo) {
    const message = prompt(`Send a positive update/note to ${userName} (e.g., "Payment recorded", "Issue resolved"):\n(Leave blank and click OK to clear existing message)`, currentInfo);
    if (message === null) return; 

    try {
        await updateDoc(doc(db, "users", userId), { 
            infoMessage: message.trim() 
        });
        
        if (message.trim() === "") {
            await logAdminAction(auth.currentUser?.email || "System Admin", `Cleared update for member: ${userId}`, "INFO");
            alert(`Update cleared for ${userName}.`);
        } else {
            await logAdminAction(auth.currentUser?.email || "System Admin", `Sent update to member: ${userId} | Update: ${message.trim()}`, "INFO");
            alert(`Update successfully sent to ${userName}.`);
        }
        
        loadMembers(); 
        
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
            await logAdminAction(auth.currentUser?.email || "System Admin", `Changed status for member: ${userId} | New Status: ${newStatus}`, "INFO");
            loadMembers(); 
        } catch (error) {
            console.error("Error updating status:", error);
            alert("Failed to update status.");
        }
    }
};

// ==========================================
// SYSTEM HEALTH & SECURITY (KILL SWITCH)
// ==========================================

export async function checkSystemStatus() {
    const badge = document.getElementById('systemStatusBadge');
    const btn = document.getElementById('toggleMaintenanceBtn');
    if (!badge || !btn) return;

    try {
        const statsRef = doc(db, "groupStats", "main");
        
        onSnapshot(statsRef, (doc) => {
            if (doc.exists()) {
                const isLocked = doc.data().maintenanceMode || false;
                
                if (isLocked) {
                    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span> LOCKED DOWN`;
                    badge.className = "bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px] uppercase px-2 py-1 rounded font-bold tracking-wider flex items-center gap-2";
                    
                    btn.innerText = "RESTORE SYSTEM ACCESS";
                    btn.className = "w-full bg-emerald-600/20 border border-emerald-500 text-emerald-500 hover:bg-emerald-600 hover:text-white py-3 rounded-lg font-bold text-sm transition-all uppercase tracking-wider shadow-[0_0_15px_rgba(16,185,129,0.15)] hover:shadow-[0_0_20px_rgba(16,185,129,0.4)]";
                } else {
                    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> ONLINE`;
                    badge.className = "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] uppercase px-2 py-1 rounded font-bold tracking-wider flex items-center gap-2";
                    
                    btn.innerText = "LOCKDOWN SYSTEM";
                    btn.className = "w-full bg-rose-600/20 border border-rose-500 text-rose-500 hover:bg-rose-600 hover:text-white py-3 rounded-lg font-bold text-sm transition-all uppercase tracking-wider shadow-[0_0_15px_rgba(225,29,72,0.15)] hover:shadow-[0_0_20px_rgba(225,29,72,0.4)]";
                }
            }
        });
    } catch (error) {
        console.error("Error checking system status:", error);
    }
}

window.toggleSystemMaintenance = async function() {
    const statsRef = doc(db, "groupStats", "main");
    
    try {
        const docSnap = await getDoc(statsRef);
        const currentlyLocked = docSnap.data().maintenanceMode || false;
        
        if (!currentlyLocked) {
            if(!confirm("CRITICAL WARNING: Engaging lockdown will instantly kick all members offline and prevent logins, payments, and loan requests. Proceed?")) return;
        } else {
            if(!confirm("Are you sure you want to bring the system back online and restore member access?")) return;
        }

        await updateDoc(statsRef, {
            maintenanceMode: !currentlyLocked
        });

        await logAdminAction("SYSTEM_ADMIN", `System ${!currentlyLocked ? 'LOCKED DOWN' : 'RESTORED ONLINE'}`, "CRIT");
        
    } catch (error) {
        console.error("Failed to toggle system status:", error);
        alert("Error connecting to server. Cannot toggle status.");
    }
};

// ==========================================
// SYSTEM AUDIT LOGS (FLIGHT RECORDER)
// ==========================================

export async function logAdminAction(adminName, actionTrace, severity = "INFO") {
    try {
        await addDoc(collection(db, "systemLogs"), {
            timestamp: serverTimestamp(),
            adminName: adminName,
            actionTrace: actionTrace,
            severity: severity 
        });
    } catch (error) {
        console.error("Failed to write to audit log", error);
    }
}

export async function loadSystemLogs() {
    const tbody = document.getElementById('systemLogsBody');
    if (!tbody) return;

    try {
        const q = query(collection(db, "systemLogs"), orderBy("timestamp", "desc"), limit(20));
        
        onSnapshot(q, (snapshot) => {
            tbody.innerHTML = '';
            
            if (snapshot.empty) {
                tbody.innerHTML = '<tr><td colspan="4" class="py-3 px-2 text-slate-500 text-center italic">No system logs found.</td></tr>';
                return;
            }

            snapshot.forEach((docSnap) => {
                const log = docSnap.data();
                const timeStr = log.timestamp ? log.timestamp.toDate().toLocaleString('en-GB') : 'Just now';
                
                let severityBadge = '';
                if (log.severity === 'INFO') {
                    severityBadge = `<span class="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded text-[9px] font-bold">INFO</span>`;
                } else if (log.severity === 'WARN') {
                    severityBadge = `<span class="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded text-[9px] font-bold">WARN</span>`;
                } else if (log.severity === 'CRIT') {
                    severityBadge = `<span class="bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded text-[9px] font-bold">CRIT</span>`;
                }

                const row = document.createElement('tr');
                row.innerHTML = `
                    <td class="py-3 px-2 text-slate-500">${timeStr}</td>
                    <td class="py-3 px-2 text-blue-400 font-bold">${log.adminName}</td>
                    <td class="py-3 px-2">${log.actionTrace}</td>
                    <td class="py-3 px-2">${severityBadge}</td>
                `;
                tbody.appendChild(row);
            });
        });
    } catch (error) {
        console.error("Error loading system logs:", error);
        tbody.innerHTML = '<tr><td colspan="4" class="py-3 px-2 text-rose-500">Log retrieval failed.</td></tr>';
    }
}

// ==========================================
// VISUAL ANALYTICS DASHBOARD (Chart.js)
// ==========================================

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
        
        const capital = data.capital || 0;
        const liquidity = data.liquidityReserve || 0;
        const activeLoans = data.totalLoans || 0;
        const profit = data.totalProfit || 0;

        const ctxDoughnut = document.getElementById('capitalDoughnutChart');
        if (ctxDoughnut) {
            if (doughnutChartInstance) doughnutChartInstance.destroy();

            doughnutChartInstance = new Chart(ctxDoughnut, {
                type: 'doughnut',
                data: {
                    labels: ['Liquidity Reserve (Cash)', 'Active Loans (Debt)'],
                    datasets: [{
                        data: [liquidity, activeLoans],
                        backgroundColor: ['#10b981', '#ef4444'],
                        hoverOffset: 4,
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom' } },
                    cutout: '70%'
                }
            });
        }

        const ctxBar = document.getElementById('wealthBarChart');
        if (ctxBar) {
            if (barChartInstance) barChartInstance.destroy();

            barChartInstance = new Chart(ctxBar, {
                type: 'bar',
                data: {
                    labels: ['Total Capital', 'Total Profit'],
                    datasets: [{
                        label: 'KSH',
                        data: [capital, profit],
                        backgroundColor: ['#6ea2f5', '#078efd'],
                        borderRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { beginAtZero: true, grid: { borderDash: [5, 5] } },
                        x: { grid: { display: false } }
                    }
                }
            });
        }

        document.getElementById('totalCapitalSkeleton')?.classList.add('hidden');
        document.getElementById('activeLoansSkeleton')?.classList.add('hidden');
        document.getElementById('liquidityReserveSkeleton')?.classList.add('hidden');
        document.getElementById('capitalDoughnutSkeleton')?.classList.add('hidden');
        document.getElementById('wealthBarSkeleton')?.classList.add('hidden');
        document.getElementById('sosReserveSkeleton')?.classList.add('hidden');

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
        
        if (!statsSnap.exists()) throw new Error("Group stats not found.");

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

        await logAdminAction(auth.currentUser?.email || "System Admin", `Distributed annual profit | Amount: KSH ${currentProfit.toFixed(2)} | Members: ${memberCount}`, "INFO");

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
        await logAdminAction(auth.currentUser?.email || "System Admin", `Recorded deposit for member: ${userId} | Amount: KSH ${amount}`, "INFO");
        
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
            if (data.emergencySavings === undefined) updates.emergencySavings = 0;
            if (data.emergencyStatus === undefined) updates.emergencyStatus = 'active';
            
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

        const statsSnap = await getDoc(doc(db, "groupStats", "main"));
        const statsData = statsSnap.exists() ? statsSnap.data() : { capital: 0, totalLoans: 0 };

        for (const loanDoc of querySnapshot.docs) {
            const loan = loanDoc.data();
            
            const userSnap = await getDoc(doc(db, "users", loan.userId));
            const user = userSnap.exists() ? userSnap.data() : null;
            
            const userName = user ? user.name : 'Unknown/Deleted';
            const savings = user ? (user.savings || 0) : 0;
            const repaidCount = user ? (user.loansRepaidCount || 0) : 0;
            const activeDebt = user ? (user.loansActive || 0) : 0;

            const joinDate = user ? user.createdAt : null;
            const monthsActive = getMonthsActive(joinDate);
            const waterfall = calculateWaterfall(savings);
            const consistencyScore = waterfall.consistencyScore;
            
            let trueLimit = 0;
            if (user) {
                const limits = calculateSmartLimit(user, statsData, activeDebt, consistencyScore, monthsActive, waterfall.arrearsTotal);
                trueLimit = limits.finalLimit;
            }

            const isFraudulent = false; // Kept as requested by user originally
            const hasActiveLoan = activeDebt > 0;

            let warningHTML = '';
            if (isFraudulent) {
                warningHTML += `<span class="bg-red-100 text-red-700 text-[10px] px-2 py-0.5 rounded font-bold block mb-1">⚠️ EXCEEDS SYSTEM LIMIT: KSH ${trueLimit}</span>`;
            }
            if (hasActiveLoan) {
                warningHTML += `<span class="bg-orange-100 text-orange-700 text-[10px] px-2 py-0.5 rounded font-bold block mb-1">⚠️ HAS ACTIVE DEBT: KSH ${activeDebt}</span>`;
            }

            const arrearsBadge = waterfall.arrearsTotal > 0 
                ? `<span class="bg-rose-100 text-rose-700 border border-rose-200 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">Arrears: KSH ${waterfall.arrearsTotal}</span>`
                : `<span class="bg-emerald-100 text-emerald-700 border border-emerald-200 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">Savings Cleared</span>`;
                
            const ageBadge = `<span class="bg-slate-100 text-slate-600 border border-slate-200 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">${monthsActive} Mos. Active</span>`;
            
            const adminNote = user && user.warningMessage 
                ? `<div class="mt-1.5 text-[10px] text-amber-700 bg-amber-50 p-1.5 rounded border border-amber-200 font-medium leading-tight"><strong>Admin Note:</strong> ${user.warningMessage}</div>`
                : '';

            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="p-3 border border-slate-200">
                    <div class="font-bold text-slate-800 text-sm">${userName}</div>
                    <div class="flex gap-1.5 mt-1 mb-1">
                        ${ageBadge}
                        ${arrearsBadge}
                    </div>
                    <div class="text-[10px] text-slate-500 font-medium">Savings: KSH ${savings} | Repaid: ${repaidCount}</div>
                    ${adminNote}
                </td>
                <td class="p-3 font-semibold ${isFraudulent ? 'text-red-600' : 'text-blue-600'} border border-slate-200">
                    KSH ${loan.amount}
                    <div class="mt-1">${warningHTML}</div>
                </td>
                <td class="p-3 bg-slate-50/50 border border-slate-200">
                    <div class="font-bold ${trueLimit >= loan.amount ? 'text-emerald-600' : 'text-red-500'}">KSH ${trueLimit}</div>
                    <div class="text-[10px] text-slate-400 font-bold tracking-wide mt-0.5 uppercase">
                        Score: ${consistencyScore}%
                    </div>
                </td>
                <td class="p-3 text-red-500 font-medium text-sm border border-slate-200">KSH ${loan.interest}</td>
                <td class="p-3 text-slate-600 font-medium text-sm border border-slate-200">${loan.durationWeeks} Weeks</td>
                <td class="p-3 flex gap-2 border border-slate-200">
                    <button onclick="approveLoan('${loanDoc.id}', this)" 
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

window.approveLoan = async function(loanId, btn) {
    if (!confirm("Approve this loan and disburse the funds?")) return;

    if (btn) {
        btn.disabled = true;
        btn.classList.add("opacity-50", "cursor-not-allowed");
        btn.innerText = "Processing...";
    }

    const loanRef = doc(db, "loans", loanId);
    const statsRef = doc(db, "groupStats", "main");

    let approvedLoanAmount = 0;
    let approvedInterest = 0;
    let approvedDuration = 0;
    let approvedUserName = 'Member';
    let approvedUserId = ''; 

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
            const activeDebt = userData.loansActive || 0;

            approvedUserId = loanData.userId;
            approvedLoanAmount = loanAmount;
            approvedInterest = loanData.interest;
            approvedDuration = loanData.durationWeeks;
            approvedUserName = userData.name || 'Member';

            if (activeDebt > 0) throw new Error("Approval Blocked: This member currently has an active loan.");

            const waterfall = calculateWaterfall(savings);
            const monthsActive = getMonthsActive(userData.createdAt);
            
            const limits = calculateSmartLimit(userData, statsDoc.data(), activeDebt, waterfall.consistencyScore, monthsActive, waterfall.arrearsTotal);
            const trueLimit = limits.finalLimit;

            if (loanAmount > trueLimit) {
                throw new Error(`Transaction Blocked: Due to current group liquidity and equity rules, the max allowed is KSH ${trueLimit}, but requested is KSH ${loanAmount}.`);
            }

            const minimumRequiredLiquidity = currentCapital * 0.30;
            const projectedLiquidity = currentLiquidity - loanAmount;

            if (projectedLiquidity < minimumRequiredLiquidity) {
                throw new Error(`Approval Blocked: Disbursing drops liquidity to KSH ${projectedLiquidity}. Minimum required is KSH ${minimumRequiredLiquidity}.`);
            }

            transaction.update(statsRef, {
                liquidityReserve: currentLiquidity - loanAmount,
                totalLoans: (statsDoc.data().totalLoans || 0) + loanAmount
            });

            transaction.update(userRef, {
                loansActive: activeDebt + loanData.repayment
            });

            transaction.update(loanRef, {
                status: "approved",
                approvedAt: serverTimestamp()
            });

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
        
        await logAdminAction(auth.currentUser?.email || "System Admin", `Approved and disbursed loan for member: ${approvedUserId} | Amount: KSH ${approvedLoanAmount}`, "INFO");

        if(confirm("Would you like to print the official disbursement letter for this loan?")) {
            const today = new Date().toLocaleDateString('en-GB'); 
            const refNumber = `BM-LN-${loanId.substring(0, 6).toUpperCase()}`;
            
            generateOfficialLetter({
                userName: approvedUserName, 
                amount: approvedLoanAmount,
                interest: approvedInterest,
                durationWeeks: approvedDuration,
                transactionType: "Loan Disbursement",
                reference: refNumber,
                date: today,
                notes: `Approved for ${approvedDuration} weeks at KSH ${approvedInterest} interest.`
            });
        }
        
        loadPendingLoans();
        if(typeof loadGroupStats === 'function') loadGroupStats();
        if(typeof loadMembers === 'function') loadMembers();
        if(typeof loadMasterLedger === 'function') loadMasterLedger();

    } catch (error) {
        console.error("Loan Approval Failed:", error);
        alert(error.message || "Failed to process loan. Check console.");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove("opacity-50", "cursor-not-allowed");
            btn.innerText = "Approve";
        }
    }
};

window.rejectLoan = async function(loanId) {
    const reason = prompt("Enter a reason for rejecting this loan (Member will see this):");
    if (reason === null) return; 

    try {
        await updateDoc(doc(db, "loans", loanId), { 
            status: "rejected",
            rejectReason: reason,
            rejectedAt: serverTimestamp()
        });
        alert("Loan request rejected successfully.");
        await logAdminAction(auth.currentUser?.email || "System Admin", `Rejected loan request: ${loanId} | Reason: ${reason}`, "INFO");
        loadPendingLoans(); 
    } catch (error) {
        console.error("Error rejecting loan:", error);
        alert("Failed to reject loan.");
    }
};

function calculateTargetForMonth(year, monthIndex) {
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate(); 
    const fullWeeks = Math.floor(daysInMonth / 7);
    const extraDays = daysInMonth % 7;
    return (fullWeeks * 70) + (extraDays * 10);
}

function calculateWaterfall(totalSavings) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    
    let remaining = totalSavings || 0;
    let arrearsTotal = 0;
    let unclearedMonths = [];
    let currentMonthAllocated = 0;
    let currentMonthTarget = calculateTargetForMonth(currentYear, currentMonth);
    
    let expectedTotalSoFar = 0;

    for (let i = 0; i <= currentMonth; i++) {
        const target = calculateTargetForMonth(currentYear, i);
        expectedTotalSoFar += target;
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
    
    const actualSaved = totalSavings || 0;
    let consistencyScore = 0;
    if (expectedTotalSoFar > 0) {
        consistencyScore = Math.min(100, Math.round((actualSaved / expectedTotalSoFar) * 100));
    }

    return { unclearedMonths, arrearsTotal, currentMonthAllocated, currentMonthTarget, consistencyScore };
}

function calculateSmartLimit(user, statsData, activeDebt, consistencyScore, monthsActive, arrearsTotal) {
    const savings = user.savings || 0;
    const repaidCount = user.loansRepaidCount || 0;
    
    const totalGroupCapital = statsData.capital || 0;
    const totalLentOut = statsData.totalLoans || 0; 
    const maxGroupLoanable = totalGroupCapital * 0.70;
    const globalRemainingLiquidity = Math.max(0, maxGroupLoanable - totalLentOut);

    if (savings < 500 || arrearsTotal > 300 || user.status === 'restricted') {
        return { baseLimit: 0, finalLimit: 0 };
    }

    let baseLimit = 0;

    if (repaidCount === 0) {
        baseLimit = 600;
    } else {
        const equityShare = totalGroupCapital > 0 ? (savings / totalGroupCapital) : 0;
        
        let earnedMultiplier = 1.0;
        earnedMultiplier += Math.min(repaidCount * 0.2, 0.6);
        earnedMultiplier += (consistencyScore / 100) * 0.4;
        earnedMultiplier += Math.min(monthsActive * 0.05, 0.5);
        earnedMultiplier = Math.min(earnedMultiplier, 1.5);

        const vaultHealthRatio = totalGroupCapital > 0 ? (globalRemainingLiquidity / maxGroupLoanable) : 0;
        const penaltyResistance = Math.min(1.0, equityShare * 1.5);
        const scaledHealth = vaultHealthRatio + ((1 - vaultHealthRatio) * penaltyResistance);
        
        const dynamicMultiplier = Math.max(0.8, earnedMultiplier * scaledHealth);
        baseLimit = Math.floor(savings * dynamicMultiplier);
    }

    let calculatedLimitBeforeVault = Math.max(0, baseLimit - activeDebt);
    
    const equityShare = totalGroupCapital > 0 ? (savings / totalGroupCapital) : 0;
    const allowedExposureRatio = Math.min(0.95, 0.30 + equityShare);
    let maxSingleExposure = globalRemainingLiquidity * allowedExposureRatio;
    maxSingleExposure = Math.max(maxSingleExposure, savings); 

    const finalSmartLimit = Math.floor(Math.min(calculatedLimitBeforeVault, globalRemainingLiquidity, maxSingleExposure));

    return { baseLimit, finalLimit: finalSmartLimit };
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

            const waterfall = calculateWaterfall(user.savings);

            let progressPercentage = (waterfall.currentMonthAllocated / waterfall.currentMonthTarget) * 100;
            if (progressPercentage > 100) progressPercentage = 100;

            let barColor = 'bg-blue-500';
            if (progressPercentage === 100) barColor = 'bg-green-500';
            if (progressPercentage === 0) barColor = 'bg-slate-300';

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
                <td class="p-4 w-1/4 border border-slate-200">
                    <div class="font-semibold text-gray-800">${user.name}</div>
                    <div class="w-full bg-slate-200 rounded-full h-1.5 mt-2">
                        <div class="${barColor} h-1.5 rounded-full transition-all duration-500" style="width: ${progressPercentage}%"></div>
                    </div>
                    <div class="text-xs text-slate-500 mt-1 font-medium">
                        ${waterfall.currentMonthAllocated} / ${waterfall.currentMonthTarget} KSH this month
                    </div>
                </td>
                
                <td class="p-4 w-1/4 border border-slate-200">${arrearsHTML}</td>
                <td class="p-4 text-green-600 font-bold border border-slate-200" id="savings-${userId}">KSH ${user.savings || 0}</td>
                
                <td class="p-4 border border-slate-200">
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
// INBOX, GRIEVANCES & EXITS
// ==========================================

export async function loadGrievances() {
    const container = document.getElementById('grievancesContainer');
    container.innerHTML = '<p class="text-sm text-slate-500">Loading messages...</p>';

    try {
        const q = query(
            collection(db, "messages"), 
            where("type", "==", "grievance"),
            where("status", "==", "unread"),
            orderBy("createdAt", "asc")
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            container.innerHTML = '<p class="text-sm text-slate-500 italic">No pending grievances.</p>';
            return;
        }

        let htmlContent = '';

        for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            const userSnap = await getDoc(doc(db, "users", data.userId));
            const userName = userSnap.exists() ? userSnap.data().name : 'Unknown User';
            const dateStr = data.createdAt ? data.createdAt.toDate().toLocaleDateString() : 'Just now';

            const safeMessage = (data.message || '')
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/\n/g, "<br>");

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
        container.innerHTML = htmlContent;

    } catch (error) {
        console.error("Error loading grievances:", error);
        container.innerHTML = '<p class="text-sm text-red-500">Error loading messages. Check index.</p>';
    }
}

window.resolveGrievance = async function(messageId, userId) {
    if (!confirm("Mark this grievance as resolved and notify the member?")) return;

    try {
        await updateDoc(doc(db, "messages", messageId), { status: "resolved" });
        
        await updateDoc(doc(db, "users", userId), {
            infoMessage: "Your recent support ticket/grievance has been reviewed and resolved by the Admins."
        });

        alert("Grievance resolved! The member has been notified on their portal.");
        await logAdminAction(auth.currentUser?.email || "System Admin", `Resolved grievance for member: ${userId}`, "INFO");
        loadGrievances(); 
        loadMembers();    
        
    } catch (error) {
        console.error(error);
        alert("Failed to resolve message.");
    }
};

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

window.rejectExit = async function(requestId) {
    if(!confirm("Are you sure you want to reject this exit application?")) return;
    await updateDoc(doc(db, "exitRequests", requestId), { status: "rejected" });
    await logAdminAction(auth.currentUser?.email || "System Admin", `Rejected exit request: ${requestId}`, "INFO");
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
            
            const currentCapital = statsDoc.data().capital || 0;
            const currentLiquidity = statsDoc.data().liquidityReserve || 0;
            
            transaction.update(statsRef, {
                capital: currentCapital - payoutAmount,
                liquidityReserve: currentLiquidity - payoutAmount
            });

            transaction.update(userRef, {
                status: "exited",
                savings: 0
            });

            transaction.update(requestRef, {
                status: "approved_paid",
                payoutAmount: payoutAmount,
                resolvedAt: serverTimestamp()
            });

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
        await logAdminAction(auth.currentUser?.email || "System Admin", `Processed exit payout for member: ${userId} | Amount: KSH ${payoutAmount}`, "INFO");
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
    if (!tableBody) return; 
    
    tableBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500">Loading master ledger...</td></tr>';

    try {
        const usersSnap = await getDocs(collection(db, "users"));
        const userMap = {};
        usersSnap.forEach(doc => { 
            userMap[doc.id] = doc.data().name; 
        });

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

window.exportLedgerCSV = function() {
    const table = document.querySelector("#ledger table");
    if (!table) return;

    let csvContent = "";
    
    for (let row of table.rows) {
        let rowData = [];
        for (let cell of row.cells) {
            let text = cell.innerText.replace(/,/g, "").replace(/\n/g, " ").trim();
            rowData.push(text);
        }
        csvContent += rowData.join(",") + "\n";
    }
    
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
    interest,          
    durationWeeks,     
    transactionType,
    reference,
    date,
    notes
}) {
    const principal = Number(amount) || 0;
    const interestAmt = Number(interest) || 0;
    const totalRepayment = principal + interestAmt;

    let baseDate = new Date();
    if (date && date.includes('/')) {
        const parts = date.split('/');
        if (parts.length === 3) {
            baseDate = new Date(parts[2], parts[1] - 1, parts[0]);
        }
    } else if (date) {
        baseDate = new Date(date);
    }
    
    if (isNaN(baseDate.getTime())) {
        baseDate = new Date();
    }

    const repaymentDateObj = new Date(baseDate.getTime());
    repaymentDateObj.setDate(repaymentDateObj.getDate() + ((Number(durationWeeks) || 0) * 7));
    
    const expectedRepaymentDate = repaymentDateObj.toLocaleDateString('en-GB');

    // --- ENHANCED CRYPTOGRAPHIC HASH (PATCHED) ---
    // 1. Define the System Secret Key
    const secretKey = "BM_VAULT_2026_X9Q"; 
    
    // 2. Combine all critical data points + the secret key
    const rawDataString = `${reference}-${userName}-${principal}-${interestAmt}-${durationWeeks}-${expectedRepaymentDate}-${secretKey}`;
    
    // 3. Generate the full hash (No truncation, strip equals signs for cleaner URLs)
    const digitalSignature = btoa(rawDataString).replace(/=/g, '').toUpperCase();
    
    // 4. Encode variables for the URL
    const encodedName = encodeURIComponent(userName);
    const encodedDate = encodeURIComponent(expectedRepaymentDate);
    
    // 5. Build the QR Payload (Passes the ingredients, NOT the secret key)
    const qrContent = `https://bmfinance.netlify.app/verify/vrf.html?r=${reference}&n=${encodedName}&p=${principal}&i=${interestAmt}&w=${durationWeeks}&d=${encodedDate}&h=${digitalSignature}`;

    const docDefinition = {
        pageSize: 'A4',
        pageMargins: [40, 45, 40, 45],

        background: function () {
            return [
                {
                    text: 'B&M GROUP',
                    color: '#d1d5db',
                    opacity: 0.08,
                    bold: true,
                    fontSize: 80,
                    absolutePosition: { x: 120, y: 320 },
                    angle: -45
                }
            ];
        },

        content: [
            // ================= HEADER =================
            {
                columns: [
                    [
                        { text: 'B&M GROUP', fontSize: 28, bold: true, color: '#0f172a' },
                        { text: 'Private Savings & Credit Investment', fontSize: 10, color: '#64748b', margin: [0, 4, 0, 0], characterSpacing: 1 }
                    ],
                    [
                        { text: 'Headquarters', alignment: 'right', bold: true, fontSize: 12, color: '#0f172a' },
                        { text: 'Juja, Kiambu County\nKenya', alignment: 'right', fontSize: 10, color: '#64748b', margin: [0, 5, 0, 0] }
                    ]
                ]
            },

            // ================= BLUE LINE =================
            {
                canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 4, lineColor: '#1e3a8a' }],
                margin: [0, 15, 0, 25]
            },
            
            // ================= SECURITY HASH TOP DISPLAY =================

            // ================= TOP INFO CARDS =================
            {
                table: {
                    widths: ['33%', '33%', '34%'],
                    body: [[
                        {
                            stack: [
                                { text: 'DOCUMENT REF', fontSize: 9, color: '#64748b', bold: true },
                                { text: reference, bold: true, fontSize: 12, color: '#0f172a' }
                            ],
                            fillColor: '#f8fafc', margin: [12, 12, 12, 12]
                        },
                        {
                            stack: [
                                { text: 'DATE OF ISSUE', fontSize: 9, color: '#64748b', bold: true },
                                { text: date, bold: true, fontSize: 12, color: '#0f172a' }
                            ],
                            fillColor: '#f8fafc', margin: [12, 12, 12, 12]
                        },
                        {
                            stack: [
                                { text: 'TRANSACTION TYPE', fontSize: 9, color: '#64748b', bold: true, alignment: 'right' },
                                { text: transactionType.toUpperCase(), bold: true, fontSize: 11, color: '#1d4ed8', alignment: 'right' }
                            ],
                            fillColor: '#f8fafc', margin: [12, 12, 12, 12]
                        }
                    ]]
                },
                layout: { hLineColor: '#e2e8f0', vLineColor: '#e2e8f0', hLineWidth: () => 1, vLineWidth: () => 1 },
                margin: [0, 0, 0, 30]
            },

            // ================= TITLE =================
            {
                text: 'DISBURSEMENT AGREEMENT',
                fontSize: 18,
                bold: true,
                color: '#0f172a',
                characterSpacing: 1,
                margin: [0, 0, 0, 10]
            },

            // ================= DESCRIPTION =================
            {
                text: `This document serves as the official financial agreement and confirmation of fund disbursement between B&M Group and the recognized beneficiary, ${userName}.`,
                fontSize: 11,
                color: '#475569',
                lineHeight: 1.5,
                margin: [0, 0, 0, 20]
            },

            // ================= FINANCIAL GRID =================
            {
                table: {
                    widths: ['45%', '55%'],
                    body: [
                        [
                            { text: 'FACILITY BREAKDOWN', colSpan: 2, fontSize: 10, bold: true, color: '#64748b', fillColor: '#f1f5f9', margin: [10, 8, 10, 8] },
                            {}
                        ],
                        [
                            { text: 'Beneficiary Name', fontSize: 11, color: '#64748b', margin: [10, 10, 10, 10] },
                            { text: userName, fontSize: 12, bold: true, color: '#0f172a', margin: [10, 10, 10, 10] }
                        ],
                        [
                            { text: 'Principal Amount', fontSize: 11, color: '#64748b', margin: [10, 10, 10, 10] },
                            { text: `KSH ${principal.toLocaleString()}`, fontSize: 12, bold: true, color: '#0f172a', margin: [10, 10, 10, 10] }
                        ],
                        [
                            { text: 'Approved Duration', fontSize: 11, color: '#64748b', margin: [10, 10, 10, 10] },
                            { text: `${durationWeeks} Weeks`, fontSize: 12, bold: true, color: '#0f172a', margin: [10, 10, 10, 10] }
                        ],
                        [
                            { text: 'System Interest Fee', fontSize: 11, color: '#64748b', margin: [10, 10, 10, 10] },
                            { text: `KSH ${interestAmt.toLocaleString()}`, fontSize: 12, bold: true, color: '#0f172a', margin: [10, 10, 10, 10] }
                        ],
                        [
                            { text: 'TOTAL REPAYMENT DUE', fontSize: 11, bold: true, color: '#065f46', fillColor: '#ecfdf5', margin: [10, 12, 10, 12] },
                            { text: `KSH ${totalRepayment.toLocaleString()}`, fontSize: 14, bold: true, color: '#059669', fillColor: '#ecfdf5', margin: [10, 12, 10, 12] }
                        ],
                        [
                            { text: 'EXPECTED REPAYMENT DATE', fontSize: 11, bold: true, color: '#991b1b', fillColor: '#fef2f2', margin: [10, 12, 10, 12] },
                            { text: expectedRepaymentDate, fontSize: 14, bold: true, color: '#dc2626', fillColor: '#fef2f2', margin: [10, 12, 10, 12] }
                        ]
                    ]
                },
                layout: { hLineColor: '#cbd5e1', vLineColor: '#cbd5e1', hLineWidth: () => 1, vLineWidth: () => 1 },
                margin: [0, 0, 0, 20]
            },

            // ================= ADMINISTRATIVE PORTAL NOTE =================
            {
                stack: [
                    { text: 'ADMINISTRATIVE NOTES', fontSize: 9, bold: true, color: '#64748b', margin: [0, 0, 0, 5] },
                    { text: notes || 'Standard clearance applied. Late repayments will negatively impact your system trust score and future borrowing limits.', fontSize: 10, color: '#334155', margin: [0, 0, 0, 5] },
                    { text: 'Please note that repayment information, and your updated financial standing can be accessed at any time by logging into your B&M Group member portal.', fontSize: 10, bold: true, color: '#1d4ed8' }
                ],
                padding: [15, 15, 15, 15],
                margin: [0, 0, 0, 40]
            },

            // ================= SIGNATURE AREA =================
            {
                columns: [
                    {
                        width: '45%',
                        stack: [
                                                    ]
                    },
                    {
                        width: '45%',
                        stack: [
                            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 180, y2: 0, lineWidth: 1, lineColor: '#94a3b8' }] },
                            { text: 'Beneficiary Signature', bold: true, alignment: 'center', margin: [0, 10, 0, 3], color: '#0f172a' },
                            { text: 'Acknowledge Receipt', fontSize: 10, color: '#64748b', alignment: 'center' }
                        ]
                    }
                ],
                columnGap: 30
            },

            // ================= REPLACED HASH WITH QR CODE =================
            {
                qr: qrContent,
                fit: 150, 
                absolutePosition: { x: 40, y: 715 }
            },

            // ================= STAMP / SEAL =================
            {
                absolutePosition: { x: 450, y: 720 },
                canvas: [
                    { type: 'ellipse', x: 45, y: 45, r1: 45, r2: 45, lineWidth: 3, lineColor: '#1e3a8a' }
                ]
            },
            {
                absolutePosition: { x: 450, y: 738 },
                columns: [
                    { width: 90, text: 'B&M\nVERIFIED', alignment: 'center', color: '#1e3a8a', fontSize: 9, bold: true }
                ]
            },
            {
                absolutePosition: { x: 450, y: 762 },
                columns: [
                    { width: 90, text: 'AUTHENTIC', alignment: 'center', color: '#dc2626', fontSize: 12, bold: true, angle: -20 }
                ]
            }

        ] 
    };

    pdfMake.createPdf(docDefinition).download(`${reference}.pdf`);
}

export function generateRepaymentLetter({
    userName,
    amount,
    reference,
    date,
    newLimit
}) {
    // --- ENHANCED CRYPTOGRAPHIC HASH FOR REPAYMENT ---
    const secretKey = "BM_VAULT_2026_X9Q"; 
    const rawDataString = `${reference}-${amount}-${date}-${secretKey}`;
    const digitalSignature = btoa(rawDataString).replace(/=/g, '').toUpperCase();
    
    const encodedDate = encodeURIComponent(date);
    
    // Generates a verification URL payload for repayments
    const qrContent = `https://bmfinance.netlify.app/verify/repayment?r=${reference}&a=${amount}&d=${encodedDate}&h=${digitalSignature}`;

    const docDefinition = {
        pageSize: 'A4',
        pageMargins: [40, 45, 40, 45],

        background: function () {
            return [
                {
                    text: 'B&M GROUP',
                    color: '#d1d5db',
                    opacity: 0.08,
                    bold: true,
                    fontSize: 80,
                    absolutePosition: { x: 120, y: 320 },
                    angle: -45
                }
            ];
        },

        content: [
            // ================= HEADER =================
            {
                columns: [
                    [
                        { text: 'B&M GROUP', fontSize: 28, bold: true, color: '#0f172a' },
                        { text: 'Private Savings & Credit Investment', fontSize: 10, color: '#64748b', margin: [0, 4, 0, 0], characterSpacing: 1 }
                    ],
                    [
                        { text: 'Headquarters', alignment: 'right', bold: true, fontSize: 12, color: '#0f172a' },
                        { text: 'Juja, Kiambu County\nKenya', alignment: 'right', fontSize: 10, color: '#64748b', margin: [0, 5, 0, 0] }
                    ]
                ]
            },

            // ================= GREEN SUCCESS LINE =================
            {
                canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 4, lineColor: '#16a34a' }], // Green line
                margin: [0, 15, 0, 25]
            },

            // ================= TOP INFO CARDS =================
            {
                table: {
                    widths: ['33%', '33%', '34%'],
                    body: [[
                        {
                            stack: [
                                { text: 'CLEARANCE REF', fontSize: 9, color: '#64748b', bold: true },
                                { text: reference, bold: true, fontSize: 12, color: '#0f172a' }
                            ],
                            fillColor: '#f8fafc', margin: [12, 12, 12, 12]
                        },
                        {
                            stack: [
                                { text: 'DATE OF CLEARANCE', fontSize: 9, color: '#64748b', bold: true },
                                { text: date, bold: true, fontSize: 12, color: '#0f172a' }
                            ],
                            fillColor: '#f8fafc', margin: [12, 12, 12, 12]
                        },
                        {
                            stack: [
                                { text: 'TRANSACTION STATUS', fontSize: 9, color: '#64748b', bold: true, alignment: 'right' },
                                { text: 'FULLY REPAID', bold: true, fontSize: 11, color: '#16a34a', alignment: 'right' }
                            ],
                            fillColor: '#f0fdf4', margin: [12, 12, 12, 12] // Light green background
                        }
                    ]]
                },
                layout: { hLineColor: '#e2e8f0', vLineColor: '#e2e8f0', hLineWidth: () => 1, vLineWidth: () => 1 },
                margin: [0, 0, 0, 30]
            },

            // ================= TITLE =================
            {
                text: 'REPAYMENT CLEARANCE CERTIFICATE',
                fontSize: 18,
                bold: true,
                color: '#16a34a', // Green title
                characterSpacing: 1,
                margin: [0, 0, 0, 10]
            },

            // ================= DESCRIPTION =================
            {
                text: `Dear ${userName},\n\nThis document serves as official confirmation that your loan repayment has been successfully processed and verified by the B&M Group administration. Your outstanding debt for this facility has been entirely cleared.`,
                fontSize: 11,
                color: '#475569',
                lineHeight: 1.5,
                margin: [0, 0, 0, 20]
            },

            // ================= FINANCIAL GRID =================
            {
                table: {
                    widths: ['45%', '55%'],
                    body: [
                        [
                            { text: 'CLEARANCE SUMMARY', colSpan: 2, fontSize: 10, bold: true, color: '#64748b', fillColor: '#f1f5f9', margin: [10, 8, 10, 8] },
                            {}
                        ],
                        [
                            { text: 'Beneficiary Name', fontSize: 11, color: '#64748b', margin: [10, 10, 10, 10] },
                            { text: userName, fontSize: 12, bold: true, color: '#0f172a', margin: [10, 10, 10, 10] }
                        ],
                        [
                            { text: 'Amount Received', fontSize: 11, color: '#64748b', margin: [10, 10, 10, 10] },
                            { text: `KSH ${Number(amount).toLocaleString()}`, fontSize: 12, bold: true, color: '#0f172a', margin: [10, 10, 10, 10] }
                        ],
                        [
                            { text: 'Remaining Balance', fontSize: 11, bold: true, color: '#16a34a', fillColor: '#f0fdf4', margin: [10, 12, 10, 12] },
                            { text: 'KSH 0.00', fontSize: 14, bold: true, color: '#15803d', fillColor: '#f0fdf4', margin: [10, 12, 10, 12] }
                        ],
                        [
                            { text: 'NEW ESTIMATED CREDIT LIMIT', fontSize: 11, bold: true, color: '#6b21a8', fillColor: '#faf5ff', margin: [10, 12, 10, 12] },
                            { text: `KSH ${Number(newLimit).toLocaleString()}`, fontSize: 14, bold: true, color: '#7e22ce', fillColor: '#faf5ff', margin: [10, 12, 10, 12] }
                        ]
                    ]
                },
                layout: { hLineColor: '#cbd5e1', vLineColor: '#cbd5e1', hLineWidth: () => 1, vLineWidth: () => 1 },
                margin: [0, 0, 0, 20]
            },

            // ================= CREDIT SCORE NOTE =================
            {
                stack: [
                    { text: 'TRUST SCORE UPDATE', fontSize: 9, bold: true, color: '#7e22ce', margin: [0, 0, 0, 5] },
                    { text: 'By clearing this loan on time, your system trust score has increased. Please log into your member portal to view your updated dashboard, check your exact new limits, and access your improved credit features.', fontSize: 10, color: '#581c87', bold: true }
                ],
                padding: [15, 15, 15, 15],
                fillColor: '#faf5ff',
                layout: { hLineColor: '#e9d5ff', vLineColor: '#e9d5ff', hLineWidth: () => 1, vLineWidth: () => 1 },
                margin: [0, 0, 0, 40]
            },

            // ================= SIGNATURE AREA =================
            {
                columns: [
                    {
                        width: '45%',
                        stack: [
                                                   ]
                    },
                    {
                        width: '45%',
                        stack: [
                            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 180, y2: 0, lineWidth: 1, lineColor: '#94a3b8' }] },
                            { text: 'B&M Finance Team', bold: true, alignment: 'center', margin: [0, 10, 0, 3], color: '#0f172a' },
                            { text: 'Official Authorization', fontSize: 10, color: '#64748b', alignment: 'center' }
                        ]
                    }
                ],
                columnGap: 30
            },

            // ================= QR CODE =================
            {
                qr: qrContent,
                fit: 120, 
                absolutePosition: { x: 40, y: 680 }
            },

            // ================= STAMP / SEAL =================
            {
                absolutePosition: { x: 450, y: 680 },
                canvas: [
                    { type: 'ellipse', x: 45, y: 45, r1: 45, r2: 45, lineWidth: 3, lineColor: '#16a34a' } // Green ring
                ]
            },
            {
                absolutePosition: { x: 450, y: 712 },
                columns: [
                    { width: 90, text: 'CLEARED\n100%', alignment: 'center', color: '#16a34a', fontSize: 11, bold: true }
                ]
            }

        ] 
    };

    pdfMake.createPdf(docDefinition).download(`${reference}-Clearance.pdf`);
}
export async function loadActiveLoans() {
    const tableBody = document.getElementById('activeLoansTableBody');
    if (!tableBody) return;
    
    tableBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500">Loading active loans...</td></tr>';

    try {
        const q = query(collection(db, "loans"), where("status", "==", "approved"));
        const snapshot = await getDocs(q);
        tableBody.innerHTML = '';

        if (snapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500 italic">No active loans outstanding.</td></tr>';
            return;
        }

        for (const loanDoc of snapshot.docs) {
            const loan = loanDoc.data();
            
            const userSnap = await getDoc(doc(db, "users", loan.userId));
            const userName = userSnap.exists() ? userSnap.data().name : 'Unknown User';

           // --- DYNAMIC PENALTY MATH ---
            const startDate = loan.approvedAt ? loan.approvedAt.toDate() : loan.createdAt.toDate();
            const dueDate = new Date(startDate.getTime() + loan.durationWeeks * 7 * 24 * 60 * 60 * 1000);
            const today = new Date();
            const timeDiff = dueDate.getTime() - today.getTime();
            const daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));

            let penaltyAmount = 0;
            let timeBadge = '';
            
            if (daysRemaining < 0) {
                const daysLate = Math.abs(daysRemaining);
                if (loan.penaltyFrozen) {
                    penaltyAmount = loan.frozenPenaltyAmount || 0;
                    timeBadge = `<div class="text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded mt-1 font-bold inline-block">FROZEN LATE</div>`;
                } else {
                    penaltyAmount = daysLate * 5;
                    timeBadge = `<div class="text-[10px] bg-red-600 text-white px-1.5 py-0.5 rounded mt-1 font-bold inline-block animate-pulse">${daysLate} DAYS LATE</div>`;
                }
            } else {
                timeBadge = `<div class="text-[10px] text-emerald-600 font-bold mt-1">${daysRemaining} Days Left</div>`;
            }

            // === MERGED INTEREST & PENALTY MATH ===
            const effectiveInterest = loan.interest + penaltyAmount;
            const paidSoFar = loan.amountPaidSoFar || 0;
            const totalDue = loan.amount + effectiveInterest;
            const currentBalance = totalDue - paidSoFar;
            // -----------------------------

            const approvedDate = loan.approvedAt ? loan.approvedAt.toDate().toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB');
            const safeDuration = loan.durationWeeks || '?';
            const safeName = (userName || '').replace(/'/g, "\\'").replace(/"/g, "&quot;");

            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="p-3 border border-slate-200">
                    <div class="font-bold text-slate-800">${userName}</div>
                    ${timeBadge}
                </td>
                <td class="p-3 text-slate-600 border border-slate-200">
                    <div>Principal: KSH ${loan.amount}</div>
                    <div class="text-xs ${penaltyAmount > 0 ? 'text-red-600 font-bold' : 'text-slate-500 font-medium'}">
                        + Int: KSH ${effectiveInterest}
                        ${penaltyAmount > 0 ? `<div class="text-[9px] bg-red-50 px-1 rounded inline-block mt-0.5 text-red-500">Incl. KSH ${penaltyAmount} late fee</div>` : ''}
                    </div>
                </td>
                <td class="p-3 border border-slate-200">
                    <div class="text-xs text-slate-500">Paid: KSH ${paidSoFar}</div>
                    <div class="font-bold ${currentBalance > 0 ? 'text-rose-600' : 'text-emerald-600'}">Bal: KSH ${currentBalance}</div>
                </td>
                <td class="p-3 flex gap-2 flex-wrap items-center border border-slate-200">
                    <select id="repayType-${loanDoc.id}" class="text-xs border border-slate-200 rounded p-1.5 bg-slate-50 focus:ring-purple-500 font-medium text-slate-700">
                        <option value="full">Full Balance</option>
                        <option value="interest">Interest Only</option>
                        <option value="mdogo">Mdogo Mdogo (Custom)</option>
                    </select>
                    <button onclick="processRepayment('${loanDoc.id}', '${loan.userId}', ${loan.amount}, ${loan.interest}, ${penaltyAmount}, ${paidSoFar}, '${safeName}', this, document.getElementById('repayType-${loanDoc.id}').value)" class="bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 text-xs font-bold shadow-sm transition">
                        Clear
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

window.reprintDisbursementLetter = function(loanId, userName, amount, interest, durationWeeks, approvedDate) {
    const refNumber = `BM-LN-${loanId.substring(0, 6).toUpperCase()}`;
    
    generateOfficialLetter({
        userName: userName, 
        amount: amount,
        transactionType: "Loan Disbursement (Reprint)", 
        interest: interest,
        durationWeeks: durationWeeks,
        reference: refNumber,
        date: approvedDate, 
        notes: `Approved for ${durationWeeks} weeks at KSH ${interest} interest.`
    });
};

window.processRepayment = async function(loanId, userId, principal, interest, penaltyAmount, paidSoFar, userName, btn, repayType) {
    // 1. Calculate the true reality of the debt
    const effectiveInterest = interest + penaltyAmount;
    const totalDue = principal + effectiveInterest;
    const remainingBalance = totalDue - paidSoFar;

    // Determine the prefill amount based on the dropdown selection
    let prefillAmount = remainingBalance; 
    if (repayType === 'interest') {
        prefillAmount = effectiveInterest;
    } else if (repayType === 'mdogo') {
        prefillAmount = ''; // Leave it blank so you can type the custom amount
    }

    // 2. Prompt the Admin for the exact cash received
    const amountInput = prompt(
        `MANUAL CASH REPAYMENT FOR ${userName}\n\n` +
        `Principal: KSH ${principal}\n` +
        `Effective Interest (Incl. penalties): KSH ${effectiveInterest}\n` +
        `-------------------------\n` +
        `Total Expected: KSH ${totalDue}\n` +
        `Paid So Far: KSH ${paidSoFar}\n` +
        `Remaining Balance: KSH ${remainingBalance}\n\n` +
        `Enter the exact cash amount you are receiving right now:`, 
        prefillAmount
    );

    if (amountInput === null) return; 
    const amount = Number(amountInput);
    
    if (isNaN(amount) || amount <= 0) {
        alert("Invalid amount entered. Transaction cancelled.");
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.classList.add("opacity-50", "cursor-not-allowed");
        btn.innerText = "Processing...";
    }

    const loanRef = doc(db, "loans", loanId);
    const userRef = doc(db, "users", userId);
    const statsRef = doc(db, "groupStats", "main");
    const transactionRef = doc(collection(db, "transactions"));

    let isFullyCleared = false;
    let finalCapital = 0;
    let finalTotalLoans = 0;

    try {
        await runTransaction(db, async (transaction) => {
            const statsDoc = await transaction.get(statsRef);
            const userDoc = await transaction.get(userRef);
            
            const currentLiquidity = statsDoc.data().liquidityReserve || 0;
            const currentCapital = statsDoc.data().capital || 0;
            const currentTotalLoans = statsDoc.data().totalLoans || 0;
            const currentProfit = statsDoc.data().totalProfit || 0;

            const newPaidSoFar = paidSoFar + amount;
            isFullyCleared = newPaidSoFar >= totalDue;

            // 2. Base updates
            let statsUpdates = { liquidityReserve: currentLiquidity + amount };
            let loanUpdates = { amountPaidSoFar: newPaidSoFar };
            
            // --- 🛠️ THE FIX: DEDUCT DEBT ON EVERY PAYMENT ---
            let newActiveDebt = (userDoc.data().loansActive || 0) - amount;
            let userUpdates = {
                loansActive: newActiveDebt < 0 ? 0 : newActiveDebt
            };
            
            if (repayType === 'interest' && !isFullyCleared) {
                loanUpdates.penaltyFrozen = true;
                loanUpdates.frozenPenaltyAmount = penaltyAmount;
            }

            // If this cash payment wipes out the remaining balance
            if (isFullyCleared) {
                loanUpdates.status = "repaid";
                loanUpdates.repaidAt = serverTimestamp();

                // Add to their success count
                userUpdates.loansRepaidCount = (userDoc.data().loansRepaidCount || 0) + 1;

                finalCapital = currentCapital + (interest + penaltyAmount);
                finalTotalLoans = currentTotalLoans - principal;

                statsUpdates.totalLoans = finalTotalLoans;
                statsUpdates.capital = finalCapital;
                statsUpdates.totalProfit = currentProfit + (interest + penaltyAmount);
            }

            transaction.update(statsRef, statsUpdates);
            transaction.update(loanRef, loanUpdates);
            // Push the user updates to Firestore
            transaction.update(userRef, userUpdates);

            transaction.set(transactionRef, {
                userId: userId,
                type: "repayment",
                amount: amount,
                status: "completed",
                description: isFullyCleared ? "Manual full loan clearance (Cash)" : "Manual partial installment (Cash)",
                createdAt: serverTimestamp()
            });
        });
        
        if (isFullyCleared) {
            alert(`Success! KSH ${amount} recorded. ${userName}'s loan is FULLY CLEARED. Group capital grew by KSH ${interest + penaltyAmount}.`);
            await logAdminAction(auth.currentUser?.email || "System Admin", `Manually cleared loan for: ${userId} | Final Cash: KSH ${amount}`, "INFO");
            
            if(confirm("Would you like to print the official Repayment Clearance letter for this member?")) {
                const today = new Date().toLocaleDateString('en-GB'); 
                const refNumber = `BM-REP-${loanId.substring(0, 6).toUpperCase()}`;
                
                const freshUserSnap = await getDoc(userRef);
                const userData = freshUserSnap.data();
                const monthsActive = getMonthsActive(userData.createdAt);
                const waterfall = calculateWaterfall(userData.savings || 0);
                
                const futureStats = { capital: finalCapital, totalLoans: finalTotalLoans };
                const limits = calculateSmartLimit(userData, futureStats, 0, waterfall.consistencyScore, monthsActive, waterfall.arrearsTotal);
                
                generateRepaymentLetter({
                    userName: userName, 
                    amount: totalDue, // Letter shows the total value of the cleared loan
                    reference: refNumber,
                    date: today,
                    newLimit: limits.finalLimit
                });
            }
        } else {
            alert(`Installment of KSH ${amount} logged successfully. Remaining balance is KSH ${totalDue - (paidSoFar + amount)}.`);
            await logAdminAction(auth.currentUser?.email || "System Admin", `Manual partial installment for: ${userId} | Cash: KSH ${amount}`, "INFO");
        }
        
        // Refresh the UI
        loadActiveLoans();
        if(typeof loadGroupStats === 'function') loadGroupStats();
        if(typeof loadMembers === 'function') loadMembers();
        if(typeof loadMasterLedger === 'function') loadMasterLedger();

    } catch (error) {
        console.error("Repayment failed:", error);
        alert("CRITICAL ERROR: Failed to process repayment. Database state has been preserved.");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove("opacity-50", "cursor-not-allowed");
            btn.innerText = "Clear";
        }
    }
};
// ==========================================
// PENDING PAYMENT VERIFICATIONS (M-PESA)
// ==========================================

export async function loadPendingPayments() {
    const tableBody = document.getElementById('pendingPaymentsTable');
    if (!tableBody) return;
    
    tableBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500">Loading pending payments...</td></tr>';

    try {
        const q = query(collection(db, "paymentClaims"), where("status", "==", "pending"), orderBy("createdAt", "asc"));
        const snapshot = await getDocs(q);
        tableBody.innerHTML = '';

        if (snapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500 italic">No pending payments to verify.</td></tr>';
            return;
        }

        for (const docSnap of snapshot.docs) {
            const claim = docSnap.data();
            const userSnap = await getDoc(doc(db, "users", claim.userId));
            const userName = userSnap.exists() ? userSnap.data().name : 'Unknown';

            let typeBadge = '<span class="bg-green-100 text-green-700 border border-green-200 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wide">Savings Deposit</span>';
            if (claim.type === 'penalty_freeze_request') {
                typeBadge = '<span class="bg-rose-100 text-rose-700 border border-rose-200 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wide">Freeze Request (Interest)</span>';
            } else if (claim.type === 'repayment') {
                typeBadge = '<span class="bg-blue-100 text-blue-700 border border-blue-200 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wide">Loan Installment</span>';
            } else if (claim.type === 'emergency_deposit') {
                typeBadge = '<span class="bg-blue-200 text-blue-700 border border-blue-200 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wide">Emergency Fund Deposit</span>';
            }

            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="p-3 font-bold text-slate-800 border border-slate-200">
                    ${userName}
                    <div class="mt-1">${typeBadge}</div>
                </td>
                <td class="p-3 font-mono text-xs bg-slate-100 rounded px-2 border border-slate-200">${claim.mpesaCode}</td>
                <td class="p-3 font-bold text-slate-800 border border-slate-200">KSH ${claim.amount}</td>
                <td class="p-3 flex gap-2 border border-slate-200">
                    <button onclick="verifyPayment('${docSnap.id}', '${claim.userId}', ${claim.amount}, '${claim.mpesaCode}', '${userName}', '${claim.type || 'deposit'}', '${claim.loanId || ''}')" class="bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 text-xs font-bold transition shadow-sm">
                        Verify
                    </button>
                    <button onclick="rejectPayment('${docSnap.id}', '${claim.userId}', '${claim.mpesaCode}')" class="bg-white border border-red-200 text-red-600 px-3 py-1.5 rounded hover:bg-red-50 text-xs font-bold transition shadow-sm">
                        Reject
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
        }
    } catch (error) {
        console.error("Error loading pending payments:", error);
        tableBody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-red-500">Error loading data. Check console.</td></tr>';
    }
}
window.rejectPayment = async function(claimId, userId, mpesaCode) {
    const reason = prompt(`You are rejecting payment Ref: ${mpesaCode}.\nEnter a brief reason for the member (e.g., "Code already used", "Invalid code", "Amount mismatch"):`);
    
    if (reason === null) return; 

    try {
        await updateDoc(doc(db, "paymentClaims", claimId), { 
            status: "rejected", 
            resolvedAt: serverTimestamp(),
            rejectReason: reason 
        });

        const warningText = `PAYMENT REJECTED: Your submission for M-Pesa Ref [${mpesaCode}] was declined by the Admin. ${reason ? 'Reason: ' + reason : 'Please verify your code and submit again.'}`;
        
        await updateDoc(doc(db, "users", userId), { 
            warningMessage: warningText 
        });

        alert("Payment rejected! The member has been automatically notified on their portal.");
        await logAdminAction(auth.currentUser?.email || "System Admin", `Rejected payment: ${claimId} | Reason: ${reason}`, "INFO");
        loadPendingPayments(); 
        
    } catch (error) {
        console.error("Error rejecting payment:", error);
        alert("Failed to reject payment.");
    }
};

window.verifyPayment = async function(claimId, userId, amount, mpesaCode, userName, type, loanId) {
    if (!confirm(`Verify receipt of KSH ${amount} (Ref: ${mpesaCode}) from ${userName}?`)) return;

    const claimRef = doc(db, "paymentClaims", claimId);
    const userRef = doc(db, "users", userId);
    const statsRef = doc(db, "groupStats", "main");
    const newTransactionRef = doc(collection(db, "transactions"));

    try {
        await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(userRef);
            const statsDoc = await transaction.get(statsRef);
            
            const currentLiquidity = statsDoc.data().liquidityReserve || 0;
            const currentCapital = statsDoc.data().capital || 0;
            const currentTotalLoans = statsDoc.data().totalLoans || 0;
            const currentProfit = statsDoc.data().totalProfit || 0;

            if (type === 'deposit' || !type) {
                // NORMAL SAVINGS DEPOSIT
                transaction.update(userRef, { savings: (userDoc.data().savings || 0) + amount });
                transaction.update(statsRef, { 
                    capital: currentCapital + amount,
                    liquidityReserve: currentLiquidity + amount
                });
                transaction.set(newTransactionRef, {
                    userId: userId, type: "deposit", amount: amount, status: "completed",
                    createdAt: serverTimestamp(), description: `Verified Deposit (Ref: ${mpesaCode})`
                });

                } else if (type === 'emergency_deposit') {
                const currentEm = userDoc.data().emergencySavings || 0;
                const currentSosVault = statsDoc.data().sosVaultTotal || 0;
                
                transaction.update(userRef, { emergencySavings: currentEm + amount });
                transaction.update(statsRef, { 
                    //liquidityReserve: currentLiquidity + amount 
                    sosVaultTotal: currentSosVault + amount
                });
                
                transaction.set(newTransactionRef, {
                    userId: userId, type: "emergency_deposit", amount: amount, status: "completed",
                    createdAt: serverTimestamp(), description: `Verified EF Contribution (Ref: ${mpesaCode})`
                });

            } else {
                // ==========================================
                // INSTALLMENT OR FREEZE REQUEST
                // ==========================================
                if (!loanId) throw new Error("Loan ID missing for repayment claim.");
                const loanRef = doc(db, "loans", loanId);
                const loanDoc = await transaction.get(loanRef);
                const loanData = loanDoc.data();

                // 1. Calculate the exact penalty
                let currentPenalty = 0;

                if (type === 'penalty_freeze_request') {
                    currentPenalty = Math.max(0, amount - loanData.interest);
                } else {
                    const startDate = loanData.approvedAt ? loanData.approvedAt.toDate() : loanData.createdAt.toDate();
                    const dueDate = new Date(startDate.getTime() + loanData.durationWeeks * 7 * 24 * 60 * 60 * 1000);
                    const timeDiff = dueDate.getTime() - new Date().getTime();
                    const daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));

                    if (daysRemaining < 0) {
                        currentPenalty = loanData.penaltyFrozen ? (loanData.frozenPenaltyAmount || 0) : (Math.abs(daysRemaining) * 5);
                    }
                }

                const paidSoFar = loanData.amountPaidSoFar || 0;
                const newPaidSoFar = paidSoFar + amount;
                const totalDue = loanData.repayment + currentPenalty;

                // 2. Base updates
                let statsUpdates = { liquidityReserve: currentLiquidity + amount };
                let loanUpdates = { amountPaidSoFar: newPaidSoFar };
                
                const userSavings = userDoc.data().savings || 0;
                const loanPrincipal = loanData.amount;

                // --- 🛠️ THE FIX: DEDUCT DEBT ON EVERY PAYMENT ---
                // Lower the user's active debt by the exact amount they just paid
                let newActiveDebt = (userDoc.data().loansActive || 0) - amount;
                let userUpdates = {
                    loansActive: newActiveDebt < 0 ? 0 : newActiveDebt
                };

                // --- 🛡️ THE NEW SAFEGUARD: AGGRESSIVE PROFIT LOGGING ---
                if (type === 'penalty_freeze_request') {
                    loanUpdates.penaltyFrozen = true;
                    loanUpdates.frozenPenaltyAmount = currentPenalty;

                    // Check if member's savings can fully cover the outstanding principal
                    if (userSavings >= loanPrincipal) {
                        statsUpdates.capital = currentCapital + amount;
                        statsUpdates.totalProfit = currentProfit + amount;
                        loanUpdates.profitAlreadyExtracted = (loanData.profitAlreadyExtracted || 0) + amount;
                    }
                }

                // 3. Did this payment clear the loan?
                if (newPaidSoFar >= totalDue) {
                    loanUpdates.status = "repaid";
                    loanUpdates.repaidAt = serverTimestamp();
                    
                    // Increment their success count ONLY when fully cleared
                    userUpdates.loansRepaidCount = (userDoc.data().loansRepaidCount || 0) + 1;

                    const previouslyExtracted = loanUpdates.profitAlreadyExtracted || loanData.profitAlreadyExtracted || 0;
                    const totalProfitEarned = (loanData.interest + currentPenalty) - previouslyExtracted;

                    statsUpdates.totalLoans = currentTotalLoans - loanData.amount;
                    
                    if (totalProfitEarned > 0) {
                        statsUpdates.capital = (statsUpdates.capital || currentCapital) + totalProfitEarned;
                        statsUpdates.totalProfit = (statsUpdates.totalProfit || currentProfit) + totalProfitEarned;
                    }
                }

                // Apply the user updates we created above
                transaction.update(userRef, userUpdates);

                transaction.update(loanRef, loanUpdates);
                transaction.update(statsRef, statsUpdates);
                
                transaction.set(newTransactionRef, {
                    userId: userId, type: "repayment", amount: amount, status: "completed",
                    createdAt: serverTimestamp(), description: `Verified Installment (Ref: ${mpesaCode})`
                });
            }
            // Finally, clear the pending claim
            transaction.update(claimRef, { status: "verified", resolvedAt: serverTimestamp() });
        });

        await logAdminAction(auth.currentUser?.email || "System Admin", `Verified ${type} payment: ${claimId} | Amount: KSH ${amount}`, "INFO");
        alert("Payment verified and applied successfully!");
        
        loadPendingPayments();
        loadActiveLoans(); 
        if (type === 'deposit') loadContributionTracker(); 
        loadGroupStats(); 
        loadMasterLedger();

    } catch (error) {
        console.error("Payment verification failed: ", error);
        alert("Transaction failed: " + error.message);
    }
};

function getMonthsActive(timestamp) {
    if (!timestamp || typeof timestamp.toDate !== 'function') return 1; 
    const join = timestamp.toDate();
    const now = new Date();
    const diff = (now.getFullYear() - join.getFullYear()) * 12 + (now.getMonth() - join.getMonth());
    return Math.max(1, diff); 
}

export function listenToSOSRequests() {
    const q = query(collection(db, "sosRequests"), where("status", "==", "pending"));
    
    onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const sos = change.doc.data();
                const id = change.doc.id;
                const payoutValue = sos.amount || 100;
                
                const accept = confirm(
                    `EMERGENCY FUNDS REQUEST\n\n` +
                    `Member: ${sos.userName}\n` +
                    `Requested Amount: KSH ${payoutValue}\n` +
                    `Reason: "${sos.reason}"\n\n` +
                    `Click OK to Approve payout.\nClick Cancel to Deny.`
                );

                if(accept) executeSOSPayout(id, sos.userId, sos.userName, payoutValue);
                else rejectSOSRequest(id, sos.userId, sos.userName);
            }
        });
    });
}

async function executeSOSPayout(reqId, userId, userName, approvedAmount) {
    const userRef = doc(db, "users", userId);
    const statsRef = doc(db, "groupStats", "main");
    const reqRef = doc(db, "sosRequests", reqId);
    const txRef = doc(collection(db, "transactions"));

    try {
        await runTransaction(db, async (t) => {
            const uDoc = await t.get(userRef);
            const sDoc = await t.get(statsRef);
            
            const currentEm = uDoc.data().emergencySavings || 0;
            const currentLiq = sDoc.data().liquidityReserve || 0;
            const currentSosVault = sDoc.data().sosVaultTotal || 0;

            if(currentEm < approvedAmount) throw new Error("Member withdrew funds before approval!");

            t.update(userRef, { emergencySavings: currentEm - approvedAmount });
            t.update(statsRef, { 
                liquidityReserve: currentLiq - approvedAmount,
                sosVaultTotal: currentSosVault - approvedAmount
            });
            t.update(reqRef, { status: "disbursed", resolvedAt: serverTimestamp() });
            
            t.set(txRef, {
                userId: userId, type: "emergency_payout", amount: approvedAmount, status: "completed",
                description: `Approved emergency payout (${approvedAmount}/-)`, createdAt: serverTimestamp()
            });
        });

        alert(`KSH ${approvedAmount} deducted from ${userName}'s vault. Disburse M-Pesa immediately.`);
        await logAdminAction(auth.currentUser?.email || "System Admin", `Disbursed KSH ${approvedAmount} SOS to ${userId}`, "WARN");
        
        loadGroupStats();
        loadMembers(); 
        loadMasterLedger();
    } catch(e) {
        alert("EMERGENCY Execution failed: " + e.message);
    }
}

window.rejectSOSRequest = async function(reqId, userId, userName) {
    const reason = prompt("Enter reason for declining EMERGENCY request (Member will see this):");
    if(reason === null) return;
    
    await updateDoc(doc(db, "sosRequests", reqId), {
        status: "rejected",
        rejectReason: reason,
        resolvedAt: serverTimestamp()
    });
    
    await updateDoc(doc(db, "users", userId), {
        warningMessage: `EMERGENCY REQUEST DECLINED: ${reason}`
    });
    
    alert(`EMERGENCY Request for ${userName} Rejected.`);
}

window.toggleSOSAccess = async function(userId, currentState) {
    const nextState = currentState === 'suspended' ? 'active' : 'suspended';
    if(!confirm(`Change member's Emergency Funds access to ${nextState.toUpperCase()}?`)) return;

    try {
        await updateDoc(doc(db, "users", userId), { emergencyStatus: nextState });
        await logAdminAction(auth.currentUser?.email || "System Admin", `Set Emergency Funds status of ${userId} to ${nextState}`, "WARN");
        loadMembers();
    } catch (e) {
        alert("Failed to change Emergency Funds status.");
    }
};