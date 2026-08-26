/**
 * RH Payout-Tabellen — Multi-Auswahl für Rollhunt Min-Multi.
 */
(function (global) {
  /** @type {{ version: number, games: Record<string, object> } | null} */
  let tables = null;
  let loadPromise = null;
  let wired = false;

  async function load() {
    if (tables) return tables;
    if (loadPromise) return loadPromise;
    loadPromise = fetch('./lib/rh-payout-tables.json')
      .then((r) => (r.ok ? r.json() : { games: {} }))
      .then((data) => {
        tables = data && typeof data === 'object' ? data : { games: {} };
        return tables;
      })
      .catch(() => {
        tables = { games: {} };
        return tables;
      });
    return loadPromise;
  }

  function getGameTable(game) {
    return tables?.games?.[game] || null;
  }

  function fillSelect(el, options, { placeholder = '—' } = {}) {
    if (!el) return;
    el.innerHTML = `<option value="">${placeholder}</option>${(options || [])
      .map((o) => `<option value="${o.value}">${o.text}</option>`)
      .join('')}`;
  }

  function optionsToSelect(opts) {
    return (opts || []).map((o) => ({
      value: String(o.multi),
      text: o.label
    }));
  }

  function refresh(game, elements) {
    const { wrap, variantEl, multiEl, minMultiEl } = elements;
    if (!wrap) return;

    const table = getGameTable(game);
    if (!table) {
      wrap.classList.add('hidden');
      fillSelect(variantEl, []);
      fillSelect(multiEl, []);
      return;
    }

    wrap.classList.remove('hidden');

    if (table.type === 'variants') {
      const variantLabel = variantEl?.closest('label');
      variantLabel?.classList.remove('hidden');
      variantEl?.classList.remove('hidden');
      const variants = table.variants || [];
      fillSelect(
        variantEl,
        variants.map((v) => ({
          value: v.id,
          text: v.setup ? `${v.label} (${v.setup})` : v.label
        })),
        { placeholder: game === 'Mines' ? 'Anzahl Minen' : 'Schwierigkeit / Setting' }
      );
      const first = variants[0];
      if (first && variantEl) {
        variantEl.value = first.id;
        fillSelect(multiEl, optionsToSelect(first.options), { placeholder: 'Multi aus Tabelle' });
      } else {
        fillSelect(multiEl, [], { placeholder: 'Multi aus Tabelle' });
      }
    } else {
      const variantLabel = variantEl?.closest('label');
      variantLabel?.classList.add('hidden');
      variantEl?.classList.add('hidden');
      fillSelect(multiEl, optionsToSelect(table.options), { placeholder: 'Multi aus Tabelle' });
    }

    const optionCount = Math.max(0, (multiEl?.options?.length || 1) - 1);
    if (multiEl) {
      multiEl.title = optionCount ? `${optionCount} Multis in Payout-Tabelle` : '';
      multiEl.size = 1;
      multiEl.classList.remove('rh-payout-multi--list');
    }

    // Select a payout row for display, but never overwrite the RH min-multi field here —
    // that field belongs to the active session / manual input. Sync only on user change
    // (multi/variant select) or when switching games in the RH form.
    if (multiEl && multiEl.options.length > 1) {
      const currentMin = Number(minMultiEl?.value) || 0;
      const match =
        currentMin > 0
          ? [...multiEl.options].find((o) => o.value && Number(o.value) === currentMin)
          : null;
      if (match) multiEl.value = match.value;
      else if (!multiEl.value) multiEl.selectedIndex = 1;
    }
  }

  function onVariantChange(game, elements) {
    const table = getGameTable(game);
    if (!table || table.type !== 'variants') return;
    const id = elements.variantEl?.value;
    const variant = (table.variants || []).find((v) => v.id === id);
    fillSelect(elements.multiEl, optionsToSelect(variant?.options || []), {
      placeholder: 'Multi aus Tabelle'
    });
    const optionCount = Math.max(0, (elements.multiEl?.options?.length || 1) - 1);
    if (elements.multiEl) {
      elements.multiEl.title = optionCount ? `${optionCount} Multis in Payout-Tabelle` : '';
      elements.multiEl.size = 1;
      elements.multiEl.classList.remove('rh-payout-multi--list');
      if (optionCount > 0) {
        elements.multiEl.selectedIndex = 1;
        if (elements.minMultiEl && elements.multiEl.value) {
          elements.minMultiEl.value = elements.multiEl.value;
        }
      }
    }
  }

  function wire(elements) {
    if (wired) return;
    wired = true;
    elements.variantEl?.addEventListener('change', () => {
      onVariantChange(elements.getGame(), elements);
    });
    elements.multiEl?.addEventListener('change', () => {
      const v = Number(elements.multiEl?.value);
      if (v > 0 && elements.minMultiEl) elements.minMultiEl.value = String(v);
    });
  }

  async function init(elements) {
    await load();
    wire(elements);
    return tables;
  }

  global.RhPayoutTables = {
    load,
    init,
    refresh,
    getGameTable,
    hasGame(game) {
      return !!getGameTable(game);
    }
  };
})(window);
