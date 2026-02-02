import itemsjs from './itemsjs.module.js';

const records = await fetch('./records.json').then(r => r.json());

// normalize authors for sorting/search
records.forEach(r => {
  r.authors_str = r.authors.join(', ');
  r.species_str = r.species.join(', ');
  r.opsins_str  = r.opsins.join(', ');
});

const engine = itemsjs(records, {
  searchableFields: ['title', 'journal', 'authors_str'],
  aggregations: {
    species: { title: 'Species' },
    opsins: { title: 'Opsins' },
    brain_areas: { title: 'Brain areas' }
  },
  sortings: {
    year_asc:        { field: 'year', order: 'asc' },
    year_desc:       { field: 'year', order: 'desc' },
    title_asc:       { field: 'title', order: 'asc' },
    title_desc:      { field: 'title', order: 'desc' },
    authors_asc:     { field: 'authors_str', order: 'asc' },
    authors_desc:    { field: 'authors_str', order: 'desc' },
    journal_asc:     { field: 'journal', order: 'asc' },
    journal_desc:    { field: 'journal', order: 'desc' },
    species_asc:     { field: 'species_str', order: 'asc' },
    species_desc:    { field: 'species_str', order: 'desc' },
    opsins_asc:      { field: 'opsins_str', order: 'asc' },
    opsins_desc:     { field: 'opsins_str', order: 'desc' }
  }
});

const speciesDiv = document.getElementById('species');
const opsinsDiv  = document.getElementById('opsins');
const brainDiv   = document.getElementById('brain_areas');
const resultsTbody = document.getElementById('results');
const searchInput = document.getElementById('search');

const headers = {
  year:    document.querySelector('th.year'),
  title:   document.querySelector('th:nth-child(2)'),
  authors: document.querySelector('th.authors'),
  journal: document.querySelector('th.journal'),
  species: document.querySelector('th:nth-child(5)'),
  opsins:  document.querySelector('th:nth-child(6)')
};

const headerText = {
  year: 'Year',
  title: 'Title',
  authors: 'Authors',
  journal: 'Journal',
  species: 'Species',
  opsins: 'Opsins'
};

let selected = {
  species: [],
  opsins: [],
  brain_areas: []
};

let sortField = 'year';
let sortDir   = 'desc';

searchInput.oninput = runSearch;

function sortKey() {
  return `${sortField}_${sortDir}`;
}

function updateSortIndicators() {
  Object.keys(headers).forEach(f => {
    headers[f].textContent = headerText[f];
    if (f === sortField) {
      headers[f].textContent += sortDir === 'asc' ? ' ▲' : ' ▼';
    }
  });
}

function toggleSort(field) {
  if (sortField === field) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortField = field;
    sortDir = 'asc';
  }
  updateSortIndicators();
  runSearch();
}

Object.keys(headers).forEach(f => {
  headers[f].onclick = () => toggleSort(f);
});

function renderFacets(aggs) {
  speciesDiv.innerHTML = '';
  opsinsDiv.innerHTML  = '';
  brainDiv.innerHTML   = '';

  aggs.species.buckets.forEach(b => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.species.includes(b.key);
    cb.onchange = () => toggleFacet('species', b.key);
    label.append(cb, ` ${b.key} (${b.doc_count})`);
    speciesDiv.appendChild(label);
  });

  aggs.opsins.buckets.forEach(b => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.opsins.includes(b.key);
    cb.onchange = () => toggleFacet('opsins', b.key);
    label.append(cb, ` ${b.key} (${b.doc_count})`);
    opsinsDiv.appendChild(label);
  });

  aggs.brain_areas.buckets.forEach(b => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.brain_areas.includes(b.key);
    cb.onchange = () => toggleFacet('brain_areas', b.key);
    label.append(cb, ` ${b.key} (${b.doc_count})`);
    brainDiv.appendChild(label);
  });
}

function toggleFacet(facet, value) {
  const arr = selected[facet];
  const i = arr.indexOf(value);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(value);
  runSearch();
}

function renderTable(items) {
  resultsTbody.innerHTML = '';

  items.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="year">${r.year}</td>
      <td>${r.title}</td>
      <td class="authors">${r.authors.join(', ')}</td>
      <td class="journal">${r.journal}</td>
      <td>${r.species.join(', ')}</td>
      <td>${r.opsins.join(', ')}</td>
    `;
    resultsTbody.appendChild(tr);
  });
}

function runSearch() {
  const sort = sortKey();
  const query = searchInput.value.trim();

  let params = { sort };

  if (query.length) params.query = query;

  if (
    selected.species.length ||
    selected.opsins.length ||
    selected.brain_areas.length
  ) {
    params.filters = {
      species: selected.species,
      opsins: selected.opsins,
      brain_areas: selected.brain_areas
    };
  } else {
    params.is_all_filtered_items = true;
  }

  const result = engine.search(params);
  renderFacets(result.data.aggregations);
  renderTable(result.data.items);
}

updateSortIndicators();
runSearch();
