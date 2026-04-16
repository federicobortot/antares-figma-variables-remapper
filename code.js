// =============================================================================
// TOKEN REMAPPER → FOUNDATIONS  |  code.js  v5
//
// Novità v5:
//  - Supporto selezione MULTIPLA di collezioni dalla libreria Foundations
//    (semantic, primitive, ecc.) — le variabili vengono mergeate in un'unica
//    mappa nome→key, "last write wins" se c'è duplicato di nome
//  - Tutto il resto invariato da v4 (alias chain following)
// =============================================================================

figma.showUI(__html__, { width: 520, height: 680, themeColors: true });

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
function executeTextStylesReverse(selectedStyleIds, maps, remappedVars, skipped, errors, log) {
  var remappedStyles = 0;
  var selectedIdSet = buildIdSet(selectedStyleIds);
  var styles = figma.getLocalTextStyles();
  for (var i = 0; i < styles.length; i++) {
    var style = styles[i];
    if (!selectedIdSet[style.id]) { continue; }
    var didRemap = false;
    try {
      var boundFields = Object.keys(style.boundVariables);
      for (var f = 0; f < boundFields.length; f++) {
        var field = boundFields[f];
        var binding = style.boundVariables[field];
        if (!binding) { continue; }
        var sourceVar = maps.localVarById[binding.id] || figma.variables.getVariableById(binding.id);
        if (!sourceVar) { continue; }
        var localTarget = maps.targetVarByName[sourceVar.name];
        if (localTarget) {
          style.setBoundVariable(field, localTarget);
          log.push('[OK-STYLE] ' + style.name + ' | ' + field + ' | ' + sourceVar.name + ' → ' + localTarget.name);
          didRemap = true;
        }
      }
      if (didRemap) { remappedStyles++; } else { skipped++; }
    } catch(e) {
      log.push('[ERR-STYLE] ' + style.name + ' | ' + String(e));
      errors.push({ name: style.name, error: String(e) });
    }
  }
  postToUI('EXECUTE_RESULT', { remappedVars: remappedVars, remappedStyles: remappedStyles, skipped: skipped, errors: errors, log: log });
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
      var targetVar = localVarById[binding.id] || figma.variables.getVariableById(binding.id);
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
  postToUI('TEXT_STYLE_COUNT', { count: figma.getLocalTextStyles().length });
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
      postToUI('PREVIEW_RESULT', { rows: rows, stats: stats, textStyles: textStyles });
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
          // ── stili di testo ──
          if (payload.selectedStyleIds && payload.selectedStyleIds.length > 0) {
            executeTextStyles(payload.selectedStyleIds, foundationsMapByName, localVarById, keyCache, remappedVars, skipped, errors, log);
          } else {
            postToUI('EXECUTE_RESULT', { remappedVars: remappedVars, remappedStyles: 0, skipped: skipped, errors: errors, total: analysis.length, log: log });
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

function executeTextStyles(selectedStyleIds, foundationsMapByName, localVarById, keyCache, remappedVars, skipped, errors, log) {
  var remappedStyles = 0;
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
    else { skipped++; }
  }

  var taskIndex = 0;

  function processStyleNext() {
    if (taskIndex >= tasks.length) {
      postToUI('EXECUTE_RESULT', { remappedVars: remappedVars, remappedStyles: remappedStyles, skipped: skipped, errors: errors, log: log });
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
          remappedStyles++;
        } catch(e) {
          log.push('[ERR-STYLE] ' + task.style.name + ' | ' + String(e));
          errors.push({ name: task.style.name, error: String(e) });
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
          errors.push({ name: task.style.name, error: String(err) });
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
      var sourceVar = localVarById[binding.id] || figma.variables.getVariableById(binding.id);
      if (!sourceVar) { continue; }
      var localTarget = targetVarByName[sourceVar.name];
      if (localTarget) {
        remappableFields.push({ field: field, aliasTargetName: sourceVar.name, localTargetId: localTarget.id });
      } else if (localVarById[binding.id]) {
        // il binding punta già a una variabile locale
        alreadyLocalCount++;
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
  postToUI('PREVIEW_RESULT', { rows: rows, stats: stats, textStyles: textStyles });
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

  if (payload.selectedStyleIds && payload.selectedStyleIds.length > 0) {
    executeTextStylesReverse(payload.selectedStyleIds, maps, remappedVars, skipped, errors, log);
  } else {
    postToUI('EXECUTE_RESULT', { remappedVars: remappedVars, remappedStyles: 0, skipped: skipped, errors: errors, total: analysis.length, log: log });
  }
}
