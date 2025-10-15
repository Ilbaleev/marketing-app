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
    createProject,
    fetchTasks,
    getProjects,
    normalizeTaskRecord,
    normalizeTasksResponse,
    patchProject
} from './api.js';
import {
    clearInlineError,
    renderAnalytics,
    renderProjectsList,
    renderTask,
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
    tasksTotal: 0,
    projects: [],
    projectsLoadedAt: null
};

const projectsState = {
    items: [],
    activeFilter: 'active',
    loadedOnce: false
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
const projectsErrorEl = document.getElementById('projectsError');
const statsUpdatedAtEl = document.getElementById('statsUpdatedAt');
const tasksUpdatedAtEl = document.getElementById('tasksUpdatedAt');
const analyticsUpdatedAtEl = document.getElementById('analyticsUpdatedAt');
const connectionResultEl = document.getElementById('connectionResult');

const pageLoaders = {
    dashboard: () => loadDashboardStats(),
    tasks: () => loadUserTasks(),
    analytics: () => loadAnalytics(),
    projects: () => loadProjects()    
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
    const projectForm = document.getElementById('projectForm');
    if (projectForm) {
        projectForm.addEventListener('submit', onCreateProject);
    }

    const projectFilter = document.getElementById('projectFilter');
    if (projectFilter) {
        projectFilter.addEventListener('change', event => {
            loadProjects({ filter: event.target.value });
        });
    }

    const projectsContainer = document.getElementById('projectsContent');
    if (projectsContainer) {
        projectsContainer.addEventListener('click', onProjectStatusToggle);
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

async function loadProjects({ filter } = {}) {
    const container = document.getElementById('projectsContent');
    if (!container) return;

    const filterSelect = document.getElementById('projectFilter');
    const allowedFilters = new Set(['active', 'paused', 'done', 'all']);
    const fallbackFilter = filterSelect ? filterSelect.value : projectsState.activeFilter;
    let selectedFilter = filter || projectsState.activeFilter || fallbackFilter || 'active';
    if (!allowedFilters.has(selectedFilter)) {
        selectedFilter = 'all';
    }

    projectsState.activeFilter = selectedFilter;

    if (filterSelect && filterSelect.value !== selectedFilter) {
        filterSelect.value = selectedFilter;
    }

    clearInlineError(projectsErrorEl);

    if (!projectsState.loadedOnce) {
        container.innerHTML = '<div class="loading">Загружаем проекты...</div>';
    }

    try {
        if (!projectsState.loadedOnce) {
            const projects = await getProjects();
            projectsState.items = Array.isArray(projects)
                ? projects.map(normalizeProjectRecord).filter(Boolean)
                : [];
            projectsState.loadedOnce = true;
            state.projectsLoadedAt = new Date();
        }

        const filteredProjects = selectedFilter === 'all'
            ? projectsState.items
            : projectsState.items.filter(project => project && project.status === selectedFilter);

        container.innerHTML = renderProjectsList(filteredProjects);
    } catch (error) {
        console.error('Ошибка загрузки проектов:', error);
        if (!projectsState.loadedOnce) {
            container.innerHTML = '';
        }
        projectsState.loadedOnce = false;
        showInlineError(projectsErrorEl, error.message || 'Не удалось загрузить проекты.');
    }
}

async function onCreateProject(event) {
    event.preventDefault();

    const form = event.target;
    if (!form) {
        return;
    }
    const formData = new FormData(form);
    const title = (formData.get('title') || '').toString().trim();

    if (!title) {
        showInlineError(projectsErrorEl, 'Введите название проекта.');
        return;
    }

    const payload = {
        title,
        status: (formData.get('status') || 'active').toString(),
        priority: (formData.get('priority') || 'medium').toString(),
        siteUrl: (formData.get('siteUrl') || '').toString().trim(),
        driveUrl: (formData.get('driveUrl') || '').toString().trim()
    };

    const submitButton = form.querySelector('[type="submit"]');
    if (submitButton) {
        submitButton.disabled = true;
    }

    clearInlineError(projectsErrorEl);

    try {
        const savedProject = await createProject(payload);
        const normalizedProject = normalizeProjectRecord(savedProject);

        if (normalizedProject) {
            projectsState.items = [normalizedProject, ...projectsState.items];
            projectsState.loadedOnce = true;
        }

        state.projectsLoadedAt = new Date();
        form.reset();
        await loadProjects({ filter: 'all' });
    } catch (error) {
        console.error('Ошибка создания проекта:', error);
        showInlineError(projectsErrorEl, error.message || 'Не удалось создать проект.');
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
        }
    }
}
async function onProjectStatusToggle(event) {
    const button = event.target.closest('.project-status-toggle');
    if (!button) {
        return;
    }

    event.preventDefault();
    const projectId = button.dataset.id;
    if (!projectId) {
        return;
    }

    clearInlineError(projectsErrorEl);

    const statuses = ['active', 'paused', 'done'];
    const currentProject = projectsState.items.find(project => project && project.id === projectId);
    const currentStatus = currentProject && typeof currentProject.status === 'string'
        ? currentProject.status
        : 'active';
    const currentIndex = statuses.indexOf(currentStatus);
    const nextStatus = statuses[(currentIndex + 1) % statuses.length];

    button.disabled = true;

    try {
        const updatedProject = await patchProject(projectId, { status: nextStatus });
        const normalizedProject = normalizeProjectRecord(updatedProject);

        projectsState.items = projectsState.items.map(project => {
            if (!project || project.id !== projectId) {
                return project;
            }
            return normalizedProject || project;
        });

        state.projectsLoadedAt = new Date();
        await loadProjects({ filter: projectsState.activeFilter });
    } catch (error) {
        console.error('Ошибка обновления статуса проекта:', error);
        showInlineError(projectsErrorEl, error.message || 'Не удалось обновить статус проекта.');
    } finally {
        button.disabled = false;
    }
}

function normalizeProjectRecord(project) {
    if (!project || typeof project !== 'object') {
        return null;
    }

    const id = typeof project.id === 'string' && project.id.trim()
        ? project.id.trim()
        : project.id !== undefined && project.id !== null
            ? String(project.id)
            : null;

    if (!id) {
        return null;
    }

    const titleCandidates = [project.title, project.name];
    let title = 'Без названия';
    for (const candidate of titleCandidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            title = candidate.trim();
            break;
        }
    }

    const status = typeof project.status === 'string' && project.status.trim()
        ? project.status.trim()
        : 'active';
    const priority = typeof project.priority === 'string' && project.priority.trim()
        ? project.priority.trim()
        : 'medium';

    return {
        id,
        title,
        status,
        priority,
        siteUrl: typeof project.siteUrl === 'string' ? project.siteUrl.trim() : '',
        driveUrl: typeof project.driveUrl === 'string' ? project.driveUrl.trim() : '',
        createdAt: project.createdAt || project.created_at || null,
        updatedAt: project.updatedAt || project.updated_at || null
    };
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
