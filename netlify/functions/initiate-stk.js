const axios = require('axios');
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
    // Enable CORS to allow the frontend to communicate with the backend
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    // Respond immediately to preflight checks
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        // Destructure all incoming data, including the optional loanId
        const { amount, phoneNumber, userId, type, loanId } = JSON.parse(event.body);

        // 1. Get Daraja Access Token
        const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
        const tokenResponse = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            headers: { Authorization: `Basic ${auth}` }
        });
        const accessToken = tokenResponse.data.access_token;

        // 2. Prepare Timestamps & Passwords for the API call
        const timestamp = new Date().toISOString().replace(/[-T:Z.]/g, '').slice(0, 14);
        const password = Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');


        // 3. Request STK Push from Safaricom
        const stkPayload = {
            BusinessShortCode: process.env.MPESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerPayBillOnline", // Standard for Tills and Paybills
            Amount: Math.round(amount),
            PartyA: phoneNumber, 
            PartyB: process.env.MPESA_SHORTCODE,
            PhoneNumber: phoneNumber,
            CallBackURL: "https://balancing-snowy-reacquire.ngrok-free.dev/.netlify/functions/mpesa-callback", 
            AccountReference: "BMGroup",
            TransactionDesc: `Payment for ${type}`
        };

        const mpesaResponse = await axios.post(
            'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
            stkPayload,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        // 4. Extract the unique identifier for this specific transaction
        const checkoutRequestID = mpesaResponse.data.CheckoutRequestID;

        // 5. Build the tracking data object
        const trackingData = {
            userId: userId,
            amount: Number(amount),
            phoneNumber: phoneNumber,
            status: 'pending',
            type: type || 'deposit', 
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // ONLY attach the loanId if this is a loan repayment or penalty freeze
        if (loanId) {
            trackingData.loanId = loanId;
        }

        // 6. Save the tracking record to Firestore
        await db.collection('paymentClaims').doc(checkoutRequestID).set(trackingData);

        // 7. Return success to the frontend
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                success: true, 
                message: "STK push initiated successfully!", 
                checkoutRequestID 
            })
        };

    } catch (error) {
        console.error("STK Push error: ", error.response ? error.response.data : error.message);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ success: false, error: "Failed to initiate payment simulation." })
        };
    }
};