/* ============================================================
   IT CLUB CTF ARENA — Admin Control Center (admin.js)
   Gerbang login role Admin + CRUD soal + peserta + audit log
   ============================================================ */

const LS_ADMIN = 'ctf_arena_admin';

const state = {
  token: '',
  username: '',
  challenges: [],
  users: [],
  audit: [],
  editingId: null,
};

/* ---------------- util ---------------- */
const $ = (sel) => document.querySelector(sel);

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
    ...options,
  });
  const data = await res.json().catch(() => ({ success: false, message: 'Respons server tidak valid.' }));
  if (state.token && (res.status === 401 || data.authRequired)) {
    doLogout('Sesi admin berakhir. Silakan login kembali.', false);
  }
  return { ok: res.ok, status: res.status, data };
}

function toast(message, type = 'info') {
  const tones = { success: 'success', error: 'error', info: 'info' };
  const el = document.createElement('div');
  el.className = `toast ${tones[type] || 'info'}`;
  el.innerHTML = `<span class="msg">${esc(message)}</span>`;
  $('#toast-container').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 320);
  }, 4200);
}

/* Toggle tampil/sembunyi kata sandi (gerbang login admin) */
function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (btn) btn.textContent = '🙈';
  } else {
    input.type = 'password';
    if (btn) btn.textContent = '👁️';
  }
}

/* Modal konfirmasi / prompt kecil (Promise-based) */
function openAsk({ title, message = '', okText = 'Ya', danger = false, inputType = null, placeholder = '' }) {
  return new Promise((resolve) => {
    const modal = $('#ask-modal');
    const okBtn = $('#ask-ok');
    const cancelBtn = $('#ask-cancel');
    const backdrop = $('#ask-backdrop');
    const inp = $('#ask-input');

    $('#ask-title').textContent = title;
    $('#ask-message').textContent = message;
    inp.classList.toggle('hidden', !inputType);
    inp.value = '';
    inp.type = inputType || 'text';
    inp.placeholder = placeholder;
    okBtn.textContent = okText;
    okBtn.className = 'btn ' + (danger ? 'danger' : 'primary');
    modal.classList.remove('hidden');

    const onOk = () => finish(inputType ? (inp.value.trim() || null) : true);
    const onCancel = () => finish(null);
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); onOk(); } };

    function finish(val) {
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onCancel);
      inp.removeEventListener('keydown', onKey);
      resolve(val);
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    backdrop.addEventListener('click', onCancel);
    inp.addEventListener('keydown', onKey);
    setTimeout(() => (inputType ? inp : okBtn).focus(), 50);
  });
}

/* ---------------- sesi & gerbang login ---------------- */
function showLogin() {
  $('#login-view').classList.remove('hidden');
  $('#dashboard-view').classList.add('hidden');
  setTimeout(() => $('#admin-username').focus(), 60);
}

function showDashboard() {
  $('#login-view').classList.add('hidden');
  $('#dashboard-view').classList.remove('hidden');
  $('#admin-who').textContent = '@' + state.username;
  $('#login-error').classList.add('hidden');
}

function saveSession() {
  try {
    localStorage.setItem(LS_ADMIN, JSON.stringify({ username: state.username, token: state.token }));
  } catch (e) { /* storage diblokir */ }
}

function doLogout(message, showToast = true) {
  state.token = '';
  state.username = '';
  state.editingId = null;
  try { localStorage.removeItem(LS_ADMIN); } catch (e) { /* abaikan */ }
  showLogin();
  if (showToast) toast(message || 'Keluar dari Admin Control Center.', 'info');
  if (message && !showToast) toast(message, 'error');
}

async function boot() {
  // pulihkan sesi admin dari localStorage → validasi ke server
  try {
    const s = JSON.parse(localStorage.getItem(LS_ADMIN) || 'null');
    if (s && s.username && s.token) {
      state.username = s.username;
      state.token = s.token;
      const { ok, data } = await api('/api/admin/users');
      if (ok && data.success) {
        state.users = data.users;
        showDashboard();
        await Promise.all([loadChallenges(), loadAudit()]);
        renderUsers();
        renderStats();
        return;
      }
    }
  } catch (e) { /* jatuh ke gerbang login */ }
  state.token = '';
  state.username = '';
  showLogin();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#admin-username').value.trim();
  const password = $('#adminPassword').value;
  const errBox = $('#login-error');

  if (!username || !password) {
    errBox.textContent = 'Isi username dan password admin.';
    errBox.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));

    if (!data.success || !data.token) {
      errBox.textContent = data.message || 'Login gagal. Coba lagi.';
      errBox.classList.remove('hidden');
      return;
    }
    if (data.user.role !== 'admin') {
      errBox.textContent = 'Akun ini bukan Admin. Gunakan akun role Admin.';
      errBox.classList.remove('hidden');
      return;
    }

    state.username = data.user.username;
    state.token = data.token;
    saveSession();
    $('#adminPassword').value = '';
    showDashboard();
    toast(`Selamat datang, Admin @${state.username}!`, 'success');
    await refreshAll();
  } catch (err) {
    errBox.textContent = 'Tidak bisa terhubung ke server.';
    errBox.classList.remove('hidden');
  }
});

$('#btn-logout').addEventListener('click', () => doLogout('Keluar dari Admin Control Center.'));

/* ---------------- tab ---------------- */
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    $('#tab-' + btn.dataset.tab).classList.remove('hidden');
  });
});

/* ---------------- muat ulang semua data ---------------- */
async function refreshAll() {
  await Promise.all([loadChallenges(), loadUsers(), loadAudit()]);
  renderStats();
}

async function loadChallenges() {
  const { ok, data } = await api('/api/admin/challenges');
  if (!ok || !data.success) return;
  state.challenges = data.challenges;
  renderChallenges();
  renderStats();
}

async function loadUsers() {
  const { ok, data } = await api('/api/admin/users');
  if (!ok || !data.success) return;
  state.users = data.users;
  renderUsers();
  renderStats();
}

async function loadAudit() {
  const { ok, data } = await api('/api/admin/audit');
  if (!ok || !data.success) return;
  state.audit = data.log;
  renderAudit();
  renderStats();
}

function renderStats() {
  $('#stat-total').textContent = state.challenges.length;
  $('#stat-active').textContent = state.challenges.filter((c) => !c.disabled).length;
  $('#stat-users').textContent = state.users.length;
  $('#stat-audit').textContent = state.audit.length;
}

/* ---------------- render tabel soal ---------------- */
function renderChallenges() {
  const body = $('#ch-body');
  $('#ch-count').textContent = state.challenges.length + ' soal';

  if (!state.challenges.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="7">Belum ada soal. Tambahkan lewat form di atas.</td></tr>';
    return;
  }

  body.innerHTML = state.challenges.map((c) => `
    <tr>
      <td><span class="id">${esc(c.id)}</span></td>
      <td>
        <span class="title">${esc(c.title)}</span>
        <span class="sub">${c.files && c.files.length ? '📎 ' + esc(c.files.join(', ')) : c.url ? '🔗 link eksternal' : 'tanpa lampiran'}</span>
      </td>
      <td>${esc(c.category)}</td>
      <td><span class="pill ${esc(String(c.difficulty).toLowerCase())}">${esc(c.difficulty)}</span></td>
      <td><span class="points">${c.points}</span></td>
      <td><span class="pill ${c.disabled ? 'off' : 'on'}">${c.disabled ? 'Nonaktif' : 'Aktif'}</span></td>
      <td class="right">
        <span class="actions">
          <button class="btn sm ghost" data-act="edit" data-id="${esc(c.id)}">✏️ Edit</button>
          <button class="btn sm ${c.disabled ? 'ghost' : ''}" data-act="toggle" data-id="${esc(c.id)}">${c.disabled ? '👁️ Aktifkan' : '🚫 Nonaktifkan'}</button>
          <button class="btn sm danger" data-act="delete" data-id="${esc(c.id)}">🗑️ Hapus</button>
        </span>
      </td>
    </tr>`).join('');
}

$('#ch-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  const ch = state.challenges.find((c) => c.id === id);
  if (!ch) return;

  if (act === 'edit') {
    startEdit(ch);
    return;
  }

  if (act === 'toggle') {
    btn.disabled = true;
    const { ok, data } = await api(`/api/admin/challenges/${encodeURIComponent(id)}/toggle`, { method: 'POST' });
    btn.disabled = false;
    toast(data.message || (ok ? 'Status soal diubah.' : 'Gagal.'), ok ? 'success' : 'error');
    if (ok) await loadChallenges();
    return;
  }

  if (act === 'delete') {
    const yes = await openAsk({
      title: 'Hapus soal?',
      message: `"${ch.title}" (${ch.id}) akan dihapus dari arena. File lampiran tetap tersimpan di server.`,
      okText: 'Hapus', danger: true,
    });
    if (!yes) return;
    const { ok, data } = await api(`/api/admin/challenges/${encodeURIComponent(id)}`, { method: 'DELETE' });
    toast(data.message || (ok ? 'Soal dihapus.' : 'Gagal menghapus.'), ok ? 'success' : 'error');
    if (ok) {
      if (state.editingId === id) cancelEdit();
      await loadChallenges();
    }
  }
});

/* ---------------- form tambah / edit soal ---------------- */
const chFormFields = ['ch-title', 'ch-category', 'ch-difficulty', 'ch-points', 'ch-url', 'ch-description', 'ch-flag'];

function startEdit(ch) {
  state.editingId = ch.id;
  $('#challenge-form-title').textContent = `✏️ Edit Soal — ${ch.id}`;
  $('#challenge-form-hint').textContent = 'Perubahan disimpan ke data/challenges.json';
  $('#ch-title').value = ch.title;
  $('#ch-category').value = ch.category;
  $('#ch-difficulty').value = ch.difficulty;
  $('#ch-points').value = ch.points;
  $('#ch-url').value = ch.url || '';
  $('#ch-description').value = ch.description;
  $('#ch-flag').value = ch.flag;
  $('#ch-file-hint').textContent = (ch.files && ch.files.length)
    ? `Lampiran saat ini: ${ch.files.join(', ')}` : 'Tidak ada lampiran terpasang.';
  $('#ch-detach-row').classList.toggle('hidden', !(ch.files && ch.files.length));
  $('#ch-detach').checked = false;
  $('#ch-file').value = '';
  $('#ch-submit').textContent = '💾 Simpan Perubahan';
  $('#ch-cancel').classList.remove('hidden');
  document.querySelector('.tab[data-tab="soal"]').click();
  const card = document.getElementById('challenge-form-card');
  if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelEdit() {
  state.editingId = null;
  $('#challenge-form-title').textContent = '➕ Tambah Soal Baru';
  $('#challenge-form-hint').textContent = 'ID & status dibuat otomatis';
  chFormFields.forEach((id) => { $('#' + id).value = ''; });
  $('#ch-points').value = 500;
  $('#ch-category').value = 'Web Exploitation';
  $('#ch-difficulty').value = 'Easy';
  $('#ch-file').value = '';
  $('#ch-file-hint').textContent = 'Belum ada lampiran.';
  $('#ch-detach-row').classList.add('hidden');
  $('#ch-detach').checked = false;
  $('#ch-submit').textContent = '💾 Simpan Soal';
  $('#ch-cancel').classList.add('hidden');
}

$('#ch-cancel').addEventListener('click', cancelEdit);

async function uploadFile(file) {
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
  const res = await fetch('/api/admin/upload/' + encodeURIComponent(safeName), {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + state.token,
      'Content-Type': 'application/octet-stream',
    },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || 'Upload file gagal.');
  return data.file;
}

$('#challenge-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const title = $('#ch-title').value.trim();
  const description = $('#ch-description').value.trim();
  const flag = $('#ch-flag').value.trim();
  const points = Number($('#ch-points').value);

  if (title.length < 3) return toast('Judul soal minimal 3 karakter.', 'error');
  if (!description) return toast('Deskripsi soal wajib diisi.', 'error');
  if (!/^ITCLUB\{.+\}$/.test(flag)) return toast('Flag harus format ITCLUB{...}.', 'error');
  if (!Number.isInteger(points) || points < 0) return toast('Poin harus bilangan bulat.', 'error');

  const payload = {
    title,
    category: $('#ch-category').value,
    difficulty: $('#ch-difficulty').value,
    points,
    description,
    flag,
    url: $('#ch-url').value.trim(),
  };

  const submitBtn = $('#ch-submit');
  submitBtn.disabled = true;
  try {
    // 1) upload lampiran bila dipilih
    const fileInput = $('#ch-file');
    if (fileInput.files && fileInput.files[0]) {
      payload.file = await uploadFile(fileInput.files[0]);
      toast(`File "${payload.file}" ter-upload.`, 'success');
    } else if (state.editingId && $('#ch-detach').checked) {
      payload.file = ''; // lepas lampiran
    }

    // 2) create / update
    const isEdit = Boolean(state.editingId);
    const { ok, data } = isEdit
      ? await api(`/api/admin/challenges/${encodeURIComponent(state.editingId)}`, {
          method: 'PUT', body: JSON.stringify(payload),
        })
      : await api('/api/admin/challenges', { method: 'POST', body: JSON.stringify(payload) });

    toast(data.message || (ok ? 'Soal tersimpan.' : 'Gagal menyimpan soal.'), ok ? 'success' : 'error');
    if (ok) {
      cancelEdit();
      await loadChallenges();
    }
  } catch (err) {
    toast(err.message || 'Terjadi kesalahan.', 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

/* ---------------- render tabel peserta ---------------- */
function renderUsers() {
  const body = $('#users-body');
  $('#users-count').textContent = state.users.length + ' akun';

  if (!state.users.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="6">Belum ada peserta terdaftar.</td></tr>';
    return;
  }

  body.innerHTML = state.users.map((u) => {
    const isAdmin = u.role === 'admin';
    return `
    <tr>
      <td><span class="id">@${esc(u.username)}</span>${isAdmin ? ' <span class="pill admin">Admin</span>' : ''}</td>
      <td>${esc(u.name)}</td>
      <td><span class="points">${u.score}</span></td>
      <td>${u.solvedCount} soal</td>
      <td><span class="pill ${isAdmin ? 'admin' : 'member'}">${isAdmin ? 'Admin' : 'Peserta'}</span></td>
      <td class="right">
        <span class="actions">
          <button class="btn sm ghost" data-act="resetpw" data-id="${esc(u.username)}">🔑 Reset Password</button>
          ${isAdmin ? '' : `<button class="btn sm danger" data-act="deluser" data-id="${esc(u.username)}">🗑️ Hapus</button>`}
        </span>
      </td>
    </tr>`;
  }).join('');
}

$('#users-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const username = btn.dataset.id;
  const act = btn.dataset.act;

  if (act === 'resetpw') {
    const newPw = await openAsk({
      title: `Reset password @${username}`,
      message: 'Masukkan password baru (minimal 6 karakter). User harus login ulang dengan password baru.',
      okText: 'Reset Password',
      inputType: 'password',
      placeholder: 'minimal 6 karakter',
    });
    if (newPw === null) return toast('Reset password dibatalkan.', 'info');
    if (newPw.length < 6) return toast('Password minimal 6 karakter.', 'error');
    const { ok, data } = await api(`/api/admin/users/${encodeURIComponent(username)}/reset-password`, {
      method: 'POST', body: JSON.stringify({ password: newPw }),
    });
    toast(data.message || (ok ? 'Password direset.' : 'Gagal.'), ok ? 'success' : 'error');
    return;
  }

  if (act === 'deluser') {
    const yes = await openAsk({
      title: `Hapus akun @${username}?`,
      message: 'Akun beserta skor & riwayat pengerjaannya akan dihapus permanen.',
      okText: 'Hapus Akun', danger: true,
    });
    if (!yes) return;
    const { ok, data } = await api(`/api/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
    toast(data.message || (ok ? 'Akun dihapus.' : 'Gagal menghapus akun.'), ok ? 'success' : 'error');
    if (ok) await loadUsers();
  }
});

$('#btn-reset-leaderboard').addEventListener('click', async () => {
  const yes = await openAsk({
    title: 'Reset Leaderboard?',
    message: 'SEMUA poin & riwayat soal peserta dikosongkan untuk sesi kompetisi baru. Akun tetap ada. Tindakan ini tidak bisa dibatalkan.',
    okText: 'Reset Sekarang', danger: true,
  });
  if (!yes) return;
  const { ok, data } = await api('/api/admin/leaderboard/reset', { method: 'POST' });
  toast(data.message || (ok ? 'Leaderboard direset.' : 'Gagal reset.'), ok ? 'success' : 'error');
  if (ok) await loadUsers();
});

/* ---------------- render audit log ---------------- */
function renderAudit() {
  const body = $('#audit-body');
  $('#audit-count').textContent = state.audit.length + ' entri terakhir';

  if (!state.audit.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="4">Belum ada submisi flag tercatat.</td></tr>';
    return;
  }

  body.innerHTML = state.audit.map((r) => {
    const when = new Date(r.ts).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    const correct = r.status === 'correct';
    return `
    <tr>
      <td style="white-space:nowrap">${esc(when)}</td>
      <td><span class="id">@${esc(r.username)}</span></td>
      <td><span class="title">${esc(r.title || r.challengeId)}</span><span class="sub">${esc(r.challengeId)}</span></td>
      <td><span class="pill ${correct ? 'correct' : 'incorrect'}">${correct ? '✓ Correct' : '✕ Incorrect'}</span></td>
    </tr>`;
  }).join('');
}

/* ---------------- mulai ---------------- */
boot();
