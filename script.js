document.addEventListener('DOMContentLoaded', () => {
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

  // Экранирование HTML-символов
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ===== БИБЛИОТЕКА СТИХОВ =====

  const LIBRARY_KEY = 'poemLibrary';

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

  function renderLibrary() {
    if (!poemListEl) return;
    const poems = loadPoems();
    poemListEl.innerHTML = '';

    if (poems.length === 0) {
      poemListEl.innerHTML =
        '<p class="calendar-message">Пока пусто. Нажмите «➕ Новый стих», чтобы начать!</p>';
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

      // Основная строка статуса
      let statusLine = st.icon + ' ' + st.label + ' · ' + st.pct + '%';

      // Сколько повторений осталось и когда сдача
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

      const del = document.createElement('button');
      del.textContent = '🗑';
      del.className = 'poem-delete';
      del.title = 'Удалить стих';
      del.onclick = () => {
        if (confirm('Удалить «' + p.title + '»?')) {
          savePoems(loadPoems().filter(x => x.id !== p.id));
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
    if (isAllHidden()) {
      statusMessage.textContent = '🎉 Отлично! Все слова скрыты — ты выучил текст!';
      nextBtn.disabled = true;
    } else {
      statusMessage.textContent = 'Шаг ' + (stepIndex + 1) + '. Продолжай.';
      nextBtn.disabled = false;
    }
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
    saveCurrentPoem(); // сброс сразу сохраняем

    showScreen(trainingScreen);
    renderTrainingText();
    updateBackButton();
    nextBtn.disabled = false;
    statusMessage.textContent = '🔁 Повторение! Шаг 1. Читай текст — слова снова открыты.';
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

  // Стартовый экран: библиотека, если стихи уже есть
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

  // Скачивание .ics файла (используется несколькими кнопками)
  function downloadIcs(url) {
    const a = document.createElement('a');
    a.href = url;
    a.download = 'training-schedule.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
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
      // Экстренная схема в течение дня
      const hourOffsets = [0.5, 2, 6, 14, daysUntilExam >= 1 ? 24 : 20];
      hourOffsets.forEach((hours, index) => {
        const start = new Date(now.getTime() + hours * 60 * 60 * 1000);
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
        const start = new Date(today.getTime() + dayOffset * 24 * 60 * 60 * 1000);
        start.setHours(18, 0, 0, 0);
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
  const STORAGE_KEY = 'trainingSchedule';

  function saveSchedule(events) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(
      events.map(e => ({ start: e.start.toISOString(), description: e.description }))
    ));
  }

  function showTodayReminder() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    let events;
    try { events = JSON.parse(raw); } catch (e) { return; }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

    const todayEvents = events.filter(e => {
      const t = new Date(e.start);
      return t >= startOfToday && t < endOfToday;
    });
    if (todayEvents.length === 0) return;

    const banner = document.createElement('div');
    banner.className = 'today-reminder';
    banner.innerHTML = '<p>📅 Сегодня по плану: ' +
      escapeHtml(todayEvents[0].description) +
      (todayEvents.length > 1 ? ' (и ещё ' + (todayEvents.length - 1) + ')' : '') +
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
    downloadButton.onclick = () => downloadIcs(url);
    offer.appendChild(downloadButton);

    if (!isIOS) {
      const importButton = document.createElement('button');
      importButton.textContent = '🌐 Импорт через сайт Google Календаря';
      importButton.classList.add('download-button');
      importButton.onclick = () => {
        downloadIcs(url);
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
  startBtn.addEventListener('click', () => {
    const text = userText.value.trim();
    const dateValue = examDateInput.value;

    if (!text) {
      alert('Пожалуйста, вставьте текст!');
      return;
    }
    if (!dateValue) {
      alert('Пожалуйста, укажите дату сдачи!');
      return;
    }

    const examDate = new Date(dateValue + 'T00:00:00');
    if (isNaN(examDate)) {
      alert('Некорректная дата!');
      return;
    }
    if (examDate < new Date(new Date().setHours(0, 0, 0, 0))) {
      alert('Дата сдачи уже прошла!');
      return;
    }

    // Схема повторений + предложение скачать календарь
    const { events, daysUntilExam } = buildSchedule(examDate);
    showDownloadOffer(events, daysUntilExam);
    saveSchedule(events);

    // Разбиваем на строки
    originalLines = text.split('\n').filter(line => line.trim() !== '');

    // Сохраняем стих в библиотеку (вместе с датой сдачи)
    currentPoemId = String(Date.now());
    const poems = loadPoems();
    poems.push({
      id: currentPoemId,
      title: makeTitle(originalLines),
      lines: originalLines,
      hiddenCounts: originalLines.map(() => 0),
      stepIndex: 0,
      examDate: dateValue, // запоминаем дату сдачи
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
  });

  // Кнопка «Готово, дальше»
  readOnceBtn.addEventListener('click', () => {
    readOnceScreen.classList.add('hidden');
    trainingScreen.classList.remove('hidden');
    statusMessage.textContent = 'Шаг 1. Читай текст, где последние слова скрыты пунктиром.';
    renderTrainingText();
    updateBackButton();
  });

  // Кнопка «Далее»
  nextBtn.addEventListener('click', () => {
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

    if (isAllHidden()) {
      statusMessage.textContent = '🎉 Отлично! Все слова скрыты — ты выучил текст!';
      nextBtn.disabled = true;
    }

    saveCurrentPoem();
  });

  // Кнопка «Назад»
  backBtn.addEventListener('click', () => {
    if (history.length === 0) return;

    const prevState = history.pop();
    stepIndex = prevState.stepIndex;
    hiddenCounts = prevState.hiddenCounts;

    renderTrainingText();
    statusMessage.textContent = 'Вернулись на шаг ' + (stepIndex + 1) + '. Продолжай.';
    updateBackButton();
    nextBtn.disabled = false;

    saveCurrentPoem();
  });

  function updateBackButton() {
    backBtn.disabled = history.length === 0;
  }

  function renderTrainingText() {
    let result = '';
    for (let i = 0; i < originalLines.length; i++) {
      const words = originalLines[i].trim().split(/\s+/);
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
      const words = originalLines[i].trim().split(/\s+/);
      if (words.length > 0 && hiddenCounts[i] < words.length) {
        return false;
      }
    }
    return true;
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
