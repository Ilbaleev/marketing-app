export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
        return;
    }

    const payload = typeof req.body === 'object' && req.body !== null ? req.body : {};
    const { webhook, method, params } = payload;

    const webhookUrl = typeof webhook === 'string' && webhook.trim() ? webhook.trim() : process.env.BITRIX_WEBHOOK_URL;

    if (!webhookUrl) {
        res.status(400).json({ error: 'BITRIX_WEBHOOK_NOT_CONFIGURED' });
        return;
    }

    if (!method || typeof method !== 'string') {
        res.status(400).json({ error: 'BITRIX_METHOD_REQUIRED' });
        return;
    }

    const targetUrl = `${webhookUrl}${method}.json`;

    let bitrixResponse;

    try {
        bitrixResponse = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(params || {})
        });
    } catch (error) {
        console.error('Bitrix proxy network error:', error);
        res.status(502).json({ error: 'BITRIX_NETWORK_ERROR', error_description: error.message });
        return;
    }

    const rawText = await bitrixResponse.text();
    let data;

    try {
        data = rawText ? JSON.parse(rawText) : {};
    } catch (error) {
        console.error('Bitrix proxy JSON parse error:', error, rawText);
        res.status(502).json({ error: 'BITRIX_INVALID_RESPONSE', error_description: 'Не удалось разобрать ответ Bitrix24' });
        return;
    }

    if (!bitrixResponse.ok) {
        res.status(bitrixResponse.status).json({
            error: 'BITRIX_HTTP_ERROR',
            status: bitrixResponse.status,
            error_description: data.error_description || bitrixResponse.statusText || 'Ошибка при обращении к Bitrix24',
            result: data.result
        });
        return;
    }

    if (data && data.error) {
        res.status(502).json({ error: data.error, error_description: data.error_description || data.error });
        return;
    }

    res.status(200).json({ result: data.result !== undefined ? data.result : data });
}
