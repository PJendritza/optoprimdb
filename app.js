import { Grid, html } from "https://cdn.jsdelivr.net/npm/gridjs@6.2.0/dist/gridjs.module.js";

// ---------- load data ----------
const records = await fetch("./records.json").then(r => r.json());

// default sort: Year descending (robust even if year is a string)
records.sort((a, b) => Number(b.year) - Number(a.year));

// add a normalized doi_url field
records.forEach(r => {
  if (r.doi) {
    r.doi_url = r.doi.startsWith("http") ? r.doi : `https://doi.org/${r.doi}`;
  } else {
    r.doi_url = "";
  }
});

const speciesDiv = document.getElementById("species");
const opsinsDiv  = document.getElementById("opsins");
const brainDiv   = document.getElementById("brain_areas");

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

  const data = filteredRecords(); // count based on current filtering

  const counts = {};

  data.forEach(r => {
    (r[field] || []).forEach(v => {
      counts[v] = (counts[v] || 0) + 1;
    });
  });

  Object.keys(counts)
    .sort()
    .forEach(v => {
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selected[field].includes(v);
      cb.onchange = () => toggleFacet(field, v);
      label.append(cb, ` ${v} (${counts[v]})`);
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
    (!selected.species.length || selected.species.some(s => r.species.includes(s))) &&
    (!selected.opsins.length  || selected.opsins.some(o => r.opsins.includes(o))) &&
    (!selected.brain_regions.length || selected.brain_regions.some(b => r.brain_regions.includes(b)))
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
        formatter: (cell, row) => {
          // last column is the hidden doi_url
          const doiUrl = row.cells[row.cells.length - 1].data;

          if (!doiUrl) {
            return html(`<span title="${cell}">${cell}</span>`);
          }

          return html(`
            <a href="${doiUrl}" target="_blank" rel="noopener" title="Open DOI">
              ${cell}
            </a>
          `);
        }
      },

      {
        name: "Authors",
        sort: true,
        formatter: cell => html(`<span title="${cell}">${cell}</span>`)
      },

      { name: "Journal", sort: true },
      { name: "Species", sort: true },
      { name: "Areas", sort: true },
      { name: "Opsins", sort: true },

      // hidden column to carry doiUrl reliably
      { name: "doi_url", hidden: true }
    ],

    data: data.map(r => [
      r.year,
      r.title,
      r.authors.join(", "),
      r.journal,
      r.species.join(", "),
      r.brain_regions.join(", "),
      r.opsins.join(", "),
      r.doi_url
    ]),

    search: true,

    language: {
      search: { placeholder: "Search…" }
    },

    sort: true,

    //pagination: { limit: 15 }
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


// ---------- fetch last update date from GitHub ----------

async function updateLastModified() {
  try {
    const response = await fetch(
      "https://api.github.com/repos/PJendritza/optoprimdb/commits?path=records.json&page=1&per_page=1"
    );

    const data = await response.json();

    if (data.length > 0) {
      const date = new Date(data[0].commit.committer.date);

      const formatted = date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric"
      });

      document.getElementById("last-updated").textContent = formatted;
    }
  } catch (error) {
    console.error("Could not fetch last update date:", error);
  }
}

updateLastModified();
