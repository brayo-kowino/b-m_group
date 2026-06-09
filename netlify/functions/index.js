const functions = require("firebase-functions");
const admin = require("firebase-admin");

// Initialize the Admin SDK with Master Privileges
admin.initializeApp();

// Create the secure backend function
exports.addNewMember = functions.https.onCall(async (data, context) => {
    
    // 1. SECURITY CHECK: Ensure the person making the request is actually logged in
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated', 
            'Only authorized executive board members can add new members.'
        );
    }

    try {
        // 2. MINT THE AUTH CREDENTIALS (Bypasses the Console Lock!)
        const userRecord = await admin.auth().createUser({
            email: data.email,
            password: data.password,
            displayName: data.fullName,
        });

        // 3. WRITE TO THE FIRESTORE LEDGER
        const db = admin.firestore();
        await db.collection("users").doc(userRecord.uid).set({
            fullName: data.fullName,
            memberId: data.memberId,
            email: data.email,
            role: "member", // Hardcoded safely on the server so hackers can't inject "admin"
            accountStatus: "active",
            savingsBalance: 0,
            loanBalance: 0,
            dateJoined: admin.firestore.FieldValue.serverTimestamp()
        });

        // 4. RETURN SUCCESS SIGNAL TO FRONTEND
        return { 
            message: `Successfully added member for ${data.fullName}`,
            newUid: userRecord.uid 
        };

    } catch (error) {
        // If the email is already in use or password is too weak, send the error back
        console.error("Adding Member Error:", error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});