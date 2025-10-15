/**
 * Модуль пользовательского интерфейса: функции работы с DOM и
 * генераторы HTML для задач, аналитики и блока команды.
 */

import {
    PROJECT_PRIORITY,
    PROJECT_STATUS,
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

export function renderProjectCard(project) {
    if (!project || typeof project !== 'object') {
        return '';
    }

    const statusKey = PROJECT_STATUS[project.status] ? project.status : 'active';
    const priorityKey = PROJECT_PRIORITY[project.priority] ? project.priority : 'medium';
    const statusLabel = PROJECT_STATUS[statusKey] || PROJECT_STATUS.active;
    const priorityLabel = PROJECT_PRIORITY[priorityKey] || '';
    const title = escapeHTML(project.title || 'Без названия');
    const siteLink = typeof project.siteUrl === 'string' && project.siteUrl.trim()
        ? `<a href="${escapeAttribute(project.siteUrl)}" target="_blank" rel="noopener">перейти</a>`
        : '—';
    const driveLink = typeof project.driveUrl === 'string' && project.driveUrl.trim()
        ? `<a href="${escapeAttribute(project.driveUrl)}" target="_blank" rel="noopener">перейти</a>`
        : '—';
    const createdDate = parseDate(project.createdAt);
    const createdLabel = createdDate ? formatDateTime(createdDate) : '—';

    return `
        <article class="task-item project-item" data-id="${escapeAttribute(project.id || '')}">
            <div class="task-header">
                <h3 class="task-title">${title}</h3>
                <span class="status-badge">${escapeHTML(statusLabel)}</span>
            </div>
            ${priorityLabel ? `<span class="badge">${priorityLabel}</span>` : ''}
            <div class="task-meta">
                <span>Сайт: ${siteLink}</span>
                <span>Диск: ${driveLink}</span>
            </div>
            <div class="task-meta">
                <span>Создан: ${escapeHTML(createdLabel)}</span>
                <button class="secondary-button project-status-toggle" data-id="${escapeAttribute(project.id || '')}">Сменить статус</button>
            </div>
        </article>
    `;
}

export function renderProjectsList(list) {
    if (!Array.isArray(list) || !list.length) {
        return '<div class="empty-state">Проекты с выбранным фильтром пока не найдены.</div>';
    }
    return list.map(renderProjectCard).join('');

}
