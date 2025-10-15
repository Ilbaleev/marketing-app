/**
 * Модуль конфигурации: хранит настройки вебхука, маппинг пользователей
 * и демо-данные для офлайн-тестирования мини-приложения.
 */

import { ensureTrailingSlash, parseManualOverrides } from './helpers.js';

export const CONFIG = {
    BITRIX_WEBHOOK: 'https://mpb.bitrix24.kz/rest/13/f92fhs0h39vmg991/',
    USER_MAPPING: {
        '721249582': '13'
    },
    PROJECTS: [
        {
            id: 'p-1',
            name: 'Редизайн корпоративного сайта',
            status: 'active',
            priority: 'elevated',
            siteUrl: 'https://example-agency.kz',
            driveUrl: 'https://drive.google.com/drive/folders/example1',
            createdAt: '2024-04-12T09:30:00+05:00'
        },
        {
            id: 'p-2',
            name: 'Запуск рекламной кампании в Meta',
            status: 'paused',
            priority: 'medium',
            siteUrl: 'https://meta-campaign.agency',
            driveUrl: 'https://drive.google.com/drive/folders/example2',
            createdAt: '2024-03-28T11:15:00+05:00'
        },
        {
            id: 'p-3',
            name: 'Внедрение CRM для отдела продаж',
            status: 'completed',
            priority: 'high',
            siteUrl: 'https://crm-launch.agency',
            driveUrl: 'https://drive.google.com/drive/folders/example3',
            createdAt: '2024-02-18T16:45:00+05:00'
        }
    ],
    DEMO_MODE: false,
    DEMO_TASKS: [
        {
            ID: '101',
            TITLE: 'Согласовать контент-план на неделю',
            DESCRIPTION: 'Подготовить и согласовать темы постов для Instagram и TikTok.',
            STATUS: '3',
            DEADLINE: '2024-06-05T18:00:00+03:00',
            PRIORITY: '2',
            CREATED_BY: '13',
            CREATED_DATE: '2024-05-30T09:00:00+03:00'
        },
        {
            ID: '102',
            TITLE: 'Запустить рекламную кампанию в Meta',
            DESCRIPTION: 'Настроить аудитории и проверить пиксель. Подготовить отчёт о первых результатах.',
            STATUS: '2',
            DEADLINE: '2024-06-03T12:00:00+03:00',
            PRIORITY: '1',
            CREATED_BY: '13',
            CREATED_DATE: '2024-05-29T11:30:00+03:00'
        },
        {
            ID: '103',
            TITLE: 'Подготовить отчёт по лидам за месяц',
            DESCRIPTION: 'Собрать статистику из CRM и выгрузить презентацию для клиента.',
            STATUS: '5',
            DEADLINE: '2024-05-31T19:00:00+03:00',
            CLOSED_DATE: '2024-05-31T17:45:00+03:00',
            PRIORITY: '0',
            CREATED_BY: '13',
            CREATED_DATE: '2024-05-27T10:15:00+03:00'
        }
    ]
};

export const manualOverrides = parseManualOverrides(
    typeof window !== 'undefined' && window.location ? window.location.search : ''
);

if (CONFIG.BITRIX_WEBHOOK) {
    CONFIG.BITRIX_WEBHOOK = ensureTrailingSlash(CONFIG.BITRIX_WEBHOOK);
}

if (manualOverrides.webhook) {
    CONFIG.BITRIX_WEBHOOK = ensureTrailingSlash(manualOverrides.webhook);
}

if (manualOverrides.demoMode !== null) {
    CONFIG.DEMO_MODE = manualOverrides.demoMode;
}
