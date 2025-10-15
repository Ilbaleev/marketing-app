/**
 * Модуль работы с Bitrix24 API: нормализация ответов и транспортные
 * функции для прямых и проксируемых запросов.
 */

import {
    ensureTrailingSlash,
    getTaskValue,
    normalizeNumber,
    toUrlParams
} from './helpers.js';
import { CONFIG } from './config.js';

export function normalizeTaskRecord(task) {
    if (!task || typeof task !== 'object') {
        return {};
    }

    const source = task.task && typeof task.task === 'object' ? task.task : task;
    const normalized = { ...source };

    ['ID', 'TITLE', 'DESCRIPTION', 'STATUS', 'DEADLINE', 'CREATED_DATE', 'CLOSED_DATE', 'PRIORITY'].forEach(field => {
        const value = getTaskValue(source, field);
        if (value !== undefined) {
            if (field === 'ID' || field === 'STATUS' || field === 'PRIORITY') {
                normalized[field] = value === null || value === undefined ? value : value.toString();
            } else {
                normalized[field] = value;
            }
        }
    });

    return normalized;
}

export function normalizeTasksResponse(payload) {
    let result = {};
    if (payload && typeof payload === 'object') {
        if (typeof payload.result !== 'undefined' && payload.result !== null) {
            result = payload.result;
        } else if (payload.raw && typeof payload.raw === 'object') {
            if (typeof payload.raw.result !== 'undefined' && payload.raw.result !== null) {
                result = payload.raw.result;
            } else {
                result = payload.raw;
            }
        } else {
            result = payload;
        }
    }

    let rawTasks = [];
    if (Array.isArray(result.tasks)) {
        rawTasks = result.tasks;
    } else if (Array.isArray(result)) {
        rawTasks = result;
    }

    const tasks = rawTasks.map(normalizeTaskRecord);

    const totalCandidates = [
        payload && payload.total,
        payload && payload.raw && payload.raw.total,
        result && result.total,
        result && result.tasks_total,
        result && result.tasks_count,
        result && result.tasksCount
    ];

    let total = null;
    for (const candidate of totalCandidates) {
        const numeric = normalizeNumber(candidate);
        if (numeric !== null) {
            total = numeric;
            break;
        }
    }

    const nextCandidates = [
        payload && payload.next,
        payload && payload.raw && payload.raw.next,
        result && result.next
    ];

    let next = null;
    for (const candidate of nextCandidates) {
        const numeric = normalizeNumber(candidate);
        if (numeric !== null) {
            next = numeric;
            break;
        }
    }

    return { tasks, total, next };
}

export function normalizeBitrixResponse(data) {
    if (!data || typeof data !== 'object') {
        return { result: null, total: null, next: null, time: null, raw: data };
    }

    return {
        result: typeof data.result !== 'undefined' ? data.result : null,
        total: normalizeNumber(data.total),
        next: normalizeNumber(data.next),
        time: data.time || null,
        raw: data
    };
}

export async function performDirectBitrixRequest(url) {
    let response;
    try {
        response = await fetch(url.toString(), { method: 'GET' });
    } catch (error) {
        const networkError = new Error(`Не удалось выполнить прямой запрос к Bitrix24: ${error.message}`);
        networkError.isNetworkError = true;
        throw networkError;
    }

    const raw = await response.text();

    if (!response.ok) {
        let message = `HTTP ${response.status}`;
        if (response.statusText) {
            message += ` ${response.statusText}`;
        }
        if (raw) {
            message += `: ${raw}`;
        }
        if (response.status === 403) {
            message += ' — доступ запрещён. Проверьте актуальность вебхука и разрешение для входящих запросов.';
        } else if (response.status === 401) {
            message += ' — требуется авторизация. Создайте новый вебхук или обновите ключ.';
        }
        throw new Error(message);
    }

    if (!raw) {
        return {};
    }

    let data;
    try {
        data = JSON.parse(raw);
    } catch (error) {
        throw new Error('Не удалось разобрать ответ Bitrix24. Проверьте формат ответа вебхука.');
    }

    if (data.error) {
        throw new Error(data.error_description || data.error);
    }

    return data;
}

export async function performProxyBitrixRequest({ webhook, method, params }) {
    let response;
    try {
        response = await fetch('/api/bitrix', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                webhook,
                method,
                params
            })
        });
    } catch (error) {
        throw new Error(`Прокси Bitrix24 недоступен: ${error.message}`);
    }

    const raw = await response.text();

    if (!response.ok) {
        let message = `Прокси Bitrix24 вернул ошибку HTTP ${response.status}`;
        if (response.statusText) {
            message += ` ${response.statusText}`;
        }

        if (raw) {
            try {
                const data = JSON.parse(raw);
                const details = data.error_description || data.error || data.message;
                if (details) {
                    message += `: ${details}`;
                } else {
                    message += `: ${raw}`;
                }
            } catch (parseError) {
                message += `: ${raw}`;
            }
        }

        throw new Error(message);
    }

    if (!raw) {
        return {};
    }

    let data;
    try {
        data = JSON.parse(raw);
    } catch (error) {
        throw new Error('Прокси Bitrix24 вернул невалидный JSON.');
    }

    if (data.error) {
        throw new Error(data.error_description || data.error);
    }

    return data;
}

export async function callBitrixAPI({ method, params = {}, config, transportState }) {
    if (!config.BITRIX_WEBHOOK) {
        throw new Error('BITRIX_WEBHOOK не задан');
    }

    const webhook = ensureTrailingSlash(config.BITRIX_WEBHOOK);
    const url = new URL(`${webhook}${method}.json`);
    const queryString = toUrlParams(params).toString();

    if (queryString) {
        url.search = queryString;
    }

    let networkError = null;

    if (!transportState.preferProxy) {
        try {
            const data = await performDirectBitrixRequest(url);
            return normalizeBitrixResponse(data);
        } catch (error) {
            if (error && error.isNetworkError) {
                networkError = error;
                transportState.preferProxy = true;
                console.warn('Прямой запрос к Bitrix24 недоступен, переключаемся на прокси.', error);
            } else {
                throw error;
            }
        }
    }

    if (!transportState.supportsProxy) {
        if (networkError) {
            throw networkError;
        }

        throw new Error('Невозможно выполнить запрос к Bitrix24: прямое соединение недоступно, а прокси нельзя использовать в текущем окружении.');
    }

    try {
        const data = await performProxyBitrixRequest({ webhook, method, params });
        return normalizeBitrixResponse(data);
    } catch (error) {
        if (networkError) {
            error.message = `${error.message} (также прямой запрос завершился ошибкой: ${networkError.message})`;
        }
        throw error;
    }
}

export async function fetchTasks({
    force = false,
    config,
    environment,
    state,
    bitrixUserId,
    transportState
}) {
    if (environment.isDemoMode) {
        if (!state.tasks.length) {
            state.tasks = (config.DEMO_TASKS || []).map(normalizeTaskRecord);
            state.tasksLoadedAt = new Date();
            state.tasksTotal = state.tasks.length;
        }
        return state.tasks;
    }

    if (!bitrixUserId) {
        throw new Error('Bitrix24 ID пользователя не определён. Проверьте USER_MAPPING или параметры запуска.');
    }

    if (!state.tasks.length || force) {
        const baseParams = {
            filter: {
                'RESPONSIBLE_ID': bitrixUserId
            },
            select: ['ID', 'TITLE', 'DESCRIPTION', 'STATUS', 'DEADLINE', 'CREATED_DATE', 'CLOSED_DATE', 'PRIORITY'],
            order: { 'DEADLINE': 'ASC' },
            start: 0
        };

        const tasks = [];
        const seenOffsets = new Set();
        let next = 0;
        let total = null;

        while (next !== null && !seenOffsets.has(next) && tasks.length < 2000) {
            seenOffsets.add(next);

            const response = await callBitrixAPI({
                method: 'tasks.task.list',
                params: {
                    ...baseParams,
                    start: next
                },
                config,
                transportState
            });

            const { tasks: batch, total: pageTotal, next: nextPointer } = normalizeTasksResponse(response);

            if (batch.length) {
                tasks.push(...batch);
            }

            if (pageTotal !== null) {
                total = total === null ? pageTotal : Math.max(total, pageTotal);
            }

            if (nextPointer !== null && !Number.isNaN(nextPointer) && !seenOffsets.has(nextPointer)) {
                next = nextPointer;
            } else {
                next = null;
            }

            if (!batch.length && next === null) {
                break;
            }
        }

        if (total === null || tasks.length > total) {
            total = tasks.length;
        }

        state.tasks = tasks;
        state.tasksLoadedAt = new Date();
        state.tasksTotal = total;
    }

    return state.tasks;
}

function ensureProjectsConfig() {
    const projectsConfig = CONFIG.PROJECTS;

    if (!projectsConfig || !projectsConfig.IBLOCK_ID) {
        throw new Error('CONFIG.PROJECTS.IBLOCK_ID не задан');
    }

    return projectsConfig;
}

function toBitrixPropertyKey(codeOrId) {
    if (typeof codeOrId === 'number' || /^\d+$/.test(String(codeOrId))) {
        return `PROPERTY_${codeOrId}`;
    }
    return codeOrId;
}

function mapProjectToBitrixPayload(project) {
    const { IBLOCK_ID, FIELDS = {} } = ensureProjectsConfig();
    const title = typeof project?.title === 'string' ? project.title.trim() : project?.title;
    const payload = {
        IBLOCK_TYPE_ID: 'lists',
        IBLOCK_ID,
        NAME: title || 'Без названия',
        PROPERTY_VALUES: {}
    };

    const status = typeof project?.status === 'string' ? project.status.trim() : project?.status;
    const priority = typeof project?.priority === 'string' ? project.priority.trim() : project?.priority;
    const siteUrl = typeof project?.siteUrl === 'string' ? project.siteUrl.trim() : project?.siteUrl;
    const driveUrl = typeof project?.driveUrl === 'string' ? project.driveUrl.trim() : project?.driveUrl;

    if (status) {
        payload.PROPERTY_VALUES[toBitrixPropertyKey(FIELDS.STATUS)] = status;
    }
    if (priority) {
        payload.PROPERTY_VALUES[toBitrixPropertyKey(FIELDS.PRIORITY)] = priority;
    }
    if (siteUrl) {
        payload.PROPERTY_VALUES[toBitrixPropertyKey(FIELDS.SITE_URL)] = siteUrl;
    }
    if (driveUrl) {
        payload.PROPERTY_VALUES[toBitrixPropertyKey(FIELDS.DRIVE_URL)] = driveUrl;
    }

    return payload;
}

function mapBitrixElementToProject(element) {
    if (!element || typeof element !== 'object') {
        return null;
    }

    const { FIELDS = {} } = ensureProjectsConfig();
    const readProperty = key => {
        const byId = (typeof key === 'number' || /^\d+$/.test(String(key))) ? `PROPERTY_${key}_VALUE` : null;
        const byCode = typeof key === 'string' ? `${key}_VALUE` : null;
        return element[byCode] ?? element[byId] ?? '';
    };

    const normalize = (value, fallback) => {
        if (value === null || value === undefined) {
            return fallback;
        }

        const text = String(value).trim();
        return text || fallback;
    };

    return {
        id: normalize(element.ID, ''),
        title: normalize(element.NAME, 'Без названия'),
        status: normalize(readProperty(FIELDS.STATUS), 'active'),
        priority: normalize(readProperty(FIELDS.PRIORITY), 'medium'),
        siteUrl: normalize(readProperty(FIELDS.SITE_URL), ''),
        driveUrl: normalize(readProperty(FIELDS.DRIVE_URL), ''),
        createdAt: normalize(element.DATE_CREATE, ''),
        updatedAt: normalize(element.TIMESTAMP_X, '')
    };
}

function ensureBitrixWebhook() {
    if (!CONFIG.BITRIX_WEBHOOK) {
        throw new Error('BITRIX_WEBHOOK не задан');
    }
    return CONFIG.BITRIX_WEBHOOK;
}

async function callBitrixLists(method, params) {
    const webhook = ensureBitrixWebhook();
    const response = await performProxyBitrixRequest({ webhook, method, params });

    if (response && typeof response === 'object' && response.error) {
        throw new Error(response.error_description || response.error);
    }

    return response;
}

export async function getProjects() {
    const { IBLOCK_ID } = ensureProjectsConfig();
    const payload = await callBitrixLists('lists.element.get', {
        IBLOCK_TYPE_ID: 'lists',
        IBLOCK_ID
    });

    const items = Array.isArray(payload?.result)
        ? payload.result
        : Array.isArray(payload)
            ? payload
            : [];

    return items.map(mapBitrixElementToProject).filter(Boolean);
}

export async function createProject(project) {
    const { IBLOCK_ID } = ensureProjectsConfig();
    const result = await callBitrixLists('lists.element.add', mapProjectToBitrixPayload(project));
    const id = result?.result || result?.ID || result;

    const fetched = await callBitrixLists('lists.element.get', {
        IBLOCK_TYPE_ID: 'lists',
        IBLOCK_ID,
        FILTER: { ID: id }
    });

    const element = Array.isArray(fetched?.result)
        ? fetched.result[0]
        : Array.isArray(fetched)
            ? fetched[0]
            : null;

    return mapBitrixElementToProject(element || { ID: id, NAME: project?.title });
}

export async function patchProject(id, patch) {
    if (!id) {
        throw new Error('Не указан идентификатор проекта');
    }

    const { IBLOCK_ID } = ensureProjectsConfig();
    const mapped = mapProjectToBitrixPayload({ ...patch, title: patch?.title });
    const updatePayload = {
        IBLOCK_TYPE_ID: 'lists',
        IBLOCK_ID,
        ID: id,
        PROPERTY_VALUES: mapped.PROPERTY_VALUES
    };

    if (patch?.title) {
        updatePayload.NAME = mapped.NAME;
    }

    await callBitrixLists('lists.element.update', updatePayload);

    const fetched = await callBitrixLists('lists.element.get', {
        IBLOCK_TYPE_ID: 'lists',
        IBLOCK_ID,
        FILTER: { ID: id }
    });

    const element = Array.isArray(fetched?.result)
        ? fetched.result[0]
        : Array.isArray(fetched)
            ? fetched[0]
            : null;

    return mapBitrixElementToProject(element || { ID: id });
}

import { CONFIG } from './config.js';

// --- если у тебя уже есть своя обёртка — используй её и удали эту функцию ---
async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const ct = res.headers.get('content-type') || '';
    let details = '';
    try { details = ct.includes('application/json') ? JSON.stringify(await res.json()) : await res.text(); } catch {}
    throw new Error(`HTTP ${res.status} ${res.statusText}${details ? ' — ' + details : ''}`);
  }
  return res.json();
}
async function callBitrixAPI(method, params) {
  return fetchJSON('/api/bitrix', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      webhook: CONFIG.BITRIX_WEBHOOK, // проверь, что он задан в config.js
      method,
      params
    })
  });
}
// ---------------------------------------------------------------------------

const propKey = k => (typeof k === 'number' || /^\d+$/.test(String(k))) ? `PROPERTY_${k}` : String(k);

function toFields(p) {
  const F = CONFIG.PROJECTS.FIELDS;
  const fields = { NAME: p.title || 'Без названия' };
  if (p.status)   fields[propKey(F.STATUS)]   = p.status;
  if (p.priority) fields[propKey(F.PRIORITY)] = p.priority;
  if (p.siteUrl)  fields[propKey(F.SITE_URL)] = p.siteUrl;
  if (p.driveUrl) fields[propKey(F.DRIVE_URL)] = p.driveUrl;
  return fields;
}

function fromBitrix(el) {
  const F = CONFIG.PROJECTS.FIELDS;
  const val = key => {
    const byId   = (typeof key === 'number' || /^\d+$/.test(String(key))) ? `PROPERTY_${key}_VALUE` : null;
    const byCode = (typeof key === 'string') ? `${key}_VALUE` : null;
    return el?.[byCode] ?? el?.[byId] ?? '';
  };
  return {
    id: String(el.ID),
    title: el.NAME || 'Без названия',
    status:   String(val(F.STATUS)   || 'active'),
    priority: String(val(F.PRIORITY) || 'medium'),
    siteUrl:  String(val(F.SITE_URL) || ''),
    driveUrl: String(val(F.DRIVE_URL)|| ''),
    createdAt: el.DATE_CREATE || '',
    updatedAt: el.TIMESTAMP_X || ''
  };
}

export async function getProjects() {
  const res = await callBitrixAPI('lists.element.get', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: CONFIG.PROJECTS.IBLOCK_ID
  });
  const items = Array.isArray(res?.result) ? res.result : (Array.isArray(res) ? res : []);
  return items.map(fromBitrix);
}

export async function createProject(payload) {
  await callBitrixAPI('lists.element.add', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: CONFIG.PROJECTS.IBLOCK_ID,
    FIELDS: toFields(payload)   // <-- NAME и свойства внутри FIELDS
  });
  const list = await callBitrixAPI('lists.element.get', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: CONFIG.PROJECTS.IBLOCK_ID
  });
  const el = Array.isArray(list?.result) ? list.result[0] : (Array.isArray(list) ? list[0] : null);
  return fromBitrix(el || { ID: '0', NAME: payload?.title });
}

export async function patchProject(id, patch) {
  await callBitrixAPI('lists.element.update', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: CONFIG.PROJECTS.IBLOCK_ID,
    ELEMENT_ID: id,             // ВАЖНО: ELEMENT_ID
    FIELDS: toFields(patch)     // Меняем только то, что пришло (status/title/...)
  });
  const fetched = await callBitrixAPI('lists.element.get', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID: CONFIG.PROJECTS.IBLOCK_ID,
    FILTER: { ID: id }
  });
  const el = Array.isArray(fetched?.result) ? fetched.result[0] : (Array.isArray(fetched) ? fetched[0] : null);
  return fromBitrix(el || { ID: id });
}
