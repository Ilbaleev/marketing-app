// server/index.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import projectsHandler from './projects.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// JSON body
app.use(express.json());

// CORS (при необходимости)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Роут проектов (точно /server/projects)
app.use('/server/projects', projectsHandler);

// Раздача статики (точно из public)
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback (если надо)
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
