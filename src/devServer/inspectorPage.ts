// Served at `GET /` by `startDevServer()` (`src/devServer/server.ts`). A
// single, self-contained HTML document -- inline `<style>`/`<script>` only,
// zero external requests -- so `typetrack dev` still renders a usable UI on
// a machine with no internet access (see BRIEF.md Design decision 5). No
// build step, no framework: hand-written HTML/CSS and vanilla browser JS
// against this same server's already-JSON `/events`, already-SSE
// `/events/stream`, and already-JSON `/schema` endpoints.
export function renderInspectorPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>typetrack event inspector</title>
<style>
  :root { color-scheme: dark light; }
  body {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: #0f172a;
    color: #e2e8f0;
  }
  header {
    position: sticky;
    top: 0;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: #1e293b;
    border-bottom: 1px solid #334155;
  }
  header h1 {
    font-size: 1rem;
    margin: 0;
    font-weight: 600;
  }
  #filter {
    flex: 1;
    max-width: 20rem;
    padding: 0.35rem 0.5rem;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 4px;
    color: inherit;
    font: inherit;
  }
  #schema-link {
    color: #94a3b8;
    font-size: 0.85rem;
    text-decoration: underline;
    cursor: pointer;
  }
  #status {
    font-size: 0.85rem;
    white-space: nowrap;
  }
  #status.live { color: #4ade80; }
  #status.reconnecting { color: #facc15; }
  main {
    padding: 1rem;
    max-width: 60rem;
    margin: 0 auto;
  }
  .event-row {
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.6rem;
    background: #1e293b;
  }
  .event-row.hidden { display: none; }
  .event-row-head {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
  }
  .event-name {
    font-weight: 600;
    font-size: 0.95rem;
  }
  .event-time {
    color: #94a3b8;
    font-size: 0.8rem;
  }
  .badge {
    margin-left: auto;
    font-size: 0.75rem;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    font-weight: 600;
  }
  .badge.valid { background: #166534; color: #bbf7d0; }
  .badge.invalid { background: #7f1d1d; color: #fecaca; }
  .issues {
    margin: 0.4rem 0 0;
    padding-left: 1.1rem;
    color: #fca5a5;
    font-size: 0.82rem;
  }
  details.payload {
    margin-top: 0.4rem;
  }
  details.payload summary {
    cursor: pointer;
    color: #94a3b8;
    font-size: 0.8rem;
  }
  details.payload pre {
    margin: 0.4rem 0 0;
    padding: 0.5rem;
    background: #0f172a;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.8rem;
  }
  #empty {
    color: #94a3b8;
    font-size: 0.9rem;
  }
</style>
</head>
<body>
<header>
  <h1>typetrack event inspector</h1>
  <input id="filter" type="text" placeholder="Filter by event name..." autocomplete="off" />
  <a id="schema-link">schema</a>
  <span id="status" class="reconnecting">○ connecting...</span>
</header>
<main>
  <p id="empty">No events yet.</p>
  <div id="events"></div>
</main>
<script>
(function () {
  "use strict";

  var eventsEl = document.getElementById("events");
  var emptyEl = document.getElementById("empty");
  var filterEl = document.getElementById("filter");
  var statusEl = document.getElementById("status");
  var schemaLinkEl = document.getElementById("schema-link");
  // Link to the dev server's own /schema dump for convenience -- no new
  // endpoint, just a client-side reference to the already-existing route.
  schemaLinkEl.href = "/schema";
  schemaLinkEl.target = "_blank";
  schemaLinkEl.rel = "noopener";

  // Most-recent-first, matching how typetrack dev's own console output
  // reads top-to-bottom-newest already.
  var events = [];

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTime(timestamp) {
    try {
      return new Date(timestamp).toLocaleTimeString();
    } catch (err) {
      return String(timestamp);
    }
  }

  function renderIssues(issues) {
    if (!issues || issues.length === 0) return "";
    var items = issues
      .map(function (issue) {
        var path = issue.path && issue.path.length > 0 ? issue.path.join(".") : "(root)";
        return "<li>" + escapeHtml(path) + ": " + escapeHtml(issue.message) + "</li>";
      })
      .join("");
    return '<ul class="issues">' + items + "</ul>";
  }

  function renderRow(event) {
    var row = document.createElement("div");
    row.className = "event-row";
    row.dataset.name = String(event.event || "").toLowerCase();

    var badgeClass = event.valid ? "valid" : "invalid";
    var badgeText = event.valid ? "valid" : "invalid";
    var payload = JSON.stringify(event.payload, null, 2);

    row.innerHTML =
      '<div class="event-row-head">' +
      '<span class="event-name">' + escapeHtml(event.event) + "</span>" +
      '<span class="event-time">' + escapeHtml(formatTime(event.timestamp)) + "</span>" +
      '<span class="badge ' + badgeClass + '">' + badgeText + "</span>" +
      "</div>" +
      renderIssues(event.issues) +
      '<details class="payload"><summary>payload</summary><pre>' +
      escapeHtml(payload) +
      "</pre></details>";

    return row;
  }

  function applyFilter() {
    var query = filterEl.value.trim().toLowerCase();
    var rows = eventsEl.children;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var matches = query === "" || row.dataset.name.indexOf(query) !== -1;
      row.classList.toggle("hidden", !matches);
    }
  }

  function renderAll() {
    eventsEl.innerHTML = "";
    emptyEl.style.display = events.length === 0 ? "block" : "none";
    for (var i = 0; i < events.length; i++) {
      eventsEl.appendChild(renderRow(events[i]));
    }
    applyFilter();
  }

  function prependEvent(event) {
    events.unshift(event);
    emptyEl.style.display = "none";
    eventsEl.insertBefore(renderRow(event), eventsEl.firstChild);
    applyFilter();
  }

  filterEl.addEventListener("input", applyFilter);

  // Render already-buffered history first (so a page opened after some
  // events have already fired isn't empty), then switch to the live feed.
  fetch("/events")
    .then(function (response) {
      return response.json();
    })
    .then(function (history) {
      events = Array.isArray(history) ? history.slice().reverse() : [];
      renderAll();
    })
    .catch(function () {
      events = [];
      emptyEl.textContent = "No history available.";
      renderAll();
    });

  var source = new EventSource("/events/stream");
  source.onopen = function () {
    statusEl.textContent = "● live";
    statusEl.className = "live";
  };
  source.onerror = function () {
    statusEl.textContent = "○ reconnecting...";
    statusEl.className = "reconnecting";
  };
  source.onmessage = function (message) {
    try {
      var event = JSON.parse(message.data);
      prependEvent(event);
    } catch (err) {
      // Malformed frame -- ignore rather than break the page.
    }
  };
})();
</script>
</body>
</html>`;
}
