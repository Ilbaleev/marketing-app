// server/projects.js
import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, 'projects.data.json');

function readAll() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return []; }
}
function writeAll(list) {
  fs.writeFileSync(DB_FILE, JSON.stringify(list, null, 2), 'utf8');
}

const router = Router();

router.get('/', (_req, res) => {
  res.json(readAll());
});

router.post('/', (req, res) => {
  const { title, status = 'active', priority = 'medium', siteUrl = '', driveUrl = '' } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });
  const list = readAll();
  const now = new Date().toISOString();
  const record = {
    id: Date.now().toString(),
    title, status, priority, siteUrl, driveUrl,
    createdAt: now, updatedAt: now
  };
  list.unshift(record);
  writeAll(list);
  res.status(201).json(record);
});

router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const list = readAll();
  const i = list.findIndex(p => p.id === id);
  if (i < 0) return res.status(404).json({ error: 'not found' });
  list[i] = { ...list[i], ...req.body, updatedAt: new Date().toISOString() };
  writeAll(list);
  res.json(list[i]);
});

export default router;
