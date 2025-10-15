// /api/bitrix.js  — серверлесс-функция для Vercel (ESM)

const ALLOWED_METHODS = new Set([
  'tasks.task.list',
  'profile',
  'user.get',
  // --- списки (проекты) ---
  'lists.element.get',
  'lists.element.add',
  'lists.element.update',
  // (не обязательно, но удобно для диагностики)
  'lists.get',
  'lists.field.get'
]);

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Init-Data');
}

// ГЛАВНОЕ: кодируем вложенные объекты как FIELDS[NAME], FIELDS[PROPERTY_123], ...
function encodeForm(params) {
  const out = [];

  const walk = (key, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${key}[${i}]`, v));
    } else if (typeof value === 'object') {
      Object.entries(value).forEach(([k, v]) => walk(`${key}[${k}]`, v));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  };

  Object.entries(params || {}).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((item, i) => walk(`${k}[${i}]`, item));
    else if (typeof v === 'object') Object.entries(v).forEach(([kk, vv]) => walk(`${k}[${kk}]`, vv));
    else out.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  });

  return out.join('&');
}

function ensureTrailingSlash(value) {
  if (!value) return '';
  const s = value.trim();
  return s.endsWith('/') ? s : `${s}/`;
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  const payload = parseBody(req);
  const webhook = typeof payload.webhook === 'string' ? payload.webhook : '';
  const method  = typeof payload.method  === 'string' ? payload.method.trim() : '';
  const params  = payload.params && typeof payload.params === 'object' ? payload.params : {};

  if (!webhook) return res.status(400).json({ error: 'Webhook URL is required' });
  if (!method)  return res.status(400).json({ error: 'Bitrix24 method is required' });
  if (!ALLOWED_METHODS.has(method)) return res.status(403).json({ error: 'Method is not allowed' });

  const normalizedWebhook = ensureTrailingSlash(webhook);

  let targetUrl;
  try {
    targetUrl = new URL(`${normalizedWebhook}${method}.json`);
  } catch {
    return res.status(400).json({ error: 'Invalid webhook URL' });
  }

  let bitrixResponse;
  try {
    bitrixResponse = await fetch(targetUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encodeForm(params) // <-- ВАЖНО: правильная форма для FIELDS[...]
    });
  } catch (error) {
    return res.status(502).json({ error: 'Не удалось отправить запрос к Bitrix24', details: error.message });
  }

  const text = await bitrixResponse.text();
  if (!text) return res.status(bitrixResponse.status).json({});

  let data;
  try { data = JSON.parse(text); }
  catch { return res.status(502).json({ error: 'Bitrix24 вернул невалидный JSON', details: text.slice(0, 2000) }); }

  if (!bitrixResponse.ok) return res.status(bitrixResponse.status).json(data);

  return res.status(200).json(data);
}
