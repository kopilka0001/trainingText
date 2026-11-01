document.addEventListener('DOMContentLoaded', () => {
  // Элементы
  const inputScreen = document.getElementById('inputScreen');
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

  // Состояние
  let originalLines = [];
  let hiddenCounts = [];
  let history = [];
  let stepIndex = 0;

  // Экранирование HTML-символов в тексте пользователя
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

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
      ics += 'SUMMARY:' + encodeURIComponent('Тренировка №' + (index + 1) + ' — заучивание стиха') + '\r\n';
      ics += 'DESCRIPTION:' + encodeURIComponent(event.description) + '\r\n';
      ics += 'BEGIN:VALARM\r\n';
      ics += 'TRIGGER:-PT15M\r\n';
      ics += 'ACTION:DISPLAY\r\n';
      ics += 'DESCRIPTION:' + encodeURIComponent('Пора повторять стих!') + '\r\n';
      ics += 'END:VALARM\r\n';
      ics += 'END:VEVENT\r\n';
    });

    ics += 'END:VCALENDAR';
    return ics;
  }

  // Составление расписания и показ предложения скачать календарь
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

  // --- Кнопка «Установить приложение» (замена пропавшего баннера Chrome) ---
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  if (!isStandalone) {
    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      showInstallButton();
    });

    // Если браузер не дал своё событие, показываем кнопку с подсказкой
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
          // Браузер поддерживает установку — показываем системный диалог
          deferredPrompt.prompt();
          deferredPrompt.userChoice.finally(() => {
            deferredPrompt = null;
            hint.remove();
          });
        } else {
          // Своя подсказка: как установить вручную
          const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
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
    // Удаляем старое сообщение и кнопку, если есть
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
      '.<br>Скачайте файл и добавьте его в календарь телефона — придут напоминания.</p>';

    // Кнопка 1: скачать .ics — работает везде
    // (на iPhone Safari сам предложит «Добавить все в Календарь»)
    const downloadButton = document.createElement('button');
    downloadButton.textContent = '📥 Скачать календарь тренировок';
    downloadButton.classList.add('download-button');
    downloadButton.onclick = () => {
      const a = document.createElement('a');
      a.href = url;
      a.download = 'training-schedule.ics';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    };
    offer.appendChild(downloadButton);

    // Блок 2: ссылки на Google Календарь, свёрнутые в <details>,
    // чтобы при длинной схеме не растягивать экран
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

      // Понятная подпись: дата и суть тренировки
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
    // Предложение показываем на экране первого чтения
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
    saveSchedule(events); // запоминаем расписание для напоминаний при открытии

    // Разбиваем на строки
    originalLines = text.split('\n').filter(line => line.trim() !== '');
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
    // Новый воркер активировался — перезагружаем страницу, чтобы показать свежую версию
    window.location.reload();
  });

  // Проверяем обновления при каждом открытии приложения
  navigator.serviceWorker.ready.then((reg) => {
    reg.update().catch(() => {});
  });
}
