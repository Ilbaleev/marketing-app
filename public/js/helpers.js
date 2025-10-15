/**
 * Модуль утилитарных функций: парсинг параметров, форматирование дат,
 * нормализация данных задач и расчёт агрегатов для интерфейса.
 */

const HTML_ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

export const PROJECT_STATUS = {
    active: 'Активный',
    paused: 'На паузе',
    done: 'Завершён'
};

export const PROJECT_PRIORITY = {
    high: '🔥 Высокий приоритет',
    medium: '⚡ Средний приоритет',
    low: ''
};

export function ensureTrailingSlash(value) {
    if (!value) {
        return '';
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }

    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function sanitize(value) {
    return value ? value.trim() : '';
}

function sanitizeId(value) {
    if (!value) return '';
    return value.replace(/\s+/g, '').replace(/^@/, '');
}

function parseBooleanParam(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const normalized = value.trim().toLowerCase();
    if (!normalized) {
        return true;
    }

    return !['0', 'false', 'no', 'off'].includes(normalized);
}

export function parseManualOverrides(search = '') {
    const params = new URLSearchParams(search || '');
    return {
        telegramId: sanitizeId(params.get('telegram_id') || params.get('tg')),
        bitrixUserId: sanitizeId(params.get('bitrix_user_id') || params.get('bx')),
        webhook: sanitize(params.get('webhook') || params.get('hook')),
        demoMode: parseBooleanParam(params.get('demo')),
        firstName: sanitize(params.get('name') || params.get('first_name')),
        lastName: sanitize(params.get('last_name') || params.get('surname'))
    };
}

export function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(date) {
    try {
        return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(date);
    } catch (error) {
        return date.toLocaleDateString('ru-RU');
    }
}

export function formatDateTime(date) {
    try {
        return new Intl.DateTimeFormat('ru-RU', {
            day: '2-digit',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    } catch (error) {
        return date.toLocaleString('ru-RU');
    }
}

export function percent(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
}

export function escapeHTML(value) {
    const input = value === null || value === undefined ? '' : String(value);
    return input.replace(/[&<>"']/g, char => HTML_ESCAPE_MAP[char] || char);
}

export function escapeAttribute(value) {
    const input = value === null || value === undefined ? '' : String(value);
    return input.replace(/"/g, '&quot;');
}

export function getPlainText(value) {
    if (!value) return '';
    return String(value)
        .replace(/<br\s*\/?>(\r?\n)?/gi, '\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function truncate(value, limit = 220) {
    if (!value) return '';
    const text = String(value);
    return text.length > limit ? `${text.slice(0, limit).trim()}…` : text;
}

export function toCamelCaseKey(key) {
    if (!key) {
        return '';
    }

    return key.toLowerCase().replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function normalizeNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }

        const parsed = Number.parseInt(trimmed, 10);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }

    return null;
}

export function getTaskValue(task, key) {
    if (!task || typeof task !== 'object' || !key) {
        return undefined;
    }

    const variants = Array.from(new Set([
        key,
        key.toUpperCase(),
        key.toLowerCase(),
        toCamelCaseKey(key)
    ].filter(Boolean)));

    for (const variant of variants) {
        if (Object.prototype.hasOwnProperty.call(task, variant)) {
            const value = task[variant];
            if (value !== undefined) {
                return value;
            }
        }
    }

    return undefined;
}

export function getStatusCode(task) {
    const rawStatus = getTaskValue(task, 'STATUS');
    const status = Number.parseInt(rawStatus, 10);
    return Number.isNaN(status) ? 0 : status;
}

export function getTaskStatusText(status) {
    const map = {
        '1': 'Новая',
        '2': 'Ожидает выполнения',
        '3': 'Выполняется',
        '4': 'Ожидает контроля',
        '5': 'Завершена',
        '6': 'Отложена',
        '7': 'Отклонена'
    };
    return map[status?.toString()] || 'Неизвестно';
}

export function getTaskStatusClass(status) {
    const code = Number.parseInt(status, 10);
    switch (code) {
        case 5:
            return 'completed';
        case 4:
            return 'review';
        case 3:
            return 'in-progress';
        case 6:
            return 'postponed';
        case 7:
            return 'declined';
        case 2:
            return 'pending';
        default:
            return 'new';
    }
}

export function getPriorityBadge(priority) {
    const normalized = priority === null || priority === undefined ? '' : priority.toString();
    if (normalized === '2') {
        return '🔥 Высокий приоритет';
    }
    if (normalized === '1') {
        return '⚡ Средний приоритет';
    }
    return '';
}

export function getTaskDeadline(task) {
    const deadline = parseDate(getTaskValue(task, 'DEADLINE'));
    if (!deadline) {
        return { text: 'Срок не указан', overdue: false };
    }
    const now = new Date();
    return {
        text: `Срок: ${formatDate(deadline)}`,
        overdue: getStatusCode(task) < 5 && deadline < now
    };
}

export function isTaskOverdue(task, now = new Date()) {
    const status = getStatusCode(task);
    if (status >= 5) return false;
    const deadline = parseDate(getTaskValue(task, 'DEADLINE'));
    return deadline ? deadline < now : false;
}

export function isTaskCompletedToday(task, todayStart, tomorrowStart) {
    if (getStatusCode(task) !== 5) {
        return false;
    }
    const closedDate = parseDate(getTaskValue(task, 'CLOSED_DATE'));
    if (closedDate) {
        return closedDate >= todayStart && closedDate < tomorrowStart;
    }
    const createdDate = parseDate(getTaskValue(task, 'CREATED_DATE'));
    return createdDate ? createdDate >= todayStart && createdDate < tomorrowStart : false;
}

export function applyTaskFilter(tasks, filterType) {
    const now = new Date();
    switch (filterType) {
        case 'completed':
            return tasks.filter(task => getStatusCode(task) === 5);
        case 'overdue':
            return tasks.filter(task => isTaskOverdue(task, now));
        case 'all':
            return tasks;
        case 'active':
        default:
            return tasks.filter(task => getStatusCode(task) < 5);
    }
}

export function sortTasks(tasks, filterType) {
    const sorted = [...tasks];
    if (filterType === 'completed') {
        sorted.sort((a, b) => {
            const aDate = parseDate(getTaskValue(a, 'CLOSED_DATE'))
                || parseDate(getTaskValue(a, 'DEADLINE'))
                || parseDate(getTaskValue(a, 'CREATED_DATE'))
                || new Date(0);
            const bDate = parseDate(getTaskValue(b, 'CLOSED_DATE'))
                || parseDate(getTaskValue(b, 'DEADLINE'))
                || parseDate(getTaskValue(b, 'CREATED_DATE'))
                || new Date(0);
            return bDate - aDate;
        });
    } else {
        const fallback = new Date(8640000000000000);
        sorted.sort((a, b) => {
            const aDate = parseDate(getTaskValue(a, 'DEADLINE'))
                || parseDate(getTaskValue(a, 'CREATED_DATE'))
                || fallback;
            const bDate = parseDate(getTaskValue(b, 'DEADLINE'))
                || parseDate(getTaskValue(b, 'CREATED_DATE'))
                || fallback;
            return aDate - bDate;
        });
    }
    return sorted;
}

export function calculateDashboardStats(tasks) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(todayStart.getDate() + 1);

    return tasks.reduce((acc, task) => {
        const status = getStatusCode(task);
        if (status < 5) {
            acc.active += 1;
            if (isTaskOverdue(task)) {
                acc.overdue += 1;
            }
        }
        if (isTaskCompletedToday(task, todayStart, tomorrowStart)) {
            acc.completedToday += 1;
        }
        return acc;
    }, { active: 0, completedToday: 0, overdue: 0 });
}

export function buildAnalytics(tasks) {
    const summary = {
        total: tasks.length,
        active: 0,
        completed: 0,
        overdue: 0,
        highPriority: 0,
        mediumPriority: 0,
        lowPriority: 0,
        statuses: {}
    };

    const now = new Date();

    tasks.forEach(task => {
        const statusCode = getStatusCode(task);
        const key = statusCode.toString();
        summary.statuses[key] = (summary.statuses[key] || 0) + 1;

        if (statusCode < 5) {
            summary.active += 1;
            if (isTaskOverdue(task, now)) {
                summary.overdue += 1;
            }
        } else if (statusCode === 5) {
            summary.completed += 1;
        }

        const priority = getTaskValue(task, 'PRIORITY');
        const normalizedPriority = priority === null || priority === undefined ? '' : priority.toString();
        if (normalizedPriority === '2') {
            summary.highPriority += 1;
        } else if (normalizedPriority === '1') {
            summary.mediumPriority += 1;
        } else {
            summary.lowPriority += 1;
        }
    });

    return summary;
}

export function toUrlParams(params = {}) {
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
