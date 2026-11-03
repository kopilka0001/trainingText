document.addEventListener('DOMContentLoaded', () => {
  // ===== ВЕРСИЯ СБОРКИ =====
  // Меняйте номер синхронно с версией кэша в sw.js — это метка,
  // по которой видно, какая версия реально запущена на устройстве.
  const APP_VERSION = 'v7';
  console.log('[Тренажёр] версия ' + APP_VERSION);
  const versionBadge = document.createElement('div');
  versionBadge.textContent = APP_VERSION;
  versionBadge.style.cssText = 'position:fixed;bottom:4px;right:8px;font-size:11px;opacity:.55;color:#667;pointer-events:none;z-index:999;';
  document.body.appendChild(versionBadge);

  // Элементы
  const inputScreen = document.getElementById('inputScreen');
  const libraryScreen = document.getElementById('libraryScreen');
  const poemListEl = document.getElementById('poemList');
  const newPoemBtn = document.getElementById('newPoemBtn');
  const readOnceScreen = document.getElementById('readOnceScreen');
  const trainingScreen = document.getElementById('trainingScreen');

  const userText = document.getElementById('userText');
  const startBtn = document.getElementById('startBtn');
  const examDateInput = document.getElementById('examDate');

  const fullTextDisplay = document.getElementById('fullTextDisplay');
  const readOnceBtn = document.getElementById('readOnceBtn');

  const trainingTextDisplay = document.getElementById('trainingTextDisplay');
  const backBtn = document.getElementById('backBtn');
  const nextBtn = document.getElementById('nextBtn');
  const statusMessage = document.getElementById('statusMessage');
  const exitTrainingBtn = document.getElementById('exitTrainingBtn');

  // Состояние текущей тренировки
  let currentPoemId = null;
  let originalLines = [];
  let hiddenCounts = [];
  let history = [];
  let stepIndex = 0;

  // Определяем платформу
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  // Адрес страницы импорта/экспорта Google Календаря
  const GCAL_IMPORT_URL = 'https://calendar.google.com/calendar/u/0/r/settings/export';

  // ===== КЛЮЧИ ХРАНИЛИЩА (объявлены ДО всего, что их использует) =====
  const LIBRARY_KEY = 'poemLibrary';
  const STORAGE_KEY = 'trainingSchedule';

  // ===== ГЕЙТ ПО ВРЕМЕНИ ПРОЧТЕНИЯ =====
  // Идея: кнопка «Далее» заблокирована столько секунд, сколько нужно,
  // чтобы прочитать весь стих. Первый проход — расчёт по объёму текста,
  // дальше — персональное среднее фактических времён ЭТОГО шага.
  // Тайминги хранятся ОТДЕЛЬНО от библиотеки (GATE_KEY), а не в прогрессе.
  const GATE_KEY = 'gateTimings';       // персональные времена шагов
  const GATE_ENABLED_KEY = 'gateEnabled'; // 'off' = гейт выключен (режим «без таймера»)
  const READING_WPM = 110;              // скорость чтения вслух, слов в минуту (коэффициент калибровки)
  const MIN_GATE_SEC = 2;               // минимальный гейт, сек
  const MAX_TIMINGS = 20;               // храним последние N замеров на шаг
  const GATE_COEFF = 0.67;              // коэффициент времени гейта: 1.0 = полное, 0.67 = две трети, 0.5 = половина

  let gateTimerId = null;
  let gateScreenStart = 0;   // когда открылся экран полного текста
  let stepStart = 0;         // когда загрузился текущий шаг тренировки
  let activeGateStep = null; // индекс шага, для которого идёт отсчёт

  // Оригинальные подписи кнопок берём из HTML один раз
  const READ_ONCE_LABEL = readOnceBtn ? readOnceBtn.textContent : 'Готово, дальше';
  const NEXT_LABEL = nextBtn ? nextBtn.textContent : 'Далее';

  function isGateEnabled() {
    return localStorage.getItem(GATE_ENABLED_KEY) !== 'off';
  }

  function elapsedSince(t) {
    return t ? Math.round((Date.now() - t) / 1000) : 0;
  }

  function loadGateData() {
    try {
      const d = JSON.parse(localStorage.getItem(GATE_KEY));
      return (d && typeof d === 'object') ? d : {};
    } catch (e) {
      return {};
    }
  }

  function saveGateData(data) {
    localStorage.setItem(GATE_KEY, JSON.stringify(data));
  }

  // При удалении стиха его тайминги тоже удаляем
  function removeGateForPoem(poemId) {
    if (!poemId) return;
    const data = loadGateData();
    if (data[poemId]) {
      delete data[poemId];
      saveGateData(data);
    }
  }

  function getStepTimings(poemId, step) {
    const data = loadGateData();
    const poem = data[poemId];
    if (!poem || !poem.steps) return [];
    const arr = poem.steps[String(step)];
    return Array.isArray(arr) ? arr : [];
  }

  // Записываем фактическое время шага (сек) в массив этого шага
  function recordStepTime(poemId, step, seconds) {
    if (!poemId || !seconds || seconds <= 0) return;
    const data = loadGateData();
    if (!data[poemId]) data[poemId] = { steps: {} };
    if (!data[poemId].steps) data[poemId].steps = {};
    const key = String(step);
    const arr = Array.isArray(data[poemId].steps[key]) ? data[poemId].steps[key] : [];
    arr.push(seconds);
    while (arr.length > MAX_TIMINGS) arr.shift();
    data[poemId].steps[key] = arr;
    saveGateData(data);
  }

  function averageOf(arr) {
    if (!arr.length) return null;
    return Math.round(arr.reduce((s, x) => s + x, 0) / arr.length);
  }

  function countAllWords() {
    let n = 0;
    for (let i = 0; i < originalLines.length; i++) {
      n += originalLines[i].trim().split(/\s+/).filter(w => w).length;
    }
    return n;
  }

  // Сколько слов сейчас ВИДНО (не скрыто пунктиром)
  function countVisibleWords() {
    let n = 0;
    for (let i = 0; i < originalLines.length; i++) {
      const words = originalLines[i].trim().split(/\s+/).filter(w => w);
      const hideCount = hiddenCounts[i] || 0;
      for (let j = 0; j < words.length; j++) {
        if (words.length - j > hideCount) n++;
      }
    }
    return n;
  }

  // Минимальное время прочтения по объёму: слова / (слов в минуту) * 60 сек
  function readingSeconds(wordCount) {
    return Math.max(MIN_GATE_SEC, Math.ceil(wordCount * 60 / READING_WPM * GATE_COEFF));
  }

  // Гейт шага: среднее накопленных замеров ЭТОГО шага (умноженное на коэффициент),
  // а если замеров нет — расчёт по объёму ВСЕГО стихотворения:
  // на каждом шаге человек произносит весь текст, а не только незакрытые слова.
  function gateSecondsForStep(stepIndex) {
    if (!currentPoemId) return readingSeconds(countAllWords());
    const avg = averageOf(getStepTimings(currentPoemId, stepIndex));
    if (avg !== null) return Math.max(MIN_GATE_SEC, Math.round(avg * GATE_COEFF));
    return readingSeconds(countAllWords());
  }

  // Гейт экрана полного текста: среднее замеров «full» или расчёт по всему тексту
  function gateSecondsForFullText() {
    if (!currentPoemId) return readingSeconds(countAllWords());
    const avg = averageOf(getStepTimings(currentPoemId, 'full'));
    if (avg !== null) return Math.max(MIN_GATE_SEC, Math.round(avg * GATE_COEFF));
    return readingSeconds(countAllWords());
  }

  function cancelGate() {
    if (gateTimerId !== null) {
      clearInterval(gateTimerId);
      gateTimerId = null;
    }
    if (nextBtn) nextBtn.classList.remove('gate-waiting');
  }

  // Запуск отсчёта на кнопке: неактивна с обратным отсчётом,
  // затем активна с обычной подписью. Каждый новый экран — отсчёт заново.
  function startGate(btn, seconds, countdownLabel, activeLabel) {
    cancelGate();
    if (!btn) return;
    if (!isGateEnabled() || seconds <= 0) {
      btn.disabled = false;
      btn.textContent = activeLabel;
      return;
    }
    btn.disabled = true;
    btn.classList.add('gate-waiting');
    let remaining = seconds;
    const tick = () => {
      if (remaining <= 0) {
        cancelGate();
        btn.disabled = false;
        btn.classList.remove('gate-waiting');
        btn.textContent = activeLabel;
        return;
      }
      btn.textContent = countdownLabel + ' ' + remaining + ' с';
      remaining--;
    };
    tick();
    gateTimerId = setInterval(tick, 1000);
  }

  // Загрузка нового шага: отсчёт стартует заново от среднего именно этого шага.
  // «Назад» свободна всегда — гейт стоит только на движении вперёд.
  // clearOnDone=true — только при движении вперёд на последний шаг:
  // там снимаем напоминания, как в прежней логике завершения.
  function enterTrainingStep(idx, clearOnDone) {
    stepStart = Date.now();
    activeGateStep = idx;
    if (isAllHidden()) {
      cancelGate();
      statusMessage.textContent = '🎉 Отлично! Все слова скрыты — ты выучил текст!';
      nextBtn.disabled = true;
      if (clearOnDone) clearSchedule();
      return;
    }
    nextBtn.disabled = false;
    startGate(nextBtn, gateSecondsForStep(idx), 'Повторить…', NEXT_LABEL);
  }

  // ===== ТИХИЕ ЧАСЫ (не беспокоим с 21:00 до 8:00) =====
  const QUIET_HOURS = { from: 21, to: 8 };
  const FALLBACK_MORNING = 10;

  function isAwake(d) {
    const h = d.getHours();
    return h >= QUIET_HOURS.to && h < QUIET_HOURS.from;
  }

  // Ночные события переносим на утро: раннее утро — сегодня в 10:00,
  // поздний вечер/ночь — завтра в 10:00.
  function clampToAwake(d) {
    if (isAwake(d)) return d;
    const fixed = new Date(d);
    fixed.setSeconds(0, 0);
    if (fixed.getHours() < QUIET_HOURS.to) {
      fixed.setHours(FALLBACK_MORNING, 0, 0, 0);
    } else {
      fixed.setDate(fixed.getDate() + 1);
      fixed.setHours(FALLBACK_MORNING, 0, 0, 0);
    }
    return fixed;
  }

  // Экранирование HTML-символов
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ===== БИБЛИОТЕКА СТИХОВ =====

  function loadPoems() {
    try {
      return JSON.parse(localStorage.getItem(LIBRARY_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function savePoems(poems) {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(poems));
  }

  // Название стиха — первая строка, обрезанная до 40 символов
  function makeTitle(lines) {
    const first = (lines[0] || '').trim();
    return first.length > 40 ? first.slice(0, 40).trim() + '…' : (first || 'Без названия');
  }

  // Процент скрытых (выученных) слов
  function poemProgress(p) {
    let total = 0, hidden = 0;
    p.lines.forEach((line, i) => {
      const words = line.trim().split(/\s+/).filter(w => w);
      total += words.length;
      hidden += Math.min(p.hiddenCounts[i] || 0, words.length);
    });
    return total ? Math.round(hidden / total * 100) : 0;
  }

  // Статус стиха: иконка + подпись + процент
  function poemStatus(p) {
    const pct = poemProgress(p);
    if (pct >= 100) return { icon: '✅', label: 'Изучен', pct };
    if (pct === 0) return { icon: '🆕', label: 'Не начат', pct };
    return { icon: '📖', label: 'В процессе', pct };
  }

  // Сколько интервальных повторений ещё осталось до сдачи
  function remainingRepeats(p) {
    if (!p.examDate) return null;
    const { events } = buildSchedule(new Date(p.examDate + 'T00:00:00'));
    return events.filter(e => e.start.getTime() > Date.now()).length;
  }

  // Дней до сдачи (или сколько дней назад она была)
  function daysToExam(p) {
    if (!p.examDate) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const examDay = new Date(p.examDate + 'T00:00:00');
    return Math.round((examDay - today) / (1000 * 60 * 60 * 24));
  }

  // Красивое «сдача …» для списка
  function examInfo(p) {
    const days = daysToExam(p);
    if (days === null) return '';
    const examDay = new Date(p.examDate + 'T00:00:00');
    const day = String(examDay.getDate()).padStart(2, '0');
    const month = String(examDay.getMonth() + 1).padStart(2, '0');
    const dateStr = day + '.' + month;
    if (days > 1) return 'сдача ' + dateStr + ' (через ' + days + ' дн.)';
    if (days === 1) return 'сдача ' + dateStr + ' (завтра)';
    if (days === 0) return 'сдача ' + dateStr + ' (сегодня!)';
    return 'сдача была ' + dateStr;
  }

  // ===== РЕЗЕРВНАЯ КОПИЯ: экспорт и импорт библиотеки =====
  // Библиотека живёт в localStorage и НЕ удаляется при обновлении версии.
  // Но localStorage привязан к адресу сайта: если открыть сайт по другому
  // адресу (с www или без, по http вместо https) — библиотека будет «другой».
  // Плюс данные могут пропасть при очистке браузера или в режиме инкогнито.
  // Поэтому даём пользователю явный экспорт/импорт файла.

  function downloadFile(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function exportLibrary() {
    const poems = loadPoems();
    if (poems.length === 0) {
      alert('Библиотека пуста — пока нечего сохранять.');
      return;
    }
    const data = JSON.stringify({
      app: 'poem-trainer',
      exportedAt: new Date().toISOString(),
      poems: poems,
      gateTimings: loadGateData()
    }, null, 2);
    const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    downloadFile(url, 'moi-stihi-backup-' + stamp + '.json');
  }

  function importLibrary(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let imported;
      try {
        imported = JSON.parse(reader.result);
      } catch (e) {
        alert('Не удалось прочитать файл: это не резервная копия приложения.');
        return;
      }
      // Поддержка двух форматов: старый (массив стихов) и новый (объект с таймингами гейта)
      let importedPoems = imported;
      let importedGate = null;
      if (!Array.isArray(imported) && imported && Array.isArray(imported.poems)) {
        importedPoems = imported.poems;
        importedGate = imported.gateTimings || null;
      } else if (!Array.isArray(imported)) {
        alert('Файл не похож на резервную копию библиотеки.');
        return;
      }
      // Оставляем только корректные записи
      const clean = importedPoems.filter(p =>
        p && Array.isArray(p.lines) && p.lines.length > 0 && Array.isArray(p.hiddenCounts)
      ).map(p => ({
        id: String(p.id || Date.now()),
        title: String(p.title || makeTitle(p.lines)),
        lines: p.lines,
        hiddenCounts: p.hiddenCounts,
        stepIndex: Number(p.stepIndex) || 0,
        examDate: p.examDate || null,
        createdAt: Number(p.createdAt) || Date.now(),
        updatedAt: Number(p.updatedAt) || Date.now()
      }));

      const current = loadPoems();
      const question = current.length
        ? 'Найдено стихов в файле: ' + clean.length + '.\n\nЗаменить текущую библиотеку (' + current.length + ' стихов) на импортируемую?'
        : 'Импортировать ' + clean.length + ' стихов?';
      if (!confirm(question)) return;

      savePoems(clean);
      // Восстанавливаем персональные тайминги гейта, если они есть в копии
      if (importedGate && typeof importedGate === 'object') {
        saveGateData(importedGate);
      }
      renderLibrary();
      alert('Импорт завершён: ' + clean.length + ' стихов.');
    };
    reader.readAsText(file);
  }

  // Панель резервной копии над списком (пересоздаётся при каждом рендере)
  function buildBackupToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'backup-toolbar';

    const exportBtn = document.createElement('button');
    exportBtn.textContent = '💾 Сохранить в файл';
    exportBtn.className = 'backup-btn';
    exportBtn.title = 'Скачать резервную копию всех стихов с прогрессом';
    exportBtn.onclick = exportLibrary;
    toolbar.appendChild(exportBtn);

    const importBtn = document.createElement('button');
    importBtn.textContent = '📂 Загрузить из файла';
    importBtn.className = 'backup-btn';
    importBtn.title = 'Восстановить библиотеку из резервной копии';
    importBtn.onclick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = () => {
        if (input.files && input.files[0]) importLibrary(input.files[0]);
      };
      input.click();
    };
    toolbar.appendChild(importBtn);

    const note = document.createElement('span');
    note.className = 'backup-note';
    note.textContent = 'данные хранятся в этом браузере';
    toolbar.appendChild(note);

    return toolbar;
  }

  // Указать дату сдачи у уже существующего стиха
  function setExamDateForPoem(id) {
    const poems = loadPoems();
    const p = poems.find(x => x.id === id);
    if (!p) return;

    const value = prompt(
      'Дата сдачи в формате ГГГГ-ММ-ДД (например, 2026-11-20).\nПусто — отменить.',
      p.examDate || ''
    );
    if (value === null) return;

    const trimmed = value.trim();
    if (trimmed === '') {
      p.examDate = null;
      savePoems(poems);
      renderLibrary();
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      alert('Нужен формат ГГГГ-ММ-ДД, например 2026-11-20.');
      return;
    }
    const examDate = new Date(trimmed + 'T00:00:00');
    if (isNaN(examDate) || examDate < new Date(new Date().setHours(0, 0, 0, 0))) {
      alert('Дата некорректная или уже прошла.');
      return;
    }

    p.examDate = trimmed;
    savePoems(poems);

    // Пересобираем и сохраняем расписание напоминаний
    const { events } = buildSchedule(examDate);
    saveSchedule(events);

    // Сразу предлагаем календарь
    const icsContent = generateICS(events);
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    downloadFile(URL.createObjectURL(blob), 'training-schedule.ics');

    renderLibrary();
  }

  function renderLibrary() {
    if (!poemListEl) return;
    const poems = loadPoems();
    poemListEl.innerHTML = '';

    // Панель резервной копии — всегда сверху списка
    poemListEl.appendChild(buildBackupToolbar());

    if (poems.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'calendar-message';
      empty.textContent = 'Пока пусто. Нажмите «➕ Новый стих», чтобы начать!';
      poemListEl.appendChild(empty);
      return;
    }

    // Свежие сверху
    poems.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    poems.forEach(p => {
      const st = poemStatus(p);
      const item = document.createElement('div');
      item.className = 'poem-item';

      const link = document.createElement('a');
      link.href = '#';
      link.className = 'poem-link';

      let statusLine = st.icon + ' ' + st.label + ' · ' + st.pct + '%';

      const left = remainingRepeats(p);
      if (left !== null) {
        if (left > 0) {
          statusLine += ' · осталось повторений: ' + left;
        } else {
          statusLine += ' · повторения закончились';
        }
        statusLine += ' · ' + examInfo(p);
      }

      link.innerHTML =
        '<span class="poem-title">' + escapeHtml(p.title) + '</span>' +
        '<span class="poem-status">' + escapeHtml(statusLine) + '</span>';
      link.onclick = (e) => {
        e.preventDefault();
        openPoem(p.id);
      };
      item.appendChild(link);

      // Кнопка «Повторить» — только у изученных стихов
      if (st.pct >= 100) {
        const repeat = document.createElement('button');
        repeat.textContent = '🔁';
        repeat.className = 'poem-repeat';
        repeat.title = 'Повторить тренировку с начала';
        repeat.onclick = () => repeatPoem(p.id);
        item.appendChild(repeat);
      }

      // Кнопка «Дата сдачи» — назначить или изменить
      const dateBtn = document.createElement('button');
      dateBtn.textContent = '📅';
      dateBtn.className = 'poem-date';
      dateBtn.title = p.examDate
        ? 'Изменить дату сдачи (' + p.examDate + ')'
        : 'Указать дату сдачи — создадутся напоминания о повторении';
      dateBtn.onclick = () => setExamDateForPoem(p.id);
      item.appendChild(dateBtn);

      const del = document.createElement('button');
      del.textContent = '🗑';
      del.className = 'poem-delete';
      del.title = 'Удалить стих';
      del.onclick = () => {
        if (confirm('Удалить «' + p.title + '»?')) {
          savePoems(loadPoems().filter(x => x.id !== p.id));
          removeGateForPoem(p.id);
          renderLibrary();
        }
      };
      item.appendChild(del);

      poemListEl.appendChild(item);
    });
  }

  // Переключение экранов
  function showScreen(name) {
    [inputScreen, libraryScreen, readOnceScreen, trainingScreen].forEach(s => {
      if (s) s.classList.add('hidden');
    });
    // Уход с экрана тренировки: гасим отсчёт и возвращаем «Далее» в исходный вид
    cancelGate();
    if (nextBtn) {
      nextBtn.disabled = false;
      nextBtn.textContent = NEXT_LABEL;
    }
    if (name) name.classList.remove('hidden');
  }

  function openLibrary() {
    renderLibrary();
    showScreen(libraryScreen || inputScreen);
  }

  // Открыть стих в сохранённом состоянии
  function openPoem(id) {
    const p = loadPoems().find(x => x.id === id);
    if (!p) return;
    currentPoemId = p.id;
    originalLines = p.lines;
    hiddenCounts = p.hiddenCounts.slice();
    stepIndex = p.stepIndex;
    history = [];

    showScreen(trainingScreen);
    renderTrainingText();
    updateBackButton();
    enterTrainingStep(stepIndex);
  }

  // Повторить изученный стих с самого начала
  function repeatPoem(id) {
    const poems = loadPoems();
    const p = poems.find(x => x.id === id);
    if (!p) return;

    currentPoemId = p.id;
    originalLines = p.lines;
    hiddenCounts = originalLines.map(() => 0);
    history = [];
    stepIndex = 0;
    saveCurrentPoem();

    showScreen(trainingScreen);
    renderTrainingText();
    updateBackButton();
    statusMessage.textContent = '🔁 Повторение! Шаг 1. Читай текст — слова снова открыты.';
    enterTrainingStep(stepIndex);
  }

  // Сохранить прогресс текущего стиха
  function saveCurrentPoem() {
    if (!currentPoemId) return;
    const poems = loadPoems();
    const p = poems.find(x => x.id === currentPoemId);
    if (!p) return;
    p.hiddenCounts = hiddenCounts.slice();
    p.stepIndex = stepIndex;
    p.updatedAt = Date.now();
    savePoems(poems);
  }

  if (newPoemBtn) {
    newPoemBtn.addEventListener('click', () => {
      currentPoemId = null;
      showScreen(inputScreen);
    });
  }

  // ===== МИГРАЦИЯ ПОСЛЕ ОБНОВЛЕНИЯ =====
  // ВАЖНО: миграция касается только расписания напоминаний (STORAGE_KEY).
  // Библиотеку стихов (LIBRARY_KEY) она НЕ трогает — никогда.
  const SCHEMA_VERSION = 2;

  function migrate() {
    if (Number(localStorage.getItem('schemaVersion') || 1) >= SCHEMA_VERSION) return;

    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const fixed = JSON.parse(raw).map(e => ({
          start: clampToAwake(new Date(e.start)).toISOString(),
          description: e.description || '',
          shown: false
        }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(fixed));
      } catch (e) {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    localStorage.setItem('schemaVersion', SCHEMA_VERSION);
  }

  // Стартовый экран: библиотека, если стихи уже есть
  migrate();
  if (libraryScreen && loadPoems().length > 0) {
    openLibrary();
  } else {
    showScreen(inputScreen);
  }

  // ===== КАЛЕНДАРЬ =====

  // Расчет интервалов повторения (в днях)
  function calculateIntervals(daysUntilExam) {
    const intervals = [];
    let remaining = daysUntilExam;

    while (remaining > 7) {
      intervals.push(3);
      remaining -= 3;
    }
    while (remaining > 3) {
      intervals.push(2);
      remaining -= 2;
    }
    while (remaining > 0) {
      intervals.push(1);
      remaining -= 1;
    }
    return intervals;
  }

  // Дата/время в формате ICS (UTC)
  function icsDateTime(d) {
    return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }

  // Экранирование спецсимволов по стандарту ICS (RFC 5545)
  function escapeICS(text) {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  // Ссылка-шаблон события для Google Календаря
  function buildGoogleCalendarLink(event) {
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: 'Тренировка: заучивание стиха',
      dates: icsDateTime(event.start) + '/' + icsDateTime(event.end),
      details: event.description
    });
    return 'https://calendar.google.com/calendar/render?' + params.toString();
  }

  // Генерация содержимого ICS файла
  function generateICS(events) {
    let ics = 'BEGIN:VCALENDAR\r\n';
    ics += 'VERSION:2.0\r\n';
    ics += 'PRODID:-//PoemTrainer//RU\r\n';
    ics += 'CALSCALE:GREGORIAN\r\n';

    events.forEach((event, index) => {
      ics += 'BEGIN:VEVENT\r\n';
      ics += 'UID:poem-training-' + Date.now() + '-' + index + '@poemtrainer\r\n';
      ics += 'DTSTAMP:' + icsDateTime(new Date()) + '\r\n';
      ics += 'DTSTART:' + icsDateTime(event.start) + '\r\n';
      ics += 'DTEND:' + icsDateTime(event.end) + '\r\n';
      ics += 'SUMMARY:' + escapeICS('Тренировка №' + (index + 1) + ' — заучивание стиха') + '\r\n';
      ics += 'DESCRIPTION:' + escapeICS(event.description) + '\r\n';
      ics += 'BEGIN:VALARM\r\n';
      ics += 'TRIGGER:-PT15M\r\n';
      ics += 'ACTION:DISPLAY\r\n';
      ics += 'DESCRIPTION:' + escapeICS('Пора повторять стих!') + '\r\n';
      ics += 'END:VALARM\r\n';
      ics += 'END:VEVENT\r\n';
    });

    ics += 'END:VCALENDAR';
    return ics;
  }

  // Составление расписания повторений
  function buildSchedule(examDate) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const examDay = new Date(examDate.getFullYear(), examDate.getMonth(), examDate.getDate());
    const daysUntilExam = Math.round((examDay - today) / (1000 * 60 * 60 * 24));

    const events = [];

    if (daysUntilExam <= 1) {
      // Экстренная схема в течение дня.
      // Каждый момент пропускаем через тихие часы: если сессия началась
      // вечером, ночные события переносятся на утро.
      const hourOffsets = [0.5, 2, 6, 14, daysUntilExam >= 1 ? 24 : 20];
      hourOffsets.forEach((hours, index) => {
        let start = new Date(now.getTime() + hours * 60 * 60 * 1000);
        start = clampToAwake(start);
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        const labels = ['первичное закрепление', 'промежуточная проверка',
          'вечернее повторение', 'утреннее повторение', 'финальное повторение'];
        events.push({ start, end, description: 'Экстренная схема: ' + labels[index] });
      });
    } else {
      // Стандартная схема по дням
      const intervals = calculateIntervals(daysUntilExam);
      let dayOffset = 0;
      intervals.forEach((interval, index) => {
        dayOffset += interval;
        let start = new Date(today.getTime() + dayOffset * 24 * 60 * 60 * 1000);
        start.setHours(18, 0, 0, 0);
        start = clampToAwake(start);
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        events.push({
          start,
          end,
          description: 'Повторение через ' + interval + ' дн. после предыдущего. Тренировка №' + (index + 1)
        });
      });
    }

    // Финальное повторение — утром дня сдачи
    const last = events[events.length - 1];
    last.start = new Date(examDay);
    last.start.setHours(9, 0, 0, 0);
    last.end = new Date(last.start.getTime() + 30 * 60 * 1000);
    last.description = 'Финальное повторение перед сдачей!';

    return { events, daysUntilExam };
  }

  // --- Напоминание при открытии приложения ---

  function saveSchedule(events) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(
      events.map(e => ({
        start: e.start.toISOString(),
        description: e.description,
        shown: false
      }))
    ));
  }

  function clearSchedule() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function showTodayReminder() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    let events;
    try { events = JSON.parse(raw); } catch (e) { return; }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
    const TWELVE_HOURS = 12 * 60 * 60 * 1000;

    let changed = false;
    const due = [];
    events.forEach(e => {
      const t = new Date(e.start);
      const today = t >= startOfToday && t < endOfToday;
      const fresh = t <= now && (now - t) < TWELVE_HOURS;
      if (today && fresh && !e.shown) {
        e.shown = true;
        changed = true;
        due.push(e);
      }
      if ((now - t) > 2 * 24 * 60 * 60 * 1000) {
        e.expired = true;
        changed = true;
      }
    });

    if (changed) {
      localStorage.setItem(STORAGE_KEY,
        JSON.stringify(events.filter(e => !e.expired)));
    }
    if (due.length === 0) return;

    const banner = document.createElement('div');
    banner.className = 'today-reminder';
    banner.innerHTML = '<p>📅 Сегодня по плану: ' +
      escapeHtml(due[0].description) +
      (due.length > 1 ? ' (и ещё ' + (due.length - 1) + ')' : '') +
      '. Открой экран тренировки и повтори стих!</p>';
    inputScreen.prepend(banner);
  }

  showTodayReminder();

  // --- Кнопка «Установить приложение» ---
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  if (!isStandalone) {
    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      showInstallButton();
    });

    setTimeout(() => {
      if (!deferredPrompt && !document.getElementById('installHint')) {
        showInstallButton();
      }
    }, 1500);

    function showInstallButton() {
      if (document.getElementById('installHint')) return;

      const hint = document.createElement('div');
      hint.id = 'installHint';
      hint.className = 'install-hint';

      const button = document.createElement('button');
      button.textContent = '📲 Установить приложение';
      button.classList.add('download-button');

      button.onclick = () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          deferredPrompt.userChoice.finally(() => {
            deferredPrompt = null;
            hint.remove();
          });
        } else {
          alert(isIOS
            ? 'На iPhone: нажмите кнопку «Поделиться» внизу Safari и выберите «На экран “Домой”».'
            : 'На Android: откройте меню браузера (три точки справа вверху) и выберите «Установить приложение» или «Добавить на главный экран».');
        }
      };

      hint.appendChild(button);
      inputScreen.appendChild(hint);
    }
  }

  function showDownloadOffer(events, daysUntilExam) {
    const oldOffer = document.getElementById('calendarOffer');
    if (oldOffer) oldOffer.remove();

    const icsContent = generateICS(events);
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const offer = document.createElement('div');
    offer.id = 'calendarOffer';

    offer.innerHTML =
      '<p class="calendar-message">📅 Схема повторений рассчитана: ' +
      events.length + ' тренировок за ' + (daysUntilExam <= 1 ? '1 день' : daysUntilExam + ' дн.') +
      '.<br>' + (isIOS
        ? 'Скачайте файл — Safari сам предложит добавить <b>все тренировки сразу</b> в Календарь.'
        : 'Скачайте файл и откройте его — календарь добавит <b>все тренировки сразу</b>.') +
      '</p>';

    const downloadButton = document.createElement('button');
    downloadButton.textContent = isIOS
      ? '📥 Добавить все тренировки в Календарь'
      : '📥 Скачать календарь тренировок';
    downloadButton.classList.add('download-button');
    downloadButton.onclick = () => downloadFile(url, 'training-schedule.ics');
    offer.appendChild(downloadButton);

    if (!isIOS) {
      const importButton = document.createElement('button');
      importButton.textContent = '🌐 Импорт через сайт Google Календаря';
      importButton.classList.add('download-button');
      importButton.onclick = () => {
        downloadFile(url, 'training-schedule.ics');
        window.open(GCAL_IMPORT_URL, '_blank');
      };
      offer.appendChild(importButton);
    }

    if (!isIOS) {
      const details = document.createElement('details');
      details.className = 'gcal-details';

      const summary = document.createElement('summary');
      summary.textContent = '➕ Добавить по одному в Google Календарь (' + events.length + ')';
      details.appendChild(summary);

      events.forEach((event, index) => {
        const link = document.createElement('a');
        link.href = buildGoogleCalendarLink(event);
        link.target = '_blank';
        link.rel = 'noopener';
        link.className = 'gcal-link';

        const d = event.start;
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        link.textContent = 'Тренировка №' + (index + 1) + ' — ' +
          day + '.' + month + ' в ' + hours + ':' + minutes;

        details.appendChild(link);
        details.appendChild(document.createElement('br'));
      });

      offer.appendChild(details);
    }

    readOnceScreen.prepend(offer);
  }

  // Кнопка «Начать учить»
  // Дата сдачи теперь НЕОБЯЗАТЕЛЬНА: можно начать учить без неё.
  // Время (расписание) учитывается только для напоминаний о повторении.
  // Кнопка «Мои стихи» на экране добавления стихотворения
  const libraryFromInputBtn = document.getElementById('libraryFromInputBtn');
  if (libraryFromInputBtn) {
    libraryFromInputBtn.addEventListener('click', () => {
      openLibrary();
    });
  }

  startBtn.addEventListener('click', () => {
    const text = userText.value.trim();
    const dateValue = examDateInput.value;

    if (!text) {
      alert('Пожалуйста, вставьте текст!');
      return;
    }

    let examDate = null;
    if (dateValue) {
      examDate = new Date(dateValue + 'T00:00:00');
      if (isNaN(examDate)) {
        alert('Некорректная дата!');
        return;
      }
      if (examDate < new Date(new Date().setHours(0, 0, 0, 0))) {
        alert('Дата сдачи уже прошла!');
        return;
      }
    }

    // Расписание строим ТОЛЬКО если дата указана
    if (examDate) {
      const { events, daysUntilExam } = buildSchedule(examDate);
      showDownloadOffer(events, daysUntilExam);
      saveSchedule(events);
    } else {
      const oldOffer = document.getElementById('calendarOffer');
      if (oldOffer) oldOffer.remove();
    }

    // Разбиваем на строки (пустые строки отбрасываем)
    originalLines = text.split('\n').filter(line => line.trim() !== '');

    // Сохраняем стих в библиотеку
    currentPoemId = String(Date.now());
    const poems = loadPoems();
    poems.push({
      id: currentPoemId,
      title: makeTitle(originalLines),
      lines: originalLines,
      hiddenCounts: originalLines.map(() => 0),
      stepIndex: 0,
      examDate: dateValue || null, // дата может отсутствовать
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    savePoems(poems);

    hiddenCounts = originalLines.map(() => 0);
    history = [];
    stepIndex = 0;

    // Переход к первому чтению
    inputScreen.classList.add('hidden');
    readOnceScreen.classList.remove('hidden');
    fullTextDisplay.textContent = text;

    // Гейт экрана 0: кнопка «Прочитать» неактивна на время прочтения текста
    gateScreenStart = Date.now();
    startGate(readOnceBtn, gateSecondsForFullText(), 'Прочитать…', READ_ONCE_LABEL);

    if (!examDate) {
      const note = document.createElement('p');
      note.className = 'calendar-message';
      note.textContent = 'Дата сдачи не указана — напоминания о повторении не созданы. ' +
        'Назначить дату можно позже: кнопка 📅 рядом со стихом в библиотеке.';
      readOnceScreen.prepend(note);
    }
  });

  // Кнопка «Готово, дальше»
  readOnceBtn.addEventListener('click', () => {
    // Фактическое время чтения полного текста — в базу персональных замеров
    recordStepTime(currentPoemId, 'full', elapsedSince(gateScreenStart));
    cancelGate();
    readOnceScreen.classList.add('hidden');
    trainingScreen.classList.remove('hidden');
    statusMessage.textContent = 'Шаг 1. Читай текст, где последние слова скрыты пунктиром.';
    renderTrainingText();
    updateBackButton();
    enterTrainingStep(stepIndex);
  });

  // Кнопка «Далее»
  nextBtn.addEventListener('click', () => {
    // Фактическое время на ЭТОМ шаге — в персональную базу шага
    recordStepTime(currentPoemId, activeGateStep, elapsedSince(stepStart));
    cancelGate();

    history.push({ stepIndex, hiddenCounts: [...hiddenCounts] });

    for (let i = 0; i < originalLines.length; i++) {
      const words = originalLines[i].trim().split(/\s+/);
      if (hiddenCounts[i] < words.length) {
        hiddenCounts[i]++;
      }
    }

    stepIndex++;
    renderTrainingText();
    statusMessage.textContent = 'Шаг ' + (stepIndex + 1) + '. Продолжай.';
    updateBackButton();

    // Новый экран — отсчёт заново, от среднего этого шага
    enterTrainingStep(stepIndex, true);

    saveCurrentPoem();
  });

  // Кнопка «Назад»
  backBtn.addEventListener('click', () => {
    if (history.length > 0) {
      // Обычный откат по снимкам текущей сессии
      const prevState = history.pop();
      stepIndex = prevState.stepIndex;
      hiddenCounts = prevState.hiddenCounts;
    } else {
      // Возврат к тренировке после перерыва: истории сессии нет,
      // откатываемся вычислением — на шаге выше у каждой строки
      // было на одно скрытое слово меньше
      stepIndex = Math.max(0, stepIndex - 1);
      hiddenCounts = hiddenCounts.map(h => Math.max(0, h - 1));
    }

    renderTrainingText();
    statusMessage.textContent = 'Вернулись на шаг ' + (stepIndex + 1) + '. Продолжай.';
    updateBackButton();

    // Возврат на шаг — отсчёт заново от среднего именно этого шага
    enterTrainingStep(stepIndex);

    saveCurrentPoem();
  });

  // Кнопка «Закончить тренировку»: сохраняем прогресс и выходим в «Мои стихи».
  // Тренировка остаётся на текущем шаге — вернётесь и продолжите с того же места.
  if (exitTrainingBtn) {
    exitTrainingBtn.addEventListener('click', () => {
      cancelGate();
      saveCurrentPoem();
      showScreen(libraryScreen);
    });
  }

  function updateBackButton() {
    // «Назад» активна на любом шаге, кроме первого —
    // даже если человек вернулся к тренировке после перерыва (история сессии пуста)
    backBtn.disabled = stepIndex === 0;
  }

  function renderTrainingText() {
    let result = '';
    for (let i = 0; i < originalLines.length; i++) {
      const words = originalLines[i].trim().split(/\s+/).filter(w => w);
      const hideCount = hiddenCounts[i];

      for (let j = 0; j < words.length; j++) {
        const fromEnd = words.length - j;
        if (fromEnd <= hideCount) {
          result += '<span class="hidden-word">' + escapeHtml(words[j]) + '</span>';
        } else {
          result += escapeHtml(words[j]);
        }
        if (j < words.length - 1) result += ' ';
      }
      result += '\n';
    }
    trainingTextDisplay.innerHTML = result;
  }

  function isAllHidden() {
    for (let i = 0; i < originalLines.length; i++) {
      const words = originalLines[i].trim().split(/\s+/).filter(w => w);
      if (words.length > 0 && hiddenCounts[i] < words.length) {
        return false;
      }
    }
    return true;
  }

  // Минимальная дата сдачи — сегодня
  if (examDateInput) {
    const now = new Date();
    const todayISO = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
    examDateInput.min = todayISO;
  }
});

// Регистрация сервис-воркера и автообновление приложения
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker.ready.then((reg) => {
    reg.update().catch(() => {});
  });
}
