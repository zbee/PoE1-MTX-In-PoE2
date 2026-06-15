// ==UserScript==
// @name         PoE1 MTX In PoE2 Helper
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Displays PoE2 availability for each item in the PoE1 item shop.
// @author       Ethan Henderson (zbee)
// @match        https://www.pathofexile.com/shop/category/*
// @match        https://www.pathofexile.com/shop/item/*
// @grant        none
// @connect      p1mip2.zbee.codes
// @run-at       document-end
// @updateURL    https://github.com/zbee/PoE1-MTX-In-PoE2/raw/refs/heads/main/user_script/poe1_mtx_in_poe2_helper.user.js
// @downloadURL  https://github.com/zbee/PoE1-MTX-In-PoE2/raw/refs/heads/main/user_script/poe1_mtx_in_poe2_helper.user.js
// ==/UserScript==

/*
PoE1-MTX-In-PoE2: A tool to shop PoE1 items for PoE2 with confidence.
Copyright (C) 2026  Ethan Henderson (zbee)

This program is free software: you can redistribute it and/or modify it under the terms of
the GNU General Public License as published by the Free Software Foundation, either version
3 of the License, or (at your option) any later version.
*/

(function () {
    'use strict';

    const WORKER_URL = 'https://p1mip2.zbee.codes';
    const CACHE_KEY = 'poe1_mtx_';
    const CACHE_TTL = 5 * 60 * 60 * 1000; // default 5h fallback
    const ERROR_CACHE_TTL = 2 * 60 * 60 * 1000; // 2h
    const SUCCESS_CACHE_TTL = 5 * 24 * 60 * 60 * 1000; // 5d

    const CSS_PREFIX = 'p1mip2';
    const INDICATOR_SELECTOR = `.${CSS_PREFIX}-indicator`;
    const P1MIP2 = {
        indicator: `${CSS_PREFIX}-indicator`,
        prefix: `${CSS_PREFIX}-prefix`,
        icon: `${CSS_PREFIX}-icon`,
        link: `${CSS_PREFIX}-p2-link`,
        tooltip: `${CSS_PREFIX}-tooltip`,
        popupWrapper: `${CSS_PREFIX}-popup-indicator-wrapper`,
        popupCostOverlay: `${CSS_PREFIX}-popup-cost-overlay`,
        modalIndicator: `${CSS_PREFIX}-modal-indicator`,
        status: {
            available: `${CSS_PREFIX}-available`,
            partial: `${CSS_PREFIX}-partial`,
            unavailable: `${CSS_PREFIX}-unavailable`,
            error: `${CSS_PREFIX}-error`,
            loading: `${CSS_PREFIX}-loading`,
        },
    };

    const STATUS_SYMBOL = {
        available: '&#x2714;', // Checkmark ✓
        partial: '&#x25D0;',   // Half-filled circle ◐
        unavailable: '&#x2716;', // Cross X ✖
        error: '&#x3F;',       // Question ?
        loading: '&#x23F1;',   // Timer ⏱
    };

    // --- Styles for Indicators & Tooltips ---
    const style = document.createElement('style');
    style.textContent = `
        .${P1MIP2.indicator} {
            position: absolute; top: 4px; right: 4px;
            font-size: 11px; font-weight: bold; z-index: 100;
            padding: 1px 4px; border-radius: 3px;
            background: rgba(0,0,0,0.92);
            text-shadow: 1px 1px 1px rgba(0,0,0,0.8);
            cursor: help;
            display: inline-flex; align-items: center; gap: 2px;
            min-width: 55px; justify-content: center;
        }

        .${P1MIP2.prefix} { color: #fff; margin-right: 2px; }

        .${P1MIP2.icon} { font-size: 12px; font-weight: 700; line-height: 1; }
        .${P1MIP2.link} { color: #4aa4ff; font-size: 12px; line-height: 1; text-decoration: none; margin-left: 4px; }
        .${P1MIP2.link}:hover { text-decoration: underline; }

        .${P1MIP2.status.available}.${P1MIP2.icon} { color: #50C878 !important; }
        .${P1MIP2.status.partial}.${P1MIP2.icon} { color: #FFB347 !important; }
        .${P1MIP2.status.unavailable}.${P1MIP2.icon} { color: #FF4136 !important; }
        .${P1MIP2.status.error}.${P1MIP2.icon} { color: #FFD700 !important; }
        .${P1MIP2.status.loading}.${P1MIP2.icon} { color: #FFFFFF !important; }

        .${P1MIP2.tooltip} {
            visibility: hidden; width: max-content;
            background-color: #1a1a1a; color: #fff;
            text-align: center; border-radius: 4px; padding: 4px 6px;
            position: absolute; z-index: 1000; bottom: 125%; left: 50%;
            transform: translateX(-50%);
            opacity: 0; transition: opacity 0.2s;
            font-size: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.4);
            pointer-events: none; border: 1px solid #333;
            white-space: nowrap;
        }
        .${P1MIP2.indicator}:hover .${P1MIP2.tooltip} { visibility: visible; opacity: 1; }
        .${P1MIP2.tooltip}::after {
            content: ""; position: absolute; top: 100%; left: 50%;
            margin-left: -4px; border-width: 4px; border-style: solid;
            border-color: #1a1a1a transparent transparent transparent;
        }

        .${P1MIP2.popupWrapper} {
            position: absolute; top: 50%; display: inline-flex;
            align-items: center; gap: 4px;
            white-space: nowrap; overflow: visible;
            pointer-events: none; z-index: 10001;
            min-width: 100px; max-width: 280px;
        }

        .${P1MIP2.indicator}.${P1MIP2.modalIndicator} {
            position: static; top: auto; right: auto;
            min-width: auto; padding: 1px 6px;
            white-space: nowrap;
        }

        .${P1MIP2.popupCostOverlay} {
            position: absolute; top: 0; right: calc(100% + 10px);
            z-index: 10000; pointer-events: auto;
            display: inline-flex; align-items: center; gap: 4px;
        }

        .${P1MIP2.popupCostOverlay} .${P1MIP2.indicator} {
            pointer-events: auto;
        }
    `;
    document.head.appendChild(style);

    const ITEM_SELECTOR = '.shopItemBase.shopItem, .shopItemBase.shopItemPackage, .shopItem, .shopItemPackage';
    const POPUP_MODAL_SELECTOR = '#cboxContent .shopBuyItemModal';
    const POPUP_LINEITEM_SELECTOR = '.lineItems .lineItem[data-id]';
    const POPUP_SINGLE_ITEM_SELECTOR = '.content .costRow .totalCost';
    const ITEM_RENDER_DELAY = 260;
    const INITIAL_RENDER_DELAY = 280;
    const INITIAL_ITEM_BATCH = 12;

    let observer = null;
    let pendingQueue = [];
    let batchTimeout = null;
    let lastTrackedInfo = '';
    let lastSearchQuery = location.search;
    const pendingRenderTimeouts = new WeakMap();

    // --- Local Storage Cache Helpers ---

    /**
     * Reads a cached item result from localStorage.
     * @param {string} id The PoE1 item identifier.
     * @returns {object|null} The cached entry or null if missing/expired.
     */
    function getCache(id) {
        try {
            const raw = localStorage.getItem(CACHE_KEY + id);
            if (!raw) return null;
            const data = JSON.parse(raw);
            const ttl = typeof data.ttl === 'number' ? data.ttl : CACHE_TTL;
            if (Date.now() - data.timestamp > ttl) {
                localStorage.removeItem(CACHE_KEY + id);
                return null;
            }
            return data;
        } catch (e) {
            console.error('[PoE1-MTX-In-PoE2-Helper] Cache read error:', e);
            return null;
        }
    }

    /**
     * Writes a result entry to localStorage.
     * @param {string} id The PoE1 item identifier.
     * @param {string} status The status to save.
     * @param {string} detail A tooltip detail message.
     * @param {string|null} errorLocation Optional error location text.
     * @param {string|null} poe2Link Optional derived PoE2 link.
     */
    function setCache(id, status, detail, errorLocation = null, poe2Link = null) {
        try {
            const ttl = status === 'error' ? ERROR_CACHE_TTL : SUCCESS_CACHE_TTL;
            localStorage.setItem(CACHE_KEY + id, JSON.stringify({
                timestamp: Date.now(), ttl, status, detail, errorLocation, poe2Link
            }));
        } catch (e) {
            console.error('[PoE1-MTX-In-PoE2-Helper] Cache write error:', e);
        }
    }

    /**
     * Returns the symbol to render for a given availability status.
     * @param {string} status One of 'available', 'partial', 'unavailable', 'error', or 'loading'.
     * @returns {string} The HTML entity for the status icon.
     */
    function getStatusSymbol(status) {
        return STATUS_SYMBOL[status] || STATUS_SYMBOL.loading;
    }

    /**
     * Returns the CSS class for the given status.
     * @param {string} status Availability status.
     * @returns {string} The CSS class name for the icon state.
     */
    function getStatusClass(status) {
        return P1MIP2.status[status] || P1MIP2.status.loading;
    }

    /**
     * Builds the tooltip text for a rendered status indicator.
     * @param {string} status The availability status.
     * @param {string|null} detail Tooltip detail message.
     * @param {string|null} errorLocation Optional error origin.
     * @returns {string} The final tooltip content.
     */
    function buildTooltipText(status, detail, errorLocation = null) {
        switch (status) {
            case 'available':
                return detail || 'Available in PoE2';
            case 'partial':
                return detail || 'Partially available';
            case 'unavailable':
                return detail || 'Not available in PoE2';
            case 'error': {
                const prefix = errorLocation ? `Error at: ${errorLocation}` : 'Unknown error';
                return `${prefix}\n${detail || ''}`.trim();
            }
            default:
                return 'Checking availability...';
        }
    }

    /**
     * Removes an existing indicator from a target container if present.
     * @param {HTMLElement} container The element to clean.
     */
    function removeExistingIndicator(container) {
        const existing = container.querySelector(INDICATOR_SELECTOR);
        if (existing) existing.remove();
    }

    /**
     * Creates the availability overlay indicator for a shop item.
     * @param {string} status One of 'available', 'partial', 'unavailable', 'error', or 'loading'.
     * @param {string|null} detail Tooltip detail text.
     * @param {string|null} errorLocation Optional error location text.
     * @param {string|null} poe2Link Optional PoE2 URL to link.
     * @returns {HTMLElement} The rendered indicator element.
     */
    function createIndicator(status, detail, errorLocation = null, poe2Link = null, extraClass = '') {
        const span = document.createElement('span');
        span.className = `${P1MIP2.indicator} ${extraClass}`.trim();

        const iconHtml = getStatusSymbol(status);
        const iconClass = getStatusClass(status);
        const tooltipText = buildTooltipText(status, detail, errorLocation);

        span.innerHTML = `
            <span class="${P1MIP2.prefix}">in 2:</span>
            <span class="${P1MIP2.icon} ${iconClass}">${iconHtml}</span>
            ${poe2Link ? `<a class="${P1MIP2.link}" href="${poe2Link}" target="_blank" rel="noopener noreferrer" title="View on PoE2DB" onclick="event.stopPropagation();" onmousedown="event.stopPropagation();">&#x2197;</a>` : ''}
            <div class="${P1MIP2.tooltip}">${tooltipText}</div>
        `;

        return span;
    }

    function createPopupIndicator(status, detail, errorLocation = null, poe2Links = [], extraClass = '') {
        const span = document.createElement('span');
        span.className = `${P1MIP2.indicator} ${extraClass}`.trim();

        const iconHtml = getStatusSymbol(status);
        const iconClass = getStatusClass(status);
        const tooltipText = buildTooltipText(status, detail, errorLocation);

        const linksHtml = Array.isArray(poe2Links) && poe2Links.length > 0
            ? poe2Links.map((url, index) => `
                <a class="${P1MIP2.link}" href="${url}" target="_blank" rel="noopener noreferrer" title="View item ${index + 1} on PoE2DB" onclick="event.stopPropagation();" onmousedown="event.stopPropagation();">&#x2197;</a>
            `).join('')
            : '';

        span.innerHTML = `
            <span class="${P1MIP2.prefix}">in 2:</span>
            <span class="${P1MIP2.icon} ${iconClass}">${iconHtml}</span>
            ${linksHtml}
            <div class="${P1MIP2.tooltip}">${tooltipText}</div>
        `;

        return span;
    }

    /**
     * Normalizes a list of IDs by trimming and removing duplicates.
     * @param {string[]} ids The raw ID list.
     * @returns {string[]} Normalized IDs.
     */
    function normalizeIds(ids) {
        return [...new Set(ids.map(id => (id || '').trim()).filter(Boolean))];
    }

    /**
     * Removes any existing availability overlay from a target container.
     * @param {HTMLElement} target The container element.
     */
    function removeIndicator(target) {
        const existing = target.querySelector(INDICATOR_SELECTOR);
        if (existing) existing.remove();
    }

    /**
     * Determines the item type by inspecting its DOM contents.
     * @param {HTMLElement} itemDiv The shop item element.
     * @returns {'PACK'|'VARIANT'|'SINGLE'} The detected item type.
     */
    function detectItemType(itemDiv) {
        if (getPackComponents(itemDiv).length > 0) return 'PACK';
        if (getVariantComponents(itemDiv).length > 0) return 'VARIANT';
        return 'SINGLE';
    }

    /**
     * Reads component IDs from a pack item.
     * @param {HTMLElement} itemDiv The pack item element.
     * @returns {string[]} List of component IDs.
     */
    function getPackComponents(itemDiv) {
        return Array.from(itemDiv.querySelectorAll('.lineItem'))
            .map(li => (li.getAttribute('data-id') || '').trim())
            .filter(Boolean);
    }

    /**
     * Reads variant IDs from a variant item.
     * @param {HTMLElement} itemDiv The variant item element.
     * @returns {string[]} List of variant IDs.
     */
    function getVariantComponents(itemDiv) {
        return Array.from(itemDiv.querySelectorAll('.variant[data-variant]'))
            .map(el => (el.getAttribute('data-variant') || '').trim())
            .filter(Boolean);
    }

    // --- Core Logic ---

    /**
     * Checks a shop item for PoE2 availability and queues a worker fetch.
     * @param {HTMLElement} itemDiv The shop item element.
     */
    async function checkItem(itemDiv) {
        const itemId = itemDiv.id;
        const cached = getCache(itemId);
        if (cached) {
            renderIndicator(itemDiv, cached.status, cached.detail, cached.errorLocation, cached.poe2Link);
            return;
        }

        const type = detectItemType(itemDiv);
        let ids = [];

        if (type === 'PACK') {
            ids = getPackComponents(itemDiv);
        } else if (type === 'VARIANT') {
            ids = getVariantComponents(itemDiv);
        } else {
            ids = [itemId];
        }

        ids = normalizeIds(ids);

        if (ids.length === 0) {
            const errorMsg = type === 'PACK'
                ? 'Pack contains no valid component IDs'
                : type === 'VARIANT'
                    ? 'Variant contains no valid IDs'
                    : 'No valid ID found';
            console.warn('[PoE1-MTX-In-PoE2-Helper] skipping fetch due to empty ids', { itemId, type, ids });
            setCache(itemId, 'error', errorMsg, 'Item Extraction');
            renderIndicator(itemDiv, 'error', errorMsg, 'Item Extraction', null);
            return;
        }

        if (type === 'PACK' || type === 'VARIANT') {
            itemDiv.dataset.pendingIds = JSON.stringify(ids);
        }

        queueFetch(ids, itemId, type);
    }

    /**
     * Adds a shop item to the pending worker batch queue.
     * @param {string[]} ids The worker IDs to fetch.
     * @param {string} targetId The item element ID.
     * @param {'PACK'|'VARIANT'|'SINGLE'} type The item type.
     */
    function queueFetch(ids, targetId, type, popupTarget = null, popupExtraClass = '') {
        const componentMap = (type === 'PACK' || type === 'VARIANT') ? ids : null;

        pendingQueue.push({ ids: [...ids], targetId, type, componentMap, popupTarget, popupExtraClass });
        console.log('[PoE1-MTX-In-PoE2-Helper] queued fetch for item', targetId, 'ids', ids, 'type', type);

        if (batchTimeout) clearTimeout(batchTimeout);
        batchTimeout = setTimeout(processBatchQueue, 20);
    }

    /**
     * Extracts the PoE2 URL returned by the worker for the target.
     * @param {object} target The target batch entry.
     * @param {Object<string, object>} resultMap Map of worker response objects.
     * @returns {string|null} The PoE2 URL or null.
     */
    function getPoe2LinkFromWorkerResult(target, resultMap) {
        if (target.type === 'SINGLE') {
            return resultMap[target.targetId]?.checkedUrl || null;
        }

        if (target.type === 'PACK' || target.type === 'VARIANT') {
            const compIds = target.componentMap || [];
            const compResults = compIds.map(id => resultMap[id]).filter(Boolean);
            return compResults[0]?.checkedUrl || null;
        }

        return null;
    }

    /**
     * Sends batches of pending IDs to the worker and applies responses to tracked items.
     */
    async function processBatchQueue() {
        if (pendingQueue.length === 0) return;

        const batches = pendingQueue.splice(0, pendingQueue.length);
        const allIds = normalizeIds(batches.flatMap(batch => batch.ids));
        if (allIds.length === 0) return;

        try {
            const params = new URLSearchParams();
            allIds.forEach(id => params.append('ids', id));
            const workerUrl = `${WORKER_URL}?${params.toString()}`;

            console.log('[PoE1-MTX-In-PoE2-Helper] worker fetch batch for items', batches.map(b => b.targetId), 'workerUrl', workerUrl, 'ids', allIds);
            const res = await fetch(workerUrl);

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }

            const data = await res.json();
            const results = Array.isArray(data) ? data : [data];

            const resultMap = {};
            results.forEach(r => resultMap[r.id] = r);

            for (const batch of batches) {
                if (batch.ids.length === 0) continue;

                let finalStatus = 'error';
                let detail = 'Unknown error';
                let errorLocation = null;

                if (batch.type === 'SINGLE') {
                    const r = resultMap[batch.targetId];
                    if (r) {
                        if (r.error) {
                            finalStatus = 'error';
                            errorLocation = determineErrorLocation(r.debug?.reason, r.httpStatus);
                            detail = buildErrorMessage(r.error, r.debug?.reason);
                        } else {
                            finalStatus = r.available ? 'available' : 'unavailable';
                            detail = r.available ? 'Available in PoE2' : 'Not found on poe2db.tw';
                        }
                    } else {
                        finalStatus = 'error';
                        errorLocation = 'Worker Response';
                        detail = 'Item ID not in response';
                    }
                } else if (batch.type === 'PACK' || batch.type === 'VARIANT') {
                    const compIds = batch.componentMap || [];
                    const compResults = compIds.map(id => resultMap[id]).filter(Boolean);

                    const availCount = compResults.filter(r => !r.error && r.available).length;
                    const total = compResults.length;

                    if (total === 0) {
                        finalStatus = 'error';
                        errorLocation = batch.type === 'VARIANT' ? 'Variant Components' : 'Pack Components';
                        detail = batch.type === 'VARIANT'
                            ? 'No variants extracted from item'
                            : 'No components extracted from pack';
                    } else if (availCount === total) {
                        finalStatus = 'available';
                        detail = batch.type === 'VARIANT'
                            ? `All ${total} variants available in PoE2`
                            : `All ${total} items available in PoE2`;
                    } else if (availCount > 0) {
                        finalStatus = 'partial';
                        detail = batch.type === 'VARIANT'
                            ? `${availCount}/${total} variants available in PoE2`
                            : `${availCount}/${total} items available in PoE2`;
                    } else {
                        finalStatus = 'unavailable';
                        detail = batch.type === 'VARIANT'
                            ? `None of the ${total} variants available in PoE2`
                            : `None of the ${total} items available in PoE2`;
                    }
                }

                setCache(batch.targetId, finalStatus, detail, errorLocation);

                const poe2Link = getPoe2LinkFromWorkerResult(batch, resultMap);
                setCache(batch.targetId, finalStatus, detail, errorLocation, poe2Link);

                const item = document.getElementById(batch.targetId);
                if (item) {
                    const loader = item.querySelector(INDICATOR_SELECTOR);
                    if (loader) loader.remove();
                    renderIndicator(item, finalStatus, detail, errorLocation, poe2Link);
                }
                if (batch.popupTarget && document.contains(batch.popupTarget)) {
                    const poe2Links = (batch.type === 'SINGLE')
                        ? (poe2Link ? [poe2Link] : [])
                        : (batch.componentMap || []).map(id => resultMap[id]).filter(Boolean).map(r => r.checkedUrl).filter(Boolean);
                    renderPopupIndicator(batch.popupTarget, finalStatus, detail, errorLocation, poe2Links, batch.popupExtraClass);
                }
            }
        } catch (err) {
            batches.forEach(batch => {
                console.error('[PoE1-MTX-In-PoE2-Helper] Batch fetch failed for item', batch.targetId, err);
                const item = document.getElementById(batch.targetId);
                if (item) {
                    const loader = item.querySelector(INDICATOR_SELECTOR);
                    if (loader) loader.remove();
                    renderIndicator(item, 'error', err.message, 'Network / Worker', null);
                    setCache(batch.targetId, 'error', err.message, 'Network / Worker');
                }
                if (batch.popupTarget && document.contains(batch.popupTarget)) {
                    renderPopupIndicator(batch.popupTarget, 'error', err.message, 'Network / Worker', null, batch.popupExtraClass);
                }
            });
        }
    }

    /**
     * Determines where in the process an error occurred based on debug info
     */
    /**
     * Maps worker debug reasons to a readable error location.
     * @param {string|null} reason The worker debug reason.
     * @param {number} httpStatus The HTTP status code returned by the worker.
     * @returns {string} A human-friendly error source.
     */
    function determineErrorLocation(reason, httpStatus) {
        if (!reason) return 'Unknown';

        switch (reason) {
            case 'network_error':
                return 'Network Connection';
            case 'http_error':
                return `Poe2db (${httpStatus})`;
            case 'tab_missing':
                return 'Poe2db (Tab Not Found)';
            case 'parse_fail':
                return 'Poe2db (Parse Failure)';
            default:
                return reason;
        }
    }

    /**
     * Builds human-readable error message
     */
    /**
     * Builds a human-readable error message from worker debug info.
     * @param {string} errorMsg The raw error message.
     * @param {string|null} reason The worker debug reason.
     * @returns {string} A formatted error description.
     */
    function buildErrorMessage(errorMsg, reason) {
        if (reason === 'network_error') return `Connection error: ${errorMsg}`;
        if (reason === 'http_error') return `HTTP ${errorMsg.split(' ')[1] || 'error'}`;
        if (reason === 'tab_missing') return 'PoE2db page structure changed (tab missing)';
        if (reason === 'parse_fail') return 'Could not parse PoE2 availability from page';
        return errorMsg || 'Unknown error';
    }

    /**
     * Updates the visible overlay indicator for an item.
     * @param {HTMLElement} itemDiv The shop item element.
     * @param {string} status The status to display.
     * @param {string} detail Tooltip detail text.
     * @param {string|null} errorLocation Optional error location.
     * @param {string|null} poe2Link Optional PoE2 URL.
     */
    /**
     * Renders an availability overlay on a shop item container.
     * @param {HTMLElement} itemDiv The shop item element.
     * @param {string} status The status to display.
     * @param {string} detail Tooltip detail text.
     * @param {string|null} errorLocation Optional error location.
     * @param {string|null} poe2Link Optional PoE2 URL.
     */
    function renderIndicator(itemDiv, status, detail, errorLocation = null, poe2Link = null) {
        removeIndicator(itemDiv);
        const indicator = createIndicator(status, detail, errorLocation, poe2Link);
        itemDiv.appendChild(indicator);
        updateTrackedItemCount();
    }

    /**
     * Renders an immediate loading placeholder for items that have not yet been checked.
     * @param {HTMLElement} itemDiv The shop item element.
     */
    function renderPlaceholder(itemDiv) {
        if (!itemDiv.querySelector(INDICATOR_SELECTOR)) {
            renderIndicator(itemDiv, 'loading', 'Waiting to enter view', null, null);
        }
    }

    /**
     * Extracts the single item ID shown in a modal purchase dialog.
     * @param {HTMLElement} modalRoot The modal root element.
     * @returns {string|null} The item identifier or null if none found.
     */
    function getModalSingleItemId(modalRoot) {
        const imageContainer = modalRoot.querySelector('.largeImage[id]');
        if (!imageContainer) return null;
        return imageContainer.id.replace(/Image$/, '').trim() || null;
    }

    /**
     * Renders an availability overlay inside a popup target container.
     * @param {HTMLElement} targetContainer The container element.
     * @param {string} status Availability status.
     * @param {string} detail Tooltip detail text.
     * @param {string|null} errorLocation Optional error origin.
     * @param {string|null} poe2Link Optional PoE2 URL.
     * @param {string} extraClass Additional CSS classes.
     */
    function renderPopupIndicator(targetContainer, status, detail, errorLocation = null, poe2Links = [], extraClass = '') {
        removeIndicator(targetContainer);
        const indicator = createPopupIndicator(status, detail, errorLocation, poe2Links, extraClass);
        targetContainer.appendChild(indicator);

        // Ensure the popup indicator and its links receive pointer events
        try {
            indicator.style.pointerEvents = 'auto';
            const anchors = indicator.querySelectorAll('a');
            anchors.forEach(a => {
                // Prevent clicks from bubbling to modal handlers
                a.addEventListener('click', (ev) => ev.stopPropagation());
                a.addEventListener('mousedown', (ev) => ev.stopPropagation());
            });
        } catch (e) {
            // ignore
        }
    }

    /**
     * Checks a single popup line item and renders its availability overlay.
     * @param {string} itemId The PoE1 item ID.
     * @param {HTMLElement} targetContainer The DOM container for the overlay.
     * @param {string} extraClass Additional CSS classes.
     */
    function checkPopupItem(itemId, targetContainer, extraClass) {
        const cached = getCache(itemId);
        if (cached) {
            renderPopupIndicator(targetContainer, cached.status, cached.detail, cached.errorLocation, cached.poe2Link ? [cached.poe2Link] : [], extraClass);
            return;
        }

        renderPopupIndicator(targetContainer, 'loading', 'Waiting to check availability...', null, [], extraClass);
        queueFetch([itemId], itemId, 'SINGLE', targetContainer, extraClass);
    }

    function checkPopupModalItems(itemIds, targetContainer, extraClass) {
        const cachedResults = itemIds.map(id => getCache(id)).filter(Boolean);
        if (cachedResults.length === itemIds.length) {
            const availCount = cachedResults.filter(r => r.status === 'available').length;
            const detail = itemIds.length === 1
                ? cachedResults[0].detail
                : `${availCount}/${itemIds.length} available in PoE2`;
            const poe2Links = cachedResults.map(r => r.poe2Link).filter(Boolean);
            const status = availCount === itemIds.length ? 'available'
                : availCount > 0 ? 'partial'
                    : 'unavailable';
            renderPopupIndicator(targetContainer, status, detail, null, poe2Links, extraClass);
            return;
        }

        renderPopupIndicator(targetContainer, 'loading', 'Waiting to check availability...', null, [], extraClass);
        queueFetch(itemIds, itemIds[0], 'PACK', targetContainer, extraClass);
    }

    /**
     * Creates a popup wrapper element for a line-item overlay.
     * @returns {HTMLElement} The wrapper element.
     */
    function createPopupWrapper(useRightSide = true) {
        const wrapper = document.createElement('span');
        wrapper.className = P1MIP2.popupWrapper;
        wrapper.style.position = 'absolute';
        wrapper.style.display = 'inline-flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.gap = '4px';
        wrapper.style.whiteSpace = 'nowrap';
        wrapper.style.overflow = 'visible';
        wrapper.style.pointerEvents = 'none';
        wrapper.style.zIndex = '10001';
        wrapper.style.minWidth = useRightSide ? '100px' : '100px';
        wrapper.style.maxWidth = '260px';

        if (useRightSide) {
            wrapper.style.top = '0';
            wrapper.style.left = '50%';
            wrapper.style.right = 'auto';
            wrapper.style.transform = 'translate(-50%, -110%)';
        } else {
            wrapper.style.top = '50%';
            wrapper.style.left = '0';
            wrapper.style.right = 'auto';
            wrapper.style.transform = 'translate(-12px, -50%)';
        }
        return wrapper;
    }

    /**
     * Initializes popup modal overlays for pack items and single-item purchases.
     */
    function patchPopupModals() {
        const modals = document.querySelectorAll(POPUP_MODAL_SELECTOR);
        modals.forEach((modalRoot) => {
            const lineItems = modalRoot.querySelectorAll(POPUP_LINEITEM_SELECTOR);
            if (lineItems.length > 0) {
                patchPopupPackModal(modalRoot, lineItems);
                return;
            }

            patchPopupSingleItem(modalRoot);
        });
    }

    /**
     * Patches line-item overlays inside pack purchase modals.
     * @param {NodeListOf<HTMLElement>} lineItems The line items.
     */
    function findPopupAnchor(lineItem, useRightSide) {
        if (!useRightSide) return lineItem;
        const buttonSelectors = ['button', '.buyButton', '.purchase', '.btn', '.shopButton', '.shopBtn', '.buy', '.action'];
        for (const selector of buttonSelectors) {
            const button = lineItem.querySelector(selector);
            if (button) return button;
        }
        const actionAreas = lineItem.querySelectorAll('div, span');
        for (const area of actionAreas) {
            if (area.textContent && /buy|purchase|add/i.test(area.textContent)) return area;
        }
        return lineItem;
    }

    function patchPopupPackModal(modalRoot, lineItems) {
        const itemIds = Array.from(lineItems)
            .map(lineItem => (lineItem.dataset.id || '').trim())
            .filter(Boolean);
        if (itemIds.length === 0) return;

        const costTarget = modalRoot.querySelector(POPUP_SINGLE_ITEM_SELECTOR);
        if (!costTarget) return;

        // Avoid creating multiple markers if one already exists
        if (costTarget.dataset.p1mip2PopupProcessed) return;
        if (costTarget.querySelector && costTarget.querySelector(`.${P1MIP2.popupCostOverlay}`)) return;

        costTarget.dataset.p1mip2PopupProcessed = 'true';
        costTarget.style.position = 'relative';

        const marker = document.createElement('span');
        marker.className = P1MIP2.popupCostOverlay;
        costTarget.appendChild(marker);

        if (itemIds.length === 1) {
            checkPopupItem(itemIds[0], marker, P1MIP2.modalIndicator);
        } else {
            checkPopupModalItems(itemIds, marker, P1MIP2.modalIndicator);
        }
    }

    function patchPopupLineItems(lineItems) {
        // kept for backward compatibility but not used by modal summary mode.
        lineItems.forEach((lineItem) => {
            const existingMarker = lineItem.querySelector(`.${P1MIP2.popupWrapper}`);
            if (lineItem.dataset.p1mip2PopupProcessed && existingMarker) return;

            lineItem.dataset.p1mip2PopupProcessed = 'true';
            lineItem.style.position = 'relative';
            lineItem.style.overflow = 'visible';

            if (existingMarker) existingMarker.remove();

            const marker = createPopupWrapper(true);
            lineItem.appendChild(marker);

            const itemId = lineItem.dataset.id;
            if (itemId) {
                checkPopupItem(itemId, marker, P1MIP2.modalIndicator);
            }
        });
    }

    /**
     * Patches the overlay for a single-item purchase modal.
     * @param {HTMLElement} modalRoot The modal root element.
     */
    function patchPopupSingleItem(modalRoot) {
        const costTarget = modalRoot.querySelector(POPUP_SINGLE_ITEM_SELECTOR);
        if (!costTarget) return;

        // Avoid duplicate markers
        if (costTarget.dataset.p1mip2PopupProcessed) return;
        if (costTarget.querySelector && costTarget.querySelector(`.${P1MIP2.popupCostOverlay}`)) return;

        const itemId = getModalSingleItemId(modalRoot);
        if (!itemId) return;

        costTarget.dataset.p1mip2PopupProcessed = 'true';
        costTarget.style.position = 'relative';
        const marker = document.createElement('span');
        marker.className = P1MIP2.popupCostOverlay;
        costTarget.appendChild(marker);
        checkPopupItem(itemId, marker, P1MIP2.modalIndicator);
    }

    /**
     * Repairs a visible item by restoring its overlay when DOM changes remove it.
     * @param {HTMLElement} itemDiv The shop item element.
     */
    function repairVisibleItem(itemDiv) {
        if (!itemDiv.id || !isElementInView(itemDiv)) return;
        if (itemDiv.querySelector(INDICATOR_SELECTOR)) return;

        const cached = getCache(itemDiv.id);
        if (cached) {
            renderIndicator(itemDiv, cached.status, cached.detail, cached.errorLocation, cached.poe2Link);
            return;
        }

        delete itemDiv.dataset.processed;
        scheduleItemCheck(itemDiv);
    }

    /**
     * Determines whether an element is currently inside or near the viewport.
     * @param {HTMLElement} itemDiv The shop item element.
     * @returns {boolean} True when the item is visible or within 128px of the viewport.
     */
    function isElementInView(itemDiv) {
        const rect = itemDiv.getBoundingClientRect();
        const margin = 128;
        return rect.bottom >= -margin && rect.top <= window.innerHeight + margin;
    }

    /**
     * Cancels a pending item check if it has been scheduled but not yet executed.
     * @param {HTMLElement} itemDiv The shop item element.
     */
    function cancelScheduledItemCheck(itemDiv) {
        const timeoutId = pendingRenderTimeouts.get(itemDiv);
        if (timeoutId) {
            clearTimeout(timeoutId);
            pendingRenderTimeouts.delete(itemDiv);
        }
    }

    /**
     * Schedules a visibility-based PoE2 availability check for a shop item.
     * @param {HTMLElement} itemDiv The shop item element.
     */
    function scheduleItemCheck(itemDiv) {
        if (itemDiv.dataset.processed || pendingRenderTimeouts.has(itemDiv)) return;

        const timeoutId = setTimeout(() => {
            pendingRenderTimeouts.delete(itemDiv);
            if (!document.contains(itemDiv)) return;
            if (itemDiv.dataset.processed) return;
            if (!isElementInView(itemDiv)) return;

            itemDiv.dataset.processed = 'true';
            renderPlaceholder(itemDiv);
            checkItem(itemDiv);
            updateTrackedItemCount();
        }, ITEM_RENDER_DELAY);

        pendingRenderTimeouts.set(itemDiv, timeoutId);
    }

    /**
     * Logs the current shop item tracking counts when they change.
     */
    function updateTrackedItemCount() {
        const totalItems = document.querySelectorAll(ITEM_SELECTOR).length;
        const overlayedItems = document.querySelectorAll(INDICATOR_SELECTOR).length;
        const info = `tracking ${totalItems} items, ${overlayedItems} overlayed`;
        if (info !== lastTrackedInfo) {
            lastTrackedInfo = info;
            console.log('[PoE1-MTX-In-PoE2-Helper]', info);
        }
    }

    /**
     * Detects search query changes by comparing the current location.search.
     */
    function resetTrackingForSearch() {
        if (batchTimeout) {
            clearTimeout(batchTimeout);
            batchTimeout = null;
        }
        pendingQueue = [];

        document.querySelectorAll(ITEM_SELECTOR).forEach((item) => {
            cancelScheduledItemCheck(item);
            delete item.dataset.processed;
            const existing = item.querySelector(INDICATOR_SELECTOR);
            if (existing) existing.remove();
        });

        const visibleItems = Array.from(document.querySelectorAll(ITEM_SELECTOR)).filter(isElementInView);
        visibleItems.forEach((item) => {
            if (!item.dataset.processed) {
                scheduleItemCheck(item);
            }
        });

        updateTrackedItemCount();
    }

    function detectSearchChange() {
        const currentSearch = location.search;
        if (currentSearch !== lastSearchQuery) {
            if (currentSearch.includes('search=')) {
                console.log('[PoE1-MTX-In-PoE2-Helper] Search detected:', currentSearch);
                resetTrackingForSearch();
            } else if (lastSearchQuery.includes('search=')) {
                console.log('[PoE1-MTX-In-PoE2-Helper] Search cleared:', currentSearch);
                resetTrackingForSearch();
            }
            lastSearchQuery = currentSearch;
        }
    }

    /**
     * Watches the page for newly inserted shop items and search changes.
     */
    function initMutationObserver() {
        const root = document.body;

        const mutationObserver = new MutationObserver((mutations) => {
            detectSearchChange();
            let observedNew = false;
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    if (node.matches && node.matches(ITEM_SELECTOR)) {
                        if (!node.dataset.processed) {
                            observer.observe(node);
                            observedNew = true;
                            if (isElementInView(node)) {
                                scheduleItemCheck(node);
                            }
                        }
                    }
                    if (node.querySelectorAll) {
                        const items = node.querySelectorAll(ITEM_SELECTOR);
                        items.forEach((item) => {
                            if (!item.dataset.processed) {
                                observer.observe(item);
                                observedNew = true;
                                if (isElementInView(item)) {
                                    scheduleItemCheck(item);
                                }
                            }
                        });
                    }
                });
            });

            Array.from(document.querySelectorAll(ITEM_SELECTOR))
                .filter(isElementInView)
                .forEach(repairVisibleItem);

            if (observedNew) updateTrackedItemCount();
            patchPopupModals();
        });

        mutationObserver.observe(root, {
            childList: true,
            subtree: true,
        });
    }

    // --- Intersection Observer Setup ---

    /**
     * Initializes the intersection and mutation observers for shop items.
     */
    async function initObserver() {
        const items = Array.from(document.querySelectorAll(ITEM_SELECTOR));

        observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    if (el.dataset.processed) return;
                    scheduleItemCheck(el);
                }
            });
        }, { rootMargin: '200px', threshold: 0.01 });

        const visibleItems = items.filter(isElementInView);
        visibleItems.forEach((item, index) => {
            if (!item.dataset.processed) {
                if (index < INITIAL_ITEM_BATCH) {
                    scheduleItemCheck(item);
                } else {
                    const timeoutId = setTimeout(() => scheduleItemCheck(item), INITIAL_RENDER_DELAY);
                    pendingRenderTimeouts.set(item, timeoutId);
                }
            }
        });
        updateTrackedItemCount();

        items.forEach(item => {
            if (!item.dataset.processed) observer.observe(item);
        });

        initMutationObserver();
        patchPopupModals();
        detectSearchChange();

        console.log('[PoE1-MTX-In-PoE2-Helper] initialized');
    }

    // --- Initialization ---

    /**
     * Delays initialization until the page load and initial DOM are fully ready.
     */
    function initializeAfterPageLoad() {
        if (document.readyState === 'complete') {
            initObserver();
        } else {
            window.addEventListener('load', () => setTimeout(initObserver, INITIAL_RENDER_DELAY));
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeAfterPageLoad);
    } else {
        initializeAfterPageLoad();
    }

})();