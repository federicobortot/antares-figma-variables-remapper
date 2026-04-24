// =============================================================================
// TOKEN REMAPPER → FOUNDATIONS  |  code.js  v5
//
// Novità v5:
//  - Supporto selezione MULTIPLA di collezioni dalla libreria Foundations
//    (semantic, primitive, ecc.) — le variabili vengono mergeate in un'unica
//    mappa nome→key, "last write wins" se c'è duplicato di nome
//  - Tutto il resto invariato da v4 (alias chain following)
// =============================================================================

figma.showUI(__html__, { width: 620, height: 680, themeColors: true });

function postToUI(type, payload) {
  figma.ui.postMessage({ type: type, payload: payload });
}

function createSafeMap() {
  return Object.create(null);
}

function buildIdSet(ids) {
  var set = createSafeMap();
  if (!ids) { return set; }
  for (var i = 0; i < ids.length; i++) { set[ids[i]] = true; }
  return set;
}

function getLocalVarsForCollections(collectionIds) {
  var allVars = figma.variables.getLocalVariables();
  var idSet = createSafeMap();
  for (var i = 0; i < collectionIds.length; i++) { idSet[collectionIds[i]] = true; }
  var result = [];
  for (var j = 0; j < allVars.length; j++) {
    if (idSet[allVars[j].variableCollectionId]) { result.push(allVars[j]); }
  }
  return result;
}

function countVarsInCollection(collectionId) {
  var allVars = figma.variables.getLocalVariables();
  var count = 0;
  for (var i = 0; i < allVars.length; i++) {
    if (allVars[i].variableCollectionId === collectionId) { count++; }
  }
  return count;
}

function getLocalCollectionsSummary() {
  var collections = figma.variables.getLocalVariableCollections();
  var result = [];
  for (var i = 0; i < collections.length; i++) {
    var c = collections[i];
    result.push({ id: c.id, name: c.name, variableCount: countVarsInCollection(c.id) });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Carica le variabili da PIÙ collezioni library e le mergia in un'unica mappa
// nome → key. Usa Promise chain sequenziale (no Promise.all per compatibilità).
// Callback: cb(foundationsMapByName) oppure cbErr(err)
// ---------------------------------------------------------------------------
function buildFoundationsMap(libraryCollectionKeys, cb, cbErr) {
  var map = createSafeMap();
  var index = 0;

  function fetchNext() {
    if (index >= libraryCollectionKeys.length) {
      cb(map);
      return;
    }
    var key = libraryCollectionKeys[index];
    index++;
    figma.teamLibrary.getVariablesInLibraryCollectionAsync(key)
      .then(function(libVars) {
        for (var i = 0; i < libVars.length; i++) {
          map[libVars[i].name] = libVars[i].key;
        }
        fetchNext();
      })
      .catch(function(err) {
        cbErr('Errore sul caricamento collezione ' + key + ': ' + String(err));
      });
  }
  fetchNext();
}

// ---------------------------------------------------------------------------
// Execute stili di testo modalità reverse (sincrono)
// ---------------------------------------------------------------------------
function executeTextStylesReverse(selectedStyleIds, maps, accumulator, log, callback) {
  var selectedIdSet = buildIdSet(selectedStyleIds);
  var styles = figma.getLocalTextStyles();

  // Pre-build tasks and collect fields to remap
  var tasks = [];
  for (var i = 0; i < styles.length; i++) {
    var style = styles[i];
    if (!selectedIdSet[style.id]) { continue; }
    var fieldsToRemap = [];
    var boundFields = Object.keys(style.boundVariables);
    for (var f = 0; f < boundFields.length; f++) {
      var field = boundFields[f];
      var binding = style.boundVariables[field];
      if (!binding) { continue; }
      var sourceVar = maps.localVarById[binding.id] || figma.variables.getVariableById(binding.id);
      if (!sourceVar) { continue; }
      var localTarget = maps.targetVarByName[sourceVar.name];
      if (localTarget) { fieldsToRemap.push({ field: field, localTarget: localTarget, prevName: sourceVar.name }); }
    }
    if (fieldsToRemap.length > 0) { tasks.push({ style: style, fields: fieldsToRemap }); }
    else { accumulator.skipped++; }
  }

  // Collect unique fonts used by all styles to remap
  var fontsMap = createSafeMap();
  var fontsToLoad = [];
  for (var t = 0; t < tasks.length; t++) {
    var fn = tasks[t].style.fontName;
    if (fn && fn.family) {
      var fk = fn.family + '|' + fn.style;
      if (!fontsMap[fk]) { fontsMap[fk] = true; fontsToLoad.push(fn); }
    }
  }

  var fontIndex = 0;
  function loadNextFont() {
    if (fontIndex >= fontsToLoad.length) {
      // All fonts loaded — apply remaps
      for (var t2 = 0; t2 < tasks.length; t2++) {
        var task = tasks[t2];
        try {
          for (var f2 = 0; f2 < task.fields.length; f2++) {
            var fd = task.fields[f2];
            task.style.setBoundVariable(fd.field, fd.localTarget);
            log.push('[OK-STYLE] ' + task.style.name + ' | ' + fd.field + ' | ' + fd.prevName + ' → ' + fd.localTarget.name);
          }
          accumulator.remappedTextStyles++;
        } catch(e) {
          log.push('[ERR-STYLE] ' + task.style.name + ' | ' + String(e));
          accumulator.errors.push({ name: task.style.name, error: String(e) });
        }
      }
      callback();
      return;
    }
    var font = fontsToLoad[fontIndex];
    fontIndex++;
    figma.loadFontAsync(font)
      .then(function() { loadNextFont(); })
      .catch(function(err) {
        log.push('[WARN-FONT] ' + font.family + ' ' + font.style + ' | ' + String(err));
        loadNextFont();
      });
  }
  loadNextFont();
}

// ---------------------------------------------------------------------------
// Execute colori reverse (sincrono)
// ---------------------------------------------------------------------------
function executeColorStylesReverse(selectedStyleIds, maps, accumulator, log) {
  var selectedIdSet = buildIdSet(selectedStyleIds);
  var styles = figma.getLocalPaintStyles();
  for (var i = 0; i < styles.length; i++) {
    var style = styles[i];
    if (!selectedIdSet[style.id]) { continue; }
    var didRemap = false;
    try {
      var bindings = style.boundVariables && style.boundVariables['color'];
      if (!bindings) { accumulator.skipped++; continue; }
      var paintsCopy = JSON.parse(JSON.stringify(style.paints));
      for (var p = 0; p < paintsCopy.length; p++) {
        var binding = bindings[p];
        if (!binding) { continue; }
        var sourceVar = maps.localVarById[binding.id] || figma.variables.getVariableById(binding.id);
        if (!sourceVar) { continue; }
        var localTarget = maps.targetVarByName[sourceVar.name];
        if (localTarget) {
          paintsCopy[p] = figma.variables.setBoundVariableForPaint(paintsCopy[p], 'color', localTarget);
          log.push('[OK-COLOR] ' + style.name + ' | paint[' + p + '] | ' + sourceVar.name + ' → ' + localTarget.name);
          didRemap = true;
        }
      }
      style.paints = paintsCopy;
      if (didRemap) { accumulator.remappedColorStyles++; } else { accumulator.skipped++; }
    } catch(e) {
      log.push('[ERR-COLOR] ' + style.name + ' | ' + String(e));
      accumulator.errors.push({ name: style.name, error: String(e) });
    }
  }
}

// ---------------------------------------------------------------------------
// Execute effetti reverse (sincrono)
// ---------------------------------------------------------------------------
function executeEffectStylesReverse(selectedStyleIds, maps, accumulator, log) {
  var selectedIdSet = buildIdSet(selectedStyleIds);
  var styles = figma.getLocalEffectStyles();
  for (var i = 0; i < styles.length; i++) {
    var style = styles[i];
    if (!selectedIdSet[style.id]) { continue; }
    var didRemap = false;
    try {
      var bindings = style.boundVariables && style.boundVariables['effects'];
      if (!bindings) { accumulator.skipped++; continue; }
      var effectsCopy = JSON.parse(JSON.stringify(style.effects));
      for (var e = 0; e < effectsCopy.length; e++) {
        var binding = bindings[e];
        if (!binding) { continue; }
        var sourceVar = maps.localVarById[binding.id] || figma.variables.getVariableById(binding.id);
        if (!sourceVar) { continue; }
        var localTarget = maps.targetVarByName[sourceVar.name];
        if (localTarget) {
          var effectField = Object.keys(effectsCopy[e].boundVariables || {})[0] || 'color';
          effectsCopy[e] = figma.variables.setBoundVariableForEffect(effectsCopy[e], effectField, localTarget);
          log.push('[OK-EFFECT] ' + style.name + ' | effect[' + e + '] | ' + sourceVar.name + ' → ' + localTarget.name);
          didRemap = true;
        }
      }
      style.effects = effectsCopy;
      if (didRemap) { accumulator.remappedEffectStyles++; } else { accumulator.skipped++; }
    } catch(e2) {
      log.push('[ERR-EFFECT] ' + style.name + ' | ' + String(e2));
      accumulator.errors.push({ name: style.name, error: String(e2) });
    }
  }
}

// ---------------------------------------------------------------------------
// Execute griglie reverse (sincrono)
// ---------------------------------------------------------------------------
function executeGridStylesReverse(selectedStyleIds, maps, accumulator, log) {
  var selectedIdSet = buildIdSet(selectedStyleIds);
  var styles = figma.getLocalGridStyles();
  for (var i = 0; i < styles.length; i++) {
    var style = styles[i];
    if (!selectedIdSet[style.id]) { continue; }
    var didRemap = false;
    try {
      var bindings = style.boundVariables && style.boundVariables['layoutGrids'];
      if (!bindings) { accumulator.skipped++; continue; }
      var gridsCopy = JSON.parse(JSON.stringify(style.layoutGrids));
      for (var g = 0; g < gridsCopy.length; g++) {
        var binding = bindings[g];
        if (!binding) { continue; }
        var sourceVar = maps.localVarById[binding.id] || figma.variables.getVariableById(binding.id);
        if (!sourceVar) { continue; }
        var localTarget = maps.targetVarByName[sourceVar.name];
        if (localTarget) {
          var gridField = Object.keys(gridsCopy[g].boundVariables || {})[0] || 'count';
          gridsCopy[g] = figma.variables.setBoundVariableForLayoutGrid(gridsCopy[g], gridField, localTarget);
          log.push('[OK-GRID] ' + style.name + ' | grid[' + g + '] | ' + sourceVar.name + ' → ' + localTarget.name);
          didRemap = true;
        }
      }
      style.layoutGrids = gridsCopy;
      if (didRemap) { accumulator.remappedGridStyles++; } else { accumulator.skipped++; }
    } catch(e3) {
      log.push('[ERR-GRID] ' + style.name + ' | ' + String(e3));
      accumulator.errors.push({ name: style.name, error: String(e3) });
    }
  }
}

// ---------------------------------------------------------------------------
// Analisi colori reverse
// ---------------------------------------------------------------------------
function analyzeColorStylesReverse(targetVarByName, localVarById) {
  var styles = figma.getLocalPaintStyles();
  var results = [];
  for (var i = 0; i < styles.length; i++) {
    var style = styles[i];
    var bindings = style.boundVariables && style.boundVariables['color'];
    if (!bindings || !bindings.length) { continue; }
    var remappable = 0;
    var alreadyLocal = 0;
    for (var p = 0; p < bindings.length; p++) {
      var b = bindings[p];
      if (!b) { continue; }
      if (localVarById[b.id]) { alreadyLocal++; continue; }
      var sourceVar = figma.variables.getVariableById(b.id);
      if (!sourceVar) { continue; }
      if (targetVarByName[sourceVar.name]) { remappable++; }
    }
    var canRemap = remappable > 0;
    var primaryStatus = canRemap ? 'remap' : (alreadyLocal > 0 ? 'already_local' : 'no_match');
    results.push({ styleId: style.id, styleName: style.name, canRemap: canRemap, primaryStatus: primaryStatus, remappableCount: remappable, fieldSummary: 'colore' });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Analisi effetti reverse
// ---------------------------------------------------------------------------
function analyzeEffectStylesReverse(targetVarByName, localVarById) {
  var styles = figma.getLocalEffectStyles();
  var results = [];
  for (var i = 0; i < styles.length; i++) {
    var style = styles[i];
    var bindings = style.boundVariables && style.boundVariables['effects'];
    if (!bindings || !bindings.length) { continue; }
    var remappable = 0;
    var alreadyLocal = 0;
    for (var e = 0; e < bindings.length; e++) {
      var b = bindings[e];
      if (!b) { continue; }
      if (localVarById[b.id]) { alreadyLocal++; continue; }
      var sourceVar = figma.variables.getVariableById(b.id);
      if (!sourceVar) { continue; }
      if (targetVarByName[sourceVar.name]) { remappable++; }
    }
    var canRemap = remappable > 0;
    var primaryStatus = canRemap ? 'remap' : (alreadyLocal > 0 ? 'already_local' : 'no_match');
    results.push({ styleId: style.id, styleName: style.name, canRemap: canRemap, primaryStatus: primaryStatus, remappableCount: remappable, fieldSummary: 'effetto' });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Analisi griglie reverse
// ---------------------------------------------------------------------------
function analyzeGridStylesReverse(targetVarByName, localVarById) {
  var styles = figma.getLocalGridStyles();
  var results = [];
  for (var i = 0; i < styles.length; i++) {
    var style = styles[i];
    var bindings = style.boundVariables && style.boundVariables['layoutGrids'];
    if (!bindings || !bindings.length) { continue; }
    var remappable = 0;
    var alreadyLocal = 0;
    for (var g = 0; g < bindings.length; g++) {
      var b = bindings[g];
      if (!b) { continue; }
      if (localVarById[b.id]) { alreadyLocal++; continue; }
      var sourceVar = figma.variables.getVariableById(b.id);
      if (!sourceVar) { continue; }
      if (targetVarByName[sourceVar.name]) { remappable++; }
    }
    var canRemap = remappable > 0;
    var primaryStatus = canRemap ? 'remap' : (alreadyLocal > 0 ? 'already_local' : 'no_match');
    results.push({ styleId: style.id, styleName: style.name, canRemap: canRemap, primaryStatus: primaryStatus, remappableCount: remappable, fieldSummary: 'griglia' });
  }
  return results;
}

function analyzeTextStyles(foundationsMapByName, localVarById) {
  var styles = figma.getLocalTextStyles();
  var results = [];
  for (var i = 0; i < styles.length; i++) {
    var style = styles[i];
    var remappableFields = [];
    var allBound = 0;
    var alreadyLibCount = 0;
    var boundFields0 = Object.keys(style.boundVariables);
    for (var f = 0; f < boundFields0.length; f++) {
      var field = boundFields0[f];
      var binding = style.boundVariables[field];
      if (!binding) { continue; }
      allBound++;
      var targetVar = localVarById[binding.id]; // solo variabili locali; se library → già rimappata
      if (!targetVar) {
        alreadyLibCount++;
      } else {
        var foundKey = foundationsMapByName[targetVar.name];
        if (foundKey) {
          remappableFields.push({ field: field, aliasTargetName: targetVar.name, foundationsKey: foundKey });
        }
      }
    }
    if (allBound === 0) { continue; }
    var canRemap = remappableFields.length > 0;
    var primaryStatus;
    if (canRemap) { primaryStatus = 'remap'; }
    else if (alreadyLibCount === allBound) { primaryStatus = 'already_library'; }
    else { primaryStatus = 'no_match'; }
    var fieldNames = [];
    for (var r = 0; r < remappableFields.length; r++) { fieldNames.push(remappableFields[r].field); }
    results.push({
      styleId: style.id,
      styleName: style.name,
      canRemap: canRemap,
      primaryStatus: primaryStatus,
      remappableCount: remappableFields.length,
      fieldSummary: fieldNames.join(', ')
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Analisi colori forward
// ---------------------------------------------------------------------------
function analyzeColorStyles(foundationsMapByName, localVarById) {
  var styles = figma.getLocalPaintStyles();
  var results = [];
  for (var i = 0; i < styles.length; i++) {
    var style = styles[i];
    var bindings = style.boundVariables && style.boundVariables['color'];
    if (!bindings || !bindings.length) { continue; }
    var remappableFields = [];
    var alreadyLibCount = 0;
    for (var p = 0; p < bindings.length; p++) {
      var b = bindings[p];
      if (!b) { continue; }
      var targetVar = localVarById[b.id]; // solo variabili locali
      if (!targetVar) { alreadyLibCount++; continue; }
      var foundKey = foundationsMapByName[targetVar.name];
      if (foundKey) { remappableFields.push({ paintIndex: p, aliasTargetName: targetVar.name, foundationsKey: foundKey }); }
    }
    var allBound = bindings.filter(function(x) { return !!x; }).length;
    if (allBound === 0) { continue; }
    var canRemap = remappableFields.length > 0;
    var primaryStatus = canRemap ? 'remap' : (alreadyLibCount === allBound ? 'already_library' : 'no_match');
    results.push({ styleId: style.id, styleName: style.name, canRemap: canRemap, primaryStatus: primaryStatus, remappableCount: remappableFields.length, fieldSummary: 'colore' });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Analisi effetti forward
// ---------------------------------------------------------------------------
function analyzeEffectStyles(foundationsMapByName, localVarById) {
  var styles = figma.getLocalEffectStyles();
  var results = [];
  for (var i = 0; i < styles.length; i++) {
    var style = styles[i];
    var bindings = style.boundVariables && style.boundVariables['effects'];
    if (!bindings || !bindings.length) { continue; }
    var remappableFields = [];
    var alreadyLibCount = 0;
    for (var e = 0; e < bindings.length; e++) {
      var b = bindings[e];
      if (!b) { continue; }
      var targetVar = localVarById[b.id]; // solo variabili locali
      if (!targetVar) { alreadyLibCount++; continue; }
      var foundKey = foundationsMapByName[targetVar.name];
      if (foundKey) { remappableFields.push({ effectIndex: e, aliasTargetName: targetVar.name, foundationsKey: foundKey }); }
    }
    var allBound = bindings.filter(function(x) { return !!x; }).length;
    if (allBound === 0) { continue; }
    var canRemap = remappableFields.length > 0;
    var primaryStatus = canRemap ? 'remap' : (alreadyLibCount === allBound ? 'already_library' : 'no_match');
    results.push({ styleId: style.id, styleName: style.name, canRemap: canRemap, primaryStatus: primaryStatus, remappableCount: remappableFields.length, fieldSummary: 'effetto' });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Analisi griglie forward
// ---------------------------------------------------------------------------
function analyzeGridStyles(foundationsMapByName, localVarById) {
  var styles = figma.getLocalGridStyles();
  var results = [];
  for (var i = 0; i < styles.length; i++) {
    var style = styles[i];
    var bindings = style.boundVariables && style.boundVariables['layoutGrids'];
    if (!bindings || !bindings.length) { continue; }
    var remappableFields = [];
    var alreadyLibCount = 0;
    for (var g = 0; g < bindings.length; g++) {
      var b = bindings[g];
      if (!b) { continue; }
      var targetVar = localVarById[b.id]; // solo variabili locali
      if (!targetVar) { alreadyLibCount++; continue; }
      var foundKey = foundationsMapByName[targetVar.name];
      if (foundKey) { remappableFields.push({ gridIndex: g, aliasTargetName: targetVar.name, foundationsKey: foundKey }); }
    }
    var allBound = bindings.filter(function(x) { return !!x; }).length;
    if (allBound === 0) { continue; }
    var canRemap = remappableFields.length > 0;
    var primaryStatus = canRemap ? 'remap' : (alreadyLibCount === allBound ? 'already_library' : 'no_match');
    results.push({ styleId: style.id, styleName: style.name, canRemap: canRemap, primaryStatus: primaryStatus, remappableCount: remappableFields.length, fieldSummary: 'griglia' });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Execute colori forward (async)
// ---------------------------------------------------------------------------
function executeColorStyles(selectedStyleIds, foundationsMapByName, localVarById, keyCache, accumulator, log, callback) {
  var selectedIdSet = buildIdSet(selectedStyleIds);
  var styles = figma.getLocalPaintStyles();
  var tasks = [];
  for (var i = 0; i < styles.length; i++) {
    if (!selectedIdSet[styles[i].id]) { continue; }
    var style = styles[i];
    var bindings = style.boundVariables && style.boundVariables['color'];
    if (!bindings) { accumulator.skipped++; continue; }
    var fieldsToRemap = [];
    for (var p = 0; p < bindings.length; p++) {
      var b = bindings[p];
      if (!b) { continue; }
      var targetVar = localVarById[b.id] || figma.variables.getVariableById(b.id);
      if (!targetVar) { continue; }
      var foundKey = foundationsMapByName[targetVar.name];
      if (foundKey) { fieldsToRemap.push({ paintIndex: p, foundationsKey: foundKey, prevName: targetVar.name }); }
    }
    if (fieldsToRemap.length > 0) { tasks.push({ style: style, fields: fieldsToRemap }); }
    else { accumulator.skipped++; }
  }

  var taskIndex = 0;
  function processNext() {
    if (taskIndex >= tasks.length) { callback(); return; }
    var task = tasks[taskIndex++];
    var uniqueKeys = createSafeMap();
    for (var f = 0; f < task.fields.length; f++) { uniqueKeys[task.fields[f].foundationsKey] = true; }
    var keysToFetch = Object.keys(uniqueKeys);
    var fetchedVars = createSafeMap();
    var fetchIndex = 0;
    function fetchNextKey() {
      if (fetchIndex >= keysToFetch.length) {
        try {
          var paintsCopy = JSON.parse(JSON.stringify(task.style.paints));
          for (var f2 = 0; f2 < task.fields.length; f2++) {
            var fd = task.fields[f2];
            var importedVar = fetchedVars[fd.foundationsKey];
            if (importedVar) {
              paintsCopy[fd.paintIndex] = figma.variables.setBoundVariableForPaint(paintsCopy[fd.paintIndex], 'color', importedVar);
              log.push('[OK-COLOR] ' + task.style.name + ' | paint[' + fd.paintIndex + '] | ' + fd.prevName + ' → ' + importedVar.name);
            } else {
              log.push('[SKIP-COLOR-NOIMPORT] ' + task.style.name + ' | paint[' + fd.paintIndex + '] | key:' + fd.foundationsKey);
            }
          }
          task.style.paints = paintsCopy;
          accumulator.remappedColorStyles++;
        } catch(e) {
          log.push('[ERR-COLOR] ' + task.style.name + ' | ' + String(e));
          accumulator.errors.push({ name: task.style.name, error: String(e) });
        }
        processNext(); return;
      }
      var key = keysToFetch[fetchIndex++];
      if (keyCache[key]) { fetchedVars[key] = keyCache[key]; fetchNextKey(); return; }
      figma.variables.importVariableByKeyAsync(key)
        .then(function(v) { keyCache[key] = v; fetchedVars[key] = v; fetchNextKey(); })
        .catch(function(err) {
          log.push('[ERR-IMPORT-COLOR] key:' + key + ' | ' + String(err));
          accumulator.errors.push({ name: task.style.name, error: String(err) });
          fetchNextKey();
        });
    }
    fetchNextKey();
  }
  processNext();
}

// ---------------------------------------------------------------------------
// Execute effetti forward (async)
// ---------------------------------------------------------------------------
function executeEffectStyles(selectedStyleIds, foundationsMapByName, localVarById, keyCache, accumulator, log, callback) {
  var selectedIdSet = buildIdSet(selectedStyleIds);
  var styles = figma.getLocalEffectStyles();
  var tasks = [];
  for (var i = 0; i < styles.length; i++) {
    if (!selectedIdSet[styles[i].id]) { continue; }
    var style = styles[i];
    var bindings = style.boundVariables && style.boundVariables['effects'];
    if (!bindings) { accumulator.skipped++; continue; }
    var fieldsToRemap = [];
    for (var e = 0; e < bindings.length; e++) {
      var b = bindings[e];
      if (!b) { continue; }
      var targetVar = localVarById[b.id] || figma.variables.getVariableById(b.id);
      if (!targetVar) { continue; }
      var foundKey = foundationsMapByName[targetVar.name];
      // Determina il campo bindable dell'effetto (es. 'color', 'radius'…)
      var effectField = (style.effects[e] && style.effects[e].boundVariables)
        ? (Object.keys(style.effects[e].boundVariables)[0] || 'color') : 'color';
      if (foundKey) { fieldsToRemap.push({ effectIndex: e, effectField: effectField, foundationsKey: foundKey, prevName: targetVar.name }); }
    }
    if (fieldsToRemap.length > 0) { tasks.push({ style: style, fields: fieldsToRemap }); }
    else { accumulator.skipped++; }
  }

  var taskIndex = 0;
  function processNextE() {
    if (taskIndex >= tasks.length) { callback(); return; }
    var task = tasks[taskIndex++];
    var uniqueKeys = createSafeMap();
    for (var f = 0; f < task.fields.length; f++) { uniqueKeys[task.fields[f].foundationsKey] = true; }
    var keysToFetch = Object.keys(uniqueKeys);
    var fetchedVars = createSafeMap();
    var fetchIndex = 0;
    function fetchNextKeyE() {
      if (fetchIndex >= keysToFetch.length) {
        try {
          var effectsCopy = JSON.parse(JSON.stringify(task.style.effects));
          for (var f2 = 0; f2 < task.fields.length; f2++) {
            var fd = task.fields[f2];
            var importedVar = fetchedVars[fd.foundationsKey];
            if (importedVar) {
              effectsCopy[fd.effectIndex] = figma.variables.setBoundVariableForEffect(effectsCopy[fd.effectIndex], fd.effectField, importedVar);
              log.push('[OK-EFFECT] ' + task.style.name + ' | effect[' + fd.effectIndex + '] | ' + fd.prevName + ' → ' + importedVar.name);
            } else {
              log.push('[SKIP-EFFECT-NOIMPORT] ' + task.style.name + ' | effect[' + fd.effectIndex + '] | key:' + fd.foundationsKey);
            }
          }
          task.style.effects = effectsCopy;
          accumulator.remappedEffectStyles++;
        } catch(e) {
          log.push('[ERR-EFFECT] ' + task.style.name + ' | ' + String(e));
          accumulator.errors.push({ name: task.style.name, error: String(e) });
        }
        processNextE(); return;
      }
      var key = keysToFetch[fetchIndex++];
      if (keyCache[key]) { fetchedVars[key] = keyCache[key]; fetchNextKeyE(); return; }
      figma.variables.importVariableByKeyAsync(key)
        .then(function(v) { keyCache[key] = v; fetchedVars[key] = v; fetchNextKeyE(); })
        .catch(function(err) {
          log.push('[ERR-IMPORT-EFFECT] key:' + key + ' | ' + String(err));
          accumulator.errors.push({ name: task.style.name, error: String(err) });
          fetchNextKeyE();
        });
    }
    fetchNextKeyE();
  }
  processNextE();
}

// ---------------------------------------------------------------------------
// Execute griglie forward (async)
// ---------------------------------------------------------------------------
function executeGridStyles(selectedStyleIds, foundationsMapByName, localVarById, keyCache, accumulator, log, callback) {
  var selectedIdSet = buildIdSet(selectedStyleIds);
  var styles = figma.getLocalGridStyles();
  var tasks = [];
  for (var i = 0; i < styles.length; i++) {
    if (!selectedIdSet[styles[i].id]) { continue; }
    var style = styles[i];
    var bindings = style.boundVariables && style.boundVariables['layoutGrids'];
    if (!bindings) { accumulator.skipped++; continue; }
    var fieldsToRemap = [];
    for (var g = 0; g < bindings.length; g++) {
      var b = bindings[g];
      if (!b) { continue; }
      var targetVar = localVarById[b.id] || figma.variables.getVariableById(b.id);
      if (!targetVar) { continue; }
      var foundKey = foundationsMapByName[targetVar.name];
      var gridField = (style.layoutGrids[g] && style.layoutGrids[g].boundVariables)
        ? (Object.keys(style.layoutGrids[g].boundVariables)[0] || 'count') : 'count';
      if (foundKey) { fieldsToRemap.push({ gridIndex: g, gridField: gridField, foundationsKey: foundKey, prevName: targetVar.name }); }
    }
    if (fieldsToRemap.length > 0) { tasks.push({ style: style, fields: fieldsToRemap }); }
    else { accumulator.skipped++; }
  }

  var taskIndex = 0;
  function processNextG() {
    if (taskIndex >= tasks.length) { callback(); return; }
    var task = tasks[taskIndex++];
    var uniqueKeys = createSafeMap();
    for (var f = 0; f < task.fields.length; f++) { uniqueKeys[task.fields[f].foundationsKey] = true; }
    var keysToFetch = Object.keys(uniqueKeys);
    var fetchedVars = createSafeMap();
    var fetchIndex = 0;
    function fetchNextKeyG() {
      if (fetchIndex >= keysToFetch.length) {
        try {
          var gridsCopy = JSON.parse(JSON.stringify(task.style.layoutGrids));
          for (var f2 = 0; f2 < task.fields.length; f2++) {
            var fd = task.fields[f2];
            var importedVar = fetchedVars[fd.foundationsKey];
            if (importedVar) {
              gridsCopy[fd.gridIndex] = figma.variables.setBoundVariableForLayoutGrid(gridsCopy[fd.gridIndex], fd.gridField, importedVar);
              log.push('[OK-GRID] ' + task.style.name + ' | grid[' + fd.gridIndex + '] | ' + fd.prevName + ' → ' + importedVar.name);
            } else {
              log.push('[SKIP-GRID-NOIMPORT] ' + task.style.name + ' | grid[' + fd.gridIndex + '] | key:' + fd.foundationsKey);
            }
          }
          task.style.layoutGrids = gridsCopy;
          accumulator.remappedGridStyles++;
        } catch(e) {
          log.push('[ERR-GRID] ' + task.style.name + ' | ' + String(e));
          accumulator.errors.push({ name: task.style.name, error: String(e) });
        }
        processNextG(); return;
      }
      var key = keysToFetch[fetchIndex++];
      if (keyCache[key]) { fetchedVars[key] = keyCache[key]; fetchNextKeyG(); return; }
      figma.variables.importVariableByKeyAsync(key)
        .then(function(v) { keyCache[key] = v; fetchedVars[key] = v; fetchNextKeyG(); })
        .catch(function(err) {
          log.push('[ERR-IMPORT-GRID] key:' + key + ' | ' + String(err));
          accumulator.errors.push({ name: task.style.name, error: String(err) });
          fetchNextKeyG();
        });
    }
    fetchNextKeyG();
  }
  processNextG();
}

// ---------------------------------------------------------------------------
// Analisi alias chain (invariata da v4)
// ---------------------------------------------------------------------------
function analyzeVars(componentVars, foundationsMapByName, localVarById, collNameById) {
  var results = [];
  for (var i = 0; i < componentVars.length; i++) {
    var variable = componentVars[i];
    var modeAnalysis = [];
    var canRemap = false;
    var modeIds = Object.keys(variable.valuesByMode);
    for (var m = 0; m < modeIds.length; m++) {
      var modeId = modeIds[m];
      var value = variable.valuesByMode[modeId];
      if (value && value.type === 'VARIABLE_ALIAS') {
        var targetVar = localVarById[value.id];
        if (!targetVar) {
          modeAnalysis.push({ modeId: modeId, aliasTargetId: value.id, aliasTargetName: '(già library)', foundationsKey: null, status: 'already_library' });
        } else {
          var foundKey = foundationsMapByName[targetVar.name];
          if (foundKey) {
            canRemap = true;
            modeAnalysis.push({ modeId: modeId, aliasTargetId: value.id, aliasTargetName: targetVar.name, foundationsKey: foundKey, status: 'remap' });
          } else {
            modeAnalysis.push({ modeId: modeId, aliasTargetId: value.id, aliasTargetName: targetVar.name, foundationsKey: null, status: 'no_match' });
          }
        }
      } else {
        modeAnalysis.push({ modeId: modeId, aliasTargetId: null, aliasTargetName: null, foundationsKey: null, status: 'no_alias' });
      }
    }
    results.push({ variable: variable, collectionName: collNameById[variable.variableCollectionId] || '?', modeAnalysis: modeAnalysis, canRemap: canRemap });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
figma.ui.onmessage = function(msg) {
  if      (msg.type === 'INIT')                  { handleInit(); }
  else if (msg.type === 'LOAD_LIBRARY_COLLECTIONS') { handleLoadLibraryCollections(); }
  else if (msg.type === 'PREVIEW_REMAP')         { handlePreviewRemap(msg.payload); }
  else if (msg.type === 'EXECUTE_REMAP')         { handleExecuteRemap(msg.payload); }
  else if (msg.type === 'PREVIEW_REMAP_REVERSE') { handlePreviewRemapReverse(msg.payload); }
  else if (msg.type === 'EXECUTE_REMAP_REVERSE') { handleExecuteRemapReverse(msg.payload); }
  else if (msg.type === 'CLOSE')                 { figma.closePlugin(); }
};

function handleInit() {
  postToUI('LOCAL_COLLECTIONS', getLocalCollectionsSummary());
  postToUI('TEXT_STYLE_COUNT',   { count: figma.getLocalTextStyles().length });
  postToUI('COLOR_STYLE_COUNT',  { count: figma.getLocalPaintStyles().length });
  postToUI('EFFECT_STYLE_COUNT', { count: figma.getLocalEffectStyles().length });
  postToUI('GRID_STYLE_COUNT',   { count: figma.getLocalGridStyles().length });
  figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()
    .then(function(libCollections) {
      var mapped = [];
      for (var i = 0; i < libCollections.length; i++) {
        var c = libCollections[i];
        mapped.push({ key: c.key, name: c.name, libraryName: c.libraryName });
      }
      postToUI('LIBRARY_COLLECTIONS', mapped);
    })
    .catch(function(err) {
      postToUI('LIBRARY_COLLECTIONS_ERROR', 'Impossibile caricare le librerie. (' + String(err) + ')');
    });
}

function handleLoadLibraryCollections() {
  figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()
    .then(function(libCollections) {
      var mapped = [];
      for (var i = 0; i < libCollections.length; i++) {
        var c = libCollections[i];
        mapped.push({ key: c.key, name: c.name, libraryName: c.libraryName });
      }
      postToUI('LIBRARY_COLLECTIONS', mapped);
    })
    .catch(function(err) {
      postToUI('ERROR', 'Impossibile caricare le librerie. (' + String(err) + ')');
    });
}

function handlePreviewRemap(payload) {
  var localCollectionIds    = payload.localCollectionIds;
  var libraryCollectionKeys = payload.libraryCollectionKeys;  // ARRAY

  buildFoundationsMap(
    libraryCollectionKeys,
    function(foundationsMapByName) {
      var localVarById = createSafeMap();
      var allLocalVars = figma.variables.getLocalVariables();
      for (var j = 0; j < allLocalVars.length; j++) { localVarById[allLocalVars[j].id] = allLocalVars[j]; }

      var collNameById = createSafeMap();
      var allCollections = figma.variables.getLocalVariableCollections();
      for (var ci = 0; ci < allCollections.length; ci++) { collNameById[allCollections[ci].id] = allCollections[ci].name; }

      var componentVars = getLocalVarsForCollections(localCollectionIds);
      var analysis = analyzeVars(componentVars, foundationsMapByName, localVarById, collNameById);

      var rows = [];
      var stats = { total: analysis.length, remap: 0, noMatch: 0, noAlias: 0, alreadyLib: 0 };

      for (var k = 0; k < analysis.length; k++) {
        var item = analysis[k];
        var primaryStatus = item.modeAnalysis.length > 0 ? item.modeAnalysis[0].status : 'no_alias';
        var targetName    = item.modeAnalysis.length > 0 ? item.modeAnalysis[0].aliasTargetName : null;
        if (primaryStatus === 'remap')           { stats.remap++; }
        else if (primaryStatus === 'no_alias')   { stats.noAlias++; }
        else if (primaryStatus === 'no_match')   { stats.noMatch++; }
        else if (primaryStatus === 'already_library') { stats.alreadyLib++; }
        rows.push({ localId: item.variable.id, localName: item.variable.name, collectionName: item.collectionName, resolvedType: item.variable.resolvedType, status: primaryStatus, aliasTargetName: targetName, canRemap: item.canRemap });
      }

      var textStyles = null;
      if (payload.includeTextStyles) { textStyles = analyzeTextStyles(foundationsMapByName, localVarById); }
      var colorStyles = null;
      if (payload.includeColorStyles) { colorStyles = analyzeColorStyles(foundationsMapByName, localVarById); }
      var effectStyles = null;
      if (payload.includeEffectStyles) { effectStyles = analyzeEffectStyles(foundationsMapByName, localVarById); }
      var gridStyles = null;
      if (payload.includeGridStyles) { gridStyles = analyzeGridStyles(foundationsMapByName, localVarById); }
      postToUI('PREVIEW_RESULT', { rows: rows, stats: stats, textStyles: textStyles, colorStyles: colorStyles, effectStyles: effectStyles, gridStyles: gridStyles });
    },
    function(err) { postToUI('ERROR', err); }
  );
}

function handleExecuteRemap(payload) {
  var localCollectionIds    = payload.localCollectionIds;
  var libraryCollectionKeys = payload.libraryCollectionKeys;  // ARRAY
  var selectedIdSet = buildIdSet(payload.selectedRowIds);

  buildFoundationsMap(
    libraryCollectionKeys,
    function(foundationsMapByName) {
      var localVarById = createSafeMap();
      var allLocalVars = figma.variables.getLocalVariables();
      for (var j = 0; j < allLocalVars.length; j++) { localVarById[allLocalVars[j].id] = allLocalVars[j]; }

      var collModes = createSafeMap();
      var collNameById = createSafeMap();
      var allCollections = figma.variables.getLocalVariableCollections();
      for (var ci = 0; ci < allCollections.length; ci++) {
        collModes[allCollections[ci].id]   = allCollections[ci].modes;
        collNameById[allCollections[ci].id] = allCollections[ci].name;
      }

      var componentVars = getLocalVarsForCollections(localCollectionIds);
      var analysis = analyzeVars(componentVars, foundationsMapByName, localVarById, collNameById);

      var tasks = [];
      var skipped = 0;
      for (var k = 0; k < analysis.length; k++) {
        if (analysis[k].canRemap && selectedIdSet[analysis[k].variable.id]) { tasks.push(analysis[k]); }
        else { skipped++; }
      }

      var remappedVars = 0;
      var errors = [];
      var keyCache = createSafeMap();
      var log = [];

      function processNext(index) {
        if (index >= tasks.length) {
          // ── catena stili ──
          var acc = { remappedTextStyles: 0, remappedColorStyles: 0, remappedEffectStyles: 0, remappedGridStyles: 0, skipped: skipped, errors: errors };
          function afterTextStyles() {
            executeColorStyles(payload.selectedColorStyleIds || [], foundationsMapByName, localVarById, keyCache, acc, log, afterColorStyles);
          }
          function afterColorStyles() {
            executeEffectStyles(payload.selectedEffectStyleIds || [], foundationsMapByName, localVarById, keyCache, acc, log, afterEffectStyles);
          }
          function afterEffectStyles() {
            executeGridStyles(payload.selectedGridStyleIds || [], foundationsMapByName, localVarById, keyCache, acc, log, afterGridStyles);
          }
          function afterGridStyles() {
            postToUI('EXECUTE_RESULT', { remappedVars: remappedVars, remappedTextStyles: acc.remappedTextStyles, remappedColorStyles: acc.remappedColorStyles, remappedEffectStyles: acc.remappedEffectStyles, remappedGridStyles: acc.remappedGridStyles, skipped: acc.skipped, errors: acc.errors, total: analysis.length, log: log });
          }
          if (payload.selectedStyleIds && payload.selectedStyleIds.length > 0) {
            executeTextStyles(payload.selectedStyleIds, foundationsMapByName, localVarById, keyCache, acc, log, afterTextStyles);
          } else {
            afterTextStyles();
          }
          return;
        }

        var item = tasks[index];
        var uniqueKeys = createSafeMap();
        for (var m = 0; m < item.modeAnalysis.length; m++) {
          var ma = item.modeAnalysis[m];
          if (ma.status === 'remap' && ma.foundationsKey) { uniqueKeys[ma.foundationsKey] = true; }
        }

        var keysToFetch = Object.keys(uniqueKeys);
        var fetchedVars = createSafeMap();
        var fetchIndex = 0;

        function fetchNextKey() {
          if (fetchIndex >= keysToFetch.length) {
            try {
              for (var m2 = 0; m2 < item.modeAnalysis.length; m2++) {
                var ma2 = item.modeAnalysis[m2];
                if (ma2.status === 'remap' && ma2.foundationsKey && fetchedVars[ma2.foundationsKey]) {
                  var prevValue = item.variable.valuesByMode[ma2.modeId];
                  var prevStr = prevValue && typeof prevValue === 'object' && prevValue.type === 'VARIABLE_ALIAS'
                    ? 'ALIAS:' + (localVarById[prevValue.id] ? localVarById[prevValue.id].name : prevValue.id)
                    : JSON.stringify(prevValue);
                  item.variable.setValueForMode(ma2.modeId, figma.variables.createVariableAlias(fetchedVars[ma2.foundationsKey]));
                  log.push('[OK] ' + item.variable.name + ' | mode:' + ma2.modeId + ' | ' + prevStr + ' → ALIAS:' + fetchedVars[ma2.foundationsKey].name);
                } else if (ma2.status === 'remap' && ma2.foundationsKey && !fetchedVars[ma2.foundationsKey]) {
                  log.push('[SKIP-NOIMPORT] ' + item.variable.name + ' | mode:' + ma2.modeId + ' | key:' + ma2.foundationsKey);
                }
              }
              remappedVars++;
            } catch(e) {
              log.push('[ERR] ' + item.variable.name + ' | ' + String(e));
              errors.push({ name: item.variable.name, error: String(e) });
            }
            processNext(index + 1);
            return;
          }

          var key = keysToFetch[fetchIndex];
          fetchIndex++;

          if (keyCache[key]) {
            fetchedVars[key] = keyCache[key];
            fetchNextKey();
            return;
          }

          figma.variables.importVariableByKeyAsync(key)
            .then(function(importedVar) {
              keyCache[key] = importedVar;
              fetchedVars[key] = importedVar;
              fetchNextKey();
            })
            .catch(function(err) {
              log.push('[ERR-IMPORT] key:' + key + ' | ' + String(err));
              errors.push({ name: item.variable.name, error: String(err) });
              fetchNextKey();
            });
        }

        fetchNextKey();
      }

      processNext(0);
    },
    function(err) { postToUI('ERROR', err); }
  );
}

function executeTextStyles(selectedStyleIds, foundationsMapByName, localVarById, keyCache, acc, log, callback) {
  var selectedIdSet = buildIdSet(selectedStyleIds);
  var styles = figma.getLocalTextStyles();
  var tasks = [];
  for (var i = 0; i < styles.length; i++) {
    if (!selectedIdSet[styles[i].id]) { continue; }
    var style = styles[i];
    var fieldsToRemap = [];
    var boundFields1 = Object.keys(style.boundVariables);
    for (var f = 0; f < boundFields1.length; f++) {
      var field = boundFields1[f];
      var binding = style.boundVariables[field];
      if (!binding) { continue; }
      var targetVar = localVarById[binding.id] || figma.variables.getVariableById(binding.id);
      if (!targetVar) { continue; }
      var foundKey = foundationsMapByName[targetVar.name];
      if (foundKey) { fieldsToRemap.push({ field: field, foundationsKey: foundKey, prevName: targetVar.name }); }
    }
    if (fieldsToRemap.length > 0) { tasks.push({ style: style, fields: fieldsToRemap }); }
    else { acc.skipped++; }
  }

  var taskIndex = 0;

  function processStyleNext() {
    if (taskIndex >= tasks.length) {
      callback();
      return;
    }
    var task = tasks[taskIndex];
    taskIndex++;

    // collect unique keys for this style
    var uniqueKeys = createSafeMap();
    for (var f = 0; f < task.fields.length; f++) { uniqueKeys[task.fields[f].foundationsKey] = true; }
    var keysToFetch = Object.keys(uniqueKeys);
    var fetchedVars = createSafeMap();
    var fetchIndex = 0;

    function fetchNextKey() {
      if (fetchIndex >= keysToFetch.length) {
        try {
          for (var f2 = 0; f2 < task.fields.length; f2++) {
            var fd = task.fields[f2];
            var importedVar = fetchedVars[fd.foundationsKey];
            if (importedVar) {
              task.style.setBoundVariable(fd.field, importedVar);
              log.push('[OK-STYLE] ' + task.style.name + ' | ' + fd.field + ' | ' + fd.prevName + ' → ' + importedVar.name);
            } else {
              log.push('[SKIP-STYLE-NOIMPORT] ' + task.style.name + ' | ' + fd.field + ' | key:' + fd.foundationsKey);
            }
          }
          acc.remappedTextStyles++;
        } catch(e) {
          log.push('[ERR-STYLE] ' + task.style.name + ' | ' + String(e));
          acc.errors.push({ name: task.style.name, error: String(e) });
        }
        processStyleNext();
        return;
      }
      var key = keysToFetch[fetchIndex];
      fetchIndex++;
      if (keyCache[key]) {
        fetchedVars[key] = keyCache[key];
        fetchNextKey();
        return;
      }
      figma.variables.importVariableByKeyAsync(key)
        .then(function(importedVar) {
          keyCache[key] = importedVar;
          fetchedVars[key] = importedVar;
          fetchNextKey();
        })
        .catch(function(err) {
          log.push('[ERR-IMPORT-STYLE] key:' + key + ' | ' + String(err));
          acc.errors.push({ name: task.style.name, error: String(err) });
          fetchNextKey();
        });
    }
    fetchNextKey();
  }
  processStyleNext();
}

// ---------------------------------------------------------------------------
// Modalità inversa: Foundations → locale
// ---------------------------------------------------------------------------
function analyzeTextStylesReverse(targetVarByName, localVarById) {
  var styles = figma.getLocalTextStyles();
  var results = [];
  for (var i = 0; i < styles.length; i++) {
    var style = styles[i];
    var remappableFields = [];
    var allBound = 0;
    var alreadyLocalCount = 0;
    var boundFields2 = Object.keys(style.boundVariables);
    for (var f = 0; f < boundFields2.length; f++) {
      var field = boundFields2[f];
      var binding = style.boundVariables[field];
      if (!binding) { continue; }
      allBound++;
      if (localVarById[binding.id]) {
        // il binding punta già a una variabile locale → già rimappato
        alreadyLocalCount++;
        continue;
      }
      var sourceVar = figma.variables.getVariableById(binding.id);
      if (!sourceVar) { continue; }
      var localTarget = targetVarByName[sourceVar.name];
      if (localTarget) {
        remappableFields.push({ field: field, aliasTargetName: sourceVar.name, localTargetId: localTarget.id });
      }
    }
    if (allBound === 0) { continue; }
    var canRemap = remappableFields.length > 0;
    var primaryStatus;
    if (canRemap) { primaryStatus = 'remap'; }
    else if (alreadyLocalCount === allBound) { primaryStatus = 'already_local'; }
    else { primaryStatus = 'no_match'; }
    var fieldNames = [];
    for (var r = 0; r < remappableFields.length; r++) { fieldNames.push(remappableFields[r].field); }
    results.push({
      styleId: style.id,
      styleName: style.name,
      canRemap: canRemap,
      primaryStatus: primaryStatus,
      remappableCount: remappableFields.length,
      fieldSummary: fieldNames.join(', ')
    });
  }
  return results;
}

function buildTargetMaps(localCollectionIds) {
  var componentIdSet = createSafeMap();
  for (var x = 0; x < localCollectionIds.length; x++) { componentIdSet[localCollectionIds[x]] = true; }

  var allLocalVars = figma.variables.getLocalVariables();
  var localVarById = createSafeMap();
  var targetVarByName = createSafeMap();
  var targetVarIds = createSafeMap();

  for (var k = 0; k < allLocalVars.length; k++) {
    localVarById[allLocalVars[k].id] = allLocalVars[k];
  }
  // Primo passaggio: remote non-component (priorità bassa)
  for (var i = 0; i < allLocalVars.length; i++) {
    var vr = allLocalVars[i];
    if (!componentIdSet[vr.variableCollectionId] && vr.remote) {
      targetVarByName[vr.name] = vr;
    }
  }
  // Secondo passaggio: non-remote non-component (sovrascrive, priorità alta)
  for (var j = 0; j < allLocalVars.length; j++) {
    var vl = allLocalVars[j];
    if (!componentIdSet[vl.variableCollectionId] && !vl.remote) {
      targetVarByName[vl.name] = vl;
      targetVarIds[vl.id] = true;
    }
  }
  return { localVarById: localVarById, targetVarByName: targetVarByName, targetVarIds: targetVarIds };
}

function analyzeVarsReverse(componentVars, targetVarByName, targetVarIds, localVarById, collNameById) {
  var results = [];
  for (var i = 0; i < componentVars.length; i++) {
    var variable = componentVars[i];
    var modeAnalysis = [];
    var canRemap = false;
    var modeIds = Object.keys(variable.valuesByMode);
    for (var m = 0; m < modeIds.length; m++) {
      var modeId = modeIds[m];
      var value = variable.valuesByMode[modeId];
      if (value && value.type === 'VARIABLE_ALIAS') {
        if (targetVarIds[value.id]) {
          modeAnalysis.push({ modeId: modeId, aliasTargetName: null, localTargetId: null, status: 'already_local' });
        } else {
          var sourceVar = localVarById[value.id] || figma.variables.getVariableById(value.id);
          if (!sourceVar) {
            modeAnalysis.push({ modeId: modeId, aliasTargetName: null, localTargetId: null, status: 'unresolvable' });
          } else {
            var localTarget = targetVarByName[sourceVar.name];
            if (localTarget) {
              canRemap = true;
              modeAnalysis.push({ modeId: modeId, aliasTargetName: sourceVar.name, localTargetId: localTarget.id, status: 'remap' });
            } else {
              modeAnalysis.push({ modeId: modeId, aliasTargetName: sourceVar.name, localTargetId: null, status: 'no_match' });
            }
          }
        }
      } else {
        modeAnalysis.push({ modeId: modeId, aliasTargetName: null, localTargetId: null, status: 'no_alias' });
      }
    }
    results.push({ variable: variable, collectionName: collNameById[variable.variableCollectionId] || '?', modeAnalysis: modeAnalysis, canRemap: canRemap });
  }
  return results;
}

function handlePreviewRemapReverse(payload) {
  var localCollectionIds = payload.localCollectionIds;
  var maps = buildTargetMaps(localCollectionIds);

  var collNameById = createSafeMap();
  var allCollections = figma.variables.getLocalVariableCollections();
  for (var ci = 0; ci < allCollections.length; ci++) { collNameById[allCollections[ci].id] = allCollections[ci].name; }

  var componentVars = getLocalVarsForCollections(localCollectionIds);
  var analysis = analyzeVarsReverse(componentVars, maps.targetVarByName, maps.targetVarIds, maps.localVarById, collNameById);

  var rows = [];
  var stats = { total: analysis.length, remap: 0, noMatch: 0, noAlias: 0, alreadyLib: 0 };

  for (var r = 0; r < analysis.length; r++) {
    var item = analysis[r];
    var primaryStatus = item.modeAnalysis.length > 0 ? item.modeAnalysis[0].status : 'no_alias';
    var targetName    = item.modeAnalysis.length > 0 ? item.modeAnalysis[0].aliasTargetName : null;
    if      (primaryStatus === 'remap')         { stats.remap++; }
    else if (primaryStatus === 'no_alias')      { stats.noAlias++; }
    else if (primaryStatus === 'no_match')      { stats.noMatch++; }
    else if (primaryStatus === 'already_local') { stats.alreadyLib++; }
    else if (primaryStatus === 'unresolvable')  { stats.noMatch++; }
    rows.push({ localId: item.variable.id, localName: item.variable.name, collectionName: item.collectionName, resolvedType: item.variable.resolvedType, status: primaryStatus, aliasTargetName: targetName, canRemap: item.canRemap });
  }

  var textStyles = null;
  if (payload.includeTextStyles) { textStyles = analyzeTextStylesReverse(maps.targetVarByName, maps.localVarById); }
  var colorStyles = null;
  if (payload.includeColorStyles) { colorStyles = analyzeColorStylesReverse(maps.targetVarByName, maps.localVarById); }
  var effectStyles = null;
  if (payload.includeEffectStyles) { effectStyles = analyzeEffectStylesReverse(maps.targetVarByName, maps.localVarById); }
  var gridStyles = null;
  if (payload.includeGridStyles) { gridStyles = analyzeGridStylesReverse(maps.targetVarByName, maps.localVarById); }
  postToUI('PREVIEW_RESULT', { rows: rows, stats: stats, textStyles: textStyles, colorStyles: colorStyles, effectStyles: effectStyles, gridStyles: gridStyles });
}

function handleExecuteRemapReverse(payload) {
  var localCollectionIds = payload.localCollectionIds;
  var selectedIdSet = buildIdSet(payload.selectedRowIds);
  var maps = buildTargetMaps(localCollectionIds);

  var collNameById = createSafeMap();
  var allCollections = figma.variables.getLocalVariableCollections();
  for (var ci = 0; ci < allCollections.length; ci++) { collNameById[allCollections[ci].id] = allCollections[ci].name; }

  var componentVars = getLocalVarsForCollections(localCollectionIds);
  var analysis = analyzeVarsReverse(componentVars, maps.targetVarByName, maps.targetVarIds, maps.localVarById, collNameById);

  var remappedVars = 0;
  var skipped = 0;
  var errors = [];
  var log = [];

  for (var r = 0; r < analysis.length; r++) {
    var item = analysis[r];
    if (!item.canRemap || !selectedIdSet[item.variable.id]) { skipped++; log.push('[SKIP] ' + item.variable.name + ' | canRemap:' + item.canRemap + ' | selected:' + !!selectedIdSet[item.variable.id]); continue; }
    try {
      for (var m = 0; m < item.modeAnalysis.length; m++) {
        var ma = item.modeAnalysis[m];
        if (ma.status === 'remap' && ma.localTargetId) {
          var targetVar = maps.localVarById[ma.localTargetId];
          if (targetVar) {
            var prevValue = item.variable.valuesByMode[ma.modeId];
            var prevStr = prevValue && typeof prevValue === 'object' && prevValue.type === 'VARIABLE_ALIAS'
              ? 'ALIAS:' + (maps.localVarById[prevValue.id] ? maps.localVarById[prevValue.id].name : prevValue.id)
              : JSON.stringify(prevValue);
            item.variable.setValueForMode(ma.modeId, figma.variables.createVariableAlias(targetVar));
            log.push('[OK] ' + item.variable.name + ' | mode:' + ma.modeId + ' | ' + prevStr + ' → ALIAS:' + targetVar.name);
          } else {
            log.push('[SKIP-NOVAR] ' + item.variable.name + ' | mode:' + ma.modeId + ' | targetId:' + ma.localTargetId);
          }
        }
      }
      remappedVars++;
    } catch(e) {
      log.push('[ERR] ' + item.variable.name + ' | ' + String(e));
      errors.push({ name: item.variable.name, error: String(e) });
    }
  }

  var acc = { remappedTextStyles: 0, remappedColorStyles: 0, remappedEffectStyles: 0, remappedGridStyles: 0, skipped: skipped, errors: errors };

  function finishReverse() {
    if (payload.selectedColorStyleIds && payload.selectedColorStyleIds.length > 0) {
      executeColorStylesReverse(payload.selectedColorStyleIds, maps, acc, log);
    }
    if (payload.selectedEffectStyleIds && payload.selectedEffectStyleIds.length > 0) {
      executeEffectStylesReverse(payload.selectedEffectStyleIds, maps, acc, log);
    }
    if (payload.selectedGridStyleIds && payload.selectedGridStyleIds.length > 0) {
      executeGridStylesReverse(payload.selectedGridStyleIds, maps, acc, log);
    }
    postToUI('EXECUTE_RESULT', { remappedVars: remappedVars, remappedTextStyles: acc.remappedTextStyles, remappedColorStyles: acc.remappedColorStyles, remappedEffectStyles: acc.remappedEffectStyles, remappedGridStyles: acc.remappedGridStyles, skipped: acc.skipped, errors: acc.errors, total: analysis.length, log: log });
  }

  if (payload.selectedStyleIds && payload.selectedStyleIds.length > 0) {
    executeTextStylesReverse(payload.selectedStyleIds, maps, acc, log, finishReverse);
  } else {
    finishReverse();
  }
}
