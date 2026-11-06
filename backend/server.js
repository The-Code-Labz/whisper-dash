import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '4300', 10);
const WHISPER_URL = (process.env.WHISPER_URL || 'http://100.89.249.230:9000').replace(/\/$/, '');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const TRANSCRIPT_DIR = path.join(DATA_DIR, 'transcripts');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || '500', 10);

for (const d of [DATA_DIR, UPLOAD_DIR, TRANSCRIPT_DIR]) fs.mkdirSync(d, { recursive: true });

// ---------- job store ----------
let jobs = [];
try { jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8')); } catch { jobs = []; }
// anything interrupted by a restart goes back to pending if the upload still exists
for (const j of jobs) {
  if (j.status === 'processing') j.status = fs.existsSync(j.uploadPath) ? 'pending' : 'failed';
}
const saveJobs = () => fsp.writeFile(JOBS_FILE, JSON.stringify(jobs, null, 2));

const pub = (j) => ({
  id: j.id, filename: j.filename, size: j.size, status: j.status, error: j.error || null,
  task: j.task, language: j.language, wordTimestamps: j.wordTimestamps,
  detectedLanguage: j.detectedLanguage || null, durationSec: j.durationSec || null,
  createdAt: j.createdAt, startedAt: j.startedAt || null, finishedAt: j.finishedAt || null,
});

// ---------- whisper queue ----------
let running = false;
async function pump() {
  if (running) return;
  const job = jobs.find((j) => j.status === 'pending');
  if (!job) return;
  running = true;
  job.status = 'processing';
  job.startedAt = new Date().toISOString();
  await saveJobs();
  try {
    const params = new URLSearchParams({
      task: job.task, output: 'json', word_timestamps: String(job.wordTimestamps),
    });
    if (job.language && job.language !== 'auto') params.set('language', job.language);
    const buf = await fsp.readFile(job.uploadPath);
    const form = new FormData();
    form.append('audio_file', new Blob([buf]), job.filename);
    const res = await fetch(`${WHISPER_URL}/asr?${params}`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`whisper ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const result = await res.json();
    job.detectedLanguage = result.language || null;
    const segs = result.segments || [];
    if (segs.length) job.durationSec = Math.round(segs[segs.length - 1].end * 10) / 10;
    await fsp.writeFile(path.join(TRANSCRIPT_DIR, `${job.id}.json`), JSON.stringify(result, null, 2));
    job.status = 'done';
  } catch (e) {
    job.status = 'failed';
    job.error = String(e.message || e).slice(0, 500);
  } finally {
    job.finishedAt = new Date().toISOString();
    await saveJobs();
    await fsp.unlink(job.uploadPath).catch(() => {});
    running = false;
    setImmediate(pump);
  }
}

// ---------- format converters ----------
const pad = (n, w = 2) => String(n).padStart(w, '0');
function tsSRT(t) {
  const ms = Math.round(t * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}
function tsVTT(t) { return tsSRT(t).replace(',', '.'); }

function toSRT(segs) {
  return segs.map((s, i) => `${i + 1}\n${tsSRT(s.start)} --> ${tsSRT(s.end)}\n${(s.text || '').trim()}\n`).join('\n');
}
function toVTT(segs) {
  return 'WEBVTT\n\n' + segs.map((s) => `${tsVTT(s.start)} --> ${tsVTT(s.end)}\n${(s.text || '').trim()}\n`).join('\n');
}

// ---------- app ----------
const app = express();
app.use(express.json());

app.get('/api/health', async (_req, res) => {
  let whisper = false;
  try {
    const r = await fetch(`${WHISPER_URL}/health`, { signal: AbortSignal.timeout(5000) });
    whisper = r.ok;
  } catch { /* unreachable */ }
  res.json({ status: 'ok', whisper, whisperUrl: WHISPER_URL });
});

app.get('/api/jobs', (_req, res) => {
  res.json({ jobs: [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(pub) });
});

app.post('/api/jobs', express.raw({ type: () => true, limit: `${MAX_UPLOAD_MB}mb` }), async (req, res) => {
  const filename = path.basename(String(req.query.filename || 'audio.bin'));
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty upload' });
  const task = ['transcribe', 'translate'].includes(req.query.task) ? req.query.task : 'transcribe';
  const language = String(req.query.language || 'auto').slice(0, 16);
  const wordTimestamps = req.query.word_timestamps === 'true';
  const id = crypto.randomBytes(8).toString('hex');
  const uploadPath = path.join(UPLOAD_DIR, `${id}_${filename}`);
  await fsp.writeFile(uploadPath, req.body);
  const job = {
    id, filename, size: req.body.length, status: 'pending', task, language, wordTimestamps,
    uploadPath, createdAt: new Date().toISOString(),
  };
  jobs.push(job);
  await saveJobs();
  setImmediate(pump);
  res.status(201).json({ job: pub(job) });
});

app.get('/api/jobs/:id', async (req, res) => {
  const job = jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  let transcript = null;
  try { transcript = JSON.parse(await fsp.readFile(path.join(TRANSCRIPT_DIR, `${job.id}.json`), 'utf8')); } catch { /* not done */ }
  res.json({ job: pub(job), transcript });
});

app.get('/api/jobs/:id/download', async (req, res) => {
  const job = jobs.find((j) => j.id === req.params.id);
  if (!job || job.status !== 'done') return res.status(404).json({ error: 'transcript not available' });
  let t;
  try { t = JSON.parse(await fsp.readFile(path.join(TRANSCRIPT_DIR, `${job.id}.json`), 'utf8')); }
  catch { return res.status(404).json({ error: 'transcript file missing' }); }
  const base = job.filename.replace(/\.[^.]+$/, '') || 'transcript';
  const fmt = req.query.format || 'txt';
  const segs = t.segments || [];
  if (fmt === 'txt') {
    res.type('text/plain').attachment(`${base}.txt`).send(t.text || '');
  } else if (fmt === 'srt') {
    res.type('text/plain').attachment(`${base}.srt`).send(toSRT(segs));
  } else if (fmt === 'vtt') {
    res.type('text/vtt').attachment(`${base}.vtt`).send(toVTT(segs));
  } else if (fmt === 'json') {
    res.type('application/json').attachment(`${base}.json`).send(JSON.stringify(t, null, 2));
  } else {
    res.status(400).json({ error: 'format must be txt|srt|vtt|json' });
  }
});

app.delete('/api/jobs/:id', async (req, res) => {
  const i = jobs.findIndex((j) => j.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'not found' });
  const [job] = jobs.splice(i, 1);
  await fsp.unlink(path.join(TRANSCRIPT_DIR, `${job.id}.json`)).catch(() => {});
  await fsp.unlink(job.uploadPath).catch(() => {});
  await saveJobs();
  res.json({ deleted: job.id });
});

// ---------- static ----------
const dist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(JSON.stringify({ msg: 'whisper-dash listening', port: PORT, whisper: WHISPER_URL }));
  setImmediate(pump);
});
