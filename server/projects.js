import { existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const DATA_FILE_PATH = fileURLToPath(new URL('./projects.data.json', import.meta.url));

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PATCH', 'OPTIONS']);
const ALLOWED_STATUSES = new Set(['active', 'paused', 'done']);
const ALLOWED_PRIORITIES = new Set(['low', 'medium', 'high']);

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Init-Data');
}

function ensureDataFile() {
  if (!existsSync(DATA_FILE_PATH)) {
    writeFileSync(DATA_FILE_PATH, '[]', 'utf8');
  }
}

function readProjectsFile() {
  ensureDataFile();
  const raw = readFileSync(DATA_FILE_PATH, 'utf8');
  if (!raw) {
    return [];
  }

  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('Не удалось разобрать projects.data.json, возвращаем пустой массив.', error);
    return [];
  }
}

function writeProjectsFile(projects) {
  try {
    writeFileSync(DATA_FILE_PATH, JSON.stringify(projects, null, 2), 'utf8');
  } catch (error) {
    console.error('Не удалось записать projects.data.json', error);
    throw new Error('Ошибка записи файла проектов');
  }
}

function parseBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === 'object') {
    return req.body;
  }

  try {
    return JSON.parse(req.body);
  } catch (error) {
    return {};
  }
}

function extractProjectId(req) {
  if (req.query && typeof req.query.id === 'string' && req.query.id) {
    return req.query.id;
  }

  const url = typeof req.url === 'string' ? req.url : '';
  const match = url.match(/\/server\/projects\/([^/?]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function normalizeStatus(status, fallback = 'active') {
  const value = typeof status === 'string' ? status.trim().toLowerCase() : '';
  return ALLOWED_STATUSES.has(value) ? value : fallback;
}

function normalizePriority(priority, fallback = 'medium') {
  const value = typeof priority === 'string' ? priority.trim().toLowerCase() : '';
  return ALLOWED_PRIORITIES.has(value) ? value : fallback;
}

export default async function handler(req, res) {
  setCors(res);

  if (!ALLOWED_METHODS.has(req.method)) {
    res.setHeader('Allow', Array.from(ALLOWED_METHODS).join(', '));
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method === 'GET') {
    const projects = readProjectsFile();
    res.status(200).json(projects);
    return;
  }

  if (req.method === 'POST') {
    const body = parseBody(req);
    const title = typeof body.title === 'string' ? body.title.trim() : '';

    if (!title) {
      res.status(400).json({ error: 'Название проекта обязательно' });
      return;
    }

    const timestamp = new Date().toISOString();
    const project = {
      id: Date.now().toString(),
      title,
      status: normalizeStatus(body.status, 'active'),
      priority: normalizePriority(body.priority, 'medium'),
      siteUrl: typeof body.siteUrl === 'string' ? body.siteUrl.trim() : '',
      driveUrl: typeof body.driveUrl === 'string' ? body.driveUrl.trim() : '',
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const projects = readProjectsFile();
    projects.unshift(project);
    writeProjectsFile(projects);

    res.status(201).json(project);
    return;
  }

  if (req.method === 'PATCH') {
    const id = extractProjectId(req);

    if (!id) {
      res.status(400).json({ error: 'Идентификатор проекта обязателен' });
      return;
    }

    const projects = readProjectsFile();
    const index = projects.findIndex(item => item && item.id === id);

    if (index === -1) {
      res.status(404).json({ error: 'Проект не найден' });
      return;
    }

    const patch = parseBody(req);
    const current = { ...projects[index] };

    if (typeof patch.title === 'string') {
      const trimmed = patch.title.trim();
      if (trimmed) {
        current.title = trimmed;
      }
    }

    if (typeof patch.status === 'string') {
      current.status = normalizeStatus(patch.status, current.status);
    }

    if (typeof patch.priority === 'string') {
      current.priority = normalizePriority(patch.priority, current.priority);
    }

    if (typeof patch.siteUrl === 'string') {
      current.siteUrl = patch.siteUrl.trim();
    }

    if (typeof patch.driveUrl === 'string') {
      current.driveUrl = patch.driveUrl.trim();
    }

    current.updatedAt = new Date().toISOString();

    projects[index] = current;
    writeProjectsFile(projects);

    res.status(200).json(current);
    return;
  }

  res.status(405).json({ error: 'Method Not Allowed' });
}
