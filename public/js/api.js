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
        response = await fetch('/server/bitrix', {
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
