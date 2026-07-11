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
});

/* =============================================
   JOURNAL HISTORY CALENDAR NOTE ENHANCEMENT
   Runs only on journal-history.html
============================================= */

document.addEventListener("DOMContentLoaded", () => {
  const modalContent = document.getElementById("modalContent");
  const calendarViewButton = document.querySelector(
    '[data-view="calendar"]'
  );

  if (!modalContent || !calendarViewButton) {
    return;
  }

  document.body.classList.add("journal-history-page");

  const historyStorageKey = "dailyMindsetJournalHistory";
  const maxNoteLength = 800;

  let selectedDate = getTodayKey();

  function getTodayKey() {
    const today = new Date();

    return [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0")
    ].join("-");
  }

  function formatNoteDate(dateKey) {
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
      const savedHistory = localStorage.getItem(historyStorageKey);
      const parsedHistory = savedHistory
        ? JSON.parse(savedHistory)
        : [];

      return Array.isArray(parsedHistory)
        ? parsedHistory
        : [];
    } catch (error) {
      console.error("Could not read calendar notes:", error);
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
      console.error("Could not save calendar note:", error);
      notify("The calendar note could not be saved");
      return false;
    }
  }

  function countWords(text) {
    const cleanText = String(text || "").trim();

    if (!cleanText) {
      return 0;
    }

    return cleanText.split(/\s+/).filter(Boolean).length;
  }

  function getCalendarNote(dateKey) {
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

    const historyWithoutOldNote = readHistory().filter((entry) => {
      return !(
        entry &&
        entry.type === "calendar-note" &&
        entry.date === dateKey
      );
    });

    const now = new Date().toISOString();

    historyWithoutOldNote.push({
      id: `calendar-note-${dateKey}`,
      signature: `calendar-note-${dateKey}`,
      type: "calendar-note",
      title: "Calendar Highlight",
      icon: "🗓️",
      date: dateKey,
      createdAt: now,
      summary:
        cleanText.length > 110
          ? `${cleanText.slice(0, 110)}…`
          : cleanText,
      details: cleanText,
      words: countWords(cleanText)
    });

    historyWithoutOldNote.sort((firstEntry, secondEntry) => {
      return (
        new Date(secondEntry.createdAt || secondEntry.date) -
        new Date(firstEntry.createdAt || firstEntry.date)
      );
    });

    if (!writeHistory(historyWithoutOldNote)) {
      return false;
    }

    refreshCalendarAndReselect(dateKey);
    notify("Calendar highlight saved ✓");

    return true;
  }

  function deleteCalendarNote(dateKey) {
    const updatedHistory = readHistory().filter((entry) => {
      return !(
        entry &&
        entry.type === "calendar-note" &&
        entry.date === dateKey
      );
    });

    if (!writeHistory(updatedHistory)) {
      return;
    }

    refreshCalendarAndReselect(dateKey);
    notify("Calendar highlight removed");
  }

  function refreshCalendarAndReselect(dateKey) {
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
      const dateButton = document.querySelector(
        `.calendar-day[data-date="${dateKey}"]`
      );

      if (dateButton) {
        dateButton.click();
      } else {
        prepareDayDetailsCard();
      }
    }, 60);
  }

  function notify(message) {
    try {
      if (typeof showToast === "function") {
        showToast(message);
        return;
      }
    } catch (error) {
      console.error("Could not show the app toast:", error);
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

  function createOpenNoteButton() {
    const openButton = document.createElement("button");

    openButton.type = "button";
    openButton.className = "calendar-note-open";
    openButton.innerHTML = `
      <span class="calendar-note-open-icon">＋</span>
      <span>
        <strong>Add or edit a calendar highlight</strong>
        <small>${formatNoteDate(selectedDate)}</small>
      </span>
    `;

    return openButton;
  }

  function prepareDayDetailsCard() {
    const dayDetails = document.getElementById("dayDetails");

    if (!dayDetails) {
      return;
    }

    dayDetails.classList.add("calendar-note-clickable");
    dayDetails.setAttribute("data-note-date", selectedDate);

    const currentTitle = dayDetails.querySelector(
      ".day-details-title"
    );

    if (
      currentTitle &&
      currentTitle.textContent.trim() ===
        "Select a highlighted day"
    ) {
      currentTitle.textContent =
        "Select any day or write a highlight";

      const currentText = dayDetails.querySelector(
        ".day-details-text"
      );

      if (currentText) {
        currentText.textContent =
          "Tap any calendar date to view its entries, or tap this card to add a personal note for today.";
      }
    }

    if (
      !dayDetails.querySelector(".calendar-note-open") &&
      !dayDetails.querySelector(".calendar-note-editor")
    ) {
      dayDetails.appendChild(createOpenNoteButton());
    }
  }

  function openNoteEditor(dateKey) {
    selectedDate = dateKey || selectedDate || getTodayKey();

    const dayDetails = document.getElementById("dayDetails");

    if (!dayDetails) {
      return;
    }

    dayDetails.classList.add("calendar-note-clickable");
    dayDetails.setAttribute("data-note-date", selectedDate);

    const existingEditor = dayDetails.querySelector(
      ".calendar-note-editor"
    );

    if (existingEditor) {
      const existingTextarea = existingEditor.querySelector(
        ".calendar-note-textarea"
      );

      if (existingTextarea) {
        existingTextarea.focus();
      }

      return;
    }

    const openButton = dayDetails.querySelector(
      ".calendar-note-open"
    );

    if (openButton) {
      openButton.remove();
    }

    const savedNote = getCalendarNote(selectedDate);
    const editor = document.createElement("section");

    editor.className = "calendar-note-editor";
    editor.innerHTML = `
      <div class="calendar-note-editor-heading">
        <div class="calendar-note-editor-icon">✍️</div>
        <div>
          <h4>Write a calendar highlight</h4>
          <p>${formatNoteDate(selectedDate)}</p>
        </div>
      </div>

      <label class="calendar-note-label" for="calendarNoteTextarea">
        What would you like to remember about this day?
      </label>

      <textarea
        class="calendar-note-textarea"
        id="calendarNoteTextarea"
        maxlength="${maxNoteLength}"
        placeholder="Write a meaningful moment, thought, lesson, achievement or memory..."
      ></textarea>

      <div class="calendar-note-meta">
        <span class="calendar-note-status" aria-live="polite"></span>
        <span class="calendar-note-count">0 / ${maxNoteLength}</span>
      </div>

      <div class="calendar-note-actions">
        <button
          class="calendar-note-clear"
          type="button"
        >
          Clear
        </button>

        <button
          class="calendar-note-save"
          type="button"
        >
          Save Highlight
        </button>
      </div>
    `;

    dayDetails.appendChild(editor);

    const textarea = editor.querySelector(
      ".calendar-note-textarea"
    );
    const count = editor.querySelector(
      ".calendar-note-count"
    );
    const status = editor.querySelector(
      ".calendar-note-status"
    );
    const saveButton = editor.querySelector(
      ".calendar-note-save"
    );
    const clearButton = editor.querySelector(
      ".calendar-note-clear"
    );

    textarea.value = savedNote
      ? String(savedNote.details || "")
      : "";

    function updateCount() {
      count.textContent =
        `${textarea.value.length} / ${maxNoteLength}`;
      status.textContent = "";
    }

    updateCount();

    textarea.addEventListener("input", updateCount);

    saveButton.addEventListener("click", (event) => {
      event.stopPropagation();

      const noteText = textarea.value.trim();

      if (!noteText) {
        status.textContent = "Write something before saving.";
        textarea.focus();
        return;
      }

      status.textContent = "Saving...";
      saveButton.disabled = true;

      const didSave = saveCalendarNote(
        selectedDate,
        noteText
      );

      if (!didSave) {
        saveButton.disabled = false;
        status.textContent = "Could not save. Please try again.";
      }
    });

    clearButton.addEventListener("click", (event) => {
      event.stopPropagation();

      if (getCalendarNote(selectedDate)) {
        const shouldDelete = window.confirm(
          "Remove the saved calendar highlight for this day?"
        );

        if (!shouldDelete) {
          return;
        }

        deleteCalendarNote(selectedDate);
        return;
      }

      textarea.value = "";
      updateCount();
      textarea.focus();
    });

    window.requestAnimationFrame(() => {
      textarea.focus();
      editor.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
      });
    });
  }

  document.addEventListener("click", (event) => {
    const dayButton = event.target.closest(
      ".calendar-day:not(.empty)"
    );

    if (dayButton && dayButton.dataset.date) {
      selectedDate = dayButton.dataset.date;

      window.setTimeout(() => {
        openNoteEditor(selectedDate);
      }, 0);

      return;
    }

    const openButton = event.target.closest(
      ".calendar-note-open"
    );

    if (openButton) {
      event.preventDefault();
      event.stopPropagation();
      openNoteEditor(selectedDate);
      return;
    }

    const dayDetails = event.target.closest("#dayDetails");

    if (
      dayDetails &&
      !event.target.closest(
        "textarea, button, .calendar-note-editor"
      )
    ) {
      openNoteEditor(selectedDate);
    }
  });

  const detailsObserver = new MutationObserver(() => {
    prepareDayDetailsCard();
  });

  detailsObserver.observe(modalContent, {
    childList: true,
    subtree: true
  });

  calendarViewButton.addEventListener("click", () => {
    selectedDate = getTodayKey();

    window.setTimeout(() => {
      prepareDayDetailsCard();
    }, 80);
  });
});
