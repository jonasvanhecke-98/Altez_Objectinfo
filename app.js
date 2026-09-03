(() => {
  'use strict';

  /* =========================================================
     ALTEZ OBJECTINFO - V6
     ========================================================= */

  const STORAGE_KEY = 'altez-objectinfo-presets-v6';
  const DEFAULT_KEY = 'altez-objectinfo-default-v6';
  const COLOR_KEY = 'altez-objectinfo-color-v6';

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


  /* =========================================================
     ALGEMEEN
     ========================================================= */

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalize(value) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function compact(value) {
    return normalize(value)
      .replace(/[^a-z0-9]/g, '');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[character])
    );
  }

  function setStatus(text) {
    const element = $('status');

    if (element) {
      element.textContent = text;
    }
  }


  /* =========================================================
     WAARDE OMZETTEN NAAR TEKST
     ========================================================= */

  function safeValue(value) {

    if (
      value === null ||
      value === undefined
    ) {
      return '';
    }

    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (typeof value === 'object') {

      /*
       * Sommige propertywaarden kunnen zelf
       * value + unit bevatten.
       */

      if (
        Object.prototype.hasOwnProperty.call(
          value,
          'value'
        )
      ) {

        const raw =
          value.value;

        const unit =
          value.unit ||
          value.units ||
          '';

        if (unit) {
          return `${raw ?? ''} ${unit}`.trim();
        }

        return String(raw ?? '');
      }

      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }

    return String(value);
  }


  /* =========================================================
     RAW TRIMBLE PROPERTIES
     =========================================================

     BELANGRIJK:

     Hier voegen we GEEN parameters toe.

     Alles komt rechtstreeks uit:

     ObjectProperties.properties
       -> PropertySet
       -> Property
     ========================================================= */

  function flattenProperties(object) {

    const result = [];

    if (!object) {
      return result;
    }

    const propertySets =
      Array.isArray(object.properties)
        ? object.properties
        : [];

    for (const propertySet of propertySets) {

      if (!propertySet) {
        continue;
      }

      const setName =
        String(
          propertySet.set ?? ''
        ).trim();

      const properties =
        Array.isArray(propertySet.properties)
          ? propertySet.properties
          : [];

      for (const property of properties) {

        if (!property) {
          continue;
        }

        const propertyName =
          String(
            property.name ?? ''
          ).trim();

        if (!propertyName) {
          continue;
        }

        /*
         * Unit kan afhankelijk van de bron
         * op verschillende manieren aanwezig zijn.
         */

        let unit =
          property.unit ??
          property.units ??
          property.unitSymbol ??
          property.symbol ??
          '';

        /*
         * Indien value zelf een object is.
         */

        if (
          !unit &&
          property.value &&
          typeof property.value === 'object'
        ) {

          unit =
            property.value.unit ??
            property.value.units ??
            property.value.unitSymbol ??
            '';
        }

        result.push({
          set: setName,
          name: propertyName,
          type: property.type,
          value: property.value,
          unit: String(unit || '').trim()
        });
      }
    }

    return result;
  }


  /* =========================================================
     PARAMETER ID
     ========================================================= */

  function fieldKey(field) {

    return JSON.stringify([
      field?.set || '',
      field?.name || ''
    ]);
  }


  /* =========================================================
     ALLE ECHTE BESCHIKBARE PARAMETERS
     ========================================================= */

  function getAvailableFields() {

    const map =
      new Map();

    for (const row of selectionRows) {

      const properties =
        flattenProperties(
          row.object
        );

      for (const property of properties) {

        const key =
          fieldKey(property);

        if (!map.has(key)) {

          map.set(
            key,
            {
              set: property.set,
              name: property.name,
              label: property.name
            }
          );
        }
      }
    }

    return Array
      .from(map.values())
      .sort((a, b) => {

        const setA =
          a.set || '';

        const setB =
          b.set || '';

        const setCompare =
          setA.localeCompare(
            setB,
            undefined,
            {
              numeric: true,
              sensitivity: 'base'
            }
          );

        if (setCompare !== 0) {
          return setCompare;
        }

        return a.name.localeCompare(
          b.name,
          undefined,
          {
            numeric: true,
            sensitivity: 'base'
          }
        );
      });
  }


  /* =========================================================
     CAST UNIT MARK HERKENNEN
     =========================================================

     Alleen voor automatische preset "Merk".

     Er wordt GEEN Cast Unit Mark parameter
     kunstmatig aangemaakt.
     ========================================================= */

  function findCastUnitMarkField() {

    const fields =
      getAvailableFields();

    let best =
      null;

    let bestScore =
      0;

    for (const field of fields) {

      const name =
        compact(field.name);

      const full =
        compact(
          `${field.set} ${field.name}`
        );

      let score =
        0;

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

      if (
        score >
        bestScore
      ) {

        best =
          field;

        bestScore =
          score;
      }
    }

    return best;
  }


  /* =========================================================
     EENHEDEN
     ========================================================= */

  function normalizeUnit(unit) {

    let text =
      String(unit || '')
        .trim();

    if (!text) {
      return '';
    }

    /*
     * Nettere schrijfwijze.
     */

    text = text
      .replace(/\bm2\b/gi, 'm²')
      .replace(/\bm\^2\b/gi, 'm²')
      .replace(/\bm3\b/gi, 'm³')
      .replace(/\bm\^3\b/gi, 'm³')
      .replace(/\bmm2\b/gi, 'mm²')
      .replace(/\bmm\^2\b/gi, 'mm²')
      .replace(/\bmm3\b/gi, 'mm³')
      .replace(/\bmm\^3\b/gi, 'mm³');

    return text;
  }


  function valueAlreadyHasUnit(value) {

    const text =
      String(value || '')
        .trim();

    return (
      /\bmm\b$/i.test(text) ||
      /\bcm\b$/i.test(text) ||
      /\bdm\b$/i.test(text) ||
      /\bm\b$/i.test(text) ||

      /mm²$/i.test(text) ||
      /cm²$/i.test(text) ||
      /m²$/i.test(text) ||

      /mm2$/i.test(text) ||
      /cm2$/i.test(text) ||
      /m2$/i.test(text) ||

      /mm³$/i.test(text) ||
      /cm³$/i.test(text) ||
      /m³$/i.test(text) ||

      /mm3$/i.test(text) ||
      /cm3$/i.test(text) ||
      /m3$/i.test(text) ||

      /\bkg\b$/i.test(text) ||
      /\bton\b$/i.test(text) ||
      /\btonne\b$/i.test(text) ||
      /\bt\b$/i.test(text) ||

      /\bpa\b$/i.test(text) ||
      /\bkpa\b$/i.test(text) ||
      /\bmpa\b$/i.test(text) ||

      /\bkn\b$/i.test(text) ||
      /\bn\b$/i.test(text) ||

      /%$/.test(text)
    );
  }


  function detectUnit(property) {

    /*
     * =============================================
     * 1. EENHEID VAN TRIMBLE / MODEL
     * =============================================
     */

    if (property?.unit) {

      return normalizeUnit(
        property.unit
      );
    }


    /*
     * =============================================
     * 2. WAARDE ZELF BEVAT EENHEID
     * =============================================
     */

    const rawValue =
      safeValue(
        property?.value
      );

    if (
      valueAlreadyHasUnit(
        rawValue
      )
    ) {

      /*
       * Geen extra unit toevoegen.
       */

      return '';
    }


    /*
     * =============================================
     * 3. PARAMETERNAAM HERKENNEN
     * =============================================
     */

    const name =
      normalize(
        property?.name
      );

    const compactName =
      compact(
        property?.name
      );


    /*
     * OPPERVLAKTE
     */

    if (
      name.includes('area') ||
      name.includes('oppervlakte') ||
      name.includes('surface area') ||
      compactName.includes('netarea') ||
      compactName.includes('grossarea')
    ) {

      return 'm²';
    }


    /*
     * VOLUME / INHOUD
     */

    if (
      name.includes('volume') ||
      name.includes('inhoud') ||
      compactName.includes('netvolume') ||
      compactName.includes('grossvolume')
    ) {

      return 'm³';
    }


    /*
     * LENGTE

     * Alleen duidelijke lengtematen.
     */

    if (
      name === 'length' ||
      name === 'lengte' ||
      name.includes('total length') ||
      name.includes('totale lengte')
    ) {

      return 'm';
    }


    /*
     * GEWICHT / MASSA

     * Hier gaan we NIET automatisch kg gokken
     * wanneer de bron niets zegt.

     * Tekla Assembly/Cast unit weight kan
     * bijvoorbeeld afhankelijk van de bron
     * anders worden aangeleverd.
     */

    return '';
  }


  /* =========================================================
     PROPERTY OPZOEKEN
     ========================================================= */

  function findProperty(
    object,
    field
  ) {

    const properties =
      flattenProperties(
        object
      );


    /*
     * 1. Exact.
     */

    let property =
      properties.find(item =>

        item.set ===
          field.set

        &&

        item.name ===
          field.name
      );


    /*
     * 2. Case insensitive.
     */

    if (!property) {

      property =
        properties.find(item =>

          normalize(item.set) ===
            normalize(field.set)

          &&

          normalize(item.name) ===
            normalize(field.name)
        );
    }


    /*
     * 3. Cast Unit Mark fallback.
     */

    if (
      !property &&
      compact(field.name)
        .includes(
          'castunitmark'
        )
    ) {

      property =
        properties.find(item =>

          compact(item.name)
            .endsWith(
              'castunitmark'
            )
        );
    }


    return property ||
      null;
  }


  /* =========================================================
     PROPERTYWAARDE MET EENHEID
     ========================================================= */

  function fieldValue(
    object,
    field
  ) {

    const property =
      findProperty(
        object,
        field
      );

    if (!property) {
      return '';
    }


    let value =
      safeValue(
        property.value
      ).trim();


    if (!value) {
      return '';
    }


    /*
     * Heeft waarde zelf al een unit?
     */

    if (
      valueAlreadyHasUnit(
        value
      )
    ) {

      return value;
    }


    /*
     * Anders unit bepalen.
     */

    const unit =
      detectUnit(
        property
      );


    if (unit) {

      return `${value} ${unit}`;
    }


    return value;
  }


  /* =========================================================
     PRESETS
     ========================================================= */

  function getCustomPresets() {

    try {

      const value =
        JSON.parse(
          localStorage.getItem(
            STORAGE_KEY
          ) || '[]'
        );

      return Array.isArray(value)
        ? value
        : [];

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


  /* =========================================================
     STANDAARD PRESET MERK
     ========================================================= */

  function getDefaultPreset() {

    /*
     * Eerst opgeslagen Merk-preset.
     */

    try {

      const saved =
        JSON.parse(
          localStorage.getItem(
            DEFAULT_KEY
          ) || 'null'
        );


      if (
        saved &&
        Array.isArray(
          saved.fields
        ) &&
        saved.fields.length
      ) {

        const available =
          getAvailableFields();


        const validFields =
          saved.fields
            .map(savedField => {

              const match =
                available.find(field =>

                  field.set ===
                    savedField.set

                  &&

                  field.name ===
                    savedField.name
                );


              if (!match) {
                return null;
              }


              return {
                ...match,

                /*
                 * BELANGRIJK:
                 *
                 * Zelfgekozen "Naam in label"
                 * behouden.
                 */

                label:
                  savedField.label ||
                  match.name
              };
            })
            .filter(Boolean);


        if (
          validFields.length
        ) {

          return {
            id: 'builtin-mark',
            name: 'Merk',
            builtin: true,
            fields: validFields
          };
        }
      }

    } catch {}


    /*
     * Geen opgeslagen preset.
     *
     * Zoek echte Cast Unit Mark.
     */

    const mark =
      findCastUnitMarkField();


    return {
      id: 'builtin-mark',
      name: 'Merk',
      builtin: true,

      fields:
        mark
          ? [
              {
                ...mark,
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
      DEFAULT_KEY,

      JSON.stringify({
        fields:
          preset.fields
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

    const id =
      $('presetSelect').value;


    return (
      allPresets()
        .find(
          preset =>
            preset.id === id
        )

      ||

      getDefaultPreset()
    );
  }


  /* =========================================================
     PRESETS TONEN
     ========================================================= */

  function renderPresets(
    preferId
  ) {

    const select =
      $('presetSelect');


    if (!select) {
      return;
    }


    const presets =
      allPresets();


    const current =
      preferId ||
      select.value ||
      'builtin-mark';


    select.innerHTML =
      presets.map(
        preset =>
          `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`
      ).join('');


    if (
      presets.some(
        preset =>
          preset.id === current
      )
    ) {

      select.value =
        current;

    } else {

      select.value =
        'builtin-mark';
    }


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
            <b>Geen parameter ingesteld</b>
            <small>
              Selecteer een object en kies Preset aanpassen.
            </small>
          </span>
        `;

    } else {

      $('presetFields').innerHTML =
        preset.fields.map(field => {

          return `
            <span class="field-chip">

              <b>
                ${escapeHtml(
                  field.label ||
                  field.name
                )}
              </b>

              <small>
                ${escapeHtml(
                  field.set ||
                  'Zonder propertyset'
                )}
                →
                ${escapeHtml(
                  field.name
                )}
              </small>

            </span>
          `;
        }).join('');
    }


    $('editPreset').disabled =
      false;


    $('deletePreset')
      .style.visibility =

        preset.builtin
          ? 'hidden'
          : 'visible';
  }


  /* =========================================================
     TRIMBLE VERBINDING
     ========================================================= */

  async function connect() {

    try {

      if (
        !window.TrimbleConnectWorkspace ||
        window.parent === window
      ) {

        throw new Error(
          'Niet geopend in Trimble Connect'
        );
      }


      API =
        await TrimbleConnectWorkspace
          .connect(

            window.parent,

            onWorkspaceEvent,

            30000
          );


      $('connectionBadge')
        .textContent =
          'Trimble Connect';


      $('connectionBadge')
        .classList
        .add('ok');


      await refreshSelection();

    } catch (error) {

      console.error(
        'Trimble Connect verbinding:',
        error
      );


      API =
        null;


      $('connectionBadge')
        .textContent =
          'Preview';


      $('connectionBadge')
        .classList
        .add('demo');


      setStatus(
        'Open de extensie in Trimble Connect.'
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


  /* =========================================================
     SELECTIE + ECHTE PARAMETERS UITLEZEN
     ========================================================= */

  async function refreshSelection() {

    if (!API) {
      return;
    }


    setStatus(
      'Parameters uit Trimble Connect lezen...'
    );


    try {

      const rows =
        [];

      const seen =
        new Set();


      /* -----------------------------------------------------
         ROUTE 1
         getObjects({ selected: true })
         ----------------------------------------------------- */

      let selectedGroups =
        [];


      try {

        selectedGroups =
          await API.viewer
            .getObjects({
              selected: true
            })

          || [];

      } catch (error) {

        console.warn(
          'getObjects({selected:true}) mislukt:',
          error
        );
      }


      for (
        const group
        of selectedGroups
      ) {

        const modelId =
          group?.modelId;


        if (!modelId) {
          continue;
        }


        const selectedObjects =
          Array.isArray(
            group?.objects
          )
            ? group.objects
            : [];


        const runtimeIds =
          selectedObjects
            .map(
              object =>
                Number(
                  object?.id
                )
            )
            .filter(
              Number.isFinite
            );


        if (!runtimeIds.length) {
          continue;
        }


        let fullObjects =
          [];


        try {

          /*
           * BELANGRIJK:
           *
           * Volledige properties expliciet
           * bij Trimble opvragen.
           */

          fullObjects =
            await API.viewer
              .getObjectProperties(
                modelId,
                runtimeIds
              )

            || [];

        } catch (error) {

          console.error(
            'getObjectProperties mislukt:',
            modelId,
            runtimeIds,
            error
          );


          /*
           * Fallback op objecten uit getObjects.
           */

          fullObjects =
            selectedObjects;
        }


        for (
          const object
          of fullObjects
        ) {

          const runtimeId =
            Number(
              object?.id
            );


          if (
            !Number.isFinite(
              runtimeId
            )
          ) {
            continue;
          }


          const key =
            `${modelId}:${runtimeId}`;


          if (
            seen.has(key)
          ) {
            continue;
          }


          seen.add(key);


          rows.push({
            modelId,
            id: runtimeId,
            object
          });
        }
      }


      /* -----------------------------------------------------
         ROUTE 2
         fallback getSelection()
         ----------------------------------------------------- */

      if (!rows.length) {

        let selection =
          [];


        try {

          selection =
            await API.viewer
              .getSelection()

            || [];

        } catch (error) {

          console.warn(
            'getSelection mislukt:',
            error
          );
        }


        for (
          const group
          of selection
        ) {

          const modelId =
            group?.modelId;


          if (!modelId) {
            continue;
          }


          const runtimeIds =
            Array.isArray(
              group?.objectRuntimeIds
            )

              ? group
                  .objectRuntimeIds
                  .map(Number)
                  .filter(
                    Number.isFinite
                  )

              : [];


          if (!runtimeIds.length) {
            continue;
          }


          let fullObjects =
            [];


          try {

            fullObjects =
              await API.viewer
                .getObjectProperties(
                  modelId,
                  runtimeIds
                )

              || [];

          } catch (error) {

            console.error(
              'Fallback getObjectProperties mislukt:',
              error
            );

            continue;
          }


          for (
            const object
            of fullObjects
          ) {

            const runtimeId =
              Number(
                object?.id
              );


            if (
              !Number.isFinite(
                runtimeId
              )
            ) {
              continue;
            }


            const key =
              `${modelId}:${runtimeId}`;


            if (
              seen.has(key)
            ) {
              continue;
            }


            seen.add(key);


            rows.push({
              modelId,
              id: runtimeId,
              object
            });
          }
        }
      }


      /* -----------------------------------------------------
         RESULTAAT
         ----------------------------------------------------- */

      selectionRows =
        rows;


      const fields =
        getAvailableFields();


      $('selectedCount')
        .textContent =
          rows.length;


      $('markCount')
        .textContent =
          fields.length;


      if (!rows.length) {

        $('selectionHint')
          .textContent =
            'Selecteer één of meer elementen in de 3D Viewer.';


        renderPresets(
          $('presetSelect')?.value
        );


        setStatus(
          'Geen geselecteerde objecten gevonden.'
        );


        return;
      }


      $('selectionHint')
        .textContent =
          `${fields.length} parameters rechtstreeks uit Trimble gelezen.`;


      /* -----------------------------------------------------
         DEBUG

         F12 -> Console laat exact zien
         wat Trimble terugstuurt.
         ----------------------------------------------------- */

      console.group(
        'ALTEZ OBJECTINFO V6 - TRIMBLE PROPERTIES'
      );


      for (
        const row
        of rows
      ) {

        console.log(
          'Object:',
          {
            modelId:
              row.modelId,

            runtimeId:
              row.id,

            raw:
              row.object
          }
        );


        console.table(
          flattenProperties(
            row.object
          ).map(
            property => ({

              PropertySet:
                property.set,

              Property:
                property.name,

              Type:
                property.type,

              Value:
                safeValue(
                  property.value
                ),

              Unit:
                property.unit,

              DetectedUnit:
                detectUnit(
                  property
                )
            })
          )
        );
      }


      console.log(
        'Beschikbare parameters:',
        fields
      );


      console.groupEnd();


      /*
       * Presets pas NU opnieuw renderen.
       */

      renderPresets(
        $('presetSelect')?.value
      );


      setStatus(
        `${rows.length} object(en) - ${fields.length} parameters ingelezen.`
      );


    } catch (error) {

      console.error(
        'ALTEZ Objectinfo fout:',
        error
      );


      selectionRows =
        [];


      $('selectedCount')
        .textContent =
          '0';


      $('markCount')
        .textContent =
          '0';


      $('selectionHint')
        .textContent =
          'Selecteer één of meer elementen in de 3D Viewer.';


      renderPresets();


      setStatus(
        `Parameters uitlezen mislukt: ${error?.message || error}`
      );
    }
  }


  /* =========================================================
     PRESET EDITOR
     ========================================================= */

  function openPresetDialog(
    preset
  ) {

    editingPresetId =
      preset?.id ||
      null;


    $('dialogTitle')
      .textContent =

        preset
          ? `Preset ${preset.name} aanpassen`
          : 'Nieuwe preset';


    $('presetName')
      .value =
        preset?.name ||
        '';


    $('presetName')
      .disabled =
        !!preset?.builtin;


    dialogFields =
      clone(
        preset?.fields ||
        []
      );


    /*
     * Lege preset?
     *
     * Eerst echte Cast Unit Mark.
     * Anders eerste echte parameter.
     */

    if (!dialogFields.length) {

      const mark =
        findCastUnitMarkField();


      const first =
        mark ||
        getAvailableFields()[0];


      if (first) {

        dialogFields = [
          {
            ...first,

            label:
              mark
                ? 'Merk'
                : first.name
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
      available.map(field => {

        const setName =
          field.set ||
          'Zonder propertyset';


        return `
          <option value="${escapeHtml(fieldKey(field))}">
            ${escapeHtml(setName)}
            →
            ${escapeHtml(field.name)}
          </option>
        `;
      }).join('');


    $('selectedFields')
      .innerHTML =

        dialogFields.map(
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
                    title="Omhoog"
                  >
                    ↑
                  </button>

                  <button
                    type="button"
                    class="mini-btn"
                    data-action="down"
                    title="Omlaag"
                  >
                    ↓
                  </button>

                  <button
                    type="button"
                    class="mini-btn remove"
                    data-action="remove"
                    title="Verwijderen"
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
                    value="${escapeHtml(
                      field.label ||
                      field.name
                    )}"
                    maxlength="60"
                  >

                </label>

              </div>
            `;
          }
        ).join('');


    const rows =
      $('selectedFields')
        .querySelectorAll(
          '.preset-field-row'
        );


    rows.forEach(
      (row, index) => {

        const select =
          row.querySelector(
            '.parameter-select'
          );


        const key =
          fieldKey(
            dialogFields[index]
          );


        if (
          available.some(
            field =>
              fieldKey(field) === key
          )
        ) {

          select.value =
            key;
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
            fieldKey(field)
        )
      );


    const next =
      available.find(
        field =>
          !used.has(
            fieldKey(field)
          )
      );


    if (!next) {

      setStatus(
        'Geen extra parameter beschikbaar.'
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


    /* -----------------------------------------------------
       PARAMETER WIJZIGEN
       ----------------------------------------------------- */

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

        /*
         * BELANGRIJK:
         *
         * Bestaande "Naam in label"
         * NIET overschrijven.
         */

        const oldLabel =
          dialogFields[index]
            ?.label;


        dialogFields[index] = {
          ...selected,

          label:
            oldLabel ||
            selected.name
        };
      }
    }


    /* -----------------------------------------------------
       NAAM IN LABEL
       ----------------------------------------------------- */

    else if (
      action ===
      'label'
    ) {

      dialogFields[index].label =
        event.target.value;
    }


    /* -----------------------------------------------------
       VERWIJDEREN
       ----------------------------------------------------- */

    else if (
      action ===
      'remove'
    ) {

      dialogFields.splice(
        index,
        1
      );


      renderDialogFields();
    }


    /* -----------------------------------------------------
       OMHOOG
       ----------------------------------------------------- */

    else if (
      action === 'up' &&
      index > 0
    ) {

      [
        dialogFields[index - 1],
        dialogFields[index]
      ] = [
        dialogFields[index],
        dialogFields[index - 1]
      ];


      renderDialogFields();
    }


    /* -----------------------------------------------------
       OMLAAG
       ----------------------------------------------------- */

    else if (
      action === 'down' &&
      index <
        dialogFields.length - 1
    ) {

      [
        dialogFields[index + 1],
        dialogFields[index]
      ] = [
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


    if (!dialogFields.length) {

      setStatus(
        'Voeg minstens één parameter toe.'
      );

      return;
    }


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

      setStatus(
        'Geef de preset een naam.'
      );

      return;
    }


    /*
     * BELANGRIJK:
     *
     * label wordt expliciet opgeslagen.
     */

    const cleanFields =
      dialogFields.map(field => {

        const customLabel =
          String(
            field.label ||
            field.name
          ).trim();


        return {
          set:
            field.set,

          name:
            field.name,

          label:
            customLabel ||
            field.name
        };
      });


    if (isBuiltin) {

      saveDefaultPreset({
        fields:
          cleanFields
      });


      $('presetDialog')
        .close();


      renderPresets(
        'builtin-mark'
      );


      setStatus(
        'Preset Merk opgeslagen.'
      );


      return;
    }


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


      if (index >= 0) {

        presets[index] = {
          ...presets[index],

          name,

          fields:
            cleanFields
        };
      }

    } else {

      id =
        `preset-${Date.now()}`;


      presets.push({
        id,
        name,
        fields:
          cleanFields
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


  /* =========================================================
     KLEUREN
     ========================================================= */

  function renderColorPalette() {

    $('colorPalette')
      .innerHTML =

        TRIMBLE_COLORS.map(
          color => {

            const selected =
              color.toLowerCase() ===
              selectedColor.toLowerCase();


            return `
              <button
                type="button"
                class="color-swatch${selected ? ' selected' : ''}"
                data-color="${color}"
                style="--swatch:${color}"
                title="${color}"
              ></button>
            `;
          }
        ).join('');


    $('currentColor')
      .style
      .setProperty(
        '--swatch',
        selectedColor
      );
  }


  function chooseColor(
    color
  ) {

    selectedColor =
      color;


    localStorage.setItem(
      COLOR_KEY,
      color
    );


    renderColorPalette();
  }


  function colorToRGBA(
    hex
  ) {

    const number =
      parseInt(
        hex.substring(1),
        16
      );


    return {
      r:
        (number >> 16) & 255,

      g:
        (number >> 8) & 255,

      b:
        number & 255,

      a:
        255
    };
  }


  /* =========================================================
     BOUNDING BOX
     ========================================================= */

  function bboxCenter(
    box,
    fallback
  ) {

    const bb =
      box?.boundingBox;


    if (
      bb?.min &&
      bb?.max
    ) {

      return {

        x:
          (
            Number(bb.min.x) +
            Number(bb.max.x)
          ) / 2,

        y:
          (
            Number(bb.min.y) +
            Number(bb.max.y)
          ) / 2,

        z:
          (
            Number(bb.min.z) +
            Number(bb.max.z)
          ) / 2,


        sizeX:
          Math.abs(
            Number(bb.max.x) -
            Number(bb.min.x)
          ),

        sizeY:
          Math.abs(
            Number(bb.max.y) -
            Number(bb.min.y)
          ),

        sizeZ:
          Math.abs(
            Number(bb.max.z) -
            Number(bb.min.z)
          )
      };
    }


    if (fallback) {

      return {
        x:
          Number(fallback.x) || 0,

        y:
          Number(fallback.y) || 0,

        z:
          Number(fallback.z) || 0,

        sizeX: 1,
        sizeY: 1,
        sizeZ: 1
      };
    }


    return null;
  }


  function labelPosition(
    center,
    index
  ) {

    const size =
      Math.max(
        center.sizeX || 0,
        center.sizeY || 0,
        center.sizeZ || 0,
        1
      );


    const distance =
      Math.max(
        1,
        size * 0.75
      );


    const angle =
      (index % 8) *
      Math.PI / 4;


    return {

      x:
        center.x +
        Math.cos(angle) *
        distance,

      y:
        center.y +
        Math.sin(angle) *
        distance,

      z:
        center.z +
        Math.max(
          0.6,
          (center.sizeZ || 1) *
          0.4
        )
    };
  }


  /* =========================================================
     LABELTEKST MAKEN
     ========================================================= */

  function buildLabelLines(
    object,
    preset,
    hideEmpty
  ) {

    const lines =
      [];


    for (
      const field
      of preset.fields
    ) {

      const value =
        fieldValue(
          object,
          field
        );


      const hasValue =
        String(value || '')
          .trim() !== '';


      if (
        hideEmpty &&
        !hasValue
      ) {
        continue;
      }


      /*
       * BELANGRIJK:
       *
       * Ook bij 1 parameter wordt nu
       * "Naam in label" getoond.
       *
       * Bijvoorbeeld:
       *
       * Merk: K12
       *
       * of
       *
       * Oppervlakte: 42.50 m²
       */

      const label =
        String(
          field.label ||
          field.name
        ).trim();


      lines.push(
        `${label}: ${hasValue ? value : '-'}`
      );
    }


    return lines;
  }


  /* =========================================================
     LABELS PLAATSEN
     ========================================================= */

  async function placeLabels() {

    if (!API) {

      setStatus(
        'Geen verbinding met Trimble Connect.'
      );

      return;
    }


    if (!selectionRows.length) {

      setStatus(
        'Selecteer eerst één of meer objecten.'
      );

      return;
    }


    const preset =
      selectedPreset();


    if (!preset.fields.length) {

      setStatus(
        'De gekozen preset bevat geen parameters.'
      );

      return;
    }


    await clearLabels(false);


    const color =
      colorToRGBA(
        selectedColor
      );


    const hideEmpty =
      $('hideEmpty').checked;


    const markups =
      [];


    /*
     * =====================================================
     * GEEN GROEPERING
     *
     * Iedere geselecteerde runtime-ID krijgt
     * zijn eigen label.
     * =====================================================
     */

    for (
      let index = 0;
      index < selectionRows.length;
      index++
    ) {

      const row =
        selectionRows[index];


      const lines =
        buildLabelLines(
          row.object,
          preset,
          hideEmpty
        );


      if (!lines.length) {
        continue;
      }


      let box =
        null;


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
                Number(item?.id) ===
                Number(row.id)
            )

          ||

          boxes?.[0]

          ||

          null;


      } catch (error) {

        console.warn(
          'Bounding box fout:',
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
          'Geen positie gevonden voor:',
          row.id
        );

        continue;
      }


      const end =
        labelPosition(
          center,
          index
        );


      markups.push({

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


    if (!markups.length) {

      setStatus(
        'Geen labels om te plaatsen.'
      );

      return;
    }


    try {

      /*
       * Eerst in één keer.
       */

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
              id !== undefined &&
              id !== null
          );


      setStatus(
        `${markups.length} afzonderlijke label(s) geplaatst.`
      );


    } catch (bulkError) {

      console.warn(
        'Bulk plaatsen mislukt, individueel proberen:',
        bulkError
      );


      activeMarkupIds =
        [];


      let placed =
        0;


      /*
       * Fallback één per één.
       */

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
            const result
            of (added || [])
          ) {

            if (
              result?.id !== undefined &&
              result?.id !== null
            ) {

              activeMarkupIds.push(
                result.id
              );
            }
          }


          placed++;


        } catch (error) {

          console.error(
            'Individueel label mislukt:',
            error
          );
        }
      }


      setStatus(
        `${placed} afzonderlijke label(s) geplaatst.`
      );
    }
  }


  /* =========================================================
     LABELS VERWIJDEREN
     ========================================================= */

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
          'Labels verwijderen mislukt:',
          error
        );
      }
    }


    activeMarkupIds =
      [];


    if (updateStatus) {

      setStatus(
        'Labels verwijderd.'
      );
    }
  }


  /* =========================================================
     EVENTS
     ========================================================= */

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


        if (preset.builtin) {
          return;
        }


        const presets =
          getCustomPresets()
            .filter(
              item =>
                item.id !==
                preset.id
            );


        saveCustomPresets(
          presets
        );


        renderPresets(
          'builtin-mark'
        );


        setStatus(
          'Preset verwijderd.'
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


  /* =========================================================
     START
     ========================================================= */

  renderPresets();

  renderColorPalette();

  connect();

})();
