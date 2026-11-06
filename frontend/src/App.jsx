import React, { useCallback, useEffect, useRef, useState } from 'react';

const LANGS = ['auto', 'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ja', 'ko', 'zh', 'ru', 'ar', 'hi'];

const fmtBytes = (n) =>
  n == null ? '—' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const fmtDur = (s) => {
  if (s == null) return '—';
  const m = Math.floor(s / 60);
  return m ? `${m}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;
};
const fmtTime = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = (s % 60).toFixed(1);
  return (h ? `${h}:` : '') + `${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(4, '0')}`;
};

const Badge = ({ status }) => {
  const c = {
    pending: 'bg-amber-500/15 text-amber-400',
    processing: 'bg-sky-500/15 text-sky-400 animate-pulse',
    done: 'bg-emerald-500/15 text-emerald-400',
    failed: 'bg-rose-500/15 text-rose-400',
  }[status] || 'bg-zinc-700 text-zinc-300';
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${c}`}>{status}</span>;
};

function Uploader({ onQueued }) {
  const [task, setTask] = useState('transcribe');
  const [language, setLanguage] = useState('auto');
  const [words, setWords] = useState(true);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState(null);
  const inputRef = useRef(null);

  const upload = async (file) => {
    if (!file || busy) return;
    setBusy(true); setErr(null);
    try {
      const q = new URLSearchParams({ filename: file.name, task, language, word_timestamps: String(words) });
      const r = await fetch(`/api/jobs?${q}`, { method: 'POST', body: file });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      onQueued();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition
          ${drag ? 'border-sky-400 bg-sky-500/10' : 'border-zinc-700 hover:border-zinc-500 bg-zinc-900'}`}
      >
        <div className="text-lg font-medium">{busy ? 'Uploading…' : 'Drop an audio or video file here'}</div>
        <div className="text-sm text-zinc-500 mt-1">or click to browse — mp3, wav, m4a, flac, ogg, mp4, mov, mkv…</div>
        <input ref={inputRef} type="file" className="hidden" accept="audio/*,video/*"
          onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />
      </div>
      <div className="flex flex-wrap gap-4 mt-4 items-center text-sm">
        <label className="flex items-center gap-2">
          <span className="text-zinc-400">Task</span>
          <select value={task} onChange={(e) => setTask(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1">
            <option value="transcribe">Transcribe</option>
            <option value="translate">Translate → English</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-zinc-400">Language</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1">
            {LANGS.map((l) => <option key={l} value={l}>{l === 'auto' ? 'Auto-detect' : l}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={words} onChange={(e) => setWords(e.target.checked)} className="accent-sky-500" />
          <span className="text-zinc-400">Word timestamps</span>
        </label>
      </div>
      {err && <div className="mt-3 text-sm text-rose-400">Upload failed: {err}</div>}
    </div>
  );
}

function TranscriptView({ id, onClose }) {
  const [data, setData] = useState(null);
  const [showTs, setShowTs] = useState(true);
  useEffect(() => {
    fetch(`/api/jobs/${id}`).then((r) => r.json()).then(setData).catch(() => {});
  }, [id]);
  if (!data) return <div className="p-6 text-zinc-500">Loading…</div>;
  const { job, transcript } = data;
  const segs = transcript?.segments || [];
  return (
    <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <div className="font-medium">{job.filename}</div>
          <div className="text-xs text-zinc-500 mt-0.5">
            {job.detectedLanguage && <>language: {job.detectedLanguage} · </>}
            {job.durationSec != null && <>duration: {fmtDur(job.durationSec)} · </>}
            {segs.length} segments
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <input type="checkbox" checked={showTs} onChange={(e) => setShowTs(e.target.checked)} className="accent-sky-500" />
            timestamps
          </label>
          {['txt', 'srt', 'vtt', 'json'].map((f) => (
            <a key={f} href={`/api/jobs/${id}/download?format=${f}`}
              className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-xs uppercase">{f}</a>
          ))}
          <button onClick={onClose} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-xs">close</button>
        </div>
      </div>
      <div className="mt-4 max-h-[55vh] overflow-y-auto space-y-1 pr-2">
        {segs.length === 0 && (
          <div className="text-zinc-400 whitespace-pre-wrap text-sm">{transcript?.text || '(empty transcript)'}</div>
        )}
        {segs.map((s, i) => (
          <div key={i} className="flex gap-3 text-sm hover:bg-zinc-800/60 rounded px-2 py-1">
            {showTs && (
              <span className="shrink-0 font-mono text-xs text-sky-400/80 pt-0.5 w-28">
                {fmtTime(s.start)} → {fmtTime(s.end)}
              </span>
            )}
            <span className="text-zinc-200">{(s.text || '').trim()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [jobs, setJobs] = useState([]);
  const [health, setHealth] = useState(null);
  const [openId, setOpenId] = useState(null);

  const refresh = useCallback(async () => {
    try { const r = await fetch('/api/jobs'); setJobs((await r.json()).jobs); } catch { /* offline */ }
  }, []);
  useEffect(() => {
    refresh();
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => {});
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const del = async (id) => { await fetch(`/api/jobs/${id}`, { method: 'DELETE' }); if (openId === id) setOpenId(null); refresh(); };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">WhisperDash</h1>
        <div className="text-xs flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${health?.whisper ? 'bg-emerald-400' : 'bg-rose-500'}`} />
          <span className="text-zinc-500">whisper {health?.whisper ? 'online' : 'offline'}</span>
        </div>
      </header>

      <Uploader onQueued={refresh} />

      <h2 className="mt-8 mb-3 text-sm font-medium text-zinc-400 uppercase tracking-wide">Jobs</h2>
      {jobs.length === 0 && <div className="text-zinc-600 text-sm">No transcriptions yet.</div>}
      <div className="space-y-2">
        {jobs.map((j) => (
          <div key={j.id} className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <Badge status={j.status} />
              <button
                onClick={() => j.status === 'done' && setOpenId(openId === j.id ? null : j.id)}
                className={`font-medium truncate max-w-[40%] ${j.status === 'done' ? 'hover:text-sky-400 cursor-pointer' : 'cursor-default'}`}>
                {j.filename}
              </button>
              <span className="text-xs text-zinc-500">{fmtBytes(j.size)}</span>
              {j.durationSec != null && <span className="text-xs text-zinc-500">{fmtDur(j.durationSec)}</span>}
              {j.task === 'translate' && <span className="text-xs text-violet-400">translate</span>}
              <span className="flex-1" />
              {j.status === 'done' && ['txt', 'srt'].map((f) => (
                <a key={f} href={`/api/jobs/${j.id}/download?format=${f}`}
                  className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-xs uppercase">{f}</a>
              ))}
              <button onClick={() => del(j.id)} className="text-xs text-zinc-600 hover:text-rose-400">delete</button>
            </div>
            {j.error && <div className="mt-1.5 text-xs text-rose-400">{j.error}</div>}
            {openId === j.id && <TranscriptView id={j.id} onClose={() => setOpenId(null)} />}
          </div>
        ))}
      </div>
    </div>
  );
}
