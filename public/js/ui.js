/**
 * Модуль пользовательского интерфейса: функции работы с DOM и
 * генераторы HTML для задач, аналитики и блока команды.
 */

import {
    escapeAttribute,
    escapeHTML,
    formatDateTime,
    getPlainText,
    getPriorityBadge,
    getTaskDeadline,
    getTaskStatusClass,
    getTaskStatusText,
    getTaskValue,
    parseDate,
    percent,
    truncate
} from './helpers.js';

export function toggleHidden(element, hidden) {
    if (!element) return;
    element.classList.toggle('hidden', hidden);
}

export function showInlineError(element, message) {
    if (!element) return;
    element.textContent = message;
    toggleHidden(element, false);
}

export function clearInlineError(element) {
    if (!element) return;
    element.textContent = '';
    toggleHidden(element, true);
}

export function updateTimestamp(element, date) {
    if (!element) return;
    if (!date) {
        element.textContent = 'Обновлено: —';
        return;
    }
    element.textContent = `Обновлено: ${formatDateTime(date)}`;
}

export function updateActiveUserInfo(element, { environment, bitrixUserId, currentUser }) {
    if (!element) {
        return;
    }

    if (environment.isDemoMode) {
        element.textContent = 'Демо-режим: отображаются тестовые данные.';
        toggleHidden(element, false);
        return;
    }

    if (!bitrixUserId) {
        element.textContent = 'Bitrix24 ID не определён. Проверьте соответствие Telegram ↔ Bitrix24.';
        toggleHidden(element, false);
        return;
    }

    const telegramInfo = currentUser && currentUser.id && currentUser.id !== 'demo' && currentUser.id !== 'manual'
        ? `Telegram ID: ${currentUser.id}`
        : null;
    const parts = [telegramInfo, `Bitrix24 ID: ${bitrixUserId}`].filter(Boolean);

    element.textContent = `Текущий пользователь → ${parts.join(' · ')}`;
    toggleHidden(element, false);
}

export function renderTask(task) {
    const title = escapeHTML(getTaskValue(task, 'TITLE') || 'Без названия');
    const description = escapeHTML(truncate(getPlainText(getTaskValue(task, 'DESCRIPTION')) || 'Описание отсутствует'));
    const priorityLabel = getPriorityBadge(getTaskValue(task, 'PRIORITY'));
    const statusValue = getTaskValue(task, 'STATUS');
    const statusClass = getTaskStatusClass(statusValue);
    const statusText = getTaskStatusText(statusValue);
    const deadline = getTaskDeadline(task);
    const taskId = getTaskValue(task, 'ID');

    return `
        <article class="task-item">
            <div class="task-header">
                <h3 class="task-title">${title}</h3>
                <span class="status-badge status-${statusClass}">${statusText}</span>
            </div>
            ${priorityLabel ? `<span class="badge">${priorityLabel}</span>` : ''}
            <p class="task-description">${description}</p>
            <div class="task-meta">
                <span class="task-deadline${deadline.overdue ? ' deadline-overdue' : ''}">${escapeHTML(deadline.text)}</span>
                <span class="task-id">ID: ${escapeHTML(taskId || '')}</span>
            </div>
        </article>
    `;
}

export function renderAnalytics(summary) {
    const statusItems = Object.entries(summary.statuses)
        .sort((a, b) => Number.parseInt(a[0], 10) - Number.parseInt(b[0], 10))
        .map(([status, count]) => {
            const label = getTaskStatusText(status);
            return `<li><span>${escapeHTML(label)}</span><span>${count} (${percent(count, summary.total)}%)</span></li>`;
        })
        .join('');

    const priorityItems = [
        { label: 'Высокий 🔥', value: summary.highPriority },
        { label: 'Средний ⚡', value: summary.mediumPriority },
        { label: 'Обычный', value: summary.lowPriority }
    ].map(item => `<li><span>${item.label}</span><span>${item.value} (${percent(item.value, summary.total)}%)</span></li>`).join('');

    return `
        <div class="cards-grid">
            <div class="card">
                <h4>Всего задач</h4>
                <strong>${summary.total}</strong>
                <span>Включая активные и завершённые</span>
            </div>
            <div class="card">
                <h4>Активные</h4>
                <strong>${summary.active}</strong>
                <span>В работе прямо сейчас</span>
            </div>
            <div class="card">
                <h4>Завершённые</h4>
                <strong>${summary.completed}</strong>
                <span>Статус «Завершена»</span>
            </div>
            <div class="card">
                <h4>Просроченные</h4>
                <strong>${summary.overdue}</strong>
                <span>Срок уже наступил</span>
            </div>
        </div>
        <div class="analytics-details">
            <h3>Распределение по статусам</h3>
            <ul>${statusItems || '<li><span>Нет данных</span><span>—</span></li>'}</ul>
            <h3>По приоритетам</h3>
            <ul>${priorityItems}</ul>
        </div>
    `;
}

export function renderProjects(projects) {
    if (!projects.length) {
        return '<div class="empty-state">Проекты с выбранным фильтром пока не найдены.</div>';
    }

    return projects.map(project => {
        const name = escapeHTML(project.name || 'Без названия');
        const statusMeta = getProjectStatusMeta(project.status);
        const priorityLabel = getProjectPriorityLabel(project.priority);
        const siteLink = formatProjectLink(project.siteUrl, 'Перейти на сайт');
        const driveLink = formatProjectLink(project.driveUrl, 'Открыть папку');
        const createdDate = parseDate(project.createdAt);
        const createdLabel = createdDate ? formatDateTime(createdDate) : 'Дата не указана';

        return `
            <article class="project-card">
                <div class="project-header">
                    <h3 class="project-title">${name}</h3>
                    <span class="status-badge ${statusMeta.className}">${statusMeta.label}</span>
                </div>
                <div class="project-priority badge">${priorityLabel}</div>
                <div class="project-attributes">
                    <div class="project-attribute">
                        <span class="project-attribute-label">Сайт:</span>
                        ${siteLink}
                    </div>
                    <div class="project-attribute">
                        <span class="project-attribute-label">Ссылка на Диск:</span>
                        ${driveLink}
                    </div>
                    <div class="project-attribute">
                        <span class="project-attribute-label">Создан:</span>
                        <span class="project-attribute-value">${escapeHTML(createdLabel)}</span>
                    </div>
                </div>
            </article>
        `;
    }).join('');
}

function getProjectStatusMeta(status) {
    switch ((status || '').toString()) {
        case 'completed':
            return { label: 'Завершён', className: 'status-completed' };
        case 'paused':
            return { label: 'На паузе', className: 'status-paused' };
        case 'active':
        default:
            return { label: 'Активный', className: 'status-active' };
    }
}

function getProjectPriorityLabel(priority) {
    switch ((priority || '').toString()) {
        case 'high':
            return '🔥 Высокий приоритет';
        case 'elevated':
            return '⚡ Повышенный приоритет';
        case 'medium':
        default:
            return 'Средний приоритет';
    }
}

function formatProjectLink(url, label) {
    if (!url) {
        return '<span class="project-attribute-value">—</span>';
    }
    return `<a href="${escapeAttribute(url)}" target="_blank" rel="noopener" class="project-link">${escapeHTML(label)}</a>`;

}
