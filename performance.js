document.addEventListener("DOMContentLoaded", () => {
  const processorCores = navigator.hardwareConcurrency || 8;
  const deviceMemory = navigator.deviceMemory || 8;

  if (processorCores <= 4 || deviceMemory <= 4) {
    document.body.classList.add("performance-lite");
  }

  document.querySelectorAll("img").forEach((image) => {
    if (!image.hasAttribute("loading")) {
      image.loading = "lazy";
    }

    image.decoding = "async";
  });

  document.querySelectorAll("video").forEach((video) => {
    if (!video.hasAttribute("preload")) {
      video.preload = "metadata";
    }
  });

  initializeJournalHistoryCalendarNotes();
});

function initializeJournalHistoryCalendarNotes() {
  const modalContent = document.getElementById("modalContent");
  const calendarViewButton = document.querySelector(
    '[data-view="calendar"]'
  );
  const timelineViewButton = document.querySelector(
    '[data-view="timeline"]'
  );
  const insightsViewButton = document.querySelector(
    '[data-view="insights"]'
  );
  const bottomActionButton = document.getElementById("exitButton");
  const modalOverlay = document.getElementById("modalOverlay");

  if (
    !modalContent ||
    !calendarViewButton ||
    !bottomActionButton ||
    !modalOverlay
  ) {
    return;
  }

  document.body.classList.add("journal-history-page");
  addCalendarNoteStyles();

  const historyStorageKey = "dailyMindsetJournalHistory";
  const maximumLength = 800;

  let currentView = "";
  let selectedDate = getTodayKey();
  let observerTimer;

  function getTodayKey() {
    const today = new Date();

    return [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0")
    ].join("-");
  }

  function formatDate(dateKey) {
    const date = new Date(`${dateKey}T12:00:00`);

    if (Number.isNaN(date.getTime())) {
      return dateKey;
    }

    return date.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  }

  function readHistory() {
    try {
      const savedValue = localStorage.getItem(historyStorageKey);
      const parsedValue = savedValue ? JSON.parse(savedValue) : [];

      return Array.isArray(parsedValue) ? parsedValue : [];
    } catch (error) {
      console.error("Could not read calendar highlights:", error);
      return [];
    }
  }

  function writeHistory(history) {
    try {
      localStorage.setItem(
        historyStorageKey,
        JSON.stringify(history)
      );

      return true;
    } catch (error) {
      console.error("Could not save calendar highlight:", error);
      showMessage("The calendar highlight could not be saved");
      return false;
    }
  }

  function countWords(text) {
    const cleanText = String(text || "").trim();

    return cleanText
      ? cleanText.split(/\s+/).filter(Boolean).length
      : 0;
  }

  function findCalendarNote(dateKey) {
    return readHistory().find((entry) => {
      return (
        entry &&
        entry.type === "calendar-note" &&
        entry.date === dateKey
      );
    });
  }

  function saveCalendarNote(dateKey, noteText) {
    const cleanText = String(noteText || "").trim();

    if (!cleanText) {
      return false;
    }

    const history = readHistory().filter((entry) => {
      return !(
        entry &&
        entry.type === "calendar-note" &&
        entry.date === dateKey
      );
    });

    const savedAt = new Date().toISOString();

    history.push({
      id: `calendar-note-${dateKey}`,
      signature: `calendar-note-${dateKey}`,
      type: "calendar-note",
      title: "Calendar Highlight",
      icon: "🗓️",
      date: dateKey,
      createdAt: savedAt,
      summary:
        cleanText.length > 110
          ? `${cleanText.slice(0, 110)}…`
          : cleanText,
      details: cleanText,
      words: countWords(cleanText)
    });

    history.sort((firstEntry, secondEntry) => {
      return (
        new Date(secondEntry.createdAt || secondEntry.date) -
        new Date(firstEntry.createdAt || firstEntry.date)
      );
    });

    if (!writeHistory(history)) {
      return false;
    }

    refreshCalendarAfterSave(dateKey);
    showMessage("Calendar highlight saved ✓");
    return true;
  }

  function refreshCalendarAfterSave(dateKey) {
    try {
      if (typeof captureCurrentEntries === "function") {
        captureCurrentEntries();
      }

      if (typeof renderCalendar === "function") {
        renderCalendar();
      }
    } catch (error) {
      console.error("Could not refresh the calendar:", error);
    }

    window.setTimeout(() => {
      const selectedDayButton = document.querySelector(
        `.calendar-day[data-date="${dateKey}"]`
      );

      if (selectedDayButton) {
        selectedDayButton.click();
      } else {
        renderCalendarEditor(dateKey, false);
      }
    }, 80);
  }

  function showMessage(message) {
    try {
      if (typeof showToast === "function") {
        showToast(message);
        return;
      }
    } catch (error) {
      console.error("Could not show the app message:", error);
    }

    const toast = document.getElementById("toast");

    if (!toast) {
      return;
    }

    toast.textContent = message;
    toast.classList.add("show");

    window.setTimeout(() => {
      toast.classList.remove("show");
    }, 2300);
  }

  function setBottomButtonMode(isCalendarView) {
    bottomActionButton.textContent = isCalendarView
      ? "Save"
      : "Exit";

    bottomActionButton.classList.toggle(
      "calendar-save-button",
      isCalendarView
    );
  }

  function renderCalendarEditor(dateKey, focusTextarea = false) {
    if (currentView !== "calendar") {
      return;
    }

    const dayDetails = document.getElementById("dayDetails");

    if (!dayDetails) {
      return;
    }

    selectedDate = dateKey || selectedDate || getTodayKey();

    const existingEditor = dayDetails.querySelector(
      ".calendar-note-editor"
    );

    if (
      existingEditor &&
      existingEditor.dataset.date === selectedDate
    ) {
      if (focusTextarea) {
        existingEditor
          .querySelector(".calendar-note-textarea")
          ?.focus();
      }

      return;
    }

    existingEditor?.remove();
    dayDetails.querySelector(".calendar-note-open")?.remove();

    const savedNote = findCalendarNote(selectedDate);
    const editor = document.createElement("section");

    editor.className = "calendar-note-editor";
    editor.dataset.date = selectedDate;
    editor.innerHTML = `
      <div class="calendar-note-editor-heading">
        <div class="calendar-note-editor-icon">✍️</div>
        <div>
          <h4>Add calendar highlight</h4>
          <p>${formatDate(selectedDate)}</p>
        </div>
      </div>

      <label class="calendar-note-label" for="calendarNoteTextarea">
        What would you like to remember about this day?
      </label>

      <textarea
        class="calendar-note-textarea"
        id="calendarNoteTextarea"
        maxlength="${maximumLength}"
        placeholder="Write a meaningful moment, thought, lesson, achievement or memory..."
      ></textarea>

      <div class="calendar-note-meta">
        <span class="calendar-note-status" aria-live="polite"></span>
        <span class="calendar-note-count">0 / ${maximumLength}</span>
      </div>

      <button
        class="calendar-note-clear"
        type="button"
      >
        Clear Text
      </button>
    `;

    dayDetails.appendChild(editor);

    const textarea = editor.querySelector(
      ".calendar-note-textarea"
    );
    const counter = editor.querySelector(
      ".calendar-note-count"
    );
    const status = editor.querySelector(
      ".calendar-note-status"
    );
    const clearButton = editor.querySelector(
      ".calendar-note-clear"
    );

    textarea.value = savedNote
      ? String(savedNote.details || "")
      : "";

    function updateCounter() {
      counter.textContent =
        `${textarea.value.length} / ${maximumLength}`;
      status.textContent = "";
    }

    updateCounter();

    textarea.addEventListener("input", updateCounter);

    clearButton.addEventListener("click", (event) => {
      event.stopPropagation();
      textarea.value = "";
      updateCounter();
      textarea.focus();
    });

    if (focusTextarea) {
      window.requestAnimationFrame(() => {
        textarea.focus();
        editor.scrollIntoView({
          behavior: "smooth",
          block: "nearest"
        });
      });
    }
  }

  function saveVisibleCalendarEditor() {
    const editor = document.querySelector(
      "#dayDetails .calendar-note-editor"
    );

    if (!editor) {
      renderCalendarEditor(selectedDate, true);
      return;
    }

    const textarea = editor.querySelector(
      ".calendar-note-textarea"
    );
    const status = editor.querySelector(
      ".calendar-note-status"
    );
    const noteText = textarea.value.trim();

    if (!noteText) {
      status.textContent = "Write something before saving.";
      textarea.focus();
      return;
    }

    status.textContent = "Saving...";
    saveCalendarNote(selectedDate, noteText);
  }

  function activateCalendarView() {
    currentView = "calendar";
    selectedDate = getTodayKey();
    setBottomButtonMode(true);

    window.setTimeout(() => {
      const todayButton = document.querySelector(
        `.calendar-day[data-date="${selectedDate}"]`
      );

      if (todayButton) {
        todayButton.click();
      } else {
        renderCalendarEditor(selectedDate, false);
      }
    }, 90);
  }

  function activateNonCalendarView() {
    currentView = "other";
    setBottomButtonMode(false);
  }

  calendarViewButton.addEventListener(
    "click",
    activateCalendarView
  );

  timelineViewButton?.addEventListener(
    "click",
    activateNonCalendarView
  );

  insightsViewButton?.addEventListener(
    "click",
    activateNonCalendarView
  );

  document.addEventListener("click", (event) => {
    const dayButton = event.target.closest(
      ".calendar-day:not(.empty)"
    );

    if (
      currentView === "calendar" &&
      dayButton &&
      dayButton.dataset.date
    ) {
      selectedDate = dayButton.dataset.date;

      window.setTimeout(() => {
        renderCalendarEditor(selectedDate, true);
      }, 0);
    }
  });

  bottomActionButton.addEventListener(
    "click",
    (event) => {
      if (
        currentView !== "calendar" ||
        !modalOverlay.classList.contains("open")
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      saveVisibleCalendarEditor();
    },
    true
  );

  const detailsObserver = new MutationObserver(() => {
    if (currentView !== "calendar") {
      return;
    }

    window.clearTimeout(observerTimer);

    observerTimer = window.setTimeout(() => {
      renderCalendarEditor(selectedDate, false);
    }, 20);
  });

  detailsObserver.observe(modalContent, {
    childList: true,
    subtree: true
  });
}

function addCalendarNoteStyles() {
  if (document.getElementById("calendarNoteRuntimeStyles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "calendarNoteRuntimeStyles";
  style.textContent = `
    body.journal-history-page .calendar-save-button {
      color: white !important;
      background: linear-gradient(110deg, #c78a84, #916968) !important;
      border-color: rgba(99, 64, 70, 0.28) !important;
      box-shadow:
        0 7px 16px rgba(99, 64, 70, 0.27),
        inset 0 1px 0 rgba(255, 255, 255, 0.31) !important;
    }

    body.journal-history-page .calendar-note-editor {
      margin-top: 15px;
    }

    body.journal-history-page .calendar-note-editor-heading h4 {
      font-size: 19px;
    }

    body.journal-history-page .calendar-note-clear {
      width: 100%;
      min-height: 45px;
      margin-top: 9px;
    }
  `;

  document.head.appendChild(style);
}
