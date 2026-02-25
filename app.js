const byId = (id) => document.getElementById(id);

let records = [];
let sortKey = "row";
let sortAsc = true;
let activeJobId = null;

const tbody = byId("records-table").querySelector("tbody");

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function selectedSearch() {
  return byId("active-search").value;
}

function parseSelectedRows() {
  const manual = byId("selected-rows").value.trim();
  const fromInput = manual
    ? manual.split(",").map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0)
    : [];
  const checked = [...document.querySelectorAll(".row-select:checked")].map((x) => Number(x.dataset.row));
  return [...new Set([...fromInput, ...checked])].sort((a, b) => a - b);
}

function updateProgress(job) {
  if (!job) {
    byId("progress-text").textContent = "Idle";
    byId("progress").value = 0;
    return;
  }
  const total = job.total || 0;
  const done = job.done || 0;
  const pct = total ? (done / total) * 100 : 0;
  byId("progress").value = pct;
  byId("progress-text").textContent = `${job.type}: ${job.status} — ${job.message || ""} (${done}/${total})`;
}

async function refreshSearchList() {
  const list = await api("/api/searches");
  const sel = byId("active-search");
  const current = sel.value;
  sel.innerHTML = "";
  list.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.name;
    opt.textContent = `${s.name} — ${s.query}`;
    sel.appendChild(opt);
  });
  if (current && [...sel.options].some((o) => o.value === current)) {
    sel.value = current;
  }
}

function renderTable() {
  const sorted = [...records].sort((a, b) => {
    const iA = a.__row;
    const iB = b.__row;
    if (sortKey === "row") return sortAsc ? iA - iB : iB - iA;

    const vA = a[sortKey];
    const vB = b[sortKey];
    const nA = Number(vA);
    const nB = Number(vB);
    let cmp = 0;
    if (!Number.isNaN(nA) && !Number.isNaN(nB)) cmp = nA - nB;
    else cmp = String(vA ?? "").localeCompare(String(vB ?? ""));
    return sortAsc ? cmp : -cmp;
  });

  tbody.innerHTML = "";
  sorted.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.__row}</td>
      <td><input type="checkbox" class="row-select" data-row="${r.__row}"></td>
      <td>${r.title || ""}</td>
      <td>${r.abstract_fetched ? "yes" : "no"}</td>
      <td>${r.processed ? "done" : "pending"}</td>
      <td>${r.include === null ? "" : String(r.include)}</td>
      <td>${r.confidence ?? ""}</td>
      <td>${(r.species || []).join(", ")}</td>
      <td>${r.direct_quotes || ""}</td>
      <td>${r.processed ? "true" : "false"}</td>
      <td><button class="rerun" data-row="${r.__row}">Re-run</button></td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll(".rerun").forEach((btn) => {
    btn.onclick = () => runJob(`/api/searches/${selectedSearch()}/rerun/${btn.dataset.row}`, { method: "POST" });
  });
}

async function refreshRecords() {
  const name = selectedSearch();
  if (!name) return;
  const data = await api(`/api/searches/${name}/records`);
  records = data.records.map((r, idx) => ({ ...r, __row: idx + 1 }));
  byId("s-total").textContent = data.counts.total;
  byId("s-abstract").textContent = data.counts.abstract_fetched;
  byId("s-processed").textContent = data.counts.processed;
  renderTable();
}

async function pollJob() {
  if (!activeJobId) return;
  const job = await api(`/api/jobs/${activeJobId}`);
  updateProgress(job);
  if (["completed", "failed", "stopped"].includes(job.status)) {
    activeJobId = null;
    await refreshRecords();
    return;
  }
  setTimeout(pollJob, 1000);
}

async function runJob(path, opts) {
  const out = await api(path, opts);
  activeJobId = out.job_id;
  pollJob();
}

byId("create-search").onclick = async () => {
  await api("/api/searches", {
    method: "POST",
    body: JSON.stringify({
      name: byId("search-name").value,
      query: byId("search-query").value,
      email: byId("search-email").value,
    }),
  });
  await refreshSearchList();
};

byId("btn-search").onclick = () => runJob(`/api/searches/${selectedSearch()}/search_pubmed`, { method: "POST" });
byId("btn-fetch").onclick = () => runJob(`/api/searches/${selectedSearch()}/fetch_abstracts`, { method: "POST" });
byId("btn-run-all").onclick = () =>
  runJob(`/api/searches/${selectedSearch()}/run_sciscreen`, {
    method: "POST",
    body: JSON.stringify({ mode: "all", selected_rows: [] }),
  });

byId("btn-run-selected").onclick = () =>
  runJob(`/api/searches/${selectedSearch()}/run_sciscreen`, {
    method: "POST",
    body: JSON.stringify({ mode: "selected", selected_rows: parseSelectedRows() }),
  });

byId("btn-stop").onclick = async () => {
  if (!activeJobId) return;
  await api(`/api/jobs/${activeJobId}/stop`, { method: "POST" });
};

byId("refresh").onclick = refreshRecords;
byId("active-search").onchange = refreshRecords;

document.querySelectorAll("#records-table th[data-sort]").forEach((th) => {
  th.onclick = () => {
    const key = th.dataset.sort;
    if (sortKey === key) sortAsc = !sortAsc;
    else {
      sortKey = key;
      sortAsc = true;
    }
    renderTable();
  };
});

await refreshSearchList();
await refreshRecords();
