const ALLOWED_METHODS = new Set([
  'tasks.task.list',
  'profile',
  'user.get'
]);

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Init-Data');
}

function ensureTrailingSlash(value) {
  if (!value) {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function toUrlParams(params = {}) {
  const search = new URLSearchParams();
  const stack = Object.keys(params || {}).map(key => ({
    key,
    value: params[key]
  }));

  while (stack.length) {
    const { key, value } = stack.pop();
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach(item => {
        search.append(`${key}[]`, item);
      });
      continue;
    }

    if (typeof value === 'object') {
      const entries = Object.keys(value);
      if (!entries.length) {
        continue;
      }

      entries.forEach(subKey => {
        stack.push({
          key: `${key}[${subKey}]`,
          value: value[subKey]
        });
      });
      continue;
    }

    search.append(key, value);
  }

  return search;
}

function parseBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === 'object') {
    return req.body;
  }

  try {
    return JSON.parse(req.body);
  } catch (error) {
    return {};
  }
}

async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const payload = parseBody(req);
  const webhook = typeof payload.webhook === 'string' ? payload.webhook : '';
  const method = typeof payload.method === 'string' ? payload.method.trim() : '';
  const params = payload.params && typeof payload.params === 'object' ? payload.params : {};

  if (!webhook) {
    res.status(400).json({ error: 'Webhook URL is required' });
    return;
  }

  if (!method) {
    res.status(400).json({ error: 'Bitrix24 method is required' });
    return;
  }

  if (!ALLOWED_METHODS.has(method)) {
    res.status(403).json({ error: 'Method is not allowed' });
    return;
  }

  const normalizedWebhook = ensureTrailingSlash(webhook);
  let targetUrl;

  try {
    targetUrl = new URL(`${normalizedWebhook}${method}.json`);
  } catch (error) {
    res.status(400).json({ error: 'Invalid webhook URL' });
    return;
  }

  const formBody = toUrlParams(params).toString();

  let bitrixResponse;
  try {
    bitrixResponse = await fetch(targetUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formBody
    });
  } catch (error) {
    res.status(502).json({ error: 'Не удалось отправить запрос к Bitrix24', details: error.message });
    return;
  }

  const text = await bitrixResponse.text();

  if (!text) {
    res.status(bitrixResponse.status).json({});
    return;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    res.status(502).json({ error: 'Bitrix24 вернул невалидный JSON', details: text.slice(0, 2000) });
    return;
  }

  if (!bitrixResponse.ok) {
    res.status(bitrixResponse.status).json(data);
    return;
  }

  res.status(200).json(data);
}

module.exports = handler;
