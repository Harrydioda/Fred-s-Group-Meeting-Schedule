const STORAGE_KEY = "fred-meeting-schedule-v2";

const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const els = {
  datePicker: document.querySelector("#datePicker"),
  prevWeekButton: document.querySelector("#prevWeekButton"),
  nextWeekButton: document.querySelector("#nextWeekButton"),
  todayButton: document.querySelector("#todayButton"),
  toggleWeekendButton: document.querySelector("#toggleWeekendButton"),
  clearWeekButton: document.querySelector("#clearWeekButton"),
  searchInput: document.querySelector("#searchInput"),
  syncStatus: document.querySelector("#syncStatus"),
  summary: document.querySelector("#summary"),
  weekHint: document.querySelector("#weekHint"),
  currentTurnLabel: document.querySelector("#currentTurnLabel"),
  endTurnButton: document.querySelector("#endTurnButton"),
  mobileDayTabs: document.querySelector("#mobileDayTabs"),
  scheduleHead: document.querySelector("#scheduleHead"),
  scheduleBody: document.querySelector("#scheduleBody"),
  meetingSuggestions: document.querySelector("#meetingSuggestions"),
  dayLocationSuggestions: document.querySelector("#dayLocationSuggestions"),
  studentLocationSuggestions: document.querySelector("#studentLocationSuggestions"),
  studentAutocomplete: document.querySelector("#studentAutocomplete"),
  selectionHint: document.querySelector("#selectionHint"),
  markClosedButton: document.querySelector("#markClosedButton"),
  splitSelectedButton: document.querySelector("#splitSelectedButton"),
  clearSelectionButton: document.querySelector("#clearSelectionButton"),
  studentCount: document.querySelector("#studentCount"),
  studentList: document.querySelector("#studentList"),
  addStudentButton: document.querySelector("#addStudentButton")
};

let state = loadState();
let activeMonday = getMonday(new Date());
let selectedCells = new Set();
let isSelecting = false;
let showWeekend = false;
let activeAutocompleteInput = null;
let activeMobileDayIndex = 0;
let activeSummaryCategory = null;
let firestoreDb = null;
let isApplyingCloudState = false;
let cloudSaveTimer = null;
let cloudUnsubscribe = null;
let localChangeVersion = 0;
let savedChangeVersion = 0;
const mobileScheduleQuery = window.matchMedia("(max-width: 760px)");

function init() {
  els.datePicker.value = formatDate(activeMonday);

  els.datePicker.addEventListener("change", () => {
    const selected = parseDateInput(els.datePicker.value);
    activeMonday = getMonday(selected);
    els.datePicker.value = formatDate(activeMonday);
    ensureWeek(activeMonday);
    selectedCells.clear();
    render();
  });

  els.prevWeekButton.addEventListener("click", () => moveWeek(-1));
  els.nextWeekButton.addEventListener("click", () => moveWeek(1));
  els.todayButton.addEventListener("click", () => {
    activeMonday = getMonday(new Date());
    els.datePicker.value = formatDate(activeMonday);
    ensureWeek(activeMonday);
    render();
  });
  els.toggleWeekendButton.addEventListener("click", () => {
    showWeekend = !showWeekend;
    render();
  });

  els.clearWeekButton.addEventListener("click", () => {
    const key = formatDate(activeMonday);
      state.weeks[key] = createBlankWeek(activeMonday);
    selectedCells.clear();
    saveState();
    render();
  });

  els.searchInput.addEventListener("input", render);
  els.endTurnButton.addEventListener("click", endCurrentTurn);
  els.markClosedButton.addEventListener("click", markSelectedClosed);
  els.splitSelectedButton.addEventListener("click", splitSelected);
  els.clearSelectionButton.addEventListener("click", () => {
    selectedCells.clear();
    render();
  });
  els.addStudentButton.addEventListener("click", addStudent);
  mobileScheduleQuery.addEventListener("change", () => {
    selectedCells.clear();
    render();
  });
  document.addEventListener("mouseup", () => {
    isSelecting = false;
  });
  document.addEventListener("mousedown", event => {
    if (!els.studentAutocomplete.contains(event.target) && !event.target.classList.contains("slot-input")) {
      hideStudentAutocomplete();
    }
    if (!event.target.closest(".location-combo")) {
      closeLocationMenus();
    }
  });

  ensureWeek(activeMonday);
  render();
  initializeCloudSync();

  /* Current time highlight is kept for later use.
  window.setInterval(render, 60000);
  */
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return migrateState(JSON.parse(saved));
    } catch (error) {
      console.warn("Saved schedule data could not be read.", error);
    }
  }

  return migrateState({
    students: structuredClone(DEFAULT_STUDENTS),
    studentLocationOptions: [...STUDENT_LOCATION_OPTIONS],
    dayLocationOptions: LOCATION_OPTIONS.filter(Boolean),
    weeks: structuredClone(DEFAULT_WEEKS)
  });
}

function migrateState(nextState) {
  nextState.students = (nextState.students || []).map(student => ({
    location: student.location || "Online",
    status: normalizeStudentStatus(student.status, student.note),
    name: student.name || "",
    note: student.note || ""
  }));

  const activeMeetingStudent = String(nextState.activeMeetingStudent || "").trim();
  nextState.activeMeetingStudent = nextState.students.some(student => {
    return activeMeetingStudent && normalize(student.name) === normalize(activeMeetingStudent);
  }) ? activeMeetingStudent : "";

  nextState.studentLocationOptions = uniqueValues(
    Array.isArray(nextState.studentLocationOptions)
      ? nextState.studentLocationOptions
      : STUDENT_LOCATION_OPTIONS
  );
  nextState.dayLocationOptions = uniqueValues(
    Array.isArray(nextState.dayLocationOptions)
      ? nextState.dayLocationOptions
      : LOCATION_OPTIONS.filter(Boolean)
  );

  nextState.weeks = nextState.weeks || {};
  return nextState;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  queueCloudSave();
}

function initializeCloudSync() {
  if (!window.firebase || !window.FRED_FIREBASE_CONFIG) {
    updateSyncStatus("Local only");
    return;
  }

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(window.FRED_FIREBASE_CONFIG);
    }

    firestoreDb = firebase.firestore();
    firestoreDb.enablePersistence({ synchronizeTabs: true }).catch(() => {});

    const collection = window.FRED_FIRESTORE_COLLECTION || "schedules";
    const docId = window.FRED_FIRESTORE_DOC_ID || "main";
    const docRef = firestoreDb.collection(collection).doc(docId);

    updateSyncStatus("Connecting...");
    cloudUnsubscribe = docRef.onSnapshot(snapshot => {
      if (!snapshot.exists) {
        queueCloudSave(true);
        return;
      }

      const hasPendingWrites = Boolean(snapshot.metadata?.hasPendingWrites);
      const hasUnsavedLocalChanges = localChangeVersion !== savedChangeVersion;
      if (hasPendingWrites || hasUnsavedLocalChanges) {
        return;
      }

      const cloudState = snapshot.data()?.state;
      if (!cloudState) return;

      isApplyingCloudState = true;
      state = migrateState(cloudState);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      ensureWeek(activeMonday);
      selectedCells.clear();
      render();
      isApplyingCloudState = false;
      updateSyncStatus("Synced");
    }, error => {
      console.warn("Cloud sync is unavailable.", error);
      updateSyncStatus("Offline backup");
    });
  } catch (error) {
    console.warn("Firebase could not be initialized.", error);
    updateSyncStatus("Local only");
  }
}

function queueCloudSave(force = false) {
  if (!firestoreDb || isApplyingCloudState) return;

  localChangeVersion += 1;
  updateSyncStatus("Saving...");
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(() => saveStateToCloud(), force ? 0 : 350);
}

async function saveStateToCloud() {
  if (!firestoreDb) return;

  const collection = window.FRED_FIRESTORE_COLLECTION || "schedules";
  const docId = window.FRED_FIRESTORE_DOC_ID || "main";
  const changeVersion = localChangeVersion;
  const stateSnapshot = structuredClone(state);

  try {
    await firestoreDb.collection(collection).doc(docId).set({
      state: stateSnapshot,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    savedChangeVersion = Math.max(savedChangeVersion, changeVersion);
    updateSyncStatus(savedChangeVersion === localChangeVersion ? "Synced" : "Saving...");
  } catch (error) {
    console.warn("Schedule could not be saved to cloud.", error);
    updateSyncStatus("Offline backup");
  }
}

function updateSyncStatus(label) {
  if (els.syncStatus) {
    els.syncStatus.textContent = label;
  }
}

function ensureWeek(monday) {
  const key = formatDate(monday);
  if (!state.weeks[key]) {
    state.weeks[key] = createBlankWeek(monday);
    saveState();
  }
  return state.weeks[key];
}

function createBlankWeek(monday) {
  const dates = weekDates(monday);
  const locations = {};
  const slots = {};

  dates.forEach(date => {
    const key = formatDate(date);
    locations[key] = "";
    slots[key] = {};
  });

  return { locations, slots };
}

function moveWeek(direction) {
  activeMonday = addDays(activeMonday, direction * 7);
  els.datePicker.value = formatDate(activeMonday);
  ensureWeek(activeMonday);
  selectedCells.clear();
  render();
}

function render() {
  const week = ensureWeek(activeMonday);
  const allDates = weekDates(activeMonday);
  const dates = visibleDates(activeMonday);
  if (activeMobileDayIndex >= dates.length) {
    activeMobileDayIndex = 0;
  }
  const scheduleDates = isMobileSchedule() ? [dates[activeMobileDayIndex]] : dates;
  const query = normalize(els.searchInput.value);

  els.weekHint.textContent = showWeekend
    ? `${formatDisplayDate(allDates[0])} to ${formatDisplayDate(allDates[6])}`
    : `${formatDisplayDate(allDates[0])} to ${formatDisplayDate(allDates[4])} - weekend hidden`;
  els.toggleWeekendButton.textContent = showWeekend ? "Hide weekend" : "Show weekend";
  document.body.classList.toggle("weekend-visible", showWeekend);
  renderCurrentTurn();
  renderSuggestions();
  renderSummary(week, dates);
  renderMobileDayTabs(dates);
  pruneSelection(scheduleDates);
  renderSelectionHint();
  renderSchedule(week, scheduleDates, query);
  renderStudents(week, dates, query);
}

function renderCurrentTurn() {
  const activeName = state.activeMeetingStudent || "";
  els.currentTurnLabel.textContent = activeName ? `Current turn: ${activeName}` : "Current turn: No one";
  els.currentTurnLabel.classList.toggle("active", Boolean(activeName));
  els.endTurnButton.disabled = !activeName;
}

function renderSuggestions() {
  const options = ["Not open", ...state.students.map(student => student.name).filter(Boolean)];
  els.meetingSuggestions.innerHTML = options
    .map(option => `<option value="${escapeHtml(option)}"></option>`)
    .join("");
  els.dayLocationSuggestions.innerHTML = state.dayLocationOptions
    .map(option => `<option value="${escapeHtml(option)}"></option>`)
    .join("");
  els.studentLocationSuggestions.innerHTML = state.studentLocationOptions
    .map(option => `<option value="${escapeHtml(option)}"></option>`)
    .join("");
}

function renderSummary(week, dates) {
  const allValues = dates.flatMap(date => {
    const dayKey = formatDate(date);
    return Object.values(week.slots[dayKey] || {});
  });
  const meetingNames = allValues.filter(value => value && normalize(value) !== "not open");
  const pendingNames = state.students.filter(student => {
    return student.name && normalizeStudentStatus(student.status, student.note) === "pending";
  }).map(student => student.name);
  const skipNames = state.students.filter(student => {
    return student.name && normalizeStudentStatus(student.status, student.note) === "skip";
  }).map(student => student.name);
  const unscheduledNames = state.students.filter(student => {
    return student.name && normalizeStudentStatus(student.status, student.note) !== "skip" && !isScheduled(week, dates, student.name);
  }).map(student => student.name);

  const categories = {
    meetings: { label: "Meetings", names: meetingNames },
    pending: { label: "Pending", names: pendingNames },
    skip: { label: "Skip", names: skipNames },
    unscheduled: { label: "Unscheduled", names: unscheduledNames }
  };

  if (activeSummaryCategory && !categories[activeSummaryCategory]) {
    activeSummaryCategory = null;
  }

  els.summary.innerHTML = [
    ...Object.entries(categories).map(([key, category]) => {
      return metric(category.label, category.names.length, key, key === activeSummaryCategory);
    }),
    activeSummaryCategory ? summaryDetails(categories[activeSummaryCategory]) : ""
  ].join("");

  els.summary.querySelectorAll(".metric[data-category]").forEach(button => {
    button.addEventListener("click", () => {
      activeSummaryCategory = activeSummaryCategory === button.dataset.category
        ? null
        : button.dataset.category;
      renderSummary(week, dates);
    });
  });
}

function metric(label, value, category, active) {
  return `
    <button
      class="metric ${active ? "active" : ""}"
      type="button"
      data-category="${category}"
      aria-expanded="${active ? "true" : "false"}"
      aria-controls="summaryDetails"
    >
      <span>${label}</span>
      <strong>${value}</strong>
    </button>
  `;
}

function summaryDetails(category) {
  const uniqueNames = uniqueValues(category.names);
  const names = uniqueNames.length
    ? uniqueNames.map(name => `<span class="summary-name">${escapeHtml(name)}</span>`).join("")
    : `<span class="summary-empty">No one in this category.</span>`;

  return `
    <section class="summary-details" id="summaryDetails" aria-live="polite">
      <strong>${escapeHtml(category.label)}</strong>
      <div class="summary-names">${names}</div>
    </section>
  `;
}

function renderMobileDayTabs(dates) {
  els.mobileDayTabs.innerHTML = dates.map((date, index) => `
    <button
      class="mobile-day-tab ${index === activeMobileDayIndex ? "active" : ""}"
      type="button"
      data-index="${index}"
      aria-pressed="${index === activeMobileDayIndex ? "true" : "false"}"
    >
      <span>${displayWeekday(date)}</span>
      <strong>${formatDisplayDate(date)}</strong>
    </button>
  `).join("");

  els.mobileDayTabs.querySelectorAll(".mobile-day-tab").forEach(button => {
    button.addEventListener("click", () => {
      activeMobileDayIndex = Number(button.dataset.index);
      selectedCells.clear();
      render();
    });
  });
}

function renderSchedule(week, dates, query) {
  // Current time highlight is kept for later use:
  // <td class="time-cell ${isCurrentTimeSlot(time) ? "current-time" : ""}">${time}</td>
  els.scheduleHead.innerHTML = `
    <tr>
      <th class="time-head">Time</th>
      ${dates.map(date => dayHeader(week, date)).join("")}
    </tr>
  `;

  els.scheduleBody.innerHTML = TIME_SLOTS.map((time, timeIndex) => `
    <tr>
      <td class="time-cell">${time}</td>
      ${dates.map(date => slotCell(week, date, time, timeIndex, query)).join("")}
    </tr>
  `).join("");

  bindScheduleEvents(week);
}

function dayHeader(week, date) {
  const dayKey = formatDate(date);
  const location = week.locations[dayKey] || "";

  return `
    <th>
      <div class="day-title">
        <strong>${displayWeekday(date)} ${formatDisplayDate(date)}</strong>
        <span>${isWeekend(date) ? "Weekend" : "Weekday"}</span>
        <div class="location-combo day-location-combo">
          <input
            class="location-input"
            data-date="${dayKey}"
            value="${escapeHtml(location)}"
            placeholder="Choose or type location"
            aria-label="${displayWeekday(date)} location"
          >
          <div class="location-menu" hidden>
            ${locationOptionRows("day")}
          </div>
        </div>
      </div>
    </th>
  `;
}

function slotCell(week, date, time, timeIndex, query) {
  const dayKey = formatDate(date);
  const value = (week.slots[dayKey] && week.slots[dayKey][time]) || "";
  const status = slotStatus(value);
  const closedRun = status === "closed" ? getClosedRun(week, dayKey, timeIndex) : null;

  if (closedRun && !closedRun.isStart) {
    return "";
  }

  const cellKey = makeCellKey(dayKey, time);
  const selected = closedRun
    ? closedRun.times.some(runTime => selectedCells.has(makeCellKey(dayKey, runTime)))
    : selectedCells.has(cellKey);
  const haystack = normalize(`${value} ${week.locations[dayKey] || ""} ${time}`);
  const highlight = query && haystack.includes(query);
  const currentTurn = isCurrentMeetingStudent(value);
  /* Current time highlight is kept for later use.
  const currentSlot = isCurrentTimeSlot(time);
  const currentDay = isToday(date);
  */
  const rowspan = closedRun ? ` rowspan="${closedRun.length}"` : "";
  const dataTimes = closedRun ? closedRun.times.join("||") : time;
  const label = closedRun && closedRun.length > 1 ? `Not open (${closedRun.times[0]} to ${closedRun.times[closedRun.times.length - 1].split("-")[1]})` : value;
  const inputReadonly = closedRun ? "readonly" : "";

  // Current time highlight is kept for later use:
  // <td class="slot ${closedRun ? "merged-slot" : ""} ${currentSlot && currentDay ? "current-day-slot" : ""}"${rowspan} data-date="${dayKey}" data-times="${escapeHtml(dataTimes)}">
  return `
    <td class="slot ${closedRun ? "merged-slot" : ""}"${rowspan} data-date="${dayKey}" data-times="${escapeHtml(dataTimes)}">
      <div class="slot-content ${status} ${closedRun ? "merged" : ""} ${highlight ? "highlight" : ""} ${selected ? "selected" : ""} ${currentTurn ? "current-turn" : ""}">
        <textarea
          class="slot-input"
          data-date="${dayKey}"
          data-time="${time}"
          rows="1"
          placeholder=""
          ${inputReadonly}
          aria-label="${dayKey} ${time} meeting"
        >${escapeHtml(label)}</textarea>
      </div>
    </td>
  `;
}

function bindLocationControls(week, rootSelector = document) {
  const root = typeof rootSelector === "string" ? document.querySelector(rootSelector) : rootSelector;
  if (!root) return;

  root.querySelectorAll(".location-input").forEach(input => {
    const combo = input.closest(".location-combo");
    const locationMenu = combo.querySelector(".location-menu");

    input.addEventListener("change", event => {
      updateDayLocation(week, event.target.dataset.date, event.target.value.trim());
    });
    input.addEventListener("focus", () => openLocationMenu(locationMenu));
    input.addEventListener("click", event => {
      event.stopPropagation();
      openLocationMenu(locationMenu);
    });
    locationMenu.querySelectorAll(".location-option-pick").forEach(button => {
      button.addEventListener("click", () => {
        updateDayLocation(week, input.dataset.date, button.dataset.value);
      });
    });
    locationMenu.querySelectorAll(".location-option-remove").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        removeLocationOption("day", button.dataset.value);
      });
    });
  });

  root.querySelectorAll(".student-location-input").forEach(input => {
    const combo = input.closest(".location-combo");
    const locationMenu = combo.querySelector(".location-menu");

    input.addEventListener("change", event => {
      const card = input.closest(".student");
      updateStudentLocation(Number(card.dataset.index), event.target.value.trim());
    });
    input.addEventListener("focus", () => openLocationMenu(locationMenu));
    input.addEventListener("click", event => {
      event.stopPropagation();
      openLocationMenu(locationMenu);
    });
    locationMenu.querySelectorAll(".location-option-pick").forEach(button => {
      button.addEventListener("click", () => {
        const card = input.closest(".student");
        updateStudentLocation(Number(card.dataset.index), button.dataset.value);
      });
    });
    locationMenu.querySelectorAll(".location-option-remove").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        removeLocationOption("student", button.dataset.value);
      });
    });
  });
}

function updateDayLocation(week, dayKey, value) {
  week.locations[dayKey] = value;
  addLocationOption("day", value);
  saveState();
  render();
}

function bindScheduleEvents(week) {
  document.querySelectorAll(".slot[data-date]").forEach(cell => {
    cell.addEventListener("mousedown", event => {
      const usesSelectionShortcut = event.ctrlKey || event.metaKey || event.shiftKey;
      if (event.target.classList.contains("slot-input") && !event.target.readOnly && !usesSelectionShortcut) {
        return;
      }

      event.preventDefault();
      isSelecting = !usesSelectionShortcut;

      if (event.shiftKey) {
        selectCellColumn(cell, event.ctrlKey || event.metaKey);
      } else {
        toggleCellSelection(cell, event.ctrlKey || event.metaKey);
      }
      render();
    });

    cell.addEventListener("mouseenter", () => {
      if (!isSelecting) return;
      addCellSelection(cell);
      render();
    });

    cell.addEventListener("dragover", event => {
      event.preventDefault();
      cell.classList.add("drag-over");
    });

    cell.addEventListener("dragleave", () => {
      cell.classList.remove("drag-over");
    });

    cell.addEventListener("drop", event => {
      event.preventDefault();
      cell.classList.remove("drag-over");
      const studentName = event.dataTransfer.getData("text/plain").trim();
      if (!studentName) return;

      const targetInput = cell.querySelector(".slot-input");
      if (!targetInput || targetInput.readOnly) return;

      setSlotValue(week, targetInput.dataset.date, targetInput.dataset.time, studentName);
    });
  });

  bindLocationControls(week, ".schedule-wrap");

  document.querySelectorAll(".slot-input").forEach(input => {
    autoResizeTextarea(input);
    input.addEventListener("focus", () => showStudentAutocomplete(input));
    input.addEventListener("input", event => {
      autoResizeTextarea(input);
      if (event.isComposing) return;
      if (!input.value.trim()) {
        setSlotValue(week, input.dataset.date, input.dataset.time, "");
        return;
      }
      showStudentAutocomplete(input);
    });
    input.addEventListener("change", event => {
      if (event.target.readOnly) {
        return;
      }

      const value = event.target.value.trim();
      setSlotValue(week, event.target.dataset.date, event.target.dataset.time, value);
    });
  });

}

function setSlotValue(week, dayKey, time, value) {
  if (!week.slots[dayKey]) {
    week.slots[dayKey] = {};
  }

  if (value) {
    week.slots[dayKey][time] = value;
  } else {
    delete week.slots[dayKey][time];
  }

  hideStudentAutocomplete();
  saveState();
  render();
}

function showStudentAutocomplete(input) {
  if (input.readOnly) return;

  activeAutocompleteInput = input;
  const matches = matchingStudents(input.value).slice(0, 8);

  if (!matches.length) {
    hideStudentAutocomplete();
    return;
  }

  const rect = input.getBoundingClientRect();
  els.studentAutocomplete.innerHTML = matches.map(student => {
    const status = normalizeStudentStatus(student.status, student.note);
    return `
      <button class="autocomplete-option" type="button" data-name="${escapeHtml(student.name)}">
        <span>${escapeHtml(student.name)}</span>
        <small>${escapeHtml(student.location || "No location")} - ${statusLabel(status)}</small>
      </button>
    `;
  }).join("");

  els.studentAutocomplete.hidden = false;
  els.studentAutocomplete.style.left = `${rect.left + window.scrollX}px`;
  els.studentAutocomplete.style.top = `${rect.bottom + window.scrollY + 4}px`;
  els.studentAutocomplete.style.width = `${Math.max(rect.width, 220)}px`;

  els.studentAutocomplete.querySelectorAll(".autocomplete-option").forEach(option => {
    option.addEventListener("mousedown", event => {
      event.preventDefault();
      if (!activeAutocompleteInput) return;

      const targetWeek = ensureWeek(activeMonday);
      setSlotValue(
        targetWeek,
        activeAutocompleteInput.dataset.date,
        activeAutocompleteInput.dataset.time,
        option.dataset.name
      );
    });
  });
}

function hideStudentAutocomplete() {
  els.studentAutocomplete.hidden = true;
  els.studentAutocomplete.innerHTML = "";
  activeAutocompleteInput = null;
}

function matchingStudents(query) {
  const text = normalize(query);
  const students = state.students.filter(student => student.name);
  if (!text) return students;

  return students.filter(student => {
    return normalize(`${student.name} ${student.location} ${student.status} ${student.note}`).includes(text);
  });
}

function markSelectedClosed() {
  const week = ensureWeek(activeMonday);
  selectedCells.forEach(key => {
    const { dayKey, time } = parseCellKey(key);
    if (!week.slots[dayKey]) {
      week.slots[dayKey] = {};
    }
    week.slots[dayKey][time] = "Not open";
  });
  saveState();
  render();
}

function splitSelected() {
  const week = ensureWeek(activeMonday);
  selectedCells.forEach(key => {
    const { dayKey, time } = parseCellKey(key);
    if (normalize(week.slots[dayKey]?.[time]) === "not open") {
      delete week.slots[dayKey][time];
    }
  });
  saveState();
  render();
}

function toggleCellSelection(cell, keepExisting) {
  const keys = cellKeysFromElement(cell);
  const allSelected = keys.every(key => selectedCells.has(key));

  if (!keepExisting && !allSelected) {
    selectedCells.clear();
  }

  keys.forEach(key => {
    if (allSelected) {
      selectedCells.delete(key);
    } else {
      selectedCells.add(key);
    }
  });
}

function addCellSelection(cell) {
  cellKeysFromElement(cell).forEach(key => selectedCells.add(key));
}

function selectCellColumn(cell, keepExisting) {
  const dayKey = cell.dataset.date;
  const columnKeys = TIME_SLOTS.map(time => makeCellKey(dayKey, time));
  const allSelected = columnKeys.every(key => selectedCells.has(key));

  if (!keepExisting) {
    selectedCells.clear();
  }

  columnKeys.forEach(key => {
    if (keepExisting && allSelected) {
      selectedCells.delete(key);
    } else {
      selectedCells.add(key);
    }
  });
}

function cellKeysFromElement(cell) {
  const dayKey = cell.dataset.date;
  return cellTimesFromElement(cell).map(time => makeCellKey(dayKey, time));
}

function cellTimesFromElement(cell) {
  return (cell.dataset.times || "").split("||").filter(Boolean);
}

function renderSelectionHint() {
  const count = selectedCells.size;
  const shortcutHint = "Ctrl/⌘+click: cell · Shift+click: column";
  els.selectionHint.textContent = count ? `${count} cells selected · ${shortcutHint}` : shortcutHint;
  els.markClosedButton.disabled = count === 0;
  els.splitSelectedButton.disabled = count === 0;
  els.clearSelectionButton.disabled = count === 0;
}

function pruneSelection(dates) {
  const dateKeys = new Set(dates.map(formatDate));
  selectedCells = new Set([...selectedCells].filter(key => {
    const { dayKey } = parseCellKey(key);
    return dateKeys.has(dayKey);
  }));
}

function closedBlockClass(week, dayKey, time) {
  const index = TIME_SLOTS.indexOf(time);
  const previous = index > 0 ? week.slots[dayKey]?.[TIME_SLOTS[index - 1]] : "";
  const next = index < TIME_SLOTS.length - 1 ? week.slots[dayKey]?.[TIME_SLOTS[index + 1]] : "";
  const hasPrevious = normalize(previous) === "not open";
  const hasNext = normalize(next) === "not open";

  if (hasPrevious && hasNext) return "block-middle";
  if (hasPrevious) return "block-end";
  if (hasNext) return "block-start";
  return "block-single";
}

function getClosedRun(week, dayKey, timeIndex) {
  const value = week.slots[dayKey]?.[TIME_SLOTS[timeIndex]];
  if (normalize(value) !== "not open") return null;

  let start = timeIndex;
  let end = timeIndex;

  while (start > 0 && normalize(week.slots[dayKey]?.[TIME_SLOTS[start - 1]]) === "not open") {
    start -= 1;
  }

  while (end < TIME_SLOTS.length - 1 && normalize(week.slots[dayKey]?.[TIME_SLOTS[end + 1]]) === "not open") {
    end += 1;
  }

  return {
    isStart: start === timeIndex,
    length: end - start + 1,
    times: TIME_SLOTS.slice(start, end + 1)
  };
}

function renderStudents(week, dates, query) {
  const filtered = state.students.filter(student => {
    const haystack = normalize(`${student.location} ${student.status} ${student.name} ${student.note}`);
    return !query || haystack.includes(query);
  });

  els.studentCount.textContent = `${filtered.length} / ${state.students.length}`;

  if (!filtered.length) {
    els.studentList.innerHTML = `<div class="empty">No students match this search.</div>`;
    return;
  }

  els.studentList.innerHTML = filtered.map(student => {
    const index = state.students.indexOf(student);
    const status = studentStatus(week, dates, student);
    const active = query && normalize(student.name).includes(query);
    const currentStatus = normalizeStudentStatus(student.status, student.note);
    const currentTurn = isCurrentMeetingStudent(student.name);

    return `
      <article class="student ${active ? "active" : ""} ${currentTurn ? "current-turn" : ""}" data-index="${index}" data-student-name="${escapeHtml(student.name)}">
        <div class="student-fields">
          <div class="student-row">
            <input class="student-name-input" value="${escapeHtml(student.name)}" placeholder="Name" aria-label="Student name">
            <div class="location-combo">
              <input
                class="student-location-input"
                value="${escapeHtml(student.location)}"
                placeholder="Location"
                aria-label="Student location"
              >
              <div class="location-menu" hidden>
                ${locationOptionRows("student")}
              </div>
            </div>
            <select class="student-status-input" aria-label="Student status">
              ${STUDENT_STATUS_OPTIONS.map(option => `
                <option value="${option}" ${option === currentStatus ? "selected" : ""}>${statusLabel(option)}</option>
              `).join("")}
            </select>
          </div>
          <textarea class="student-note-input" placeholder="Note" aria-label="Student note">${escapeHtml(student.note)}</textarea>
          <div class="student-actions">
            <button
              class="take-turn-button"
              type="button"
              aria-pressed="${currentTurn ? "true" : "false"}"
              ${!student.name || currentTurn ? "disabled" : ""}
            >${currentTurn ? "On turn" : "My turn"}</button>
            <button class="delete-student" type="button" aria-label="Remove ${escapeHtml(student.name || "student")}">Remove person</button>
          </div>
        </div>
        <button class="student-drag-handle" type="button" draggable="${student.name ? "true" : "false"}" aria-label="Drag ${escapeHtml(student.name || "student")} to schedule" title="Hold and drag to schedule">Drag</button>
        <span class="student-status ${status.className}">${status.label}</span>
      </article>
    `;
  }).join("");

  bindStudentEvents();
  bindLocationControls(week, ".students-panel");
}

function bindStudentEvents() {
  els.studentList.querySelectorAll(".student").forEach(card => {
    const index = Number(card.dataset.index);
    const nameInput = card.querySelector(".student-name-input");
    const statusInput = card.querySelector(".student-status-input");
    const noteInput = card.querySelector(".student-note-input");
    const takeTurnButton = card.querySelector(".take-turn-button");
    const deleteButton = card.querySelector(".delete-student");
    const dragHandle = card.querySelector(".student-drag-handle");

    nameInput.addEventListener("change", () => updateStudent(index, "name", nameInput.value.trim()));
    statusInput.addEventListener("change", () => updateStudent(index, "status", statusInput.value));
    noteInput.addEventListener("change", () => updateStudent(index, "note", noteInput.value.trim()));
    takeTurnButton.addEventListener("click", () => startCurrentTurn(card.dataset.studentName));
    deleteButton.addEventListener("click", () => removeStudent(index));

    dragHandle.addEventListener("dragstart", event => {
      const studentName = card.dataset.studentName || "";
      if (!studentName) {
        event.preventDefault();
        return;
      }

      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("text/plain", studentName);
      card.classList.add("dragging");
    });

    dragHandle.addEventListener("dragend", () => {
      card.classList.remove("dragging");
    });
  });
}

function updateStudent(index, field, value) {
  const previousName = state.students[index].name;
  state.students[index][field] = value;
  if (field === "name" && isCurrentMeetingStudent(previousName)) {
    state.activeMeetingStudent = value;
  }
  saveState();
  render();
}

function removeStudent(index) {
  const student = state.students[index];
  if (!student) return;

  const targetName = normalize(student.name);
  if (targetName) {
    Object.values(state.weeks || {}).forEach(week => {
      Object.values(week.slots || {}).forEach(daySlots => {
        Object.keys(daySlots || {}).forEach(time => {
          if (normalize(daySlots[time]) === targetName) {
            delete daySlots[time];
          }
        });
      });
    });
  }

  if (isCurrentMeetingStudent(student.name)) {
    state.activeMeetingStudent = "";
  }

  state.students.splice(index, 1);
  saveState();
  render();
}

function startCurrentTurn(name) {
  const student = state.students.find(item => normalize(item.name) === normalize(name));
  if (!student?.name) return;

  state.activeMeetingStudent = student.name;
  saveState();
  render();
}

function endCurrentTurn() {
  if (!state.activeMeetingStudent) return;

  state.activeMeetingStudent = "";
  saveState();
  render();
}

function isCurrentMeetingStudent(name) {
  const activeName = normalize(state.activeMeetingStudent);
  return Boolean(activeName) && normalize(name) === activeName;
}

function updateStudentLocation(index, value) {
  state.students[index].location = value || "Online";
  addLocationOption("student", state.students[index].location);
  saveState();
  render();
}

function addLocationOption(kind, value) {
  const option = value.trim();
  if (!option) return;

  if (kind === "day") {
    state.dayLocationOptions = uniqueValues([...(state.dayLocationOptions || []), option]);
    return;
  }

  state.studentLocationOptions = uniqueValues([...(state.studentLocationOptions || []), option]);
}

function removeLocationOption(kind, value) {
  const option = value.trim();
  if (!option) return;

  if (kind === "day") {
    state.dayLocationOptions = (state.dayLocationOptions || []).filter(item => normalize(item) !== normalize(option));
  } else {
    state.studentLocationOptions = (state.studentLocationOptions || []).filter(item => normalize(item) !== normalize(option));
  }

  saveState();
  render();
}

function locationOptionRows(kind) {
  const options = kind === "day" ? state.dayLocationOptions || [] : state.studentLocationOptions || [];
  if (!options.length) {
    return `<div class="location-option-empty">No saved locations</div>`;
  }

  return options.map(option => `
    <div class="location-option-row">
      <button class="location-option-pick" type="button" data-value="${escapeHtml(option)}">${escapeHtml(option)}</button>
      <button class="location-option-remove" type="button" data-value="${escapeHtml(option)}" aria-label="Remove ${escapeHtml(option)}">x</button>
    </div>
  `).join("");
}

function openLocationMenu(menu) {
  closeLocationMenus(menu);
  menu.hidden = false;
}

function closeLocationMenus(exceptMenu = null) {
  document.querySelectorAll(".location-menu").forEach(menu => {
    if (menu !== exceptMenu) {
      menu.hidden = true;
    }
  });
}

function addStudent() {
  state.students.push({ location: "Online", status: "open", name: "", note: "" });
  addLocationOption("student", "Online");
  saveState();
  els.searchInput.value = "";
  render();
}

function slotStatus(value) {
  const text = normalize(value);
  if (!text) return "";
  if (text === "not open") return "closed";

  const student = state.students.find(item => normalize(item.name) === text);
  if (student && normalizeStudentStatus(student.status, student.note) === "pending") return "pending";
  if (student && normalizeStudentStatus(student.status, student.note) === "skip") return "skip";
  if (student && isOnlineLocation(student.location)) return "online";
  return "meeting";
}

function isOnlineLocation(location) {
  const text = normalize(location);
  return text === "online" || text.includes("\u7dda\u4e0a");
}

function studentStatus(week, dates, student) {
  const status = normalizeStudentStatus(student.status, student.note);
  if (status === "pending") return { label: "Pending", className: "pending" };
  if (status === "skip") return { label: "Skip", className: "skip" };
  if (student.name && isScheduled(week, dates, student.name)) {
    return { label: "Scheduled", className: "scheduled" };
  }
  return { label: "Open", className: "" };
}

function normalizeStudentStatus(status, note = "") {
  const text = normalize(status);
  if (STUDENT_STATUS_OPTIONS.includes(text)) return text;
  if (/pending/i.test(note)) return "pending";
  if (/skip/i.test(note)) return "skip";
  return "open";
}

function statusLabel(status) {
  if (status === "pending") return "Pending";
  if (status === "skip") return "Skip";
  return "Open";
}

function isScheduled(week, dates, name) {
  const target = normalize(name);
  return dates.some(date => {
    const dayKey = formatDate(date);
    return Object.values(week.slots[dayKey] || {}).some(value => normalize(value) === target);
  });
}

function weekDates(monday) {
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

function visibleDates(monday) {
  return weekDates(monday).slice(0, showWeekend ? 7 : 5);
}

function isMobileSchedule() {
  return mobileScheduleQuery.matches;
}

function displayWeekday(date) {
  const day = date.getDay();
  return weekdayNames[day === 0 ? 6 : day - 1];
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/* Current time highlight is kept for later use.
function isToday(date) {
  const today = new Date();
  return formatDate(date) === formatDate(today);
}

function isCurrentTimeSlot(slot) {
  if (formatDate(activeMonday) !== formatDate(getMonday(new Date()))) {
    return false;
  }

  const [start, end] = slot.split("-");
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return currentMinutes >= timeToMinutes(start) && currentMinutes < timeToMinutes(end);
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}
*/

function getMonday(date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = copy.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(copy, offset);
}

function addDays(date, days) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function parseDateInput(value) {
  if (!value) return new Date();
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}`;
}

function makeCellKey(dayKey, time) {
  return `${dayKey}|${time}`;
}

function parseCellKey(key) {
  const [dayKey, time] = key.split("|");
  return { dayKey, time };
}

function uniqueValues(values) {
  const seen = new Set();
  const result = [];
  values.forEach(value => {
    const item = String(value || "").trim();
    const key = normalize(item);
    if (!item || seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
}

function autoResizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

init();
