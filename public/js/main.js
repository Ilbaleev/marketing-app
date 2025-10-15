/**
 * Точка входа мини-приложения: инициализация окружения, навигация
 * между разделами и оркестрацию работы API и UI модулей.
 */

import { CONFIG, manualOverrides } from './config.js';
import {
    applyTaskFilter,
    buildAnalytics,
    calculateDashboardStats,
    escapeHTML,
    getTaskValue,
    sortTasks
} from './helpers.js';
import {
    callBitrixAPI,
    fetchTasks,
    normalizeTaskRecord,
    normalizeTasksResponse
} from './api.js';
import {
    clearInlineError,
    renderAnalytics,
    renderTask,
    renderTeam,
    showInlineError,
    toggleHidden,
    updateActiveUserInfo,
    updateTimestamp
} from './ui.js';

const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

if (tg) {
    tg.ready();
    tg.expand();
}

const hasTelegramContext = Boolean(tg && tg.initDataUnsafe && tg.initDataUnsafe.user);
const manualTelegramId = manualOverrides.telegramId;
const manualBitrixUserId = manualOverrides.bitrixUserId;

const environment = {
    hasTelegramContext,
    hasManualIdentity: Boolean(manualTelegramId || manualBitrixUserId),
    isTelegram: hasTelegramContext || Boolean(manualTelegramId || manualBitrixUserId),
    isDemoMode: Boolean(CONFIG.DEMO_MODE),
    isDemoForced: manualOverrides.demoMode !== null
};

if (!environment.isTelegram && !environment.isDemoMode && CONFIG.DEMO_TASKS && CONFIG.DEMO_TASKS.length && !environment.isDemoForced) {
    environment.isDemoMode = true;
}

const hasBackButton = Boolean(tg && tg.BackButton);

const state = {
    tasks: [],
    tasksLoadedAt: null,
    tasksTotal: 0
};

const bitrixTransportState = {
    preferProxy: false,
    supportsProxy: typeof window !== 'undefined'
        && window.location
        && window.location.protocol !== 'file:'
};

let currentUser = null;
let bitrixUserId = null;

const welcomeEl = document.getElementById('welcome');
const activeUserInfoEl = document.getElementById('activeUserInfo');
const demoNoticeEl = document.getElementById('demoNotice');
const statsErrorEl = document.getElementById('statsError');
const tasksErrorEl = document.getElementById('tasksError');
const analyticsErrorEl = document.getElementById('analyticsError');
const statsUpdatedAtEl = document.getElementById('statsUpdatedAt');
const tasksUpdatedAtEl = document.getElementById('tasksUpdatedAt');
const analyticsUpdatedAtEl = document.getElementById('analyticsUpdatedAt');
const connectionResultEl = document.getElementById('connectionResult');

const pageLoaders = {
    dashboard: () => loadDashboardStats(),
    tasks: () => loadUserTasks(),
    analytics: () => loadAnalytics(),
    team: () => loadTeam()
};

if (hasBackButton) {
    tg.BackButton.onClick(() => {
        const activePage = document.querySelector('.page.active');
        if (!activePage || activePage.id === 'dashboard') {
            if (typeof tg.close === 'function') {
                tg.close();
            }
        } else {
            showDashboard();
        }
    });
}

initializeApp();

function initializeApp() {
    setupNavigation();
    setupEventHandlers();
    detectUser();
    applyEnvironmentState();

    if (environment.isDemoMode || bitrixUserId) {
        showDashboard();
    } else {
        showPage('dashboard');
        showInlineError(statsErrorEl, 'Не найдено соответствие Telegram ID. Добавьте пользователя в USER_MAPPING.');
    }
}

function setupNavigation() {
    document.querySelectorAll('[data-page-target]').forEach(button => {
        button.addEventListener('click', () => showPage(button.dataset.pageTarget));
    });

    document.querySelectorAll('[data-action="back"]').forEach(button => {
        button.addEventListener('click', showDashboard);
    });
}

function setupEventHandlers() {
    const dashboardButton = document.getElementById('refreshDashboard');
    if (dashboardButton) {
        dashboardButton.addEventListener('click', () => loadDashboardStats({ force: true }));
    }

    const tasksButton = document.getElementById('refreshTasks');
    if (tasksButton) {
        tasksButton.addEventListener('click', () => loadUserTasks({ force: true }));
    }

    const analyticsButton = document.getElementById('refreshAnalytics');
    if (analyticsButton) {
        analyticsButton.addEventListener('click', () => loadAnalytics({ force: true }));
    }

    const filterSelect = document.getElementById('taskStatusFilter');
    if (filterSelect) {
        filterSelect.addEventListener('change', event => {
            loadUserTasks({ filter: event.target.value });
        });
    }

    const testConnectionButton = document.getElementById('testConnection');
    if (testConnectionButton) {
        testConnectionButton.addEventListener('click', () => {
            testBitrixConnection();
        });
    }
}

function detectUser() {
    const hasManualOverrides = Boolean(manualTelegramId || manualBitrixUserId);

    if (hasManualOverrides) {
        const displayNameParts = [];
        if (manualOverrides.firstName) {
            displayNameParts.push(manualOverrides.firstName);
        }
        if (manualOverrides.lastName) {
            displayNameParts.push(manualOverrides.lastName);
        }

        const displayName = displayNameParts.join(' ').trim() || 'Тестовый пользователь';
        const fallbackFirstName = manualOverrides.firstName || displayName.split(' ')[0] || 'Тестовый пользователь';

        currentUser = {
            id: manualTelegramId || 'manual',
            first_name: fallbackFirstName,
            last_name: manualOverrides.lastName || ''
        };

        if (welcomeEl) {
            welcomeEl.textContent = `Тестовый доступ: ${displayName}`;
        }

        if (manualTelegramId && manualBitrixUserId && (!CONFIG.USER_MAPPING || !CONFIG.USER_MAPPING[manualTelegramId])) {
            CONFIG.USER_MAPPING[manualTelegramId] = manualBitrixUserId;
        }

        const mappedId = (manualTelegramId && CONFIG.USER_MAPPING ? CONFIG.USER_MAPPING[manualTelegramId] : null) || manualBitrixUserId || null;
        if (mappedId) {
            bitrixUserId = mappedId;
        }

        environment.isTelegram = true;

        if (!environment.isDemoForced) {
            environment.isDemoMode = false;
        }
    } else if (environment.hasTelegramContext && tg && tg.initDataUnsafe) {
        currentUser = tg.initDataUnsafe.user;
        if (currentUser && welcomeEl) {
            welcomeEl.textContent = `Добро пожаловать, ${currentUser.first_name}!`;
        }
        const mappedId = currentUser ? CONFIG.USER_MAPPING[currentUser.id.toString()] : null;
        if (mappedId) {
            bitrixUserId = mappedId;
        } else if (!environment.isDemoMode) {
            console.warn('Пользователь не найден в USER_MAPPING:', currentUser ? currentUser.id : 'unknown');
        }
    } else {
        currentUser = { id: 'demo', first_name: 'Гость' };
        if (welcomeEl) {
            welcomeEl.textContent = 'Режим предпросмотра активен';
        }
        if (!environment.isDemoMode && CONFIG.DEMO_TASKS && CONFIG.DEMO_TASKS.length) {
            environment.isDemoMode = true;
        }
        if (!bitrixUserId) {
            const mappingValues = Object.values(CONFIG.USER_MAPPING || {});
            if (mappingValues.length > 0) {
                bitrixUserId = mappingValues[0];
            }
        }
    }

    if (environment.isDemoMode && CONFIG.DEMO_TASKS) {
        state.tasks = (CONFIG.DEMO_TASKS || []).map(normalizeTaskRecord);
        state.tasksLoadedAt = new Date();
        state.tasksTotal = state.tasks.length;
    }

    updateActiveUserInfo(activeUserInfoEl, { environment, bitrixUserId, currentUser });
}

function applyEnvironmentState() {
    document.body.classList.toggle('demo-mode', environment.isDemoMode);
    toggleHidden(demoNoticeEl, !environment.isDemoMode);
}

function showDashboard() {
    showPage('dashboard');
}

function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });

    const page = document.getElementById(pageId);
    if (page) {
        page.classList.add('active');
    }

    updateBackButton(pageId);

    if (pageLoaders[pageId]) {
        pageLoaders[pageId]();
    }
}

function updateBackButton(pageId) {
    if (!hasBackButton) {
        return;
    }

    if (pageId === 'dashboard') {
        tg.BackButton.hide();
    } else {
        tg.BackButton.show();
    }
}

async function loadDashboardStats({ force = false } = {}) {
    clearInlineError(statsErrorEl);

    try {
        const tasks = await fetchTasks({
            force,
            config: CONFIG,
            environment,
            state,
            bitrixUserId,
            transportState: bitrixTransportState
        });
        const stats = calculateDashboardStats(tasks);

        document.getElementById('activeTasks').textContent = stats.active;
        document.getElementById('completedTasks').textContent = stats.completedToday;
        document.getElementById('overdueTasks').textContent = stats.overdue;

        updateTimestamp(statsUpdatedAtEl, state.tasksLoadedAt);
    } catch (error) {
        console.error('Ошибка загрузки статистики:', error);
        document.getElementById('activeTasks').textContent = '—';
        document.getElementById('completedTasks').textContent = '—';
        document.getElementById('overdueTasks').textContent = '—';
        showInlineError(statsErrorEl, `Не удалось получить статистику: ${error.message}`);
        updateTimestamp(statsUpdatedAtEl, null);
    }
}

async function loadUserTasks({ filter, force = false } = {}) {
    const container = document.getElementById('tasksContent');
    if (!container) return;

    const filterSelect = document.getElementById('taskStatusFilter');
    const selectedFilter = filter || (filterSelect ? filterSelect.value : 'active');

    if (filterSelect && filterSelect.value !== selectedFilter) {
        filterSelect.value = selectedFilter;
    }

    container.innerHTML = '<div class="loading">Загрузка задач...</div>';
    clearInlineError(tasksErrorEl);

    try {
        const tasks = await fetchTasks({
            force,
            config: CONFIG,
            environment,
            state,
            bitrixUserId,
            transportState: bitrixTransportState
        });
        const filtered = applyTaskFilter(tasks, selectedFilter);

        if (!filtered.length) {
            container.innerHTML = '<div class="empty-state">Задачи с выбранным фильтром не найдены.</div>';
        } else {
            const sortedTasks = sortTasks(filtered, selectedFilter);
            container.innerHTML = sortedTasks.map(renderTask).join('');
        }

        updateTimestamp(tasksUpdatedAtEl, state.tasksLoadedAt);
    } catch (error) {
        console.error('Ошибка загрузки задач:', error);
        container.innerHTML = '';
        showInlineError(tasksErrorEl, `Не удалось загрузить задачи: ${error.message}`);
        updateTimestamp(tasksUpdatedAtEl, null);
    }
}

async function loadAnalytics({ force = false } = {}) {
    const container = document.getElementById('analyticsContent');
    if (!container) return;

    container.innerHTML = '<div class="loading">Считаем показатели...</div>';
    clearInlineError(analyticsErrorEl);

    try {
        const tasks = await fetchTasks({
            force,
            config: CONFIG,
            environment,
            state,
            bitrixUserId,
            transportState: bitrixTransportState
        });
        if (!tasks.length) {
            container.innerHTML = '<div class="empty-state">Недостаточно данных для аналитики.</div>';
            updateTimestamp(analyticsUpdatedAtEl, state.tasksLoadedAt);
            return;
        }

        const summary = buildAnalytics(tasks);
        container.innerHTML = renderAnalytics(summary);
        updateTimestamp(analyticsUpdatedAtEl, state.tasksLoadedAt);
    } catch (error) {
        console.error('Ошибка загрузки аналитики:', error);
        container.innerHTML = '';
        showInlineError(analyticsErrorEl, `Не удалось загрузить аналитику: ${error.message}`);
        updateTimestamp(analyticsUpdatedAtEl, null);
    }
}

function loadTeam() {
    const container = document.getElementById('teamContent');
    if (!container) return;

    const members = CONFIG.TEAM_MEMBERS || [];
    container.innerHTML = renderTeam(members);
}

async function testBitrixConnection() {
    if (!connectionResultEl) {
        return;
    }

    if (environment.isDemoMode) {
        connectionResultEl.textContent = 'Включён демо-режим — реальные запросы к Bitrix24 отключены.';
        toggleHidden(connectionResultEl, false);
        return;
    }

    if (!CONFIG.BITRIX_WEBHOOK) {
        connectionResultEl.textContent = 'Не задан адрес вебхука Bitrix24. Заполните CONFIG.BITRIX_WEBHOOK.';
        toggleHidden(connectionResultEl, false);
        return;
    }

    if (!bitrixUserId) {
        connectionResultEl.textContent = 'Bitrix24 ID пользователя не найден. Проверьте соответствия Telegram ↔ Bitrix24.';
        toggleHidden(connectionResultEl, false);
        return;
    }

    connectionResultEl.textContent = 'Отправляем запрос к Bitrix24...';
    toggleHidden(connectionResultEl, false);

    try {
        const response = await callBitrixAPI({
            method: 'tasks.task.list',
            params: {
                filter: {
                    'RESPONSIBLE_ID': bitrixUserId
                },
                select: ['ID', 'TITLE', 'STATUS', 'DEADLINE'],
                order: { 'DEADLINE': 'ASC' },
                start: 0
            },
            config: CONFIG,
            transportState: bitrixTransportState
        });

        const { tasks, total } = normalizeTasksResponse(response);
        const displayTotal = total !== null ? total : tasks.length;

        if (tasks.length) {
            const preview = tasks
                .slice(0, 3)
                .map(task => `#${escapeHTML(getTaskValue(task, 'ID') || '')} — ${escapeHTML(getTaskValue(task, 'TITLE') || 'Без названия')}`)
                .join('<br>');

            connectionResultEl.innerHTML = `Успешно: получено задач — ${displayTotal}.<br><span class="hint">Примеры:<br>${preview}</span>`;
        } else {
            connectionResultEl.textContent = 'Подключение установлено, но задачи для указанного пользователя не найдены.';
        }
    } catch (error) {
        console.error('Проверка подключения завершилась ошибкой:', error);
        connectionResultEl.textContent = `Ошибка: ${error.message}`;
    }
}
