"use strict";

// =============================================================================
// WEATHER APP — app.js
// =============================================================================
// Architecture: Single-file vanilla JS app.
// Data flow:
//   1. User searches a city → geocoding API returns location candidates
//   2. User picks a suggestion → weather API fetches forecast data
//   3. Render functions read from `state` and write to the DOM
//
// External APIs used:
//   - Open-Meteo Geocoding  https://geocoding-api.open-meteo.com
//   - Open-Meteo Forecast   https://api.open-meteo.com
//
// Unit system:
//   - Raw API data is always metric (°C, m/s, mm)
//   - Conversions happen at render time — state.data is never mutated
// =============================================================================

// =============================================================================
// STATE
// =============================================================================

/**
 * Central application state.
 * All render functions read from here; never hold display values elsewhere.
 *
 * @type {{
 *   data: Object|null,
 *   currentUnits: { temp: string, wind: string, precip: string },
 *   currentCity: { name: string, lat: string, lon: string },
 *   currentDay: number
 * }}
 */
const state = {
  /** Raw forecast response from the Open-Meteo API, or null if not yet loaded */
  data: null,

  /** Currently selected display units for each measurement */
  currentUnits: {
    temp: "celsius", // "celsius" | "fahrenheit"
    wind: "kmh", // "kmh" | "mph"
    precip: "mm", // "mm" | "in"
  },

  /** The city the user most recently searched and selected */
  currentCity: {
    name: "",
    lat: "",
    lon: "",
  },

  /**
   * Index (0–6) of the day currently shown in the hourly forecast.
   * Corresponds to a position in state.data.daily.time[].
   */
  currentDay: 0,
};

// =============================================================================
// DOM ELEMENTS
// =============================================================================
// Grouped by UI section for easy scanning.
// Queried once at startup — never re-queried inside render/event functions.

// ── Header / Units dropdown ───────────────────────────────────────────────────
const unitsTrigger = document.getElementById("units-trigger");
const unitsMenu = document.getElementById("units-menu");
const switchUnitsBtn = document.getElementById("switch-units-btn");
const unitsOptions = document.querySelectorAll(".units-dropdown__option");
const unitsDropdown = document.getElementById("units-dropdown");

// ── Search ────────────────────────────────────────────────────────────────────
const searchInput = document.getElementById("search-input");
const searchBtn = document.getElementById("search-btn");
const searchSuggestions = document.getElementById("search-suggestions");
const searchInProgress = document.getElementById("search-in-progress");
const searchForm = document.querySelector(".search-section__bar");

// ── App-level UI states ───────────────────────────────────────────────────────
const stateNoResults = document.getElementById("state-no-results");
const stateError = document.getElementById("state-error");
const retryBtn = document.getElementById("retry-btn");

// ── Dashboard wrapper ─────────────────────────────────────────────────────────
const dashboard = document.getElementById("dashboard");

// ── Current weather card ──────────────────────────────────────────────────────
const weatherCard = document.getElementById("weather-card");
const weatherCardLoading = document.getElementById("weather-card-loading");
const weatherCardContent = document.getElementById("weather-card-content");
const currentCity = document.getElementById("current-city");
const currentDate = document.getElementById("current-date");
const currentIcon = document.getElementById("current-icon");
const currentTemp = document.getElementById("current-temp");

// ── Metric tiles ──────────────────────────────────────────────────────────────
const feelsLike = document.getElementById("feels-like");
const humidity = document.getElementById("humidity");
const wind = document.getElementById("wind");
const precipitation = document.getElementById("precipitation");

// ── Forecast lists ────────────────────────────────────────────────────────────
const dailyForecastList = document.getElementById("daily-forecast-list");
const hourlyForecastList = document.getElementById("hourly-forecast-list");

// ── Day selector dropdown ─────────────────────────────────────────────────────
const daySelectorTrigger = document.getElementById("day-selector-trigger");
const daySelectorMenu = document.getElementById("day-selector-menu");
const selectedDayLabel = document.getElementById("selected-day-label");
const daySelector = document.getElementById("day-selector");

// =============================================================================
// WEATHER CODE LOOKUP
// =============================================================================

/**
 * Maps WMO weather interpretation codes to internal icon names.
 * Icon filenames follow the pattern: `./assets/images/icon-{name}.webp`
 *
 * WMO reference: https://open-meteo.com/en/docs#weathervariables
 *
 * @type {Object.<number, string>}
 */
const weatherCodeLookup = {
  0: "sunny",
  1: "partly-cloudy",
  2: "partly-cloudy",
  3: "overcast",
  45: "fog",
  48: "fog",
  51: "drizzle",
  53: "drizzle",
  55: "drizzle",
  61: "rain",
  63: "rain",
  65: "rain",
  71: "snow",
  73: "snow",
  75: "snow",
  80: "rain",
  81: "rain",
  82: "rain",
  95: "storm",
  96: "storm",
  99: "storm",
};

// =============================================================================
// UTILITY HELPERS
// =============================================================================

/**
 * Shows or hides a DOM element using the `hidden` attribute.
 * Preferred over toggling CSS classes so the element is genuinely
 * removed from the accessibility tree when hidden.
 *
 * @param {HTMLElement} element - The element to show or hide.
 * @param {boolean} show - Pass `true` to reveal, `false` to hide.
 */
const toggleElement = function (element, show) {
  if (show) {
    element.removeAttribute("hidden");
  } else {
    element.setAttribute("hidden", "");
  }
};

/**
 * Returns the path to the weather icon image for a given WMO code.
 *
 * @param {number} code - WMO weather interpretation code.
 * @returns {string|undefined} Relative image path, or undefined if code is unmapped.
 */
function getWeatherIcon(code) {
  const iconName = weatherCodeLookup[code];
  if (!iconName) return;
  return `./assets/images/icon-${iconName}.webp`;
}

/**
 * Creates a debounced version of a function.
 * The wrapped function will only execute after `delay` ms of inactivity.
 * Each new call resets the timer.
 *
 * @param {Function} func - The function to debounce.
 * @param {number} [delay=300] - Wait time in milliseconds.
 * @returns {Function} The debounced wrapper function.
 */
const debounce = function (func, delay = 300) {
  let timeoutId;

  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
};

// =============================================================================
// UI STATE TRANSITIONS
// =============================================================================
// One function per named app state.
// Each function is the single source of truth for what is visible in that state.

/** Shows the main dashboard; hides all error/empty states. */
const showDashboard = function () {
  toggleElement(dashboard, true);
  toggleElement(stateError, false);
  toggleElement(stateNoResults, false);
};

/** Shows the generic error state; hides everything else. */
const showError = function () {
  toggleElement(stateError, true);
  toggleElement(dashboard, false);
  toggleElement(stateNoResults, false);
  toggleElement(searchInProgress, false);
};

/** Shows the "no results found" state; hides everything else. */
const showNoResult = function () {
  toggleElement(stateNoResults, true);
  toggleElement(stateError, false);
  toggleElement(dashboard, false);
  toggleElement(searchInProgress, false);
};

/** Shows the loading indicator while a geocoding request is in flight. */
const showSearchInProgress = function () {
  toggleElement(searchInProgress, true);
  toggleElement(stateNoResults, false);
  toggleElement(stateError, false);
  toggleElement(dashboard, false);
};

/** Switches the weather card to its skeleton/loading state. */
const showWeatherCardLoading = function () {
  toggleElement(weatherCardLoading, true);
  toggleElement(weatherCardContent, false);
  toggleElement(stateNoResults, false);
  toggleElement(stateError, false);
};

/** Switches the weather card to its populated content state. */
const showWeatherCardContent = function () {
  toggleElement(weatherCardContent, true);
  toggleElement(weatherCardLoading, false);
  toggleElement(stateNoResults, false);
  toggleElement(stateError, false);
};

// =============================================================================
// API CALLS
// =============================================================================

/**
 * Fetches up to 5 city suggestions from the Open-Meteo Geocoding API.
 * Calls `showNoResult()` when the query returns zero matches.
 * Calls `showError()` on network or HTTP failure.
 *
 * @async
 * @param {string} cityName - Raw user input from the search field.
 * @returns {Promise<Array|undefined>} Array of location result objects, or
 *   undefined if the query yielded no results or a request error occurred.
 */
const getGeoInfo = async function (cityName) {
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${cityName}&count=5&language=en&format=json`,
    );

    if (!res.ok) throw new Error("Geocoding request failed");

    const data = await res.json();

    if (!data.results) {
      showNoResult();
      return;
    }

    return data.results;
  } catch (error) {
    showError();
  }
};

/**
 * Fetches a 7-day weather forecast from the Open-Meteo Forecast API
 * and triggers a full re-render of all dashboard components.
 *
 * Side effects:
 *  - Clears stale forecast markup before the request resolves
 *  - Populates `state.data` and resets `state.currentDay` to 0
 *  - Transitions through loading → content card states on success
 *  - Calls `showError()` on network or HTTP failure
 *
 * @async
 * @param {string|number} lat - Latitude of the selected city.
 * @param {string|number} lon - Longitude of the selected city.
 * @returns {Promise<void>}
 */
const getWeatherInfo = async function (lat, lon) {
  try {
    // Clear stale data from a previous city before the new fetch resolves
    dailyForecastList.innerHTML = "";
    hourlyForecastList.innerHTML = "";
    feelsLike.textContent = "—";
    humidity.textContent = "—";
    wind.textContent = "—";
    precipitation.textContent = "—";

    showDashboard();
    showWeatherCardLoading();

    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
        `&hourly=temperature_2m,weather_code` +
        `&timezone=auto` +
        `&wind_speed_unit=ms` +
        `&forecast_days=7`,
    );

    if (!res.ok) throw new Error("Weather request failed");

    state.data = await res.json();
    state.currentDay = 0;

    showWeatherCardContent();
    renderCurrentWeather();
    renderMetrics();
    renderDailyForecast();
    renderDaySelector();
    renderHourlyForecast();
  } catch (error) {
    showError();
  }
};

// =============================================================================
// RENDER FUNCTIONS
// =============================================================================
// Each function reads from `state` and writes to the DOM.
// Unit conversions happen here — raw API data is never modified.

/**
 * Renders the current-conditions card (city, date, icon, temperature).
 * Reads: state.currentCity, state.data.current, state.currentUnits.temp
 */
const renderCurrentWeather = function () {
  // City name — set when the user selects a suggestion
  currentCity.textContent = state.currentCity.name;

  // Date — API returns ISO-8601 local time e.g. "2025-08-05T14:00"
  currentDate.textContent = new Date(
    state.data.current.time,
  ).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // Weather icon — derived from WMO code
  const weatherCode = state.data.current.weather_code;
  currentIcon.src = getWeatherIcon(weatherCode);
  currentIcon.alt = weatherCodeLookup[weatherCode];

  // Temperature — raw value is always °C; convert if user prefers °F
  let tempValue = state.data.current.temperature_2m;
  if (state.currentUnits.temp === "fahrenheit") {
    tempValue = (tempValue * 9) / 5 + 32;
  }
  currentTemp.textContent = Math.round(tempValue) + "°";
};

/**
 * Renders the four metric tiles: feels like, humidity, wind speed, precipitation.
 * Reads: state.data.current, state.currentUnits
 */
const renderMetrics = function () {
  // ── Feels Like ─────────────────────────────────────────
  // Raw: °C — convert to °F if needed
  let feelsLikeValue = state.data.current.apparent_temperature;
  if (state.currentUnits.temp === "fahrenheit") {
    feelsLikeValue = (feelsLikeValue * 9) / 5 + 32;
  }
  feelsLike.textContent = Math.round(feelsLikeValue) + "°";

  // ── Humidity ───────────────────────────────────────────
  // Already a percentage — no conversion needed
  humidity.textContent =
    Math.round(state.data.current.relative_humidity_2m) + "%";

  // ── Wind Speed ─────────────────────────────────────────
  // Raw: m/s — API is always requested in m/s; convert at display time
  let windValue = state.data.current.wind_speed_10m;
  windValue =
    state.currentUnits.wind === "mph"
      ? windValue * 2.237 // m/s → mph
      : windValue * 3.6; // m/s → km/h (default)
  wind.textContent = Math.round(windValue) + " " + state.currentUnits.wind;

  // ── Precipitation ──────────────────────────────────────
  // Raw: mm — convert to inches if needed
  let precipValue = state.data.current.precipitation;
  if (state.currentUnits.precip === "in") {
    precipValue = precipValue / 25.4;
  }
  precipitation.textContent =
    Math.round(precipValue * 10) / 10 + " " + state.currentUnits.precip;
};

/**
 * Renders the 7-day daily forecast strip.
 * Each card shows: short day name, weather icon, high temp, low temp.
 * Reads: state.data.daily, state.currentUnits.temp
 */
const renderDailyForecast = function () {
  let markUp = "";

  state.data.daily.time.forEach((isoDate, index) => {
    // Temperature — raw: °C; convert if needed
    let highTemp = state.data.daily.temperature_2m_max[index];
    let lowTemp = state.data.daily.temperature_2m_min[index];

    if (state.currentUnits.temp === "fahrenheit") {
      highTemp = (highTemp * 9) / 5 + 32;
      lowTemp = (lowTemp * 9) / 5 + 32;
    }

    highTemp = Math.round(highTemp) + "°";
    lowTemp = Math.round(lowTemp) + "°";

    const code = state.data.daily.weather_code[index];
    // API date string e.g. "2025-08-05" → short day name e.g. "Tue"
    const dayName = new Date(isoDate).toLocaleDateString("en-US", {
      weekday: "short",
    });

    markUp += `
      <li class="daily-card">
        <p class="daily-card__day">${dayName}</p>
        <img class="daily-card__icon" src="${getWeatherIcon(code)}" alt="${weatherCodeLookup[code]}" />
        <p class="daily-card__high"><span class="sr-only">High: </span>${highTemp}</p>
        <p class="daily-card__low"><span class="sr-only">Low: </span>${lowTemp}</p>
      </li>`;
  });

  // Single assignment after the loop — avoids repeated DOM reflows
  dailyForecastList.innerHTML = markUp;
};

/**
 * Renders a 9-hour window of hourly forecast for the selected day.
 * The window starts at hour 0 of the selected day (midnight local time).
 *
 * Note: The API returns 7 × 24 = 168 hourly slots. Each day's data lives
 * at indices [dayIndex * 9 … dayIndex * 9 + 8] in the current implementation.
 *
 * Reads: state.data.hourly, state.currentDay, state.currentUnits.temp
 */
const renderHourlyForecast = function () {
  const startIndex = state.currentDay * 9;
  const endIndex = startIndex + 9;

  const hourlyTimes = state.data.hourly.time.slice(startIndex, endIndex);
  const hourlyTemps = state.data.hourly.temperature_2m.slice(
    startIndex,
    endIndex,
  );
  const hourlyCodes = state.data.hourly.weather_code.slice(
    startIndex,
    endIndex,
  );

  let markUp = "";

  for (let i = 0; i < 9; i++) {
    // Format ISO time string e.g. "2025-08-05T15:00" → "3 PM"
    const formattedTime = new Date(hourlyTimes[i]).toLocaleTimeString("en-US", {
      hour: "numeric",
      hour12: true,
    });

    // Temperature — raw: °C; convert if needed
    let tempValue = hourlyTemps[i];
    if (state.currentUnits.temp === "fahrenheit") {
      tempValue = (tempValue * 9) / 5 + 32;
    }

    markUp += `
      <li class="hourly-item">
        <img class="hourly-item__icon"
          src="${getWeatherIcon(hourlyCodes[i])}"
          alt="${weatherCodeLookup[hourlyCodes[i]]}" />
        <span class="hourly-item__time">${formattedTime}</span>
        <span class="hourly-item__temp">${Math.round(tempValue)}°</span>
      </li>`;
  }

  // Single assignment after the loop — avoids repeated DOM reflows
  hourlyForecastList.innerHTML = markUp;
};

/**
 * Renders the day-selector dropdown options and syncs the trigger label.
 * Each `<li>` carries data-index and data-date attributes for event delegation.
 * Reads: state.data.daily.time, state.currentDay
 */
const renderDaySelector = function () {
  let menuHtml = "";

  state.data.daily.time.forEach((isoDateString, index) => {
    const weekdayName = new Date(isoDateString).toLocaleDateString("en-US", {
      weekday: "long",
    });

    menuHtml += `
      <li role="option" data-date="${isoDateString}" data-index="${index}">
        ${weekdayName}
      </li>`;

    // Keep the trigger label in sync with the active day
    if (index === state.currentDay) {
      selectedDayLabel.textContent = weekdayName;
    }
  });

  daySelectorMenu.innerHTML = menuHtml;
};

/**
 * Renders search suggestion `<li>` items returned by the geocoding API.
 * Each item carries lat/lon/name as data attributes for event delegation.
 *
 * @param {Array<{name: string, country: string, latitude: number, longitude: number}>} results
 *   Location objects from the Open-Meteo Geocoding API.
 */
const renderSearchSuggestions = function (results) {
  let markUp = "";

  results.forEach((location) => {
    markUp += `
      <li
        role="option"
        data-lat="${location.latitude}"
        data-lon="${location.longitude}"
        data-name="${location.name}, ${location.country}"
        tabindex="0"
      >
        ${location.name}, ${location.country}
      </li>`;
  });

  searchSuggestions.innerHTML = markUp;
  toggleElement(searchSuggestions, true);
};

// =============================================================================
// UNIT UI HELPER
// =============================================================================

/**
 * Syncs the `is-selected` class and `aria-checked` attribute for all buttons
 * in a given unit group to match the currently active value.
 *
 * Called after any unit change — whether from an individual option click
 * or the bulk "Switch to Imperial/Metric" button.
 *
 * @param {string} unitGroup  - The `data-unit` group name e.g. "temp", "wind", "precip".
 * @param {string} activeValue - The value to mark as selected e.g. "celsius", "mph".
 */
function updateUnitGroupUI(unitGroup, activeValue) {
  const groupOptions = document.querySelectorAll(
    `.units-dropdown__option[data-unit="${unitGroup}"]`,
  );

  groupOptions.forEach((option) => {
    const isActive = option.dataset.value === activeValue;
    option.classList.toggle("is-selected", isActive);
    option.setAttribute("aria-checked", isActive);
  });
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================

// ── Search form submit ────────────────────────────────────────────────────────
// Handles explicit form submission (Enter key or search button click).

searchForm.addEventListener("submit", async function (e) {
  e.preventDefault();

  const inputValue = searchInput.value.trim();
  if (inputValue === "") return;

  showSearchInProgress();

  const results = await getGeoInfo(inputValue);

  toggleElement(searchInProgress, false);

  if (!results) return;

  renderSearchSuggestions(results);
});

// ── Search input (debounced) — live suggestions ───────────────────────────────
// Fires suggestions as the user types; waits 300 ms after last keystroke.

searchInput.addEventListener(
  "input",
  debounce(async function () {
    const inputValue = searchInput.value;

    if (inputValue === "") {
      toggleElement(searchSuggestions, false);
      return;
    }

    const results = await getGeoInfo(inputValue);
    if (!results) return;

    renderSearchSuggestions(results);
  }, 300),
);

// ── Search suggestions — mouse click ─────────────────────────────────────────
// Uses event delegation: one listener handles all suggestion <li> clicks.

searchSuggestions.addEventListener("click", function (event) {
  const clickedLi = event.target.closest("li");
  if (!clickedLi) return;

  state.currentCity.name = clickedLi.dataset.name;
  state.currentCity.lat = clickedLi.dataset.lat;
  state.currentCity.lon = clickedLi.dataset.lon;

  toggleElement(searchSuggestions, false);
  searchInput.value = "";

  getWeatherInfo(state.currentCity.lat, state.currentCity.lon);
});

// ── Search suggestions — keyboard (Enter) ────────────────────────────────────
// Allows keyboard users to confirm a focused suggestion with Enter.

searchSuggestions.addEventListener("keydown", function (e) {
  if (e.key !== "Enter") return;

  const activeElement = document.activeElement;
  if (activeElement.tagName !== "LI") return;

  state.currentCity.name = activeElement.dataset.name;
  state.currentCity.lat = activeElement.dataset.lat;
  state.currentCity.lon = activeElement.dataset.lon;

  toggleElement(searchSuggestions, false);
  searchInput.value = "";

  getWeatherInfo(state.currentCity.lat, state.currentCity.lon);
});

// ── Units trigger — toggle dropdown open/closed ───────────────────────────────

unitsTrigger.addEventListener("click", function () {
  const isExpanded = unitsTrigger.getAttribute("aria-expanded") === "true";
  unitsTrigger.setAttribute("aria-expanded", !isExpanded);
  toggleElement(unitsMenu, !isExpanded);
});

// ── Units menu — select individual unit option ────────────────────────────────
// Event delegation: one listener handles all option button clicks.

unitsMenu.addEventListener("click", function (e) {
  const clickedOption = e.target.closest(".units-dropdown__option");
  if (!clickedOption) return;

  const { value: dataValue, unit: dataUnit } = clickedOption.dataset;

  // Update state — raw API data stays metric, only display changes
  state.currentUnits[dataUnit] = dataValue;
  updateUnitGroupUI(dataUnit, dataValue);

  // Re-render only if data has already been loaded
  if (!state.data) return;
  renderCurrentWeather();
  renderMetrics();
  renderDailyForecast();
  renderHourlyForecast();
});

// ── Switch Units button — bulk toggle between metric and imperial ─────────────

switchUnitsBtn.addEventListener("click", function () {
  const switchingToImperial =
    switchUnitsBtn.textContent.trim() === "Switch to Imperial";

  if (switchingToImperial) {
    state.currentUnits = { temp: "fahrenheit", wind: "mph", precip: "in" };
    switchUnitsBtn.textContent = "Switch to Metric";
  } else {
    state.currentUnits = { temp: "celsius", wind: "kmh", precip: "mm" };
    switchUnitsBtn.textContent = "Switch to Imperial";
  }

  // Sync all three groups in the dropdown
  updateUnitGroupUI("temp", state.currentUnits.temp);
  updateUnitGroupUI("wind", state.currentUnits.wind);
  updateUnitGroupUI("precip", state.currentUnits.precip);

  // Re-render only if data has already been loaded
  if (!state.data) return;
  renderCurrentWeather();
  renderMetrics();
  renderDailyForecast();
  renderHourlyForecast();
});

// ── Day selector trigger — toggle dropdown open/closed ───────────────────────

daySelectorTrigger.addEventListener("click", function () {
  const isExpanded =
    daySelectorTrigger.getAttribute("aria-expanded") === "true";
  daySelectorTrigger.setAttribute("aria-expanded", !isExpanded);
  toggleElement(daySelectorMenu, !isExpanded);
});

// ── Day selector menu — switch active forecast day ────────────────────────────
// Event delegation: one listener handles all day <li> clicks.

daySelectorMenu.addEventListener("click", function (e) {
  const clickedDay = e.target.closest("li");
  if (!clickedDay) return;

  state.currentDay = Number(clickedDay.dataset.index);
  selectedDayLabel.textContent = clickedDay.textContent.trim();

  // Close dropdown and reset ARIA state
  toggleElement(daySelectorMenu, false);
  daySelectorTrigger.setAttribute("aria-expanded", "false");

  renderHourlyForecast();
});

// ── Retry button — re-fetch weather for the last searched city ────────────────

retryBtn.addEventListener("click", async function () {
  if (state.currentCity.lat === "") return;
  await getWeatherInfo(state.currentCity.lat, state.currentCity.lon);
});

// ── Document click — close any open dropdown when clicking outside ────────────

document.addEventListener("click", function (e) {
  // Units dropdown
  if (
    unitsTrigger.getAttribute("aria-expanded") === "true" &&
    !unitsDropdown.contains(e.target)
  ) {
    unitsTrigger.setAttribute("aria-expanded", "false");
    toggleElement(unitsMenu, false);
  }

  // Day selector dropdown
  if (
    daySelectorTrigger.getAttribute("aria-expanded") === "true" &&
    !daySelector.contains(e.target)
  ) {
    daySelectorTrigger.setAttribute("aria-expanded", "false");
    toggleElement(daySelectorMenu, false);
  }

  // Search suggestions
  if (
    !searchSuggestions.hasAttribute("hidden") &&
    !searchForm.contains(e.target)
  ) {
    toggleElement(searchSuggestions, false);
  }
});

// ── Escape key — close all open dropdowns and suggestions ─────────────────────

document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") return;

  unitsTrigger.setAttribute("aria-expanded", "false");
  toggleElement(unitsMenu, false);

  daySelectorTrigger.setAttribute("aria-expanded", "false");
  toggleElement(daySelectorMenu, false);

  toggleElement(searchSuggestions, false);
});
