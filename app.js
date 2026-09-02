(() => {
  'use strict';

  const STORAGE_KEY = 'altez-objectinfo-presets-v2';
  const DEFAULT_OVERRIDE_KEY = 'altez-objectinfo-default-preset-v2';
  const COLOR_KEY = 'altez-objectinfo-color-v2';
  const BASE_DEFAULT_PRESET = {
    id: 'builtin-mark',
    name: 'Merk',
    builtin: true,
    fields: [{ set: 'Tekla Assembly', name: 'Cast Unit Mark', label: 'Merk' }]
  };

  // Trimble Connect-style fixed palette: no browser color picker, just preset swatches.
  const TRIMBLE_COLORS = [
    '#f44336','#ff7043','#ff9800','#ffc107','#ffeb3b','#cddc39','#8bc34a',
    '#4caf50','#26a69a','#00bcd4','#29b6f6','#2196f3','#3f51b5','#5c6bc0',
    '#7e57c2','#9c27b0','#ec407a','#e91e63','#d32f2f','#e64a19','#f57c00',
    '#f9a825','#afb42b','#689f38','#388e3c','#00897b','#0097a7','#0288d1',
    '#1976d2','#303f9f','#512da8','#7b1fa2','#c2185b','#795548','#8d6e63',
    '#607d8b','#78909c','#9e9e9e','#bdbdbd','#616161','#424242','#212121'
  ];

  let API = null;
  let selectionRows = [];
  let uniqueMarks = [];
  let activeMarkupIds = [];
  let editingPresetId = null;
  let dialogFields = [];
  let selectedColor = localStorage.getItem(COLOR_KEY) || '#f44336';

  const $ = id => document.getElementById(id);

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function normalize(v) { return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function safeValue(v) {
    if (typeof v === 'bigint') return v.toString();
    if (v === null || v === undefined) return '';
    return String(v);
  }
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function getDefaultPreset() {
    try {
      const saved = JSON.parse(localStorage.getItem(DEFAULT_OVERRIDE_KEY) || 'null');
      if (saved?.fields?.length) return { ...BASE_DEFAULT_PRESET, ...saved, id:'builtin-mark', builtin:true, name:'Merk' };
    } catch {}
    return clone(BASE_DEFAULT_PRESET);
  }
  function saveDefaultPreset(preset) {
    localStorage.setItem(DEFAULT_OVERRIDE_KEY, JSON.stringify({ name:'Merk', fields:preset.fields }));
  }
  function getCustomPresets() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  }
  function saveCustomPresets(presets) { localStorage.setItem(STORAGE_KEY, JSON.stringify(presets)); }
  function allPresets() { return [getDefaultPreset(), ...getCustomPresets()]; }
  function selectedPreset() { return allPresets().find(p => p.id === $('presetSelect').value) || getDefaultPreset(); }

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
    const current = preferId || select.value || 'builtin-mark';
    select.innerHTML = presets.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
    select.value = presets.some(p => p.id === current) ? current : 'builtin-mark';
    renderPresetFields();
  }
  function renderPresetFields() {
    const p = selectedPreset();
    $('presetFields').innerHTML = p.fields.map(f => `<span class="field-chip"><b>${escapeHtml(f.label || f.name)}</b><small>${escapeHtml(f.set)} → ${escapeHtml(f.name)}</small></span>`).join('');
    $('editPreset').disabled = false;
    $('deletePreset').style.visibility = p.builtin ? 'hidden' : 'visible';
  }

  async function connect() {
    try {
      if (!window.TrimbleConnectWorkspace || window.parent === window) throw new Error('preview');
      API = await TrimbleConnectWorkspace.connect(window.parent, onWorkspaceEvent, 30000);
      $('connectionBadge').textContent = 'Trimble Connect';
      $('connectionBadge').classList.add('ok');
      await refreshSelection();
    } catch {
      API = null;
      $('connectionBadge').textContent = 'Preview';
      $('connectionBadge').classList.add('demo');
      loadDemo();
    }
  }
  function onWorkspaceEvent(event) { if (event === 'viewer.onSelectionChanged') refreshSelection(); }
  function loadDemo() {
    selectionRows = [
      { modelId:'demo', id:1, object:{ properties:[{set:'Tekla Assembly',properties:[{name:'Cast Unit Mark',value:'K12'},{name:'Assembly/Cast unit weight',value:842}]},{set:'Profile',properties:[{name:'Profile',value:'HEA300'}]},{set:'Tekla Common',properties:[{name:'Finish',value:'RAL9005'}]}] } },
      { modelId:'demo', id:2, object:{ properties:[{set:'Tekla Assembly',properties:[{name:'Cast Unit Mark',value:'K12'}]}] } },
      { modelId:'demo', id:3, object:{ properties:[{set:'Tekla Assembly',properties:[{name:'Cast Unit Mark',value:'K18'},{name:'Assembly/Cast unit weight',value:631}]},{set:'Profile',properties:[{name:'Profile',value:'HEA240'}]}] } }
    ];
    calculateSelectionInfo();
  }
  async function refreshSelection() {
    if (!API) return loadDemo();
    setStatus('Geselecteerde elementen en parameters inlezen…');
    try {
      const rows = [];
      let selection = [];

      // Betrouwbare route: getSelection() levert de runtime IDs van de huidige
      // Trimble-selectie. De eigenschappen halen we daarna expliciet op via
      // getObjectProperties(). getObjects({selected:true}) kan objectstubs
      // teruggeven zonder de volledige properties en wordt daarom niet meer
      // rechtstreeks als propertybron gebruikt.
      try {
        selection = await API.viewer.getSelection() || [];
      } catch (selectionError) {
        console.warn('getSelection() mislukt; geselecteerde objecten worden als fallback opgezocht.', selectionError);
      }

      // Fallback: haal alleen de IDs uit getObjects({selected:true}).
      if (!selection.length) {
        try {
          const selectedModels = await API.viewer.getObjects({ selected: true }) || [];
          selection = selectedModels.map(group => ({
            modelId: group.modelId,
            objectRuntimeIds: (group.objects || []).map(obj => obj.id).filter(id => Number.isFinite(id))
          })).filter(group => group.objectRuntimeIds.length);
        } catch (objectsError) {
          console.warn('Fallback getObjects({selected:true}) mislukt.', objectsError);
        }
      }

      // Properties altijd expliciet ophalen per model.
      for (const group of selection) {
        const ids = Array.from(new Set(group.objectRuntimeIds || [])).filter(id => Number.isFinite(id));
        if (!group.modelId || !ids.length) continue;

        try {
          const objects = await API.viewer.getObjectProperties(group.modelId, ids) || [];
          for (const obj of objects) {
            rows.push({ modelId: group.modelId, id: obj.id, object: obj });
          }
        } catch (propertyError) {
          console.error(`Properties uitlezen mislukt voor model ${group.modelId}`, propertyError);
        }
      }

      selectionRows = rows;
      calculateSelectionInfo();

      if (!selection.length) {
        setStatus('Selecteer één of meer elementen in het model.');
      } else if (!rows.length) {
        setStatus('De selectie is gevonden, maar Trimble gaf geen objecteigenschappen terug.');
      } else {
        const parameterCount = getAvailableFields(false).length;
        setStatus(`${rows.length} geselecteerd element${rows.length === 1 ? '' : 'en'} ingelezen · ${parameterCount} parameters gevonden.`);
      }
    } catch (e) {
      console.error(e);
      selectionRows = [];
      calculateSelectionInfo();
      setStatus('Selectie kon niet worden ingelezen.');
    }
  }

  function calculateSelectionInfo() {
    const map = new Map();
    for (const row of selectionRows) {
      const mark = findCastUnitMark(row.object);
      if (!mark) continue;
      const key = normalize(mark);
      if (!map.has(key)) map.set(key, { mark, row });
    }
    uniqueMarks = [...map.values()];

    const availableFields = getAvailableFields(false);
    $('selectedCount').textContent = selectionRows.length;
    $('markCount').textContent = availableFields.length;

    if (!selectionRows.length) {
      $('selectionHint').textContent = 'Selecteer één of meer elementen in de 3D Viewer.';
    } else {
      $('selectionHint').textContent = `${availableFields.length} parameters uit de geselecteerde elementen gelezen.`;
    }
  }

  function getAvailableFields(includeDefault = true) {
    const map = new Map();
    for (const row of selectionRows) {
      for (const p of flattenProperties(row.object)) {
        const key = `${p.set}\u0000${p.name}`;
        if (!map.has(key)) map.set(key, { set:p.set, name:p.name, label:p.name });
      }
    }
    // Alleen voor de preset-editor houden we Cast Unit Mark als vaste standaardoptie beschikbaar.
    if (includeDefault) {
      const castKey = 'Tekla Assembly\u0000Cast Unit Mark';
      if (!map.has(castKey)) map.set(castKey, { set:'Tekla Assembly', name:'Cast Unit Mark', label:'Merk' });
    }
    return [...map.values()].sort((a,b) => `${a.set} ${a.name}`.localeCompare(`${b.set} ${b.name}`));
  }

  function fieldKey(f) { return `${f.set}\u0000${f.name}`; }
  function openPresetDialog(preset) {
    editingPresetId = preset?.id || null;
    $('dialogTitle').textContent = preset ? `Preset ${preset.name} aanpassen` : 'Nieuwe preset';
    $('presetName').value = preset?.name || '';
    $('presetName').disabled = !!preset?.builtin;
    dialogFields = clone(preset?.fields?.length ? preset.fields : [{ set:'Tekla Assembly', name:'Cast Unit Mark', label:'Merk' }]);
    renderDialogFields();
    $('presetDialog').showModal();
  }

  function renderDialogFields() {
    const available = getAvailableFields();
    const options = available.map(f => `<option value="${escapeHtml(fieldKey(f))}">${escapeHtml(f.set || 'Algemeen')} → ${escapeHtml(f.name)}</option>`).join('');
    $('selectedFields').innerHTML = dialogFields.map((f, i) => {
      const key = fieldKey(f);
      return `<div class="preset-field-row" data-index="${i}">
        <div class="field-row-top">
          <span class="order-number">${i + 1}</span>
          <select class="parameter-select" data-action="parameter">${options}</select>
          <button type="button" class="mini-btn" data-action="up" title="Omhoog">↑</button>
          <button type="button" class="mini-btn" data-action="down" title="Omlaag">↓</button>
          <button type="button" class="mini-btn remove" data-action="remove" title="Verwijderen">×</button>
        </div>
        <label class="alias-row"><span>Naam in label</span><input data-action="label" value="${escapeHtml(f.label || f.name)}" maxlength="40"></label>
      </div>`;
    }).join('');
    [...$('selectedFields').querySelectorAll('.preset-field-row')].forEach((row, i) => {
      row.querySelector('.parameter-select').value = fieldKey(dialogFields[i]);
    });
    $('dialogEmptyHint').style.display = dialogFields.length ? 'none' : 'block';
  }

  function addDialogField() {
    const available = getAvailableFields();
    const used = new Set(dialogFields.map(fieldKey));
    const next = available.find(f => !used.has(fieldKey(f))) || available[0];
    if (!next) return;
    dialogFields.push({ set:next.set, name:next.name, label:next.label || next.name });
    renderDialogFields();
  }
  function handleDialogFieldAction(ev) {
    const row = ev.target.closest('.preset-field-row');
    if (!row) return;
    const i = Number(row.dataset.index);
    const action = ev.target.dataset.action;
    if (action === 'parameter') {
      const available = getAvailableFields();
      const hit = available.find(f => fieldKey(f) === ev.target.value);
      if (hit) dialogFields[i] = { set:hit.set, name:hit.name, label: dialogFields[i].label || hit.name };
    } else if (action === 'label') {
      dialogFields[i].label = ev.target.value;
    } else if (action === 'remove') {
      dialogFields.splice(i,1); renderDialogFields();
    } else if (action === 'up' && i > 0) {
      [dialogFields[i-1],dialogFields[i]]=[dialogFields[i],dialogFields[i-1]]; renderDialogFields();
    } else if (action === 'down' && i < dialogFields.length-1) {
      [dialogFields[i+1],dialogFields[i]]=[dialogFields[i],dialogFields[i+1]]; renderDialogFields();
    }
  }

  function savePresetFromDialog(ev) {
    ev.preventDefault();
    const isBuiltin = editingPresetId === 'builtin-mark';
    const name = isBuiltin ? 'Merk' : $('presetName').value.trim();
    if (!name) return;
    if (!dialogFields.length) return setStatus('Voeg minstens één parameter toe aan de preset.');
    dialogFields = dialogFields.map(f => ({ ...f, label:(f.label || f.name).trim() || f.name }));

    if (isBuiltin) {
      saveDefaultPreset({ id:'builtin-mark', name:'Merk', builtin:true, fields:dialogFields });
      $('presetDialog').close();
      renderPresets('builtin-mark');
      setStatus('Preset Merk aangepast.');
      return;
    }

    const presets = getCustomPresets();
    let id = editingPresetId;
    if (id) {
      const idx = presets.findIndex(p => p.id === id);
      if (idx >= 0) presets[idx] = { ...presets[idx], name, fields:dialogFields };
    } else {
      id = `preset-${Date.now()}`;
      presets.push({ id, name, fields:dialogFields });
    }
    saveCustomPresets(presets);
    $('presetDialog').close();
    renderPresets(id);
    setStatus(`Preset ${name} opgeslagen.`);
  }

  function renderColorPalette() {
    $('colorPalette').innerHTML = TRIMBLE_COLORS.map(hex => `<button type="button" class="color-swatch${hex.toLowerCase()===selectedColor.toLowerCase()?' selected':''}" data-color="${hex}" title="${hex}" aria-label="Kleur ${hex}" style="--swatch:${hex}"></button>`).join('');
    $('currentColor').style.setProperty('--swatch', selectedColor);
  }
  function chooseColor(hex) {
    selectedColor = hex;
    localStorage.setItem(COLOR_KEY, selectedColor);
    renderColorPalette();
  }
  function colorToRGBA(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r:(n>>16)&255, g:(n>>8)&255, b:n&255, a:255 };
  }

  async function placeLabels() {
    if (!uniqueMarks.length) return setStatus('Geen merken met Cast Unit Mark gevonden.');
    const preset = selectedPreset();
    const hideEmpty = $('hideEmpty').checked;
    const color = colorToRGBA(selectedColor);
    if (!API) return setStatus(`Preview: ${uniqueMarks.length} merklabel(s) met preset “${preset.name}”.`);
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
          let value = normalize(field.set)==='tekla assembly' && normalize(field.name)==='cast unit mark' ? mark : fieldValue(row.object, field);
          if (hideEmpty && !String(value).trim()) continue;
          const onlyMark = preset.fields.length === 1 && normalize(field.name)==='cast unit mark';
          lines.push(onlyMark ? (value || '-') : `${field.label || field.name}: ${value || '-'}`);
        }
        if (!lines.length) continue;
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
      setStatus('Labels plaatsen is mislukt. Controleer de geselecteerde Tekla-merken.');
    }
  }

  function bboxCenter(box, fallback) {
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
  $('editPreset').addEventListener('click', () => openPresetDialog(selectedPreset()));
  $('deletePreset').addEventListener('click', () => {
    const p = selectedPreset(); if (p.builtin) return;
    saveCustomPresets(getCustomPresets().filter(x => x.id !== p.id));
    renderPresets('builtin-mark');
  });
  $('addField').addEventListener('click', addDialogField);
  $('selectedFields').addEventListener('click', handleDialogFieldAction);
  $('selectedFields').addEventListener('change', handleDialogFieldAction);
  $('selectedFields').addEventListener('input', handleDialogFieldAction);
  $('presetForm').addEventListener('submit', savePresetFromDialog);
  $('colorPalette').addEventListener('click', ev => {
    const swatch = ev.target.closest('.color-swatch');
    if (swatch) chooseColor(swatch.dataset.color);
  });
  $('placeLabels').addEventListener('click', placeLabels);
  $('clearLabels').addEventListener('click', () => clearLabels(true));

  renderPresets();
  renderColorPalette();
  connect();
})();
