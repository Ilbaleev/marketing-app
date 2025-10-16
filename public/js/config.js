/**
 * Модуль конфигурации: хранит настройки вебхука, маппинг пользователей
 * и демо-данные для офлайн-тестирования мини-приложения.
 */

import { ensureTrailingSlash, parseManualOverrides } from './helpers.js';

export const CONFIG = {
    BITRIX_WEBHOOK: 'https://mpb.bitrix24.kz/rest/13/f92fhs0h39vmg991/',
    USER_MAPPING: {
        '721249582': '13',
        '458063074': '27', 
        '1607374454': '41', 
        '458152540': '29', 
        '501925619': '23', 
        '1207928336': '21', 
        '2045661348': '15', 
        '478800727': '11', 
        '1893698989': '39', 
        '1816572561': '53', 
        '7329272763': '25', 
        '865562957': '31', 
        '5555097406': '35', 
        '7384473922': '47', 
        '993670406': '55'
    },
    PROJECTS: {
        IBLOCK_ID: '31',
        FIELDS: {
            STATUS: 107,
            PRIORITY: 109,
            SITE_URL: 111,
            DRIVE_URL: 113
        }
    },
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
