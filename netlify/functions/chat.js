// netlify/functions/chat.js

exports.handler = async function (event, context) {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
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
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        };

    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Failed connecting to AI backend pipeline" })
        };
    }
};