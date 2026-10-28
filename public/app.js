(function () {
  'use strict';

  const TOKEN_KEY = 'cfd_token';
  const USER_KEY = 'cfd_user';

  /* ===============================================================
   * Shared helpers
   * ============================================================= */
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  const getToken = () => localStorage.getItem(TOKEN_KEY);

  function saveSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify({ name: user.name }));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatBytes(bytes) {
    if (!bytes || bytes < 0) return '0 KB';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0) + ' KB';
    if (bytes < 1024 * 1024 * 1024) {
      const mb = bytes / (1024 * 1024);
      return mb.toFixed(mb < 10 ? 2 : 1) + ' MB';
    }
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  async function api(path, options) {
    options = options || {};
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    const init = { method: options.method || 'GET', headers: headers };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    let res;
    try {
      res = await fetch('/api' + path, init);
    } catch (err) {
      throw new Error('Cannot reach the server. Check your connection and try again.');
    }

    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      data = null;
    }

    if (res.status === 401 && !options.skipAuthRedirect) {
      clearSession();
      window.location.href = '/index.html';
      throw new Error('Your session has ended. Log in again.');
    }
    if (!res.ok) {
      throw new Error((data && data.message) || 'Request failed (' + res.status + ')');
    }
    return data;
  }

  /* ----- Password rules, strength meter, show/hide ----- */
  function passwordPolicyError(pw) {
    if (pw.length < 8) return 'Use at least 8 characters.';
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Include at least one letter and one number.';
    return null;
  }

  function scorePassword(pw) {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8) score += 1;
    if (pw.length >= 12) score += 1;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
    if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score += 1;
    return Math.max(1, score);
  }

  function initPasswordWidgets() {
    $$('[data-toggle-password]').forEach((button) => {
      const input = document.getElementById(button.dataset.togglePassword);
      if (!input) return;
      button.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        button.textContent = show ? 'Hide' : 'Show';
        button.setAttribute('aria-pressed', show ? 'true' : 'false');
      });
    });

    const colors = ['bg-red-500', 'bg-amber-500', 'bg-brand', 'bg-secure'];
    const labels = ['Weak', 'Fair', 'Good', 'Strong'];
    const textColors = ['text-red-600', 'text-amber-600', 'text-brand', 'text-secure'];

    $$('[data-strength]').forEach((box) => {
      const input = document.getElementById(box.dataset.strength);
      if (!input) return;
      box.innerHTML =
        '<div class="flex items-center gap-2">' +
        '<div class="grid flex-1 grid-cols-4 gap-1">' +
        [0, 1, 2, 3].map(() => '<span class="h-1.5 rounded-full bg-slate-200 transition-colors"></span>').join('') +
        '</div><span class="w-14 text-right text-sm font-bold"></span></div>';
      const bars = $$('span.h-1\\.5', box);
      const label = $('span.w-14', box);

      const update = () => {
        const score = scorePassword(input.value);
        bars.forEach((bar, i) => {
          bar.className = 'h-1.5 rounded-full transition-colors ' + (i < score ? colors[score - 1] : 'bg-slate-200');
        });
        label.textContent = score ? labels[score - 1] : '';
        label.className = 'w-14 text-right text-sm font-bold ' + (score ? textColors[score - 1] : '');
      };
      input.addEventListener('input', update);
      update();
    });
  }

  function showBanner(el, message, type) {
    el.textContent = message;
    el.className =
      'mt-5 rounded-lg border px-3 py-2 ' +
      (type === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : 'border-red-200 bg-red-50 text-red-700');
  }

  function hideBanner(el) {
    el.textContent = '';
    el.className = 'hidden';
  }

  async function submitWithBusy(form, busyLabel, task) {
    const button = $('button[type="submit"]', form);
    const original = button.textContent;
    button.disabled = true;
    button.textContent = busyLabel;
    try {
      return await task();
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  /* ===============================================================
   * Login / Register
   * ============================================================= */
  function initAuthPage() {
    if (getToken()) {
      window.location.replace('/dashboard.html');
      return;
    }

    initPasswordWidgets();

    const tabs = $$('[data-tab]');
    const forms = { login: $('#login-form'), register: $('#register-form') };
    const banner = $('#auth-message');
    const titles = {
      login: ['Welcome back', 'Log in to share your files.'],
      register: ['Create your account', 'Free, with unlimited storage.']
    };

    function setView(name) {
      hideBanner(banner);
      Object.keys(forms).forEach((key) => forms[key].classList.toggle('hidden', key !== name));
      tabs.forEach((tab) => {
        const active = tab.dataset.tab === name;
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        tab.classList.toggle('bg-white', active);
        tab.classList.toggle('shadow-sm', active);
        tab.classList.toggle('text-ink', active);
        tab.classList.toggle('text-slate-500', !active);
      });
      $('#auth-title').textContent = titles[name][0];
      $('#auth-subtitle').textContent = titles[name][1];
    }

    tabs.forEach((tab) => tab.addEventListener('click', () => setView(tab.dataset.tab)));

    async function authRequest(form, path, payload, busyLabel) {
      hideBanner(banner);
      try {
        const data = await submitWithBusy(form, busyLabel, () =>
          api(path, { method: 'POST', body: payload, skipAuthRedirect: true })
        );
        saveSession(data.token, data.user);
        window.location.href = '/dashboard.html';
      } catch (err) {
        showBanner(banner, err.message, 'error');
      }
    }

    forms.login.addEventListener('submit', (event) => {
      event.preventDefault();
      const email = $('#login-email').value.trim();
      const password = $('#login-password').value;
      if (!email || !password) return showBanner(banner, 'Enter your email and password.', 'error');
      return authRequest(forms.login, '/auth/login', { email, password }, 'Logging in…');
    });

    forms.register.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = $('#register-name').value.trim();
      const email = $('#register-email').value.trim();
      const password = $('#register-password').value;
      if (!name) return showBanner(banner, 'Enter your name.', 'error');
      if (!email) return showBanner(banner, 'Enter your email address.', 'error');
      const problem = passwordPolicyError(password);
      if (problem) return showBanner(banner, problem, 'error');
      return authRequest(forms.register, '/auth/register', { name, email, password }, 'Creating account…');
    });

    setView('login');
  }

  /* ===============================================================
   * Reset password page (opened from an email link)
   * ============================================================= */
  function initResetPage() {
    initPasswordWidgets();

    const banner = $('#reset-message');
    const form = $('#reset-form');
    const token = new URLSearchParams(window.location.search).get('token') || '';

    // Remove the token from the address bar so it is not kept in history.
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname);
    }

    if (!/^[a-f0-9]{64}$/.test(token)) {
      form.classList.add('hidden');
      showBanner(banner, 'This reset link is invalid or has expired.', 'error');
      return;
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const password = $('#reset-password').value;
      const confirm = $('#reset-confirm').value;
      hideBanner(banner);

      const problem = passwordPolicyError(password);
      if (problem) return showBanner(banner, problem, 'error');
      if (password !== confirm) return showBanner(banner, 'The two passwords do not match.', 'error');

      try {
        const data = await submitWithBusy(form, 'Saving…', () =>
          api('/auth/reset-password', { method: 'POST', body: { token, password }, skipAuthRedirect: true })
        );
        form.classList.add('hidden');
        $('#reset-login-link').classList.remove('hidden');
        $('#reset-login-link').classList.add('block');
        return showBanner(banner, data.message, 'success');
      } catch (err) {
        return showBanner(banner, err.message, 'error');
      }
    });
  }

  /* ===============================================================
   * Dashboard
   * ============================================================= */
  function initDashboard() {
    if (!getToken()) {
      window.location.replace('/index.html');
      return;
    }

    initPasswordWidgets();

    const state = {
      files: [],
      user: null,
      used: 0,
      query: '',
      uploading: false,
      view: 'files',
      shareFile: null, // file currently in the share dialog
      shareMinutes: 60
    };

    const els = {
      viewTabs: $$('[data-view-tab]'),
      sharedBadges: $$('[data-shared-count]'),
      views: { files: $('#view-files'), shared: $('#view-shared'), profile: $('#view-profile') },
      storageChip: $('#storage-chip'),
      avatarBtn: $('#avatar-btn'),
      navAvatar: $('#nav-avatar'),
      menu: $('#profile-menu'),
      menuAvatar: $('#menu-avatar'),
      menuName: $('#menu-name'),
      menuEmail: $('#menu-email'),
      menuStorage: $('#menu-storage'),
      dropZone: $('#drop-zone'),
      fileInput: $('#file-input'),
      uploadStatus: $('#upload-status'),
      uploadSpinner: $('#upload-spinner'),
      uploadFileName: $('#upload-file-name'),
      uploadStep: $('#upload-step'),
      uploadBar: $('#upload-bar'),
      uploadPercent: $('#upload-percent'),
      search: $('#file-search'),
      fileCount: $('#file-count'),
      filesHead: $('#files-head'),
      filesList: $('#files-list'),
      filesEmpty: $('#files-empty'),
      filesEmptyTitle: $('#files-empty-title'),
      filesEmptyText: $('#files-empty-text'),
      filesLoading: $('#files-loading'),
      sharedList: $('#shared-list'),
      sharedEmpty: $('#shared-empty'),
      sharedCount: $('#shared-count'),
      // share dialog
      shareModal: $('#share-modal'),
      shareFormStage: $('#share-form-stage'),
      shareResultStage: $('#share-result-stage'),
      shareFileName: $('#share-file-name'),
      chips: $$('#expiry-chips .chip'),
      customAmount: $('#custom-amount'),
      customUnit: $('#custom-unit'),
      expirySummary: $('#expiry-summary'),
      protectToggle: $('#protect-toggle'),
      protectFields: $('#protect-fields'),
      sharePassword: $('#share-password'),
      shareError: $('#share-error'),
      shareCancel: $('#share-cancel'),
      shareCreate: $('#share-create'),
      resultFileName: $('#result-file-name'),
      shareLink: $('#share-link'),
      copyBtn: $('#copy-link-btn'),
      resultExpiry: $('#result-expiry'),
      resultProtected: $('#result-protected'),
      resultDone: $('#result-done'),
      resultQr: $('#result-qr'),
      // QR
      qrModal: $('#qr-modal'),
      qrFile: $('#qr-file'),
      qrImage: $('#qr-image'),
      qrSpinner: $('#qr-spinner'),
      qrNote: $('#qr-note'),
      qrDownload: $('#qr-download'),
      qrClose: $('#qr-close'),
      // confirm + delete
      confirmModal: $('#confirm-modal'),
      confirmTitle: $('#confirm-title'),
      confirmMessage: $('#confirm-message'),
      confirmOk: $('#confirm-ok'),
      confirmCancel: $('#confirm-cancel'),
      deleteModal: $('#delete-modal'),
      deleteForm: $('#delete-form'),
      deletePassword: $('#delete-password'),
      deleteText: $('#delete-confirm-text'),
      deleteOk: $('#delete-ok'),
      deleteCancel: $('#delete-cancel'),
      deleteError: $('#delete-error'),
      // profile
      profileAvatar: $('#profile-avatar'),
      avatarInput: $('#avatar-input'),
      avatarChange: $('#avatar-change'),
      avatarRemove: $('#avatar-remove'),
      profileNameDisplay: $('#profile-name-display'),
      profileSince: $('#profile-since'),
      profileForm: $('#profile-form'),
      profileName: $('#profile-name'),
      profileEmail: $('#profile-email'),
      passwordForm: $('#password-form'),
      pwCurrent: $('#pw-current'),
      pwNew: $('#pw-new'),
      pwConfirm: $('#pw-confirm'),
      profileLogout: $('#profile-logout-btn'),
      logoutAll: $('#logout-all-btn'),
      deleteAccountBtn: $('#delete-account-btn'),
      toasts: $('#toast-container')
    };

    /* ----- Toasts ----- */
    function toast(message, type) {
      const div = document.createElement('div');
      div.className =
        'pop-in max-w-sm rounded-xl px-4 py-3 font-bold text-white shadow-lg ' + (type === 'error' ? 'bg-red-600' : 'bg-navy');
      div.textContent = message;
      els.toasts.appendChild(div);
      setTimeout(() => div.remove(), type === 'error' ? 6000 : 3500);
    }

    /* ----- Modals ----- */
    function openModal(modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      document.body.classList.add('overflow-hidden');
    }

    function closeModal(modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      if (!$$('.fixed.inset-0.flex').length) document.body.classList.remove('overflow-hidden');
    }

    let confirmResolver = null;

    function closeConfirm(result) {
      if (!confirmResolver) return;
      const resolve = confirmResolver;
      confirmResolver = null;
      closeModal(els.confirmModal);
      resolve(result);
    }

    function confirmDialog(options) {
      return new Promise((resolve) => {
        confirmResolver = resolve;
        els.confirmTitle.textContent = options.title;
        els.confirmMessage.textContent = options.message;
        els.confirmOk.textContent = options.okLabel || 'Confirm';
        els.confirmOk.className =
          'rounded-xl px-4 py-2 font-bold text-white transition ' +
          (options.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-brand hover:bg-brand-dark');
        openModal(els.confirmModal);
        els.confirmCancel.focus();
      });
    }

    els.confirmOk.addEventListener('click', () => closeConfirm(true));
    els.confirmCancel.addEventListener('click', () => closeConfirm(false));
    els.confirmModal.addEventListener('click', (event) => {
      if (event.target === els.confirmModal) closeConfirm(false);
    });

    /* ----- Copy helper ----- */
    async function copyText(text, fallbackInput) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        // navigator.clipboard needs https or localhost. Fall back to execCommand.
        const input = fallbackInput || document.createElement('textarea');
        if (!fallbackInput) {
          input.value = text;
          input.style.position = 'fixed';
          input.style.opacity = '0';
          document.body.appendChild(input);
        }
        input.focus();
        input.select();
        let ok = false;
        try {
          ok = document.execCommand('copy');
        } catch (err2) {
          ok = false;
        }
        if (!fallbackInput) input.remove();
        return ok;
      }
    }

    /* ----- Avatars ----- */
    function initials(name) {
      return (
        String(name || '?')
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((w) => w.charAt(0))
          .join('')
          .toUpperCase() || '?'
      );
    }

    function paintAvatar(el, user) {
      el.textContent = '';
      if (user && user.avatar) {
        const img = document.createElement('img');
        img.src = user.avatar;
        img.alt = '';
        img.className = 'h-full w-full object-cover';
        el.appendChild(img);
      } else {
        el.textContent = initials(user && user.name);
      }
    }

    function resizeToJpeg(file, size) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          const side = Math.min(img.naturalWidth, img.naturalHeight);
          const sx = (img.naturalWidth - side) / 2;
          const sy = (img.naturalHeight - side) / 2;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, size, size);
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

          let quality = 0.85;
          let dataUrl = canvas.toDataURL('image/jpeg', quality);
          while (dataUrl.length > 140000 && quality > 0.4) {
            quality -= 0.15;
            dataUrl = canvas.toDataURL('image/jpeg', quality);
          }
          resolve(dataUrl);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('That image could not be read. Try a JPG or PNG.'));
        };
        img.src = url;
      });
    }

    /* ----- User rendering ----- */
    function renderUser() {
      const user = state.user;
      if (!user) return;
      paintAvatar(els.navAvatar, user);
      paintAvatar(els.menuAvatar, user);
      paintAvatar(els.profileAvatar, user);
      els.menuName.textContent = user.name;
      els.menuEmail.textContent = user.email;
      els.profileNameDisplay.textContent = user.name;
      els.profileSince.textContent = user.createdAt
        ? 'Member since ' + new Date(user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
        : '';
      els.profileName.value = user.name;
      els.profileEmail.value = user.email;
      els.avatarRemove.classList.toggle('hidden', !user.avatar);
      localStorage.setItem(USER_KEY, JSON.stringify({ name: user.name }));
    }

    /* ----- Storage (shown in the top bar, no limit) ----- */
    function renderStorage() {
      const text = formatBytes(state.used);
      els.storageChip.textContent = text + ' used';
      els.menuStorage.textContent = text;
    }

    function applyStorage(storage) {
      if (!storage) return;
      state.used = storage.storageUsedBytes;
      renderStorage();
    }

    /* ----- Views / tabs ----- */
    function setView(name, scrollToId) {
      state.view = name;
      Object.keys(els.views).forEach((key) => els.views[key].classList.toggle('hidden', key !== name));
      els.viewTabs.forEach((tab) => {
        const active = tab.dataset.viewTab === name;
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        tab.classList.toggle('bg-brand-soft', active);
        tab.classList.toggle('text-brand-dark', active);
        tab.classList.toggle('text-slate-600', !active);
        tab.classList.toggle('hover:bg-surface', !active);
      });
      closeMenu();
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', name === 'files' ? window.location.pathname : '#' + name);
      }
      if (scrollToId) {
        const target = document.getElementById(scrollToId);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        window.scrollTo(0, 0);
      }
    }

    els.viewTabs.forEach((tab) => tab.addEventListener('click', () => setView(tab.dataset.viewTab)));

    /* ----- Profile menu ----- */
    function closeMenu() {
      els.menu.classList.add('hidden');
      els.avatarBtn.setAttribute('aria-expanded', 'false');
    }

    function toggleMenu() {
      const open = els.menu.classList.contains('hidden');
      els.menu.classList.toggle('hidden', !open);
      els.avatarBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    els.avatarBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleMenu();
    });
    document.addEventListener('click', (event) => {
      if (!els.menu.contains(event.target) && !els.avatarBtn.contains(event.target)) closeMenu();
    });

    /* ----- Files: formatting helpers ----- */
    function typeLabel(file) {
      const dot = file.originalName.lastIndexOf('.');
      if (dot > -1 && dot < file.originalName.length - 1) {
        const ext = file.originalName.slice(dot + 1);
        if (ext.length <= 4) return ext.toUpperCase();
      }
      const parts = (file.mimeType || '').split('/');
      return (parts[1] || parts[0] || 'FILE').split(/[.+;-]/)[0].slice(0, 4).toUpperCase();
    }

    function tileClass(file) {
      const mime = file.mimeType || '';
      const ext = (file.originalName.split('.').pop() || '').toLowerCase();
      if (mime.indexOf('image/') === 0) return 'bg-sky-100 text-sky-700';
      if (mime.indexOf('video/') === 0) return 'bg-violet-100 text-violet-700';
      if (mime.indexOf('audio/') === 0) return 'bg-pink-100 text-pink-700';
      if (mime === 'application/pdf') return 'bg-red-100 text-red-700';
      if (['zip', 'rar', '7z', 'tar', 'gz'].indexOf(ext) !== -1) return 'bg-amber-100 text-amber-700';
      if (['doc', 'docx'].indexOf(ext) !== -1) return 'bg-blue-100 text-blue-700';
      if (['xls', 'xlsx', 'csv'].indexOf(ext) !== -1) return 'bg-emerald-100 text-emerald-700';
      if (['ppt', 'pptx'].indexOf(ext) !== -1) return 'bg-orange-100 text-orange-700';
      if (mime.indexOf('text/') === 0) return 'bg-slate-200 text-slate-700';
      return 'bg-indigo-100 text-indigo-700';
    }

    const tile = (file) =>
      '<span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xs font-bold ' + tileClass(file) + '">' +
      escapeHtml(typeLabel(file)) + '</span>';

    const formatDate = (iso) =>
      new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

    const formatDateTime = (iso) =>
      new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

    function timeLeft(iso) {
      const ms = new Date(iso).getTime() - Date.now();
      if (ms <= 0) return 'expired';
      const min = Math.ceil(ms / 60000);
      if (min < 60) return min + ' min left';
      const hours = Math.floor(min / 60);
      if (hours < 24) return hours + ' h ' + (min % 60) + ' min left';
      const days = Math.floor(hours / 24);
      return days + (days === 1 ? ' day ' : ' days ') + (hours % 24) + ' h left';
    }

    function shareState(file) {
      if (!file.shareToken || !file.shareExpiresAt) return 'none';
      return new Date(file.shareExpiresAt).getTime() > Date.now() ? 'active' : 'expired';
    }

    const LOCK_ICON =
      '<svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';

    function shareCell(file) {
      const s = shareState(file);
      if (s === 'active') {
        return (
          '<button type="button" data-action="view-share" data-id="' + escapeHtml(file.id) + '" ' +
          'class="-mx-1 rounded-lg px-1 py-0.5 text-left hover:bg-surface" title="Show link">' +
          '<span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-sm font-bold text-emerald-800">' +
          (file.shareProtected ? LOCK_ICON : '<span class="h-1.5 w-1.5 rounded-full bg-emerald-600"></span>') +
          (file.shareProtected ? 'Protected' : 'Active') + '</span>' +
          '<span class="block text-sm text-slate-500">' + escapeHtml(timeLeft(file.shareExpiresAt)) + '</span></button>'
        );
      }
      if (s === 'expired') {
        return '<span class="inline-flex items-center gap-1.5 rounded-full bg-slate-200 px-2.5 py-0.5 text-sm font-bold text-slate-600">' +
          '<span class="h-1.5 w-1.5 rounded-full bg-slate-500"></span>Expired</span>';
      }
      return '<span class="text-sm text-slate-400">Not shared</span>';
    }

    /* ----- Render: My files ----- */
    const FILE_COLS = 'xl:grid-cols-[minmax(0,1fr)_5rem_8rem_5.5rem_8.5rem_14rem]';

    function visibleFiles() {
      const q = state.query.trim().toLowerCase();
      if (!q) return state.files;
      return state.files.filter((f) => f.originalName.toLowerCase().indexOf(q) !== -1);
    }

    function renderFiles() {
      els.filesLoading.classList.add('hidden');
      const files = visibleFiles();
      const total = state.files.length;
      els.fileCount.textContent = state.query.trim()
        ? files.length + ' of ' + total
        : total + (total === 1 ? ' file' : ' files');

      if (files.length === 0) {
        els.filesList.innerHTML = '';
        els.filesHead.style.display = 'none';
        els.filesEmpty.classList.remove('hidden');
        els.filesEmptyTitle.textContent = total === 0 ? 'No files yet' : 'No matching files';
        els.filesEmptyText.textContent = total === 0 ? 'Drop a file above to upload it.' : 'Try a different search.';
        return;
      }

      els.filesEmpty.classList.add('hidden');
      els.filesHead.style.display = ''; // CSS decides: hidden below xl, grid at xl and up

      els.filesList.innerHTML = files
        .map((file) => {
          const id = escapeHtml(file.id);
          return (
            '<div class="grid gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-surface/70 sm:px-5 xl:items-center ' + FILE_COLS + '">' +
            '<div class="flex min-w-0 items-center gap-3">' + tile(file) +
            '<span class="truncate font-bold" title="' + escapeHtml(file.originalName) + '">' + escapeHtml(file.originalName) + '</span></div>' +
            '<div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-[3.25rem] text-slate-600 xl:contents xl:pl-0">' +
            '<span>' + escapeHtml(formatBytes(file.sizeBytes)) + '</span>' +
            '<span>' + escapeHtml(formatDate(file.uploadedAt)) + '</span>' +
            '<span class="tabular-nums">' + escapeHtml(file.downloadCount) + '<span class="xl:hidden"> downloads</span></span></div>' +
            '<div class="pl-[3.25rem] xl:pl-0">' + shareCell(file) + '</div>' +
            '<div class="flex gap-2 xl:justify-end">' +
            '<button type="button" data-action="download" data-id="' + id + '" class="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 font-bold transition hover:bg-surface sm:flex-none">Download</button>' +
            '<button type="button" data-action="share" data-id="' + id + '" class="btn-primary flex-1 rounded-lg px-3 py-1.5 sm:flex-none">Share</button>' +
            '<button type="button" data-action="delete" data-id="' + id + '" class="flex-1 rounded-lg border border-red-200 px-3 py-1.5 font-bold text-red-700 transition hover:bg-red-50 sm:flex-none">Delete</button>' +
            '</div></div>'
          );
        })
        .join('');
    }

    /* ----- Render: Shared links ----- */
    function activeShares() {
      return state.files
        .filter((f) => shareState(f) === 'active')
        .sort((a, b) => new Date(a.shareExpiresAt) - new Date(b.shareExpiresAt));
    }

    function renderShared() {
      const shared = activeShares();
      els.sharedBadges.forEach((badge) => {
        badge.textContent = shared.length;
        badge.classList.toggle('hidden', shared.length === 0);
      });
      els.sharedCount.textContent = shared.length + (shared.length === 1 ? ' link' : ' links');

      if (shared.length === 0) {
        els.sharedList.innerHTML = '';
        els.sharedEmpty.classList.remove('hidden');
        return;
      }
      els.sharedEmpty.classList.add('hidden');

      els.sharedList.innerHTML = shared
        .map((file) => {
          const id = escapeHtml(file.id);
          return (
            '<div class="flex flex-col gap-3 px-4 py-3 transition-colors hover:bg-surface/70 sm:px-5 lg:flex-row lg:items-center">' +
            '<div class="flex min-w-0 flex-1 items-center gap-3">' + tile(file) +
            '<div class="min-w-0"><p class="truncate font-bold" title="' + escapeHtml(file.originalName) + '">' + escapeHtml(file.originalName) + '</p>' +
            '<p class="text-slate-500">' + escapeHtml(timeLeft(file.shareExpiresAt)) + ' · until ' + escapeHtml(formatDateTime(file.shareExpiresAt)) +
            ' · ' + escapeHtml(file.downloadCount) + (file.downloadCount === 1 ? ' download' : ' downloads') + '</p></div></div>' +
            '<div class="flex items-center gap-2 pl-[3.25rem] lg:pl-0">' +
            (file.shareProtected
              ? '<span class="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-2.5 py-0.5 text-sm font-bold text-sky-800">' + LOCK_ICON + 'PIN / password</span>'
              : '<span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-sm font-bold text-emerald-800"><span class="h-1.5 w-1.5 rounded-full bg-emerald-600"></span>Open link</span>') +
            '</div>' +
            '<div class="flex gap-2 lg:justify-end">' +
            '<button type="button" data-action="copy-link" data-id="' + id + '" class="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 font-bold transition hover:bg-surface sm:flex-none">Copy link</button>' +
            '<button type="button" data-action="qr" data-id="' + id + '" class="flex-1 rounded-lg border border-brand px-3 py-1.5 font-bold text-brand transition hover:bg-brand-soft sm:flex-none">QR code</button>' +
            '<button type="button" data-action="stop-share" data-id="' + id + '" class="flex-1 rounded-lg border border-red-200 px-3 py-1.5 font-bold text-red-700 transition hover:bg-red-50 sm:flex-none">Stop sharing</button>' +
            '</div></div>'
          );
        })
        .join('');
    }

    function renderAll() {
      renderFiles();
      renderShared();
    }

    const findFile = (id) => state.files.find((f) => String(f.id) === String(id));

    els.search.addEventListener('input', () => {
      state.query = els.search.value;
      renderFiles();
    });

    async function loadData() {
      try {
        const [me, list] = await Promise.all([api('/auth/me'), api('/files')]);
        state.user = me;
        state.files = list.files;
        renderUser();
        applyStorage(list.storage);
        renderAll();
      } catch (err) {
        els.filesLoading.textContent = 'Could not load your files. ' + err.message;
        toast(err.message, 'error');
      }
    }

    /* ----- Upload (direct to S3, with real progress) ----- */
    function setUploadPercent(percent) {
      els.uploadBar.style.width = percent + '%';
      els.uploadBar.className = 'bg-sky-grad h-full rounded-full transition-all duration-200';
      els.uploadPercent.textContent = percent > 0 ? Math.round(percent) + '%' : '';
    }

    function showUploadStep(name, step, percent) {
      els.uploadStatus.classList.remove('hidden');
      els.uploadSpinner.classList.remove('hidden');
      els.uploadFileName.textContent = name;
      els.uploadStep.textContent = step;
      els.uploadStep.className = 'text-slate-500';
      setUploadPercent(percent);
    }

    function showUploadError(name, message) {
      els.uploadStatus.classList.remove('hidden');
      els.uploadSpinner.classList.add('hidden');
      els.uploadFileName.textContent = name;
      els.uploadStep.textContent = message;
      els.uploadStep.className = 'text-red-600';
      els.uploadBar.className = 'h-full rounded-full bg-red-500';
      els.uploadPercent.textContent = '';
    }

    function putToS3(url, file, mimeType, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);
        xhr.setRequestHeader('Content-Type', mimeType);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error('S3 rejected the upload (status ' + xhr.status + '). The upload link may have expired.'));
        };
        xhr.onerror = () =>
          reject(new Error('The upload to S3 was blocked. Check the bucket CORS configuration and your connection.'));
        xhr.send(file);
      });
    }

    async function uploadOne(file) {
      const mimeType = file.type || 'application/octet-stream';
      if (file.size === 0) throw new Error('This file is empty.');

      showUploadStep(file.name, '1. Requesting secure S3 slot...', 0);
      const slot = await api('/files/upload-url', {
        method: 'POST',
        body: { originalName: file.name, sizeBytes: file.size, mimeType: mimeType }
      });

      showUploadStep(file.name, '2. Uploading directly to AWS S3...', 0);
      await putToS3(slot.uploadUrl, file, mimeType, setUploadPercent);

      showUploadStep(file.name, '3. Saving metadata...', 100);
      const saved = await api('/files/confirm', {
        method: 'POST',
        body: { originalName: file.name, s3Key: slot.s3Key, mimeType: mimeType, sizeBytes: file.size }
      });

      state.files.unshift(saved.file);
      applyStorage(saved.storage);
      renderAll();
    }

    async function uploadMany(fileList) {
      const files = Array.from(fileList);
      if (files.length === 0) return;
      if (state.uploading) {
        toast('Wait for the current upload to finish.', 'error');
        return;
      }

      state.uploading = true;
      let succeeded = 0;
      let lastError = null;

      for (const file of files) {
        try {
          await uploadOne(file);
          succeeded += 1;
        } catch (err) {
          lastError = { name: file.name, message: err.message };
          toast(file.name + ': ' + err.message, 'error');
        }
      }

      state.uploading = false;
      els.fileInput.value = '';

      if (lastError) showUploadError(lastError.name, lastError.message);
      else els.uploadStatus.classList.add('hidden');
      if (succeeded > 0) toast(succeeded === 1 ? 'File uploaded' : succeeded + ' files uploaded');
    }

    els.fileInput.addEventListener('change', () => uploadMany(els.fileInput.files));

    ['dragenter', 'dragover'].forEach((name) =>
      els.dropZone.addEventListener(name, (event) => {
        event.preventDefault();
        els.dropZone.classList.add('drop-active');
      })
    );
    ['dragleave', 'drop'].forEach((name) =>
      els.dropZone.addEventListener(name, (event) => {
        event.preventDefault();
        els.dropZone.classList.remove('drop-active');
      })
    );
    els.dropZone.addEventListener('drop', (event) => {
      if (event.dataTransfer && event.dataTransfer.files) uploadMany(event.dataTransfer.files);
    });
    // Stop the browser from opening a file that is dropped outside the zone.
    window.addEventListener('dragover', (event) => event.preventDefault());
    window.addEventListener('drop', (event) => event.preventDefault());

    /* ----- Download (owner) ----- */
    async function downloadFile(id, button) {
      button.disabled = true;
      try {
        const data = await api('/files/' + encodeURIComponent(id) + '/download');
        const a = document.createElement('a');
        a.href = data.downloadUrl;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        button.disabled = false;
      }
    }

    /* ----- Delete file ----- */
    async function deleteFile(id, button) {
      const file = findFile(id);
      if (!file) return;
      const ok = await confirmDialog({
        title: 'Delete this file?',
        message: '"' + file.originalName + '" will be removed from cloud storage. This cannot be undone.',
        okLabel: 'Delete file',
        danger: true
      });
      if (!ok) return;

      button.disabled = true;
      try {
        const data = await api('/files/' + encodeURIComponent(id), { method: 'DELETE' });
        state.files = state.files.filter((f) => String(f.id) !== String(id));
        if (data.storage) applyStorage(data.storage);
        else {
          state.used = Math.max(0, state.used - file.sizeBytes);
          renderStorage();
        }
        renderAll();
        toast('File deleted');
      } catch (err) {
        button.disabled = false;
        toast(err.message, 'error');
      }
    }

    /* ===========================================================
     * Share dialog: custom expiry + optional PIN / password
     * ========================================================= */
    const MAX_MINUTES = 30 * 24 * 60;

    function describeMinutes(minutes) {
      if (minutes % 1440 === 0) return minutes / 1440 + (minutes === 1440 ? ' day' : ' days');
      if (minutes % 60 === 0) return minutes / 60 + (minutes === 60 ? ' hour' : ' hours');
      if (minutes > 60) return Math.floor(minutes / 60) + ' h ' + (minutes % 60) + ' min';
      return minutes + (minutes === 1 ? ' minute' : ' minutes');
    }

    function updateExpirySummary() {
      if (state.shareMinutes === null) {
        els.expirySummary.textContent = 'Enter a time between 1 minute and 30 days.';
        els.expirySummary.className = 'mt-2 text-sm text-red-600';
        return;
      }
      const end = new Date(Date.now() + state.shareMinutes * 60000);
      els.expirySummary.textContent = 'Expires in ' + describeMinutes(state.shareMinutes) + ' (' + formatDateTime(end.toISOString()) + ').';
      els.expirySummary.className = 'mt-2 text-sm text-slate-500';
    }

    function selectChip(minutes) {
      els.chips.forEach((chip) => chip.setAttribute('aria-pressed', Number(chip.dataset.minutes) === minutes ? 'true' : 'false'));
    }

    els.chips.forEach((chip) =>
      chip.addEventListener('click', () => {
        state.shareMinutes = Number(chip.dataset.minutes);
        selectChip(state.shareMinutes);
        els.customAmount.value = '';
        updateExpirySummary();
      })
    );

    function readCustomExpiry() {
      const amount = Number(els.customAmount.value);
      if (!els.customAmount.value) return;
      const minutes = Math.round(amount * Number(els.customUnit.value));
      state.shareMinutes = Number.isFinite(minutes) && minutes >= 1 && minutes <= MAX_MINUTES ? minutes : null;
      selectChip(state.shareMinutes);
      updateExpirySummary();
    }
    els.customAmount.addEventListener('input', readCustomExpiry);
    els.customUnit.addEventListener('change', readCustomExpiry);

    els.protectToggle.addEventListener('change', () => {
      els.protectFields.classList.toggle('hidden', !els.protectToggle.checked);
      if (els.protectToggle.checked) els.sharePassword.focus();
    });

    function showShareError(message) {
      els.shareError.textContent = message;
      els.shareError.classList.remove('hidden');
    }

    function openShareDialog(file) {
      state.shareFile = file;
      state.shareMinutes = 60;
      els.shareFileName.textContent = file.originalName;
      els.customAmount.value = '';
      els.customUnit.value = '1';
      els.protectToggle.checked = false;
      els.protectFields.classList.add('hidden');
      els.sharePassword.value = '';
      els.sharePassword.type = 'password';
      els.shareError.classList.add('hidden');
      selectChip(60);
      updateExpirySummary();
      els.shareFormStage.classList.remove('hidden');
      els.shareResultStage.classList.add('hidden');
      openModal(els.shareModal);
    }

    function showShareResult(file) {
      state.shareFile = file;
      els.resultFileName.textContent = file.originalName;
      els.shareLink.value = file.shareUrl;
      els.resultExpiry.textContent =
        'Anyone with this link can download until ' + formatDateTime(file.shareExpiresAt) + ' (' + timeLeft(file.shareExpiresAt) + ').';
      if (file.shareProtected) {
        els.resultProtected.innerHTML = LOCK_ICON + ' They need the PIN or password you set.';
        els.resultProtected.classList.remove('hidden');
        els.resultProtected.classList.add('flex');
      } else {
        els.resultProtected.classList.add('hidden');
        els.resultProtected.classList.remove('flex');
      }
      els.copyBtn.textContent = 'Copy link';
      els.shareFormStage.classList.add('hidden');
      els.shareResultStage.classList.remove('hidden');
      openModal(els.shareModal);
      els.shareLink.focus();
      els.shareLink.select();
    }

    function closeShareDialog() {
      closeModal(els.shareModal);
    }

    async function createShare() {
      const file = state.shareFile;
      if (!file) return;
      els.shareError.classList.add('hidden');

      if (state.shareMinutes === null) return showShareError('Enter a time between 1 minute and 30 days.');

      const body = { expiresInMinutes: state.shareMinutes };
      if (els.protectToggle.checked) {
        const pw = els.sharePassword.value;
        if (pw.length < 4 || pw.length > 64) return showShareError('The PIN or password must be 4 to 64 characters.');
        body.password = pw;
      }

      els.shareCreate.disabled = true;
      els.shareCreate.textContent = 'Creating…';
      try {
        const data = await api('/files/' + encodeURIComponent(file.id) + '/share', { method: 'POST', body: body });
        file.shareToken = data.shareToken;
        file.shareExpiresAt = data.expiresAt;
        file.shareProtected = data.protected;
        file.shareUrl = data.shareUrl;
        renderAll();
        showShareResult(file);
      } catch (err) {
        showShareError(err.message);
      } finally {
        els.shareCreate.disabled = false;
        els.shareCreate.textContent = 'Create link';
      }
      return undefined;
    }

    els.shareCreate.addEventListener('click', createShare);
    els.shareCancel.addEventListener('click', closeShareDialog);
    els.resultDone.addEventListener('click', closeShareDialog);
    els.shareModal.addEventListener('click', (event) => {
      if (event.target === els.shareModal) closeShareDialog();
    });
    els.copyBtn.addEventListener('click', async () => {
      const ok = await copyText(els.shareLink.value, els.shareLink);
      if (ok) {
        els.copyBtn.textContent = 'Copied ✓';
        toast('Link copied');
      } else {
        toast('Copy failed. Select the link and press Ctrl+C.', 'error');
      }
    });
    els.resultQr.addEventListener('click', () => {
      if (state.shareFile) showQr(state.shareFile);
    });

    /* ----- QR code pop-up ----- */
    async function showQr(file) {
      els.qrFile.textContent = file.originalName;
      els.qrImage.classList.add('hidden');
      els.qrSpinner.classList.remove('hidden');
      els.qrDownload.classList.add('pointer-events-none', 'opacity-60');
      els.qrDownload.removeAttribute('href');
      els.qrNote.textContent = 'Point a phone camera at the code.';
      openModal(els.qrModal);

      try {
        const data = await api('/files/' + encodeURIComponent(file.id) + '/share-qr');
        els.qrImage.src = data.qr;
        els.qrImage.classList.remove('hidden');
        els.qrSpinner.classList.add('hidden');
        els.qrDownload.href = data.qr;
        els.qrDownload.classList.remove('pointer-events-none', 'opacity-60');
        if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(data.shareUrl)) {
          els.qrNote.textContent = 'This link points to localhost, so a phone cannot open it yet. Set APP_URL in .env to your PC address or domain.';
        }
      } catch (err) {
        closeModal(els.qrModal);
        toast(err.message, 'error');
      }
    }

    els.qrClose.addEventListener('click', () => closeModal(els.qrModal));
    els.qrModal.addEventListener('click', (event) => {
      if (event.target === els.qrModal) closeModal(els.qrModal);
    });

    /* ----- Stop sharing ----- */
    async function stopSharing(id, button) {
      const file = findFile(id);
      if (!file) return;
      const ok = await confirmDialog({
        title: 'Stop sharing this file?',
        message: 'The link for "' + file.originalName + '" stops working right away.',
        okLabel: 'Stop sharing',
        danger: true
      });
      if (!ok) return;

      button.disabled = true;
      try {
        await api('/files/' + encodeURIComponent(id) + '/share', { method: 'DELETE' });
        file.shareToken = null;
        file.shareExpiresAt = null;
        file.shareProtected = false;
        file.shareUrl = null;
        renderAll();
        toast('Sharing stopped');
      } catch (err) {
        button.disabled = false;
        toast(err.message, 'error');
      }
    }

    /* ----- Row actions (My files + Shared links) ----- */
    function handleAction(event) {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const id = button.dataset.id;
      const file = findFile(id);
      const action = button.dataset.action;

      if (action === 'download') downloadFile(id, button);
      else if (action === 'delete') deleteFile(id, button);
      else if (action === 'share' && file) openShareDialog(file);
      else if (action === 'view-share' && file && shareState(file) === 'active') showShareResult(file);
      else if (action === 'qr' && file) {
        state.shareFile = file;
        showQr(file);
      } else if (action === 'copy-link' && file && file.shareUrl) {
        copyText(file.shareUrl).then((ok) => toast(ok ? 'Link copied' : 'Copy failed. Open the link and copy it.', ok ? undefined : 'error'));
      } else if (action === 'stop-share') stopSharing(id, button);
    }

    els.filesList.addEventListener('click', handleAction);
    els.sharedList.addEventListener('click', handleAction);

    /* ----- Profile: photo ----- */
    const pickAvatar = () => els.avatarInput.click();
    els.profileAvatar.addEventListener('click', pickAvatar);
    els.avatarChange.addEventListener('click', pickAvatar);

    els.avatarInput.addEventListener('change', async () => {
      const file = els.avatarInput.files[0];
      els.avatarInput.value = '';
      if (!file) return;
      if (file.type.indexOf('image/') !== 0) return toast('Choose an image file.', 'error');
      if (file.size > 15 * 1024 * 1024) return toast('That image is too large. Choose one under 15 MB.', 'error');

      try {
        const avatar = await resizeToJpeg(file, 256);
        state.user = await api('/auth/profile', { method: 'PUT', body: { avatar: avatar } });
        renderUser();
        return toast('Profile photo updated');
      } catch (err) {
        return toast(err.message, 'error');
      }
    });

    els.avatarRemove.addEventListener('click', async () => {
      try {
        state.user = await api('/auth/profile', { method: 'PUT', body: { avatar: null } });
        renderUser();
        toast('Profile photo removed');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    /* ----- Profile: name ----- */
    els.profileForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = els.profileName.value.trim();
      if (!name) return toast('Enter your name.', 'error');
      try {
        state.user = await submitWithBusy(els.profileForm, 'Saving…', () =>
          api('/auth/profile', { method: 'PUT', body: { name: name } })
        );
        renderUser();
        return toast('Profile updated');
      } catch (err) {
        return toast(err.message, 'error');
      }
    });

    /* ----- Profile: password ----- */
    els.passwordForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const current = els.pwCurrent.value;
      const next = els.pwNew.value;
      if (!current) return toast('Enter your current password.', 'error');
      const problem = passwordPolicyError(next);
      if (problem) return toast(problem, 'error');
      if (next !== els.pwConfirm.value) return toast('The two new passwords do not match.', 'error');

      try {
        const data = await submitWithBusy(els.passwordForm, 'Updating…', () =>
          api('/auth/password', { method: 'PUT', body: { currentPassword: current, newPassword: next } })
        );
        localStorage.setItem(TOKEN_KEY, data.token); // keep this device logged in
        els.passwordForm.reset();
        els.pwNew.dispatchEvent(new Event('input'));
        return toast('Password updated. Other devices were signed out.');
      } catch (err) {
        return toast(err.message, 'error');
      }
    });

    /* ----- Logout ----- */
    function logout() {
      clearSession();
      window.location.href = '/index.html';
    }

    async function logoutEverywhere() {
      const ok = await confirmDialog({
        title: 'Log out of all devices?',
        message: 'Every device, including this one, will need to log in again.',
        okLabel: 'Log out everywhere'
      });
      if (!ok) return;
      try {
        await api('/auth/logout-all', { method: 'POST' });
        logout();
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    els.profileLogout.addEventListener('click', logout);
    els.logoutAll.addEventListener('click', logoutEverywhere);

    /* ----- Delete account ----- */
    function updateDeleteButton() {
      els.deleteOk.disabled = !(els.deletePassword.value && els.deleteText.value.trim() === 'DELETE');
    }
    els.deletePassword.addEventListener('input', updateDeleteButton);
    els.deleteText.addEventListener('input', updateDeleteButton);

    function closeDeleteModal() {
      closeModal(els.deleteModal);
      els.deleteForm.reset();
      els.deleteError.classList.add('hidden');
      updateDeleteButton();
    }

    function openDeleteModal() {
      openModal(els.deleteModal);
      els.deletePassword.focus();
    }

    els.deleteAccountBtn.addEventListener('click', openDeleteModal);
    els.deleteCancel.addEventListener('click', closeDeleteModal);
    els.deleteModal.addEventListener('click', (event) => {
      if (event.target === els.deleteModal) closeDeleteModal();
    });

    els.deleteForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (els.deleteOk.disabled) return;
      els.deleteError.classList.add('hidden');
      els.deleteOk.disabled = true;
      els.deleteOk.textContent = 'Deleting…';
      try {
        await api('/auth/account', { method: 'DELETE', body: { password: els.deletePassword.value } });
        clearSession();
        window.location.href = '/index.html';
      } catch (err) {
        els.deleteError.textContent = err.message;
        els.deleteError.classList.remove('hidden');
        els.deleteOk.textContent = 'Delete account';
        updateDeleteButton();
      }
    });

    /* ----- Profile menu actions ----- */
    els.menu.addEventListener('click', (event) => {
      const item = event.target.closest('[data-menu]');
      if (!item) return;
      const action = item.dataset.menu;
      closeMenu();
      if (action === 'profile') setView('profile');
      else if (action === 'password') {
        setView('profile', 'password-card');
        setTimeout(() => els.pwCurrent.focus({ preventScroll: true }), 350);
      } else if (action === 'logout-all') logoutEverywhere();
      else if (action === 'logout') logout();
      else if (action === 'delete') openDeleteModal();
    });

    /* ----- Escape closes whatever is open ----- */
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      closeMenu();
      closeConfirm(false);
      closeModal(els.qrModal);
      closeModal(els.shareModal);
      if (!els.deleteModal.classList.contains('hidden')) closeDeleteModal();
    });

    /* ----- Boot ----- */
    try {
      const cached = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
      if (cached && cached.name) els.navAvatar.textContent = initials(cached.name);
    } catch (err) {
      /* ignore a corrupt cache */
    }
    const startView = window.location.hash.replace('#', '');
    setView(startView === 'shared' || startView === 'profile' ? startView : 'files');
    renderStorage();
    loadData();

    // Countdowns refresh and expired links drop out of the Shared tab without a reload.
    setInterval(() => {
      if (state.files.length > 0 && !state.uploading) renderAll();
    }, 20000);
  }

  /* ===============================================================
   * Router
   * ============================================================= */
  document.addEventListener('DOMContentLoaded', () => {
    const page = document.body.dataset.page;
    if (page === 'auth') initAuthPage();
    if (page === 'reset') initResetPage();
    if (page === 'dashboard') initDashboard();
  });
})();
