document.addEventListener('DOMContentLoaded', () => {
  // ===== ВЕРСИЯ СБОРКИ =====
  // Меняйте номер синхронно с версией кэша в sw.js — это метка,
  // по которой видно, какая версия реально запущена на устройстве.
  const APP_VERSION = 'v2.28';
  console.log('[Тренажёр] версия ' + APP_VERSION);
  const versionBadge = document.createElement('div');
  versionBadge.textContent = APP_VERSION;
  versionBadge.style.cssText = 'position:fixed;bottom:4px;right:8px;font-size:11px;opacity:.55;color:var(--text-muted, #667);pointer-events:none;z-index:999;';
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

  // ===== МИГРАЦИЯ: старые данные одного стиха → библиотека =====
  // Если человек начинал пользоваться в старой версии (один стих в отдельном
  // ключе), при первом запуске переносим его в библиотеку и удаляем старый ключ.
  const MIGRATED_KEY = 'migrationDone';
  const OLD_TEXT_KEY = 'poemText';
  const OLD_HIDDEN_KEY = 'hiddenCounts';
  const OLD_STEP_KEY = 'stepIndex';

  function migrateOldStorage() {
    if (localStorage.getItem(MIGRATED_KEY) === 'yes') return;
    const oldText = localStorage.getItem(OLD_TEXT_KEY);
    if (oldText && oldText.trim()) {
      const lines = oldText.split('\n').filter(l => l.trim());
      const hiddenCounts = lines.map(() => 0);
      const savedHidden = localStorage.getItem(OLD_HIDDEN_KEY);
      if (savedHidden) {
        try {
          const arr = JSON.parse(savedHidden);
          if (Array.isArray(arr) && arr.length === lines.length) {
            for (let i = 0; i < lines.length; i++) {
              hiddenCounts[i] = Math.max(0, Math.min(Number(arr[i]) || 0, lines[i].trim().split(/\s+/).filter(w => w).length));
            }
          }
        } catch (e) {}
      }
      const poems = loadPoems();
      // Не дублируем: если такой текст уже есть в библиотеке — пропускаем
      const exists = poems.some(p => p.lines.join('\n') === lines.join('\n'));
      if (!exists) {
        poems.push({
          id: String(Date.now()),
          title: makeTitle(lines),
          lines: lines,
          hiddenCounts: hiddenCounts,
          stepIndex: Number(localStorage.getItem(OLD_STEP_KEY)) || 0,
          examDate: null,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
        savePoems(poems);
      }
    }
    localStorage.setItem(MIGRATED_KEY, 'yes');
    // Старые ключи можно оставить на случай отката — или подчистить:
    localStorage.removeItem(OLD_HIDDEN_KEY);
    localStorage.removeItem(OLD_STEP_KEY);
  }

  // ===== РАСПИСАНИЕ ПОВТОРЕНИЙ =====
  // Классическая схема интервальных повторений к дате сдачи:
  // 1 день, 3 дня, 7 дней, 14 дней, 30 дней от дня добавления стиха.
  // Все события зажимаются в «тихие часы» (не раньше 8:00, не позже 21:00).

  function buildSchedule(examDate) {
    const events = [];
    const base = new Date();
    const intervals = [1, 3, 7, 14, 30];
    intervals.forEach(days => {
      const d = new Date(base);
      d.setDate(d.getDate() + days);
      if (d <= examDate) {
        events.push({ start: clampToAwake(d), type: 'repeat' });
      }
    });
    // Сам день сдачи — утром
    events.push({ start: clampToAwake(new Date(examDate)), type: 'exam' });
    events.sort((a, b) => a.start - b.start);
    return { events };
  }

  function saveSchedule(events) {
    const payload = events.map(e => ({
      ts: e.start.getTime(),
      type: e.type
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  function loadSchedule() {
    try {
      const arr = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!Array.isArray(arr)) return [];
      return arr
        .map(e => ({ start: new Date(e.ts), type: e.type }))
        .filter(e => !isNaN(e.start.getTime()));
    } catch (e) {
      return [];
    }
  }

  function clearSchedule() {
    localStorage.removeItem(STORAGE_KEY);
  }

  // Очистка прошедших событий
  function cleanupSchedule() {
    const events = loadSchedule();
    const fresh = events.filter(e => e.start.getTime() > Date.now());
    if (fresh.length !== events.length) saveSchedule(fresh);
    return fresh;
  }

  // Есть ли тренировка сегодня? Для баннера на главном экране
  function getTodayReminder() {
    const events = cleanupSchedule();
    if (!events.length) return null;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    for (const e of events) {
      if (e.start >= todayStart && e.start <= todayEnd) return e;
    }
    return null;
  }

  // ===== ФОРМАТ ICS (для Google Календаря и других) =====
  // Время в ICS — UTC, формат YYYYMMDDTHHMMSSZ.
  function icsStamp(date) {
    return date.getUTCFullYear() +
      String(date.getUTCMonth() + 1).padStart(2, '0') +
      String(date.getUTCDate()).padStart(2, '0') +
      'T' + String(date.getUTCHours()).padStart(2, '0') +
      String(date.getUTCMinutes()).padStart(2, '0') +
      String(date.getUTCSeconds()).padStart(2, '0') + 'Z';
  }

  function generateICS(events) {
    let lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Poem Trainer//RU',
      'CALSCALE:GREGORIAN'
    ];
    events.forEach((e, i) => {
      const isExam = e.type === 'exam';
      lines.push('BEGIN:VEVENT');
      lines.push('UID:poem-trainer-' + Date.now() + '-' + i + '@local');
      lines.push('DTSTAMP:' + icsStamp(new Date()));
      lines.push('DTSTART:' + icsStamp(e.start));
      // Событие на 30 минут
      const end = new Date(e.start.getTime() + 30 * 60 * 1000);
      lines.push('DTEND:' + icsStamp(end));
      lines.push('SUMMARY:' + (isExam
        ? '🎓 Сдача стихотворения'
        : '📖 Повторение стихотворения'));
      lines.push('DESCRIPTION:' + (isExam
        ? 'День сдачи. Прогони стихотворение целиком.'
        : 'Интервальное повторение. Прогони стихотворение целиком.'));
      lines.push('BEGIN:VALARM');
      lines.push('TRIGGER:-PT30M');
      lines.push('ACTION:DISPLAY');
      lines.push('DESCRIPTION:Напоминание о стихотворении');
      lines.push('END:VALARM');
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  // Ссылки на добавление события в Google Календарь
  function gcalLink(e, title) {
    const fmt = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/g, '');
    const end = new Date(e.start.getTime() + 30 * 60 * 1000);
    const isExam = e.type === 'exam';
    const text = encodeURIComponent(isExam
      ? '🎓 Сдача стихотворения' + (title ? ': ' + title : '')
      : '📖 Повторение стихотворения' + (title ? ': ' + title : ''));
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + text +
      '&dates=' + fmt(e.start) + '/' + fmt(end) +
      '&details=' + encodeURIComponent('Напоминание из Тренажёра заучивания');
  }

  // Показать блок с календарём на экране после добавления
  function showCalendarBlock(events, title) {
    const old = document.getElementById('gcalBlock');
    if (old) old.remove();

    const block = document.createElement('div');
    block.id = 'gcalBlock';
    block.className = 'calendar-message';

    const info = document.createElement('p');
    info.textContent = 'Составлен график повторений: ' + events.length + ' событий до дня сдачи.';
    block.appendChild(info);

    // ICS-файл для импорта в любой календарь
    const icsContent = generateICS(events);
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const dl = document.createElement('button');
    dl.textContent = '📥 Скачать расписание (ICS)';
    dl.className = 'download-button';
    dl.onclick = () => downloadFile(URL.createObjectURL(blob), 'training-schedule.ics');
    block.appendChild(dl);

    // Свёрнутый список прямых ссылок Google Календаря
    const details = document.createElement('details');
    details.className = 'gcal-details';
    const summary = document.createElement('summary');
    summary.textContent = 'Добавить в Google Календарь вручную';
    details.appendChild(summary);

    events.forEach(e => {
      const a = document.createElement('a');
      a.href = gcalLink(e, title);
      a.className = 'gcal-link';
      a.target = '_blank';
      a.rel = 'noopener';
      const d = e.start;
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      a.textContent = (e.type === 'exam' ? '🎓 Сдача' : '📖 Повторение') +
        ' — ' + day + '.' + month + ' в ' + hh + ':' + mm;
      details.appendChild(a);
    });
    block.appendChild(details);

    // Подсказка про импорт файла
    const importNote = document.createElement('p');
    importNote.innerHTML = 'Импорт файла в Google Календарь: ' +
      '<a href="' + GCAL_IMPORT_URL + '" target="_blank" rel="noopener" class="gcal-link">Настройки календаря → Импорт</a>';
    block.appendChild(importNote);

    (libraryScreen || inputScreen).insertBefore(block, poemListEl ? poemListEl.nextSibling : null);
  }
  // ===== ЭКРАН ПОЛНОГО ТЕКСТА (после добавления стиха) =====

  function showFullText() {
    fullTextDisplay.textContent = originalLines.join('\n');
    gateScreenStart = Date.now();
    activeGateStep = 'full';
    showScreen(readOnceScreen);
    startGate(readOnceBtn, gateSecondsForFullText(), 'Читать…', READ_ONCE_LABEL);
  }

  if (startBtn) {
    startBtn.addEventListener('click', () => {
      const text = userText.value.trim();
      if (!text) return;

      const lines = text.split('\n').filter(l => l.trim());
      const title = makeTitle(lines);

      const rawDate = examDateInput && examDateInput.value ? examDateInput.value.trim() : null;
      let examDate = null;
      if (rawDate) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
          alert('Дата сдачи должна быть в формате ГГГГ-ММ-ДД.');
          return;
        }
        const parsed = new Date(rawDate + 'T00:00:00');
        if (isNaN(parsed) || parsed < new Date(new Date().setHours(0, 0, 0, 0))) {
          alert('Дата сдачи некорректная или уже прошла.');
          return;
        }
        examDate = rawDate;
      }

      // Новое стихотворение в библиотеку
      const poems = loadPoems();
      const poem = {
        id: String(Date.now()),
        title: title,
        lines: lines,
        hiddenCounts: lines.map(() => 0),
        stepIndex: 0,
        examDate: examDate,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      poems.push(poem);
      savePoems(poems);

      currentPoemId = poem.id;
      originalLines = lines;
      hiddenCounts = lines.map(() => 0);
      stepIndex = 0;
      history = [];

      userText.value = '';
      if (examDateInput) examDateInput.value = '';

      if (examDate) {
        const { events } = buildSchedule(new Date(examDate + 'T00:00:00'));
        saveSchedule(events);
        renderLibrary();
        showCalendarBlock(events, title);
      } else {
        showFullText();
      }
    });
  }

  if (readOnceBtn) {
    readOnceBtn.addEventListener('click', () => {
      // Записываем фактическое время чтения полного текста
      if (activeGateStep === 'full') {
        recordStepTime(currentPoemId, 'full', elapsedSince(gateScreenStart));
      }
      showScreen(trainingScreen);
      renderTrainingText();
      updateBackButton();
      statusMessage.textContent = 'Шаг 1. Читай текст, жми «Далее».';
      enterTrainingStep(stepIndex);
    });
  }

  // ===== ТРЕНИРОВКА =====

  // Рендер тренировки: строки, у каждой скрыто последнее слово (или несколько —
  // при откате «Назад» после перерыва скрытых меньше)
  function renderTrainingText() {
    let html = '';
    for (let i = 0; i < originalLines.length; i++) {
      const words = originalLines[i].trim().split(/\s+/).filter(w => w);
      const hideCount = Math.min(hiddenCounts[i] || 0, words.length);
      let lineHtml = '';
      for (let j = 0; j < words.length; j++) {
        const visible = words.length - j > hideCount;
        if (visible) {
          lineHtml += (lineHtml ? ' ' : '') + escapeHtml(words[j]);
        } else {
          lineHtml += (lineHtml ? ' ' : '') + '<span class="hidden-word">' + escapeHtml(words[j]) + '</span>';
        }
      }
      html += (html ? '\n' : '') + lineHtml;
    }
    trainingTextDisplay.innerHTML = html;
  }

  function isAllHidden() {
    for (let i = 0; i < originalLines.length; i++) {
      const words = originalLines[i].trim().split(/\s+/).filter(w => w);
      if ((hiddenCounts[i] || 0) < words.length) return false;
    }
    return originalLines.length > 0;
  }

  function updateBackButton() {
    // «Назад» активна на любом шаге, кроме первого: даже если история сессии
    // пуста (возврат после перерыва), откат делается вычислением в обработчике.
    if (backBtn) backBtn.disabled = stepIndex === 0;
  }

  backBtn.addEventListener('click', () => {
    if (stepIndex <= 0) return;
    if (history.length > 0) {
      const prevState = history.pop();
      stepIndex = prevState.stepIndex;
      hiddenCounts = prevState.hiddenCounts;
    } else {
      // Возврат после перерыва: история пуста, откатываем вычислением —
      // каждый шаг скрывает ровно последнее слово каждой строки,
      // поэтому состояние шага однозначно восстанавливается из номера.
      stepIndex--;
      hiddenCounts = hiddenCounts.map(h => Math.max(0, h - 1));
    }
    saveCurrentPoem();
    renderTrainingText();
    updateBackButton();
    statusMessage.textContent = 'Шаг ' + (stepIndex + 1) + '. Вернулись на шаг назад.';
    enterTrainingStep(stepIndex);
  });

  nextBtn.addEventListener('click', () => {
    if (nextBtn.disabled) return;

    // Записываем фактическое время шага для персонального гейта
    if (activeGateStep !== null && activeGateStep !== 'full') {
      recordStepTime(currentPoemId, activeGateStep, elapsedSince(stepStart));
    }

    // Снимок для «Назад» в этой сессии
    history.push({
      stepIndex: stepIndex,
      hiddenCounts: hiddenCounts.slice()
    });

    // Каждый шаг скрывает последнее слово каждой строки
    for (let i = 0; i < originalLines.length; i++) {
      const words = originalLines[i].trim().split(/\s+/).filter(w => w);
      hiddenCounts[i] = Math.min((hiddenCounts[i] || 0) + 1, words.length);
    }
    stepIndex++;

    saveCurrentPoem();

    if (isAllHidden()) {
      renderTrainingText();
      cancelGate();
      statusMessage.textContent = '🎉 Отлично! Все слова скрыты — ты выучил текст!';
      nextBtn.disabled = true;
      clearSchedule();
      return;
    }

    renderTrainingText();
    updateBackButton();
    statusMessage.textContent = 'Шаг ' + (stepIndex + 1) + '.';
    enterTrainingStep(stepIndex);
  });

  // «Закончить тренировку»: сохранить прогресс, погасить отсчёт, уйти в библиотеку.
  // Тренировка остаётся на текущем шаге — вернётесь и продолжите с того же места.
  if (exitTrainingBtn) {
    exitTrainingBtn.addEventListener('click', () => {
      saveCurrentPoem();
      cancelGate();
      openLibrary();
    });
  }

  // «Мои стихи» с экрана добавления — тем же способом
  const libraryFromInputBtn = document.getElementById('libraryFromInputBtn');
  if (libraryFromInputBtn) {
    libraryFromInputBtn.addEventListener('click', () => {
      openLibrary();
    });
  }

  // ===== БАННЕР «СЕГОДНЯ ТРЕНИРОВКА» =====
  function showTodayReminder() {
    const ev = getTodayReminder();
    if (!ev) return;
    const banner = document.createElement('div');
    banner.className = 'today-reminder';
    banner.textContent = '⏰ Сегодня по расписанию: ' +
      (ev.type === 'exam' ? 'сдача стихотворения' : 'повторение стихотворения') +
      '. Прогони текст целиком!';
    (libraryScreen || inputScreen).insertBefore(banner, poemListEl);
  }

  // ===== ЗАПУСК =====
  migrateOldStorage();
  cleanupSchedule();
  openLibrary();
  showTodayReminder();
});
