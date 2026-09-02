(() => {
  'use strict';

  const STORAGE_KEY = 'altez-objectinfo-presets-v1';
  const DEFAULT_PRESET = {
    id: 'builtin-mark',
    name: 'Merk',
    builtin: true,
    fields: [{ set: 'Tekla Assembly', name: 'Cast Unit Mark', label: 'Merk' }]
  };

  let API = null;
  let selectionRows = [];
  let uniqueMarks = [];
  let activeMarkupIds = [];
  let editingPresetId = null;

  const $ = id => document.getElementById(id);

  function getCustomPresets() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  }
  function saveCustomPresets(presets) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  }
  function allPresets() { return [DEFAULT_PRESET, ...getCustomPresets()]; }
  function selectedPreset() { return allPresets().find(p => p.id === $('presetSelect').value) || DEFAULT_PRESET; }

  function normalize(v) { return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function safeValue(v) {
    if (typeof v === 'bigint') return v.toString();
    if (v === null || v === undefined) return '';
    return String(v);
  }

  function flattenProperties(obj) {
    const out = [];
    for (const ps of (obj.properties || [])) {
      for (const p of (ps.properties || [])) {
        out.push({ set: ps.set || '', name: p.name || '', value: safeValue(p.value), type: p.type });
      }
    }
    return out;
  }

  function findCastUnitMark(obj) {
    const props = flattenProperties(obj);
    const exact = props.find(p => normalize(p.set) === 'tekla assembly' && normalize(p.name) === 'cast unit mark');
    if (exact) return exact.value;
    const fallback = props.find(p => normalize(p.name).replace(/[^a-z0-9]/g,'') === 'castunitmark');
    return fallback?.value || '';
  }

  function fieldValue(obj, field) {
    const props = flattenProperties(obj);
    let hit = props.find(p => normalize(p.set) === normalize(field.set) && normalize(p.name) === normalize(field.name));
    if (!hit) hit = props.find(p => normalize(p.name) === normalize(field.name));
    return hit ? hit.value : '';
  }

  function renderPresets(preferId) {
    const select = $('presetSelect');
    const presets = allPresets();
    const current = preferId || select.value || DEFAULT_PRESET.id;
    select.innerHTML = presets.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
    select.value = presets.some(p => p.id === current) ? current : DEFAULT_PRESET.id;
    renderPresetFields();
  }

  function renderPresetFields() {
    const p = selectedPreset();
    $('presetFields').innerHTML = p.fields.map(f => `<span class="field-chip">${escapeHtml(f.label || f.name)}</span>`).join('');
    $('editPreset').disabled = !!p.builtin;
    $('deletePreset').style.visibility = p.builtin ? 'hidden' : 'visible';
    if (p.builtin) $('presetFields').insertAdjacentHTML('afterend','');
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  async function connect() {
    try {
      if (!window.TrimbleConnectWorkspace || window.parent === window) throw new Error('preview');
      API = await TrimbleConnectWorkspace.connect(window.parent, onWorkspaceEvent, 30000);
      $('connectionBadge').textContent = 'Trimble Connect';
      $('connectionBadge').classList.add('ok');
      await refreshSelection();
    } catch (err) {
      API = null;
      $('connectionBadge').textContent = 'Preview';
      $('connectionBadge').classList.add('demo');
      loadDemo();
    }
  }

  function onWorkspaceEvent(event) {
    if (event === 'viewer.onSelectionChanged') refreshSelection();
  }

  function loadDemo() {
    selectionRows = [
      { modelId:'demo', id:1, object:{ properties:[{set:'Tekla Assembly',properties:[{name:'Cast Unit Mark',value:'K12'},{name:'Assembly/Cast unit weight',value:842}]},{set:'Profile',properties:[{name:'Profile',value:'HEA300'}]}] } },
      { modelId:'demo', id:2, object:{ properties:[{set:'Tekla Assembly',properties:[{name:'Cast Unit Mark',value:'K12'}]}] } },
      { modelId:'demo', id:3, object:{ properties:[{set:'Tekla Assembly',properties:[{name:'Cast Unit Mark',value:'K18'}]}] } }
    ];
    calculateMarks();
  }

  async function refreshSelection() {
    if (!API) return loadDemo();
    setStatus('Selectie inlezen…');
    try {
      const selection = await API.viewer.getSelection();
      const rows = [];
      for (const group of (selection || [])) {
        const ids = group.objectRuntimeIds || [];
        if (!ids.length) continue;
        const objects = await API.viewer.getObjectProperties(group.modelId, ids);
        for (const obj of (objects || [])) rows.push({ modelId: group.modelId, id: obj.id, object: obj });
      }
      selectionRows = rows;
      calculateMarks();
      setStatus(rows.length ? 'Selectie klaar.' : 'Selecteer Tekla-objecten in het model.');
    } catch (e) {
      console.error(e);
      setStatus('Selectie kon niet worden ingelezen.');
    }
  }

  function calculateMarks() {
    const map = new Map();
    for (const row of selectionRows) {
      const mark = findCastUnitMark(row.object);
      if (!mark) continue;
      const key = normalize(mark);
      if (!map.has(key)) map.set(key, { mark, row });
    }
    uniqueMarks = [...map.values()];
    $('selectedCount').textContent = selectionRows.length;
    $('markCount').textContent = uniqueMarks.length;
    $('selectionHint').textContent = uniqueMarks.length
      ? `${uniqueMarks.length} unieke Tekla-merken klaar om te labelen.`
      : 'Geen Cast Unit Mark gevonden in de selectie.';
  }

  function getAvailableFields() {
    const map = new Map();
    for (const row of selectionRows) {
      for (const p of flattenProperties(row.object)) {
        const key = `${p.set}\u0000${p.name}`;
        if (!map.has(key)) map.set(key, { set:p.set, name:p.name, label:p.name });
      }
    }
    return [...map.values()].sort((a,b) => `${a.set} ${a.name}`.localeCompare(`${b.set} ${b.name}`));
  }

  function openPresetDialog(preset) {
    const fields = getAvailableFields();
    editingPresetId = preset?.id || null;
    $('dialogTitle').textContent = preset ? 'Preset aanpassen' : 'Nieuwe preset';
    $('presetName').value = preset?.name || '';
    const selectedKeys = new Set((preset?.fields || []).map(f => `${f.set}\u0000${f.name}`));
    $('availableFields').innerHTML = fields.length ? fields.map((f,i) => {
      const key = `${f.set}\u0000${f.name}`;
      return `<label class="available-field"><input type="checkbox" data-index="${i}" ${selectedKeys.has(key)?'checked':''}><span>${escapeHtml(f.name)}<small>${escapeHtml(f.set || 'Algemeen')}</small></span></label>`;
    }).join('') : '<p class="muted">Selecteer eerst objecten om beschikbare parameters te laden.</p>';
    $('presetDialog').showModal();
  }

  function savePresetFromDialog(ev) {
    ev.preventDefault();
    const name = $('presetName').value.trim();
    if (!name) return;
    const available = getAvailableFields();
    const checked = [...$('availableFields').querySelectorAll('input[type=checkbox]:checked')];
    const fields = checked.map(c => available[Number(c.dataset.index)]).filter(Boolean);
    if (!fields.length) { setStatus('Kies minstens één veld voor de preset.'); return; }
    const presets = getCustomPresets();
    let id = editingPresetId;
    if (id) {
      const idx = presets.findIndex(p => p.id === id);
      if (idx >= 0) presets[idx] = { ...presets[idx], name, fields };
    } else {
      id = `preset-${Date.now()}`;
      presets.push({ id, name, fields });
    }
    saveCustomPresets(presets);
    $('presetDialog').close();
    renderPresets(id);
  }

  function colorToRGBA(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r:(n>>16)&255, g:(n>>8)&255, b:n&255, a:255 };
  }

  async function placeLabels() {
    if (!uniqueMarks.length) return setStatus('Geen merken met Cast Unit Mark gevonden.');
    const preset = selectedPreset();
    const hideEmpty = $('hideEmpty').checked;
    const color = colorToRGBA($('labelColor').value);
    if (!API) {
      setStatus(`Preview: ${uniqueMarks.length} merklabel(s) met preset “${preset.name}”.`);
      return;
    }
    try {
      await clearLabels(false);
      const markups = [];
      for (let i=0;i<uniqueMarks.length;i++) {
        const { mark, row } = uniqueMarks[i];
        const boxes = await API.viewer.getObjectBoundingBoxes(row.modelId, [row.id]);
        const box = boxes?.[0];
        const center = bboxCenter(box, row.object.position);
        const lines = [];
        for (const field of preset.fields) {
          let value = field.name === 'Cast Unit Mark' ? mark : fieldValue(row.object, field);
          if (hideEmpty && !String(value).trim()) continue;
          if (preset.builtin && field.name === 'Cast Unit Mark') lines.push(value || '-');
          else lines.push(`${field.label || field.name}: ${value || '-'}`);
        }
        const offset = labelOffset(center, i);
        markups.push({
          start: { modelId: row.modelId, objectId: row.id, positionX:center.x*1000, positionY:center.y*1000, positionZ:center.z*1000, type:'point' },
          end: { positionX:offset.x*1000, positionY:offset.y*1000, positionZ:offset.z*1000, type:'point' },
          text: lines.join('\n'),
          color
        });
      }
      const added = await API.markup.addTextMarkup(markups);
      activeMarkupIds = (added || []).map(m => m.id).filter(id => id !== undefined && id !== null);
      setStatus(`${activeMarkupIds.length || markups.length} merklabel(s) geplaatst.`);
    } catch (e) {
      console.error(e);
      setStatus('Labels plaatsen is mislukt. Controleer of de geselecteerde objecten geldige Tekla-merken zijn.');
    }
  }

  function bboxCenter(box, fallback) {
    // Workspace API versions expose bounding boxes with slightly different key names.
    const min = box?.min || box?.box?.min || box?.minimum;
    const max = box?.max || box?.box?.max || box?.maximum;
    if (min && max) return { x:(min.x+max.x)/2, y:(min.y+max.y)/2, z:(min.z+max.z)/2 };
    if (fallback) return { x:Number(fallback.x)||0, y:Number(fallback.y)||0, z:Number(fallback.z)||0 };
    return {x:0,y:0,z:0};
  }

  function labelOffset(c, index) {
    const stagger = (index % 5) * .12;
    return { x:c.x + 1.0 + stagger, y:c.y + .35 + stagger, z:c.z + .55 + stagger };
  }

  async function clearLabels(updateStatus=true) {
    if (API && activeMarkupIds.length) {
      try { await API.markup.removeMarkups(activeMarkupIds); }
      catch (e) { console.warn(e); }
    }
    activeMarkupIds = [];
    if (updateStatus) setStatus('Alle door Altez Objectinfo geplaatste labels zijn verwijderd.');
  }

  function setStatus(text) { $('status').textContent = text; }

  $('refreshSelection').addEventListener('click', refreshSelection);
  $('presetSelect').addEventListener('change', renderPresetFields);
  $('newPreset').addEventListener('click', () => openPresetDialog(null));
  $('editPreset').addEventListener('click', () => { const p=selectedPreset(); if(!p.builtin) openPresetDialog(p); });
  $('deletePreset').addEventListener('click', () => {
    const p = selectedPreset(); if (p.builtin) return;
    saveCustomPresets(getCustomPresets().filter(x => x.id !== p.id));
    renderPresets(DEFAULT_PRESET.id);
  });
  $('presetForm').addEventListener('submit', savePresetFromDialog);
  $('placeLabels').addEventListener('click', placeLabels);
  $('clearLabels').addEventListener('click', () => clearLabels(true));

  renderPresets();
  connect();
})();
