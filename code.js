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

      postToUI('PREVIEW_RESULT', { rows: rows, stats: stats });
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

      var remapped = 0;
      var errors = [];
      var keyCache = createSafeMap();
      var log = [];

      function processNext(index) {
        if (index >= tasks.length) {
          postToUI('EXECUTE_RESULT', { remapped: remapped, skipped: skipped, errors: errors, total: analysis.length, log: log });
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
              remapped++;
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

// ---------------------------------------------------------------------------
// Modalità inversa: Foundations → locale
// ---------------------------------------------------------------------------
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

  postToUI('PREVIEW_RESULT', { rows: rows, stats: stats });
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

  var remapped = 0;
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
      remapped++;
    } catch(e) {
      log.push('[ERR] ' + item.variable.name + ' | ' + String(e));
      errors.push({ name: item.variable.name, error: String(e) });
    }
  }

  postToUI('EXECUTE_RESULT', { remapped: remapped, skipped: skipped, errors: errors, total: analysis.length, log: log });
}
