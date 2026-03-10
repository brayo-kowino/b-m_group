// admin.js (or a dedicated ledger.js)
import { db } from './firebase.js';
import { doc, runTransaction, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

async function recordDeposit(userId, amount) {
    const userRef = doc(db, "users", userId);
    const statsRef = doc(db, "groupStats", "main");
    const newTransactionRef = doc(collection(db, "transactions"));

    try {
        await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(userRef);
            const statsDoc = await transaction.get(statsRef);

            if (!userDoc.exists() || !statsDoc.exists()) {
                throw "Document does not exist!";
            }

            const newSavings = (userDoc.data().savings || 0) + Number(amount);
            const newCapital = (statsDoc.data().capital || 0) + Number(amount);

            // 1. Update User's Savings
            transaction.update(userRef, { savings: newSavings });

            // 2. Update Group Total Capital
            transaction.update(statsRef, { capital: newCapital });

            // 3. Log the Transaction
            transaction.set(newTransactionRef, {
                userId: userId,
                type: "deposit",
                amount: Number(amount),
                status: "completed",
                createdAt: serverTimestamp()
            });
        });

        console.log("Deposit successfully recorded!");
        // Refresh your UI here
    } catch (error) {
        console.error("Transaction failed: ", error);
    }
}