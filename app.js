import { Grid } from "https://cdn.jsdelivr.net/npm/gridjs@6.2.0/dist/gridjs.module.js";

const records = await fetch("./records.json").then(r => r.json());

const speciesDiv = document.getElementById("species");
const opsinsDiv  = document.getElementById("opsins");
const brainDiv   = document.getElementById("brain_areas");
const searchInput = document.getElementById("search");

let selected = {
  species: [],
  opsins: [],
  brain_regions: []
};

let grid;

// ---------- helpers ----------

function uniqueValues(field) {
  return [...new Set(records.flatMap(r => r[field] || []))].sort();
}

// ---------- facets ----------

function renderFacet(container, field) {
  container.innerHTML = "";
  uniqueValues(field).forEach(v => {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.onchange = () => toggleFacet(field, v);
    label.append(cb, ` ${v}`);
    container.appendChild(label);
  });
}

function toggleFacet(field, value) {
  const arr = selected[field];
  const i = arr.indexOf(value);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(value);
  updateGrid();
}

// ---------- filtering ----------

function filteredRecords() {
  return records.filter(r =>
    (!selected.species.length ||
      selected.species.some(s => r.species.includes(s))) &&
    (!selected.opsins.length ||
      selected.opsins.some(o => r.opsins.includes(o))) &&
    (!selected.brain_regions.length ||
      selected.brain_regions.some(b => r.brain_regions.includes(b)))
  );
}

// ---------- grid ----------

function makeGrid(data) {
  return new Grid({
    columns: [
      { name: "Year", sort: true },
      {
        name: "Title",
        sort: true,
        formatter: cell =>
          `<span title="${cell}">${cell}</span>`
      },
      {
        name: "Authors",
        sort: true,
        formatter: cell =>
          `<span title="${cell}">${cell}</span>`
      },
      { name: "Journal", sort: true },
      { name: "Species", sort: true },
      { name: "Opsins", sort: true }
    ],
    data: data.map(r => [
      r.year,
      r.title,
      r.authors.join(", "),
      r.journal,
      r.species.join(", "),
      r.opsins.join(", ")
    ]),
    search: true,
    sort: true,
    pagination: {
      limit: 15
    }
  });
}

function updateGrid() {
  const data = filteredRecords();
  if (grid) grid.destroy();
  grid = makeGrid(data);
  grid.render(document.getElementById("grid"));
}

// ---------- init ----------

renderFacet(speciesDiv, "species");
renderFacet(opsinsDiv, "opsins");
renderFacet(brainDiv, "brain_regions");

updateGrid();
