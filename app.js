(() => {
  'use strict';

  const STORAGE_KEY = 'altez-objectinfo-presets-v4';
  const DEFAULT_OVERRIDE_KEY = 'altez-objectinfo-default-preset-v4';
  const COLOR_KEY = 'altez-objectinfo-color-v4';

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
  let activeMarkupIds = [];
  let editingPresetId = null;
  let dialogFields = [];
  let selectedColor =
    localStorage.getItem(COLOR_KEY) || '#f44336';

  const $ = id => document.getElementById(id);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalize(value) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function compactName(value) {
    return normalize(value).replace(/[^a-z0-9]/g, '');
  }

  function safeValue(value) {
    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (value === null || value === undefined) {
      return '';
    }

    return String(value);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(
      /[&<>'"]/g,
      character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[character])
    );
  }

  /*
   * ============================================================
   * PROPERTIES
   * ============================================================
   *
   * Heel belangrijk:
   *
   * We gebruiken alleen properties die Trimble werkelijk
   * terugstuurt.
   *
   * Er wordt dus GEEN:
   *
   * Tekla Assembly -> Cast Unit Mark
   *
   * meer kunstmatig toegevoegd.
   */

  function flattenProperties(object) {
    const result = [];

    for (const propertySet of (object?.properties || [])) {

      const setName =
        String(propertySet?.set || '').trim();

      for (const property of
        (propertySet?.properties || [])) {

        const propertyName =
          String(property?.name || '').trim();

        if (!propertyName) {
          continue;
        }

        result.push({
          set: setName,
          name: propertyName,
          value: safeValue(property?.value),
          type: property?.type
        });
      }
    }

    return result;
  }

  function fieldKey(field) {
    return (
      `${field?.set || ''}\u0000${field?.name || ''}`
    );
  }

  /*
   * Alle werkelijk gevonden parameters uit de selectie.
   */

  function getAvailableFields() {

    const fields = new Map();

    for (const row of selectionRows) {

      const properties =
        flattenProperties(row.object);

      for (const property of properties) {

        const key =
          fieldKey(property);

        if (!fields.has(key)) {

          fields.set(key, {
            set: property.set,
            name: property.name,
            label: property.name
          });
        }
      }
    }

    return [...fields.values()].sort(
      (a, b) => {

        const textA =
          `${a.set || 'Algemeen'} ${a.name}`;

        const textB =
          `${b.set || 'Algemeen'} ${b.name}`;

        return textA.localeCompare(
          textB,
          'nl'
        );
      }
    );
  }

  /*
   * Zoek automatisch de echte Cast Unit Mark.
   *
   * Voorbeelden die hiermee worden herkend:
   *
   * Cast Unit Mark
   * Assembly/Cast unit Mark
   * CAST_UNIT_MARK
   * enz.
   */

  function findRealCastUnitMarkField() {

    const fields =
      getAvailableFields();

    const candidates =
      fields.map(field => {

        const name =
          compactName(field.name);

        const full =
          compactName(
            `${field.set}/${field.name}`
          );

        let score = 0;

        if (
          name ===
          'assemblycastunitmark'
        ) {
          score = 100;
        }

        else if (
          name ===
          'castunitmark'
        ) {
          score = 95;
        }

        else if (
          name.endsWith(
            'castunitmark'
          )
        ) {
          score = 90;
        }

        else if (
          full.includes(
            'assemblycastunitmark'
          )
        ) {
          score = 85;
        }

        return {
          field,
          score
        };
      });

    candidates.sort(
      (a, b) =>
        b.score - a.score
    );

    if (
      candidates.length &&
      candidates[0].score > 0
    ) {

      return candidates[0].field;
    }

    return null;
  }

  /*
   * Als een oude preset nog een oude naam bevat,
   * proberen we hem naar de werkelijk aanwezige
   * property te koppelen.
   */

  function resolveField(field) {

    const available =
      getAvailableFields();

    /*
     * Eerst exacte match.
     */

    let match =
      available.find(candidate =>

        normalize(candidate.set) ===
          normalize(field?.set)

        &&

        normalize(candidate.name) ===
          normalize(field?.name)
      );

    if (match) {
      return match;
    }

    /*
     * Oude Cast Unit Mark preset migreren.
     */

    if (
      compactName(field?.name) ===
      'castunitmark'
    ) {

      match =
        findRealCastUnitMarkField();

      if (match) {
        return match;
      }
    }

    /*
     * Laatste fallback:
     * exact dezelfde propertynaam.
     */

    match =
      available.find(candidate =>

        normalize(candidate.name) ===
        normalize(field?.name)
      );

    return match || null;
  }

  /*
   * ============================================================
   * PRESETS
   * ============================================================
   */

  function getCustomPresets() {

    try {

      return JSON.parse(
        localStorage.getItem(
          STORAGE_KEY
        ) || '[]'
      );

    } catch {

      return [];
    }
  }

  function saveCustomPresets(
    presets
  ) {

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(presets)
    );
  }

  /*
   * Standaardpreset MERK.
   *
   * Deze wordt dynamisch gekoppeld aan
   * de werkelijk gevonden Cast Unit Mark.
   */

  function getDefaultPreset() {

    let saved = null;

    try {

      saved =
        JSON.parse(
          localStorage.getItem(
            DEFAULT_OVERRIDE_KEY
          ) || 'null'
        );

    } catch {}

    /*
     * Eerst kijken of gebruiker
     * de preset Merk heeft aangepast.
     */

    if (
      saved?.fields?.length
    ) {

      const resolvedFields =
        saved.fields
          .map(field => {

            const resolved =
              resolveField(field);

            if (!resolved) {
              return null;
            }

            return {
              ...resolved,
              label:
                field.label ||
                resolved.name
            };
          })
          .filter(Boolean);

      if (
        resolvedFields.length
      ) {

        return {
          id: 'builtin-mark',
          name: 'Merk',
          builtin: true,
          fields:
            resolvedFields
        };
      }
    }

    /*
     * Geen aangepaste preset:
     * automatisch Cast Unit Mark zoeken.
     */

    const castUnitMark =
      findRealCastUnitMarkField();

    return {
      id: 'builtin-mark',
      name: 'Merk',
      builtin: true,

      fields:
        castUnitMark

          ? [
              {
                ...castUnitMark,
                label: 'Merk'
              }
            ]

          : []
    };
  }

  function saveDefaultPreset(
    preset
  ) {

    localStorage.setItem(
      DEFAULT_OVERRIDE_KEY,

      JSON.stringify({
        name: 'Merk',
        fields: preset.fields
      })
    );
  }

  function allPresets() {

    return [
      getDefaultPreset(),
      ...getCustomPresets()
    ];
  }

  function selectedPreset() {

    return (
      allPresets().find(
        preset =>
          preset.id ===
          $('presetSelect').value
      )

      ||

      getDefaultPreset()
    );
  }

  function renderPresets(
    preferId
  ) {

    const select =
      $('presetSelect');

    const presets =
      allPresets();

    const current =
      preferId ||
      select.value ||
      'builtin-mark';

    select.innerHTML =
      presets
        .map(
          preset =>
            `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`
        )
        .join('');

    select.value =
      presets.some(
        preset =>
          preset.id === current
      )

        ? current

        : 'builtin-mark';

    renderPresetFields();
  }

  function renderPresetFields() {

    const preset =
      selectedPreset();

    if (
      !preset.fields.length
    ) {

      $('presetFields').innerHTML =
        `
        <span class="field-chip">

          <b>
            Geen Cast Unit Mark gevonden
          </b>

          <small>
            Kies via Preset aanpassen
            een parameter uit de huidige selectie.
          </small>

        </span>
        `;

    } else {

      $('presetFields').innerHTML =
        preset.fields
          .map(field => {

            const setName =
              field.set ||
              'Algemeen';

            return `
              <span class="field-chip">

                <b>
                  ${escapeHtml(
                    field.label ||
                    field.name
                  )}
                </b>

                <small>
                  ${escapeHtml(setName)}
                  →
                  ${escapeHtml(field.name)}
                </small>

              </span>
            `;
          })
          .join('');
    }

    $('editPreset').disabled =
      false;

    $('deletePreset').style.visibility =
      preset.builtin
        ? 'hidden'
        : 'visible';
  }

  /*
   * ============================================================
   * TRIMBLE CONNECT
   * ============================================================
   */

  async function connect() {

    try {

      if (
        !window.TrimbleConnectWorkspace ||
        window.parent === window
      ) {

        throw new Error(
          'preview'
        );
      }

      API =
        await TrimbleConnectWorkspace.connect(

          window.parent,

          onWorkspaceEvent,

          30000
        );

      $('connectionBadge').textContent =
        'Trimble Connect';

      $('connectionBadge')
        .classList.add('ok');

      await refreshSelection();

    } catch (error) {

      API = null;

      $('connectionBadge').textContent =
        'Preview';

      $('connectionBadge')
        .classList.add('demo');

      selectionRows = [];

      calculateSelectionInfo();

      renderPresets();

      setStatus(
        'Open de extensie in Trimble Connect om objectgegevens te lezen.'
      );
    }
  }

  function onWorkspaceEvent(
    event
  ) {

    if (
      event ===
      'viewer.onSelectionChanged'
    ) {

      refreshSelection();
    }
  }

  /*
   * ============================================================
   * SELECTIE UITLEZEN
   * ============================================================
   */

  async function refreshSelection() {

    if (!API) {
      return;
    }

    setStatus(
      'Selectie en parameters inlezen...'
    );

    try {

      const rows = [];

      const seen =
        new Set();

      /*
       * ROUTE 1
       *
       * geselecteerde objecten ophalen.
       */

      let selectedGroups = [];

      try {

        selectedGroups =
          await API.viewer.getObjects({
            selected: true
          }) || [];

      } catch (error) {

        console.warn(
          'getObjects selected mislukt',
          error
        );
      }

      for (
        const group
        of selectedGroups
      ) {

        const modelId =
          group?.modelId;

        const objects =
          Array.isArray(
            group?.objects
          )

            ? group.objects

            : [];

        if (
          !modelId ||
          !objects.length
        ) {

          continue;
        }

        const ids =
          objects
            .map(
              object =>
                Number(
                  object?.id
                )
            )
            .filter(
              Number.isFinite
            );

        if (!ids.length) {
          continue;
        }

        /*
         * Expliciet volledige properties ophalen.
         */

        let fullObjects = [];

        try {

          fullObjects =
            await API.viewer
              .getObjectProperties(
                modelId,
                ids
              )

            || [];

        } catch (error) {

          console.warn(
            'getObjectProperties mislukt',
            modelId,
            ids,
            error
          );

          /*
           * Fallback naar objecten
           * uit getObjects.
           */

          fullObjects =
            objects;
        }

        for (
          const object
          of fullObjects
        ) {

          const id =
            Number(
              object?.id
            );

          if (
            !Number.isFinite(id)
          ) {

            continue;
          }

          const key =
            `${modelId}:${id}`;

          if (
            seen.has(key)
          ) {

            continue;
          }

          seen.add(key);

          rows.push({
            modelId,
            id,
            object
          });
        }
      }

      /*
       * ROUTE 2
       *
       * fallback via getSelection().
       */

      if (!rows.length) {

        let selection = [];

        try {

          selection =
            await API.viewer
              .getSelection()

            || [];

        } catch (error) {

          console.warn(
            'getSelection mislukt',
            error
          );
        }

        for (
          const group
          of selection
        ) {

          const modelId =
            group?.modelId;

          const ids =
            (
              group
                ?.objectRuntimeIds
              || []
            )

              .map(Number)

              .filter(
                Number.isFinite
              );

          if (
            !modelId ||
            !ids.length
          ) {

            continue;
          }

          const fullObjects =
            await API.viewer
              .getObjectProperties(
                modelId,
                ids
              )

            || [];

          for (
            const object
            of fullObjects
          ) {

            const id =
              Number(
                object?.id
              );

            if (
              !Number.isFinite(id)
            ) {

              continue;
            }

            const key =
              `${modelId}:${id}`;

            if (
              seen.has(key)
            ) {

              continue;
            }

            seen.add(key);

            rows.push({
              modelId,
              id,
              object
            });
          }
        }
      }

      /*
       * Selectie opslaan.
       */

      selectionRows =
        rows;

      calculateSelectionInfo();

      /*
       * Preset opnieuw koppelen
       * aan werkelijk gevonden parameters.
       */

      renderPresets(
        $('presetSelect')?.value
      );

      const parameterCount =
        getAvailableFields().length;

      const withProperties =
        rows.filter(
          row =>
            flattenProperties(
              row.object
            ).length > 0
        ).length;

      /*
       * Diagnose in console.
       */

      console.log(
        'ALTEZ OBJECTINFO',
        {
          rows,
          parameterCount,
          properties:
            rows.map(row => ({
              modelId:
                row.modelId,

              id:
                row.id,

              properties:
                flattenProperties(
                  row.object
                )
            }))
        }
      );

      if (!rows.length) {

        setStatus(
          'Geen geselecteerde 3D-objecten gevonden.'
        );

      }

      else if (
        !withProperties
      ) {

        setStatus(
          `${rows.length} element(en) gevonden, maar geen parameters ontvangen.`
        );

      }

      else {

        setStatus(
          `${rows.length} element(en) ingelezen - ${parameterCount} parameters gevonden.`
        );
      }

    } catch (error) {

      console.error(
        'Selectie inlezen mislukt',
        error
      );

      selectionRows = [];

      calculateSelectionInfo();

      renderPresets();

      setStatus(
        `Selectie kon niet worden ingelezen: ${error?.message || error}`
      );
    }
  }

  function calculateSelectionInfo() {

    const fields =
      getAvailableFields();

    $('selectedCount').textContent =
      selectionRows.length;

    $('markCount').textContent =
      fields.length;

    $('selectionHint').textContent =
      selectionRows.length

        ? `${fields.length} parameters rechtstreeks uit de geselecteerde elementen gelezen.`

        : 'Selecteer één of meer elementen in de 3D Viewer.';
  }

  /*
   * ============================================================
   * WAARDE VAN GEKOZEN PARAMETER
   * ============================================================
   */

  function fieldValue(
    object,
    field
  ) {

    const properties =
      flattenProperties(
        object
      );

    const resolved =
      resolveField(field)
      || field;

    /*
     * Exact propertyset + propertynaam.
     */

    let match =
      properties.find(
        property =>

          normalize(property.set) ===
            normalize(resolved.set)

          &&

          normalize(property.name) ===
            normalize(resolved.name)
      );

    /*
     * Exact dezelfde propertynaam.
     */

    if (!match) {

      match =
        properties.find(
          property =>

            normalize(
              property.name
            )

            ===

            normalize(
              resolved.name
            )
        );
    }

    /*
     * Cast Unit Mark fallback.
     */

    if (
      !match &&
      compactName(
        resolved.name
      ).includes(
        'castunitmark'
      )
    ) {

      match =
        properties.find(
          property =>

            compactName(
              property.name
            )
              .endsWith(
                'castunitmark'
              )
        );
    }

    return match
      ? match.value
      : '';
  }

  /*
   * ============================================================
   * PRESET EDITOR
   * ============================================================
   */

  function openPresetDialog(
    preset
  ) {

    editingPresetId =
      preset?.id || null;

    $('dialogTitle').textContent =
      preset

        ? `Preset ${preset.name} aanpassen`

        : 'Nieuwe preset';

    $('presetName').value =
      preset?.name || '';

    $('presetName').disabled =
      !!preset?.builtin;

    dialogFields =
      clone(
        preset?.fields || []
      );

    /*
     * Als Merk leeg is:
     * echte Cast Unit Mark kiezen.
     */

    if (
      !dialogFields.length
    ) {

      const castUnitMark =
        findRealCastUnitMarkField();

      const firstField =
        castUnitMark ||
        getAvailableFields()[0];

      if (firstField) {

        dialogFields = [
          {
            ...firstField,

            label:
              castUnitMark
                ? 'Merk'
                : firstField.name
          }
        ];
      }
    }

    renderDialogFields();

    $('presetDialog')
      .showModal();
  }

  function renderDialogFields() {

    const available =
      getAvailableFields();

    const options =
      available
        .map(field => {

          const setName =
            field.set ||
            'Algemeen';

          return `
            <option value="${escapeHtml(fieldKey(field))}">
              ${escapeHtml(setName)}
              →
              ${escapeHtml(field.name)}
            </option>
          `;
        })
        .join('');

    $('selectedFields').innerHTML =
      dialogFields
        .map(
          (field, index) => {

            return `
              <div
                class="preset-field-row"
                data-index="${index}"
              >

                <div class="field-row-top">

                  <span class="order-number">
                    ${index + 1}
                  </span>

                  <select
                    class="parameter-select"
                    data-action="parameter"
                  >
                    ${options}
                  </select>

                  <button
                    type="button"
                    class="mini-btn"
                    data-action="up"
                  >
                    ↑
                  </button>

                  <button
                    type="button"
                    class="mini-btn"
                    data-action="down"
                  >
                    ↓
                  </button>

                  <button
                    type="button"
                    class="mini-btn remove"
                    data-action="remove"
                  >
                    ×
                  </button>

                </div>

                <label class="alias-row">

                  <span>
                    Naam in label
                  </span>

                  <input
                    data-action="label"
                    value="${escapeHtml(field.label || field.name)}"
                    maxlength="40"
                  >

                </label>

              </div>
            `;
          }
        )
        .join('');

    /*
     * Correcte dropdownwaarden selecteren.
     */

    [
      ...$('selectedFields')
        .querySelectorAll(
          '.preset-field-row'
        )
    ]
      .forEach(
        (row, index) => {

          const resolved =
            resolveField(
              dialogFields[index]
            )

            ||

            dialogFields[index];

          const select =
            row.querySelector(
              '.parameter-select'
            );

          const exists =
            getAvailableFields()
              .some(
                field =>
                  fieldKey(field)
                  ===
                  fieldKey(resolved)
              );

          if (exists) {

            select.value =
              fieldKey(resolved);
          }
        }
      );

    $('dialogEmptyHint')
      .style.display =

        dialogFields.length
          ? 'none'
          : 'block';
  }

  function addDialogField() {

    const available =
      getAvailableFields();

    const used =
      new Set(
        dialogFields.map(
          field =>
            fieldKey(
              resolveField(field)
              || field
            )
        )
      );

    const next =
      available.find(
        field =>
          !used.has(
            fieldKey(field)
          )
      )

      ||

      available[0];

    if (!next) {

      setStatus(
        'Geen parameters beschikbaar in de huidige selectie.'
      );

      return;
    }

    dialogFields.push({
      ...next,
      label: next.name
    });

    renderDialogFields();
  }

  function handleDialogFieldAction(
    event
  ) {

    const row =
      event.target.closest(
        '.preset-field-row'
      );

    if (!row) {
      return;
    }

    const index =
      Number(
        row.dataset.index
      );

    const action =
      event.target.dataset.action;

    /*
     * Andere parameter kiezen.
     */

    if (
      action ===
      'parameter'
    ) {

      const selected =
        getAvailableFields()
          .find(
            field =>
              fieldKey(field)
              ===
              event.target.value
          );

      if (selected) {

        dialogFields[index] = {
          ...selected,

          label:
            dialogFields[index]
              ?.label

            ||

            selected.name
        };
      }
    }

    /*
     * Naam aanpassen.
     */

    if (
      action ===
      'label'
    ) {

      dialogFields[index].label =
        event.target.value;
    }

    /*
     * Verwijderen.
     */

    if (
      action ===
      'remove'
    ) {

      dialogFields.splice(
        index,
        1
      );

      renderDialogFields();
    }

    /*
     * Omhoog.
     */

    if (
      action === 'up' &&
      index > 0
    ) {

      [
        dialogFields[index - 1],
        dialogFields[index]
      ]

      =

      [
        dialogFields[index],
        dialogFields[index - 1]
      ];

      renderDialogFields();
    }

    /*
     * Omlaag.
     */

    if (
      action === 'down' &&
      index <
        dialogFields.length - 1
    ) {

      [
        dialogFields[index + 1],
        dialogFields[index]
      ]

      =

      [
        dialogFields[index],
        dialogFields[index + 1]
      ];

      renderDialogFields();
    }
  }

  function savePresetFromDialog(
    event
  ) {

    event.preventDefault();

    const isBuiltin =
      editingPresetId ===
      'builtin-mark';

    const name =
      isBuiltin

        ? 'Merk'

        : $('presetName')
            .value
            .trim();

    if (!name) {
      return;
    }

    if (
      !dialogFields.length
    ) {

      setStatus(
        'Voeg minstens één parameter toe aan de preset.'
      );

      return;
    }

    dialogFields =
      dialogFields.map(
        field => ({
          ...field,

          label:
            (
              field.label ||
              field.name
            )
              .trim()

            ||

            field.name
        })
      );

    /*
     * Standaardpreset Merk opslaan.
     */

    if (isBuiltin) {

      saveDefaultPreset({
        id: 'builtin-mark',
        name: 'Merk',
        builtin: true,
        fields: dialogFields
      });

      $('presetDialog')
        .close();

      renderPresets(
        'builtin-mark'
      );

      setStatus(
        'Preset Merk aangepast.'
      );

      return;
    }

    /*
     * Eigen preset.
     */

    const presets =
      getCustomPresets();

    let id =
      editingPresetId;

    if (id) {

      const index =
        presets.findIndex(
          preset =>
            preset.id === id
        );

      if (
        index >= 0
      ) {

        presets[index] = {
          ...presets[index],
          name,
          fields:
            dialogFields
        };
      }

    } else {

      id =
        `preset-${Date.now()}`;

      presets.push({
        id,
        name,
        fields:
          dialogFields
      });
    }

    saveCustomPresets(
      presets
    );

    $('presetDialog')
      .close();

    renderPresets(id);

    setStatus(
      `Preset ${name} opgeslagen.`
    );
  }

  /*
   * ============================================================
   * KLEUREN
   * ============================================================
   */

  function renderColorPalette() {

    $('colorPalette').innerHTML =
      TRIMBLE_COLORS
        .map(
          hex => `
            <button
              type="button"
              class="color-swatch${hex.toLowerCase() === selectedColor.toLowerCase() ? ' selected' : ''}"
              data-color="${hex}"
              title="${hex}"
              style="--swatch:${hex}"
            ></button>
          `
        )
        .join('');

    $('currentColor')
      .style
      .setProperty(
        '--swatch',
        selectedColor
      );
  }

  function chooseColor(
    hex
  ) {

    selectedColor =
      hex;

    localStorage.setItem(
      COLOR_KEY,
      selectedColor
    );

    renderColorPalette();
  }

  function colorToRGBA(
    hex
  ) {

    const value =
      parseInt(
        hex.slice(1),
        16
      );

    return {
      r:
        (value >> 16)
        & 255,

      g:
        (value >> 8)
        & 255,

      b:
        value
        & 255,

      a: 255
    };
  }

  /*
   * ============================================================
   * LABELPOSITIE
   * ============================================================
   */

  function bboxCenter(
    box,
    fallback
  ) {

    const boundingBox =
      box?.boundingBox;

    const min =
      boundingBox?.min;

    const max =
      boundingBox?.max;

    if (
      min &&
      max
    ) {

      return {

        x:
          (
            Number(min.x) +
            Number(max.x)
          )
          / 2,

        y:
          (
            Number(min.y) +
            Number(max.y)
          )
          / 2,

        z:
          (
            Number(min.z) +
            Number(max.z)
          )
          / 2,

        sizeX:
          Math.abs(
            Number(max.x) -
            Number(min.x)
          ),

        sizeY:
          Math.abs(
            Number(max.y) -
            Number(min.y)
          ),

        sizeZ:
          Math.abs(
            Number(max.z) -
            Number(min.z)
          )
      };
    }

    if (fallback) {

      return {

        x:
          Number(fallback.x)
          || 0,

        y:
          Number(fallback.y)
          || 0,

        z:
          Number(fallback.z)
          || 0,

        sizeX: 1,
        sizeY: 1,
        sizeZ: 1
      };
    }

    return null;
  }

  function labelOffset(
    center,
    index
  ) {

    const objectSize =
      Math.max(
        center.sizeX || 0,
        center.sizeY || 0,
        center.sizeZ || 0,
        1
      );

    const distance =
      Math.max(
        1,
        objectSize * 0.75
      );

    const angle =
      (index % 8)
      *
      (Math.PI / 4);

    return {

      x:
        center.x
        +
        Math.cos(angle)
        *
        distance,

      y:
        center.y
        +
        Math.sin(angle)
        *
        distance,

      z:
        center.z
        +
        Math.max(
          0.6,
          (center.sizeZ || 1)
          * 0.45
        )
    };
  }

  /*
   * ============================================================
   * LABELS PLAATSEN
   * ============================================================
   */

  async function placeLabels() {

    if (!API) {

      setStatus(
        'Open de extensie in Trimble Connect.'
      );

      return;
    }

    if (
      !selectionRows.length
    ) {

      setStatus(
        'Selecteer eerst één of meer elementen in de 3D Viewer.'
      );

      return;
    }

    const preset =
      selectedPreset();

    if (
      !preset.fields?.length
    ) {

      setStatus(
        'De gekozen preset bevat geen parameters.'
      );

      return;
    }

    const hideEmpty =
      $('hideEmpty').checked;

    const color =
      colorToRGBA(
        selectedColor
      );

    try {

      await clearLabels(
        false
      );

      const markups = [];

      /*
       * ZEER BELANGRIJK:
       *
       * GEEN GROEPERING OP MERK.
       *
       * Iedere geselecteerde runtime-ID
       * krijgt zijn eigen label.
       *
       * Dus:
       *
       * Assembly 1 = K12
       * Assembly 2 = K12
       *
       * geeft TWEE labels.
       */

      for (
        let index = 0;
        index <
          selectionRows.length;
        index++
      ) {

        const row =
          selectionRows[index];

        const lines = [];

        /*
         * Alle parameters uit preset.
         */

        for (
          const field
          of preset.fields
        ) {

          const value =
            fieldValue(
              row.object,
              field
            );

          const hasValue =
            String(
              value ?? ''
            )
              .trim()
              !== '';

          if (
            hideEmpty &&
            !hasValue
          ) {

            continue;
          }

          /*
           * Eén parameter:
           * alleen waarde.
           */

          if (
            preset.fields.length
            === 1
          ) {

            lines.push(
              hasValue
                ? String(value)
                : '-'
            );

          }

          /*
           * Meerdere parameters:
           *
           * Merk: K12
           * Profiel: HEA300
           * Gewicht: 842
           */

          else {

            lines.push(
              `${field.label || field.name}: ${hasValue ? value : '-'}`
            );
          }
        }

        if (
          !lines.length
        ) {

          continue;
        }

        /*
         * Bounding box object.
         */

        let box = null;

        try {

          const boxes =
            await API.viewer
              .getObjectBoundingBoxes(
                row.modelId,
                [row.id]
              );

          box =
            (boxes || [])
              .find(
                item =>
                  Number(item?.id)
                  ===
                  Number(row.id)
              )

            ||

            boxes?.[0]

            ||

            null;

        } catch (error) {

          console.warn(
            'Bounding box kon niet worden gelezen',
            row.id,
            error
          );
        }

        const center =
          bboxCenter(
            box,
            row.object?.position
          );

        if (!center) {

          console.warn(
            'Geen positie voor label',
            row
          );

          continue;
        }

        /*
         * Label buiten object.
         */

        const end =
          labelOffset(
            center,
            index
          );

        markups.push({

          /*
           * Leader line begint
           * op geselecteerd object.
           */

          start: {

            modelId:
              row.modelId,

            objectId:
              row.id,

            positionX:
              center.x * 1000,

            positionY:
              center.y * 1000,

            positionZ:
              center.z * 1000,

            type:
              'point'
          },

          /*
           * Labelpositie.
           */

          end: {

            positionX:
              end.x * 1000,

            positionY:
              end.y * 1000,

            positionZ:
              end.z * 1000,

            type:
              'point'
          },

          text:
            lines.join('\n'),

          color
        });
      }

      if (
        !markups.length
      ) {

        setStatus(
          'Geen labels geplaatst: de gekozen parameters bevatten geen waarden.'
        );

        return;
      }

      /*
       * Eerst alle labels tegelijk proberen.
       */

      try {

        const added =
          await API.markup
            .addTextMarkup(
              markups
            );

        activeMarkupIds =
          (added || [])
            .map(
              markup =>
                markup?.id
            )
            .filter(
              id =>
                id !== undefined
                &&
                id !== null
            );

        setStatus(
          `${markups.length} afzonderlijke label(s) geplaatst.`
        );

      }

      /*
       * Sommige Trimble hosts kunnen
       * moeite hebben met meerdere markups
       * tegelijk.
       *
       * Dan plaatsen we ze één voor één.
       */

      catch (bulkError) {

        console.warn(
          'Bulk labels mislukt. Individueel proberen.',
          bulkError
        );

        const ids = [];

        let placed = 0;

        for (
          const markup
          of markups
        ) {

          try {

            const added =
              await API.markup
                .addTextMarkup(
                  [markup]
                );

            for (
              const item
              of (added || [])
            ) {

              if (
                item?.id !==
                  undefined
                &&
                item?.id !==
                  null
              ) {

                ids.push(
                  item.id
                );
              }
            }

            placed++;

          } catch (
            singleError
          ) {

            console.error(
              'Label plaatsen mislukt',
              markup,
              singleError
            );
          }
        }

        activeMarkupIds =
          ids;

        if (!placed) {

          throw bulkError;
        }

        setStatus(
          `${placed} afzonderlijke label(s) geplaatst.`
        );
      }

    } catch (error) {

      console.error(
        'Labels plaatsen mislukt',
        error
      );

      setStatus(
        `Labels plaatsen mislukt: ${error?.message || error}`
      );
    }
  }

  /*
   * ============================================================
   * LABELS VERWIJDEREN
   * ============================================================
   */

  async function clearLabels(
    updateStatus = true
  ) {

    if (
      API &&
      activeMarkupIds.length
    ) {

      try {

        await API.markup
          .removeMarkups(
            activeMarkupIds
          );

      } catch (error) {

        console.warn(
          'Labels verwijderen mislukt',
          error
        );
      }
    }

    activeMarkupIds = [];

    if (updateStatus) {

      setStatus(
        'Alle door Altez Objectinfo geplaatste labels zijn verwijderd.'
      );
    }
  }

  function setStatus(
    text
  ) {

    $('status').textContent =
      text;
  }

  /*
   * ============================================================
   * EVENTS
   * ============================================================
   */

  $('refreshSelection')
    .addEventListener(
      'click',
      refreshSelection
    );

  $('presetSelect')
    .addEventListener(
      'change',
      renderPresetFields
    );

  $('newPreset')
    .addEventListener(
      'click',
      () =>
        openPresetDialog(null)
    );

  $('editPreset')
    .addEventListener(
      'click',
      () =>
        openPresetDialog(
          selectedPreset()
        )
    );

  $('deletePreset')
    .addEventListener(
      'click',
      () => {

        const preset =
          selectedPreset();

        if (
          preset.builtin
        ) {

          return;
        }

        saveCustomPresets(
          getCustomPresets()
            .filter(
              item =>
                item.id !==
                preset.id
            )
        );

        renderPresets(
          'builtin-mark'
        );
      }
    );

  $('addField')
    .addEventListener(
      'click',
      addDialogField
    );

  $('selectedFields')
    .addEventListener(
      'click',
      handleDialogFieldAction
    );

  $('selectedFields')
    .addEventListener(
      'change',
      handleDialogFieldAction
    );

  $('selectedFields')
    .addEventListener(
      'input',
      handleDialogFieldAction
    );

  $('presetForm')
    .addEventListener(
      'submit',
      savePresetFromDialog
    );

  $('colorPalette')
    .addEventListener(
      'click',
      event => {

        const swatch =
          event.target.closest(
            '.color-swatch'
          );

        if (swatch) {

          chooseColor(
            swatch.dataset.color
          );
        }
      }
    );

  $('placeLabels')
    .addEventListener(
      'click',
      placeLabels
    );

  $('clearLabels')
    .addEventListener(
      'click',
      () =>
        clearLabels(true)
    );

  /*
   * ============================================================
   * START
   * ============================================================
   */

  renderPresets();

  renderColorPalette();

  connect();

})();
