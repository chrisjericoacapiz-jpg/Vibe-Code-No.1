// ─── State ──────────────────────────────────────────────────────────────────
let db;
let allFiles = [];
let currentFilter = 'all';
let currentSearch = '';
let currentSort = 'newest';
let selectedIds = new Set();
let currentFile = null;

// ─── IndexedDB ──────────────────────────────────────────────────────────────
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('VaultDB', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('files')) {
        const store = db.createObjectStore('files', { keyPath: 'id' });
        store.createIndex('added', 'added');
      }
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

async function saveFileToDB(fileObj) {
  const tx = db.transaction('files', 'readwrite');
  tx.objectStore('files').put(fileObj);
  return new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = rej;
  });
}

async function deleteFileFromDB(id) {
  const tx = db.transaction('files', 'readwrite');
  tx.objectStore('files').delete(id);
  return new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = rej;
  });
}

async function clearDB() {
  const tx = db.transaction('files', 'readwrite');
  tx.objectStore('files').clear();
  return new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = rej;
  });
}

async function loadAllFromDB() {
  const tx = db.transaction('files', 'readonly');
  const store = tx.objectStore('files');
  return new Promise((res, rej) => {
    const req = store.getAll();
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

// ─── File helpers ────────────────────────────────────────────────────────────
function getFileType(mime, name) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (
    mime.startsWith('text/') ||
    mime.includes('pdf') ||
    mime.includes('word') ||
    mime.includes('spreadsheet') ||
    mime.includes('presentation') ||
    /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|md|csv)$/i.test(name)
  ) return 'doc';
  return 'other';
}

function typeEmoji(t) {
  return { image:'🖼️', video:'🎬', doc:'📄', other:'📦' }[t] || '📦';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024**2) return (bytes/1024).toFixed(1) + ' KB';
  if (bytes < 1024**3) return (bytes/1024**2).toFixed(1) + ' MB';
  return (bytes/1024**3).toFixed(2) + ' GB';
}

function formatDate(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month:'short', day:'numeric', year:'numeric',
    hour:'2-digit', minute:'2-digit'
  });
}

function uniqueId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ─── Read file as DataURL ─────────────────────────────────────────────────────
function readAsDataURL(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload  = e => res(e.target.result);
    reader.onerror = e => rej(e.target.error);
    reader.readAsDataURL(file);
  });
}

// ─── Upload ──────────────────────────────────────────────────────────────────
async function handleFiles(files) {
  const arr = Array.from(files);
  if (!arr.length) return;
  const prog = document.getElementById('upload-progress');
  const fill = document.getElementById('progress-fill');
  const pct  = document.getElementById('progress-pct');
  const name = document.getElementById('progress-name');
  prog.classList.add('active');

  for (let i = 0; i < arr.length; i++) {
    const file = arr[i];
    name.textContent = `Storing ${file.name}…`;
    fill.style.width = '0%';
    pct.textContent  = '0%';

    try {
      let progress = 0;
      const interval = setInterval(() => {
        progress = Math.min(progress + Math.random() * 15, 85);
        fill.style.width = progress + '%';
        pct.textContent  = Math.round(progress) + '%';
      }, 80);

      const dataUrl = await readAsDataURL(file);
      clearInterval(interval);
      fill.style.width = '100%';
      pct.textContent  = '100%';

      const fileObj = {
        id:      uniqueId(),
        name:    file.name,
        size:    file.size,
        mime:    file.type || 'application/octet-stream',
        type:    getFileType(file.type || '', file.name),
        added:   Date.now(),
        dataUrl
      };

      await saveFileToDB(fileObj);
      allFiles.unshift(fileObj);
      toast(`✅ ${file.name} saved`, 'success');
    } catch(e) {
      toast(`❌ Failed: ${file.name}`, 'error');
    }
  }

  prog.classList.remove('active');
  updateStats();
  renderGrid();
}

// ─── Render ──────────────────────────────────────────────────────────────────
function getVisible() {
  let list = [...allFiles];

  if (currentFilter !== 'all') list = list.filter(f => f.type === currentFilter);

  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    list = list.filter(f => f.name.toLowerCase().includes(q));
  }

  switch(currentSort) {
    case 'newest':    list.sort((a,b) => b.added - a.added); break;
    case 'oldest':    list.sort((a,b) => a.added - b.added); break;
    case 'name':      list.sort((a,b) => a.name.localeCompare(b.name)); break;
    case 'size-desc': list.sort((a,b) => b.size - a.size); break;
    case 'size-asc':  list.sort((a,b) => a.size - b.size); break;
  }

  return list;
}

function renderGrid() {
  const grid  = document.getElementById('file-grid');
  const empty = document.getElementById('empty-state');
  const vis   = getVisible();

  Array.from(grid.children).forEach(c => {
    if (!c.classList.contains('empty-state')) c.remove();
  });

  if (!vis.length) {
    empty.classList.add('visible');
    return;
  }

  empty.classList.remove('visible');

  vis.forEach(f => {
    const card = document.createElement('div');
    card.className = 'file-card' + (selectedIds.has(f.id) ? ' selected' : '');
    card.dataset.id = f.id;

    const thumbClass = { image:'thumb-img', video:'thumb-vid', doc:'thumb-doc', other:'thumb-other' }[f.type];
    const badgeClass = { image:'badge-img', video:'badge-vid', doc:'badge-doc', other:'badge-other' }[f.type];
    const ext = f.name.split('.').pop().toUpperCase().slice(0, 6);

    let thumbContent = `<span>${typeEmoji(f.type)}</span>`;
    if (f.type === 'image') {
      thumbContent = `<img src="${f.dataUrl}" alt="${f.name}" loading="lazy">`;
    } else if (f.type === 'video') {
      thumbContent = `<video src="${f.dataUrl}" muted preload="metadata"></video><span style="position:absolute;font-size:2rem;filter:drop-shadow(0 0 4px #000)">▶️</span>`;
    }

    card.innerHTML = `
      <div class="file-thumb ${thumbClass}">
        ${thumbContent}
        <span class="type-badge ${badgeClass}">${ext}</span>
        <div class="select-check" id="chk-${f.id}">✓</div>
      </div>
      <div class="file-info">
        <div class="file-name" title="${f.name}">${f.name}</div>
        <div class="file-meta">
          <span>${formatSize(f.size)}</span>
          <span>${new Date(f.added).toLocaleDateString()}</span>
        </div>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        toggleSelect(f.id, card);
      } else if (selectedIds.size > 0) {
        toggleSelect(f.id, card);
      } else {
        openLightbox(f);
      }
    });

    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      toggleSelect(f.id, card);
    });

    grid.appendChild(card);
  });
}

// ─── Selection ───────────────────────────────────────────────────────────────
function toggleSelect(id, card) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
    card.classList.remove('selected');
  } else {
    selectedIds.add(id);
    card.classList.add('selected');
  }
  updateBulkBar();
}

function clearSelection() {
  selectedIds.clear();
  document.querySelectorAll('.file-card.selected').forEach(c => c.classList.remove('selected'));
  updateBulkBar();
}

function updateBulkBar() {
  const bar = document.getElementById('bulk-bar');
  const cnt = document.getElementById('bulk-count');
  if (selectedIds.size > 0) {
    bar.classList.add('active');
    cnt.textContent = selectedIds.size + (selectedIds.size === 1 ? ' selected' : ' selected');
  } else {
    bar.classList.remove('active');
  }
}

async function deleteSelected() {
  for (const id of selectedIds) {
    await deleteFileFromDB(id);
    allFiles = allFiles.filter(f => f.id !== id);
  }
  const n = selectedIds.size;
  selectedIds.clear();
  updateBulkBar();
  updateStats();
  renderGrid();
  toast(`🗑 Deleted ${n} file${n !== 1 ? 's' : ''}`, 'error');
}

function downloadSelected() {
  selectedIds.forEach(id => {
    const f = allFiles.find(x => x.id === id);
    if (f) downloadFile(f);
  });
  clearSelection();
}

// ─── Stats ───────────────────────────────────────────────────────────────────
function updateStats() {
  document.getElementById('stat-count').textContent = allFiles.length;
  const total = allFiles.reduce((s, f) => s + f.size, 0);
  document.getElementById('stat-size').textContent = formatSize(total);
}

// ─── Clear All ───────────────────────────────────────────────────────────────
async function clearAll() {
  if (!allFiles.length) return;
  if (!confirm(`Delete all ${allFiles.length} files? This cannot be undone.`)) return;
  await clearDB();
  allFiles = [];
  selectedIds.clear();
  updateStats();
  updateBulkBar();
  renderGrid();
  toast('🗑 All files deleted', 'error');
}

// ─── Download ────────────────────────────────────────────────────────────────
function downloadFile(f) {
  const a = document.createElement('a');
  a.href     = f.dataUrl;
  a.download = f.name;
  a.click();
}

// ─── Lightbox ────────────────────────────────────────────────────────────────
function openLightbox(f) {
  currentFile = f;
  document.getElementById('lb-title').textContent = f.name;
  const body = document.getElementById('lb-body');
  body.innerHTML = '';

  if (f.type === 'image') {
    const img = document.createElement('img');
    img.src = f.dataUrl;
    img.alt = f.name;
    body.appendChild(img);
  } else if (f.type === 'video') {
    const vid = document.createElement('video');
    vid.src      = f.dataUrl;
    vid.controls = true;
    vid.autoplay = true;
    body.appendChild(vid);
  } else if (f.mime === 'application/pdf') {
    const iframe = document.createElement('iframe');
    iframe.src = f.dataUrl;
    body.appendChild(iframe);
  } else if (f.mime.startsWith('text/')) {
    fetch(f.dataUrl)
      .then(r => r.text())
      .then(txt => {
        const pre = document.createElement('pre');
        pre.style.cssText = 'color:var(--text);font-family:Space Mono,monospace;font-size:.8rem;overflow:auto;max-height:50vh;white-space:pre-wrap;word-break:break-all;text-align:left;';
        pre.textContent = txt;
        body.appendChild(pre);
      });
  } else {
    body.innerHTML = `<div class="file-placeholder">
      <div class="big-icon">${typeEmoji(f.type)}</div>
      <p style="margin-bottom:12px">${f.name}</p>
      <p style="font-size:.8rem">Preview not available for this file type.</p>
    </div>`;
  }

  document.getElementById('lb-meta').innerHTML = `
    <div class="meta-item"><strong>${f.name}</strong>File name</div>
    <div class="meta-item"><strong>${formatSize(f.size)}</strong>Size</div>
    <div class="meta-item"><strong>${f.mime || 'Unknown'}</strong>Type</div>
    <div class="meta-item"><strong>${formatDate(f.added)}</strong>Added</div>
  `;

  document.getElementById('lightbox').classList.add('open');
}

function closeLightbox(e) {
  if (!e || e.target === document.getElementById('lightbox')) {
    document.getElementById('lightbox').classList.remove('open');
    const vid = document.querySelector('#lb-body video');
    if (vid) { vid.pause(); vid.src = ''; }
    currentFile = null;
  }
}

// ─── Toast ───────────────────────────────────────────────────────────────────
function toast(msg, type = '') {
  const c  = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ─── Event Listeners ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const dz = document.getElementById('drop-zone');

  dz.addEventListener('dragover', e => {
    e.preventDefault();
    dz.classList.add('dragging');
  });

  dz.addEventListener('dragleave', e => {
    if (!dz.contains(e.relatedTarget)) dz.classList.remove('dragging');
  });

  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('dragging');
    handleFiles(e.dataTransfer.files);
  });

  document.body.addEventListener('dragover', e => e.preventDefault());
  document.body.addEventListener('drop', e => {
    e.preventDefault();
    if (!dz.contains(e.target)) handleFiles(e.dataTransfer.files);
  });

  document.getElementById('file-input').addEventListener('change', e => {
    handleFiles(e.target.files);
    e.target.value = '';
  });

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      renderGrid();
    });
  });

  document.getElementById('search-input').addEventListener('input', e => {
    currentSearch = e.target.value.trim();
    renderGrid();
  });

  document.getElementById('sort-select').addEventListener('change', e => {
    currentSort = e.target.value;
    renderGrid();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeLightbox({ target: document.getElementById('lightbox') });
  });

  // ─── Init ────────────────────────────────────────────────────────────────
  (async () => {
    db = await openDB();
    allFiles = await loadAllFromDB();
    allFiles.sort((a, b) => b.added - a.added);
    updateStats();
    renderGrid();
  })();
});