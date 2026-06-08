"use strict";

// state

const state = {
  data: null,
  currentUnits: {
    temp: "celsius",
    wind: "kmh",
    precip: "mm",
  },
  currentCity: {
    name: "",
    lat: "",
    lon: "",
  },
  currentDay: 0,
};

// ====== DOM ELEMENTS ======

// Header
const unitsTrigger = document.getElementById("units-trigger");
const unitsMenu = document.getElementById("units-menu");
const switchUnitsBtn = document.getElementById("switch-units-btn");
const unitsOptions = document.querySelectorAll(".units-dropdown__option");

// Search
const searchInput = document.getElementById("search-input");
const searchBtn = document.getElementById("search-btn");
const searchSuggestions = document.getElementById("search-suggestions");
const searchInProgress = document.getElementById("search-in-progress");

// App states
const stateNoResults = document.getElementById("state-no-results");
const stateError = document.getElementById("state-error");
const retryBtn = document.getElementById("retry-btn");

// Dashboard
const dashboard = document.getElementById("dashboard");

// Weather card
const weatherCard = document.getElementById("weather-card");
const weatherCardLoading = document.getElementById("weather-card-loading");
const weatherCardContent = document.getElementById("weather-card-content");
const currentCity = document.getElementById("current-city");
const currentDate = document.getElementById("current-date");
const currentIcon = document.getElementById("current-icon");
const currentTemp = document.getElementById("current-temp");

// Metrics
const feelsLike = document.getElementById("feels-like");
const humidity = document.getElementById("humidity");
const wind = document.getElementById("wind");
const precipitation = document.getElementById("precipitation");

// Daily forecast
const dailyForecastList = document.getElementById("daily-forecast-list");

// Hourly forecast
const hourlyForecastList = document.getElementById("hourly-forecast-list");

// Day selector
const daySelectorTrigger = document.getElementById("day-selector-trigger");
const daySelectorMenu = document.getElementById("day-selector-menu");
const selectedDayLabel = document.getElementById("selected-day-label");

// Setting Attributes on element

const toggleElement = function (element, show) {
  if (show) {
    element.removeAttribute("hidden", "");
  } else {
    element.setAttribute("hidden", "");
  }
};

const showDashboard = function () {
  toggleElement(dashboard, true);
  toggleElement(stateError, false);
  toggleElement(stateNoResults, false);
};

const showError = function () {
  toggleElement(stateError, true);
  toggleElement(dashboard, false);
  toggleElement(stateNoResults, false);
  toggleElement(searchInProgress, false);
};

const showNoResult = function () {
  toggleElement(stateNoResults, true);
  toggleElement(stateError, false);
  toggleElement(dashboard, false);
  toggleElement(searchInProgress, false);
};

const showSearchInProgress = function () {
  toggleElement(searchInProgress, true);
  toggleElement(stateNoResults, false);
  toggleElement(stateError, false);
  toggleElement(dashboard, false);
};

const showWeatherCardLoading = function () {
  toggleElement(weatherCardLoading, true);
  toggleElement(weatherCardContent, false);
  toggleElement(stateNoResults, false);
  toggleElement(stateError, false);
};

const showWeatherCardContent = function () {
  toggleElement(weatherCardContent, true);
  toggleElement(weatherCardLoading, false);
  toggleElement(stateNoResults, false);
  toggleElement(stateError, false);
};

// Geocoding function

const getGeoInfo = async function (CITY_NAME) {
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${CITY_NAME}&count=5&language=en&format=json`,
    );

    if (!res.ok) throw new Error();

    const data = await res.json();

    if (!data.results) {
      showNoResult();
      return;
    } else {
      return data.results;
    }
  } catch (error) {
    showError();
  }
};

// Weather fetch function

const getWeatherInfo = async function (lat, lon) {
  try {
    showWeatherCardLoading();

    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&hourly=temperature_2m,weather_code&timezone=auto&wind_speed_unit=ms&forecast_days=7`,
    );

    if (!res.ok) throw new Error();

    const data = await res.json();

    state.data = data;

    console.log(data);
    showDashboard();
    showWeatherCardContent();
  } catch (error) {
    showError();
  }
};

// getWeatherInfo(52.52, 13.419);

// weather code

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
  73: "snow",
  71: "snow",
  75: "snow",
  80: "rain",
  81: "rain",
  82: "rain",
  95: "storm",
  96: "storm",
  99: "storm",
};

/**
 * Helper function to get the weather description safely
 * @param {number} code - The WMO weather code from the API
 * @returns {string} The text description
 */
function getWeatherIcon(code) {
  const iconName = weatherCodeLookup[code];

  if (!iconName) {
    return;
  } else {
    return `./assets/images/icon-${iconName}.webp`;
  }
}

const renderCurrentWeather = function () {
  // ── Location ─────────────────────────────────────────────
  // Set from state.currentCity, populated when user picks a suggestion
  currentCity.textContent = state.currentCity.name;

  // ── Date ─────────────────────────────────────────────────
  // API returns ISO string e.g. "2025-08-05T14:00" — format to readable date
  currentDate.textContent = new Date(
    state.data.current.time,
  ).toLocaleDateString("en-US", {
    weekday: "long", // adds "Tuesday" to match design
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // ── Weather Icon ─────────────────────────────────────────
  // Map WMO weather code to icon filename and description
  const weatherCode = state.data.current.weather_code;
  currentIcon.src = getWeatherIcon(weatherCode);
  currentIcon.alt = weatherCodeLookup[weatherCode];

  // ── Temperature ──────────────────────────────────────────
  // Raw value is always celsius — convert if user prefers fahrenheit
  let tempValue = state.data.current.temperature_2m;
  if (state.currentUnits.temp === "fahrenheit") {
    tempValue = (tempValue * 9) / 5 + 32;
  }
  currentTemp.textContent = Math.round(tempValue) + "°";
};

// Render Metrics

const renderMetrics = function () {
  // ── Feels Like ──────────────────────────────────────────
  // Raw value is always celsius from the API
  let feelsLikeValue = state.data.current.apparent_temperature;
  if (state.currentUnits.temp === "fahrenheit") {
    feelsLikeValue = (feelsLikeValue * 9) / 5 + 32;
  }
  feelsLikeValue = Math.round(feelsLikeValue) + "°";

  // ── Humidity ─────────────────────────────────────────────
  // Already a percentage, no conversion needed
  const humidityValue =
    Math.round(state.data.current.relative_humidity_2m) + "%";

  // ── Wind Speed ───────────────────────────────────────────
  // Raw value is m/s from the API — always convert
  let windValue = state.data.current.wind_speed_10m;
  if (state.currentUnits.wind === "mph") {
    windValue = windValue * 2.237;
  } else {
    // Default: km/h
    windValue = windValue * 3.6;
  }
  windValue = Math.round(windValue) + " " + state.currentUnits.wind;

  // ── Precipitation ────────────────────────────────────────
  // Raw value is mm from the API
  let precipValue = state.data.current.precipitation;
  if (state.currentUnits.precip === "in") {
    precipValue = precipValue / 25.4;
  }
  precipValue =
    Math.round(precipValue * 10) / 10 + " " + state.currentUnits.precip;

  // ── Update DOM ───────────────────────────────────────────
  feelsLike.textContent = feelsLikeValue;
  humidity.textContent = humidityValue;
  wind.textContent = windValue;
  precipitation.textContent = precipValue;
};

const renderDailyForecast = function () {
  let markUp = "";

  state.data.daily.time.forEach((day, index) => {
    // ── Temperature conversion ──────────────────────────────
    // Raw values are always celsius from the API
    let highTemp = state.data.daily.temperature_2m_max[index];
    let lowTemp = state.data.daily.temperature_2m_min[index];

    if (state.currentUnits.temp === "fahrenheit") {
      highTemp = (highTemp * 9) / 5 + 32;
      lowTemp = (lowTemp * 9) / 5 + 32;
    }

    highTemp = Math.round(highTemp) + "°";
    lowTemp = Math.round(lowTemp) + "°";

    // ── Weather icon ────────────────────────────────────────
    const code = state.data.daily.weather_code[index];

    // ── Day name ────────────────────────────────────────────
    // API returns date string e.g. "2025-08-05" — format to short day name
    const dayName = new Date(state.data.daily.time[index]).toLocaleDateString(
      "en-US",
      { weekday: "short" },
    );

    markUp += `
        <li class="daily-card">
          <p class="daily-card__day">${dayName}</p>
          <img class="daily-card__icon" src="${getWeatherIcon(code)}" alt="${weatherCodeLookup[code]}" />
          <p class="daily-card__high"><span class="sr-only">High: </span>${highTemp}</p>
          <p class="daily-card__low"><span class="sr-only">Low: </span>${lowTemp}</p>
        </li>`;
  });

  // ── Update DOM ───────────────────────────────────────────
  // Set once after loop — avoids DOM thrashing
  dailyForecastList.innerHTML = markUp;
};
