const admin = require('firebase-admin');

// Initialize Firebase Admin safely
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        })
    });
}
const db = admin.firestore();

exports.handler = async function (event, context) {
    try {
        const payload = JSON.parse(event.body);
        const callbackData = payload.Body.stkCallback;
        const checkoutRequestID = callbackData.CheckoutRequestID;
        const resultCode = callbackData.ResultCode;

        // Fetch our matching tracked payment reference document
        const paymentRef = db.collection('paymentClaims').doc(checkoutRequestID);
        const paymentDoc = await paymentRef.get();

        if (!paymentDoc.exists) {
            console.error(`No pending payment tracking record found for: ${checkoutRequestID}`);
            return { statusCode: 200, body: JSON.stringify({ ResultCode: 1, ResultDesc: "Rejected" }) };
        }

        const paymentData = paymentDoc.data();

        // ResultCode 0 means total transaction success from Safaricom
        if (resultCode === 0) {
            const items = callbackData.CallbackMetadata.Item;
            const mpesaCode = items.find(i => i.Name === 'MpesaReceiptNumber').Value;
            const amountPaid = Number(items.find(i => i.Name === 'Amount').Value);

            // 1. Update the tracking claim document
            await paymentRef.update({
                status: 'verified',
                mpesaCode: mpesaCode,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // 2. THE TRAFFIC COP & MASTER ACCOUNTANT (Transactions & Logs)
            const userRef = db.collection('users').doc(paymentData.userId);
            const statsRef = db.collection('groupStats').doc('main');
            const transactionRef = db.collection('transactions').doc(); // Auto-generates ID for ledger
            const systemLogRef = db.collection('systemLogs').doc(); // Auto-generates ID for audit log

            await db.runTransaction(async (transaction) => {
                const userSnapshot = await transaction.get(userRef);
                const statsSnapshot = await transaction.get(statsRef);
                
                if (!userSnapshot.exists) return;
                
                // Fetch current group stats
                const currentLiquidity = statsSnapshot.exists ? (statsSnapshot.data().liquidityReserve || 0) : 0;
                const currentCapital = statsSnapshot.exists ? (statsSnapshot.data().capital || 0) : 0;
                const currentTotalLoans = statsSnapshot.exists ? (statsSnapshot.data().totalLoans || 0) : 0;
                const currentProfit = statsSnapshot.exists ? (statsSnapshot.data().totalProfit || 0) : 0;

                if (paymentData.type === 'deposit' || !paymentData.type) {
                    // ==========================================
                    // ROUTE A: SAVINGS DEPOSIT
                    // ==========================================
                    let currentSavings = userSnapshot.data().savings || 0;
                    
                    // 1. Update User Savings
                    transaction.update(userRef, { savings: currentSavings + amountPaid });
                    
                    // 2. Update Group Stats (Liquidity & Capital)
                    transaction.update(statsRef, {
                        capital: currentCapital + amountPaid,
                        liquidityReserve: currentLiquidity + amountPaid
                    });
                    
                    // 3. Write to Master Ledger
                    transaction.set(transactionRef, {
                        userId: paymentData.userId,
                        type: "deposit",
                        amount: amountPaid,
                        status: "completed",
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        description: `Auto-Mpesa Deposit (Ref: ${mpesaCode})`
                    });

                    // 4. Write to Admin Audit Logs
                    transaction.set(systemLogRef, {
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        adminName: "SYSTEM_MPESA_AUTO",
                        actionTrace: `Auto-verified deposit for member: ${paymentData.userId} | Amount: KSH ${amountPaid}`,
                        severity: "INFO"
                    });

                    console.log(`Savings credited and ledger updated for user ${paymentData.userId}.`);

                } else if (paymentData.type === 'repayment' || paymentData.type === 'penalty_freeze_request') {
                    // ==========================================
                    // ROUTE B: LOAN REPAYMENT & PENALTY FREEZES
                    // ==========================================
                    const loanRef = db.collection('loans').doc(paymentData.loanId);
                    const loanSnap = await transaction.get(loanRef);
                    if (!loanSnap.exists) return;
                    
                    const loanData = loanSnap.data();
                    let currentPenalty = 0;

                    // Exact penalty math matching admin.js
                    if (paymentData.type === 'penalty_freeze_request') {
                        // Trust exact cash sent to reverse engineer penalty
                        currentPenalty = Math.max(0, amountPaid - (loanData.interest || 0));
                    } else {
                        // Standard dynamic math
                        const startDate = loanData.approvedAt ? loanData.approvedAt.toDate() : loanData.createdAt.toDate();
                        const dueDate = new Date(startDate.getTime() + loanData.durationWeeks * 7 * 24 * 60 * 60 * 1000);
                        const timeDiff = dueDate.getTime() - new Date().getTime();
                        const daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));

                        if (daysRemaining < 0) {
                            currentPenalty = loanData.penaltyFrozen ? (loanData.frozenPenaltyAmount || 0) : (Math.abs(daysRemaining) * 5);
                        }
                    }

                    const paidSoFar = loanData.amountPaidSoFar || 0;
                    const newPaidSoFar = paidSoFar + amountPaid;
                    // loanData.repayment contains Principal + Original Interest
                    const totalDue = (loanData.repayment || 0) + currentPenalty; 

                    // Prep basic updates
                    let statsUpdates = { liquidityReserve: currentLiquidity + amountPaid };
                    let loanUpdates = { amountPaidSoFar: newPaidSoFar };

                    if (paymentData.type === 'penalty_freeze_request') {
                        loanUpdates.penaltyFrozen = true;
                        loanUpdates.frozenPenaltyAmount = currentPenalty;
                    }

                    let logMessage = `Auto-verified installment for: ${paymentData.userId} | Cash: KSH ${amountPaid}`;

                    // Check if the loan is fully cleared
                    if (newPaidSoFar >= totalDue) {
                        loanUpdates.status = "repaid";
                        loanUpdates.repaidAt = admin.firestore.FieldValue.serverTimestamp();
                        
                        // Drop active debt
                        let newActiveDebt = (userSnapshot.data().loansActive || 0) - (loanData.repayment || 0);
                        transaction.update(userRef, { 
                            loansActive: newActiveDebt < 0 ? 0 : newActiveDebt,
                            loansRepaidCount: (userSnapshot.data().loansRepaidCount || 0) + 1
                        });

                        // Book the profits and return principal to vault
                        statsUpdates.totalLoans = currentTotalLoans - (loanData.amount || 0);
                        statsUpdates.capital = currentCapital + ((loanData.interest || 0) + currentPenalty);
                        statsUpdates.totalProfit = currentProfit + ((loanData.interest || 0) + currentPenalty);

                        logMessage = `Auto-cleared loan for: ${paymentData.userId} | Final Cash: KSH ${amountPaid}`;
                    }

                    // Execute Updates
                    transaction.update(loanRef, loanUpdates);
                    transaction.update(statsRef, statsUpdates);
                    
                    // Write to Master Ledger
                    transaction.set(transactionRef, {
                        userId: paymentData.userId,
                        type: "repayment",
                        amount: amountPaid,
                        status: "completed",
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        description: `Auto-Mpesa Installment (Ref: ${mpesaCode})`
                    });

                    // Write to Admin Audit Logs
                    transaction.set(systemLogRef, {
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        adminName: "SYSTEM_MPESA_AUTO",
                        actionTrace: logMessage,
                        severity: "INFO"
                    });

                    console.log(`Loan ${paymentData.loanId} credited and ledger updated for user ${paymentData.userId}.`);
                }
            });

        } else {
            // Transaction was cancelled or failed on the device side
            await paymentRef.update({
                status: 'failed',
                resultDesc: callbackData.ResultDesc,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`Transaction failed/cancelled with code ${resultCode}`);
        }

        // Safaricom expects a clear acknowledgement response format
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ResultCode: 0, ResultDesc: "Success" })
        };

    } catch (error) {
        console.error("Callback API Processing Error: ", error);
        return { statusCode: 500, body: "Internal Processing Error" };
    }
};