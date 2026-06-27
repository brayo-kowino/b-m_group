// netlify/functions/chat.js

exports.handler = async function (event, context) {
    // Define your permitted origins
    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "https://bmfinance.me", // Allows your GitHub Pages domain to read the data
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
    };

    // 1. Handle browser pre-flight CORS check
    if (event.httpMethod === "OPTIONS") {
        return { 
            statusCode: 200, 
            headers, 
            body: JSON.stringify({ message: "CORS preflight ok" }) 
        };
    }

    if (event.httpMethod !== "POST") {
        return { 
            statusCode: 405, 
            headers, 
            body: JSON.stringify({ error: "Method Not Allowed" }) 
        };
    }

    try {
        const apiKey = process.env.MISTRAL_API_KEY;
        const requestBody = JSON.parse(event.body);

        const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: requestBody.model || 'mistral-small-latest',
                messages: requestBody.messages,
                temperature: requestBody.temperature || 0.6,
                max_tokens: requestBody.max_tokens || 1000
            })
        });

        const data = await response.json();

        return {
            statusCode: 200,
            headers, // Injects CORS and JSON content-type
            body: JSON.stringify(data)
        };

    } catch (error) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: "Failed connecting to AI backend pipeline" })
        };
    }
};