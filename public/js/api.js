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
// Ключ свойства: ID -> PROPERTY_<ID>, КОД -> сам код
const propKey = k => (typeof k === 'number' || /^\d+$/.test(String(k)))
  ? `PROPERTY_${k}`
  : String(k);

// Собираем объект FIELDS для Bitrix Lists
function toFields(project) {
  const { FIELDS = {} } = ensureProjectsConfig();

  const title = typeof project?.title === 'string' ? project.title.trim() : project?.title;
    
  const fields = {
    NAME: title || 'Без названия'
  };

  const status   = typeof project?.status === 'string'  ? project.status.trim()  : project?.status;
  const priority = typeof project?.priority === 'string'? project.priority.trim(): project?.priority;
  const siteUrl  = typeof project?.siteUrl === 'string' ? project.siteUrl.trim() : project?.siteUrl;
  const driveUrl = typeof project?.driveUrl === 'string'? project.driveUrl.trim(): project?.driveUrl;

  if (status)   fields[propKey(FIELDS.STATUS)]   = status;
  if (priority) fields[propKey(FIELDS.PRIORITY)] = priority;
  if (siteUrl)  fields[propKey(FIELDS.SITE_URL)] = siteUrl;
  if (driveUrl) fields[propKey(FIELDS.DRIVE_URL)] = driveUrl;

  return fields;
}


function toBitrixPropertyKey(codeOrId) {
    if (typeof codeOrId === 'number' || /^\d+$/.test(String(codeOrId))) {
        return `PROPERTY_${codeOrId}`;
    }
    return codeOrId;
}

function mapBitrixElementToProject(element) {
  if (!element || typeof element !== 'object') return null;

  const { FIELDS = {} } = ensureProjectsConfig();

  const readProp = (id) => {
    const key = `PROPERTY_${id}_VALUE`;
    let v = element[key];
    if (Array.isArray(v)) v = v[0];
    if (v === undefined || v === null) return '';
    return String(v);
  };

  const norm = (v, fb) => {
    if (v === null || v === undefined) return fb;
    const s = String(v).trim();
    return s || fb;
  };

  return {
    id:       norm(element.ID, ''),
    title:    norm(element.NAME, 'Без названия'),
    status:   norm(readProp(FIELDS.STATUS), 'active'),
    priority: norm(readProp(FIELDS.PRIORITY), 'medium'),
    siteUrl:  norm(readProp(FIELDS.SITE_URL), ''),
    driveUrl: norm(readProp(FIELDS.DRIVE_URL), ''),
    createdAt: norm(element.DATE_CREATE, ''),
    updatedAt: norm(element.TIMESTAMP_X, '')
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
  const webhook = ensureBitrixWebhook();

  // 1) Узнаём точный тип списка и проверяем его видимость вебхуку
  const listsResp = await performProxyBitrixRequest({
    webhook,
    method: 'lists.get',
    params: { IBLOCK_TYPE_ID: 'lists' } // стартуем с "company lists"
  });

  const listsRaw = (listsResp && listsResp.result != null) ? listsResp.result : listsResp;
  const listsArr = Array.isArray(listsRaw) ? listsRaw : [];
  // ищем по ID, а если не нашли — по имени "MPB Projects"
  let meta = listsArr.find(x => String(x.ID) === String(IBLOCK_ID)) 
          || listsArr.find(x => (x.NAME || '').toLowerCase().includes('mpb projects'));

  // если не нашли, возможно тип не 'lists' — попробуем без IBLOCK_TYPE_ID
  if (!meta) {
    const alt = await performProxyBitrixRequest({
      webhook,
      method: 'lists.get',
      params: {}
    });
    const altArr = Array.isArray(alt?.result) ? alt.result : Array.isArray(alt) ? alt : [];
    meta = altArr.find(x => String(x.ID) === String(IBLOCK_ID)) || meta;
  }

  if (!meta) {
    throw new Error(`Список с IBLOCK_ID=${IBLOCK_ID} недоступен этому вебхуку (lists.get не вернул его). Проверьте права доступа.`);
  }

  const TYPE_ID = meta.IBLOCK_TYPE_ID || 'lists';

  // 2) Пробуем вытащить элементы тремя способами
  const tries = [
    { params: { IBLOCK_TYPE_ID: TYPE_ID, IBLOCK_ID, SELECT: ['ID','NAME','DATE_CREATE','TIMESTAMP_X','PROPERTY_*'] } },
    { params: { IBLOCK_TYPE_ID: TYPE_ID, IBLOCK_ID, SELECT: ['ID','NAME','DATE_CREATE','TIMESTAMP_X','PROPERTY_*'], FILTER: { 'SECTION_ID': 0 } } },
    { params: { IBLOCK_TYPE_ID: TYPE_ID, IBLOCK_ID, SELECT: ['ID','NAME','DATE_CREATE','TIMESTAMP_X','PROPERTY_*'], FILTER: { 'SECTION_ID': '' } } },
  ];

  const allItems = [];
  for (const t of tries) {
    try {
      const r = await performProxyBitrixRequest({
        webhook,
        method: 'lists.element.get',
        params: t.params
      });
      const raw = (r && r.result != null) ? r.result : r;
      if (Array.isArray(raw)) allItems.push(...raw);
    } catch (_) { /* пропускаем ошибку этой попытки */ }
  }

  // 3) Удаляем дубликаты по ID
  const seen = new Set();
  const unique = [];
  for (const it of allItems) {
    const id = it && it.ID ? String(it.ID) : '';
    if (id && !seen.has(id)) {
      seen.add(id);
      unique.push(it);
    }
  }

  if (!unique.length) {
    throw new Error('Не удалось прочитать элементы списка: Bitrix вернул 0 записей (возможны права чтения или разделы).');
  }

  return unique.map(mapBitrixElementToProject).filter(Boolean);
}



export async function createProject(project) {
  const { IBLOCK_ID } = ensureProjectsConfig();

  // ГЕНЕРИРУЕМ УНИКАЛЬНЫЙ КОД ЭЛЕМЕНТА (ТРЕБУЕТСЯ СПИСКОМ)
  const elementCode = `project_${Date.now()}`;

  await callBitrixLists('lists.element.add', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID,
    ELEMENT_CODE: elementCode,     // <-- ВАЖНО: НЕ в FIELDS, а ОТДЕЛЬНО
    FIELDS: toFields(project)      // NAME + свойства
  });

  // перечитываем список (можно добавить FILTER по NAME/ID — не обязательно)
  const fetched = await callBitrixLists('lists.element.get', {
    IBLOCK_TYPE_ID: 'lists',
    IBLOCK_ID
  });

  const items = Array.isArray(fetched?.result) ? fetched.result
              : Array.isArray(fetched) ? fetched
              : [];
  const element = items[0] || null;

  return mapBitrixElementToProject(element || { ID: '0', NAME: project?.title });
}



export async function patchProject(id, patch) {
    if (!id) {
        throw new Error('Не указан идентификатор проекта');
    }

    const { IBLOCK_ID } = ensureProjectsConfig();

    // ВАЖНО: для update в Lists нужен ELEMENT_ID и FIELDS{...}
    await callBitrixLists('lists.element.update', {
        IBLOCK_TYPE_ID: 'lists',
        IBLOCK_ID,
        ELEMENT_ID: id,
        FIELDS: toFields(patch)  // сюда попадут только те поля, что передали (напр., {status})
    });

    const fetched = await callBitrixLists('lists.element.get', {
        IBLOCK_TYPE_ID: 'lists',
        IBLOCK_ID,
        FILTER: { ID: id }
    });

    const items = Array.isArray(fetched?.result) ? fetched.result
                : Array.isArray(fetched) ? fetched
                : [];

    const element = items[0] || null;

    return mapBitrixElementToProject(element || { ID: id });
}

