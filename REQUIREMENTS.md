# Token Remapper → Foundations — Requisiti utente

## 1. Obiettivo generale

Il plugin Figma consente di rimappare variabili di componenti locali verso variabili della libreria Foundations (e viceversa), e di fare lo stesso con i valori di binding delle proprietà degli stili di testo.

---

## 2. Modalità operative

### 2.1 Forward (locale → Foundations)
- Le variabili di componenti locali che puntano a variabili primitive locali (es. collezione "primitives") devono essere reimpostate tramite `VARIABLE_ALIAS` verso le variabili equivalenti nella libreria Foundations.
- La corrispondenza avviene per **nome** della variabile.

### 2.2 Reverse (Foundations → locale)
- Le variabili di componenti locali che puntano a variabili di una libreria esterna (Foundations) devono essere reindirizzate verso le variabili locali equivalenti.
- La corrispondenza avviene per **nome** della variabile.

---

## 3. Selezione delle sorgenti (Step 1)

### 3.1 Colonna sinistra — elementi da rimappare
- Mostrare tutte le **collezioni di variabili locali** con numero di variabili per collezione.
- Le collezioni devono essere mostrate **tutte in sequenza**, senza altezza massima né scroll interno.
- Checkbox multipla: l'utente può selezionare una o più collezioni.
- Sezione **"Stili"** (nome generico, per espansione futura a grid, colori, ombre):
  - Checkbox "Includi stili di testo" con conteggio del numero di stili locali.
  - La checkbox aggiorna immediatamente la validità del pulsante "Avanti".

### 3.2 Colonna destra (solo forward) — librerie Foundations
- Mostrare le collezioni disponibili nelle librerie di team, raggruppate per libreria.
- Le librerie devono essere **precaricate automaticamente** all'apertura del plugin (senza dover premere un pulsante).
- Mostrare un loader durante il caricamento e un pulsante **↺ Ricarica** per ricaricare manualmente le librerie.
- Selezione multipla di collezioni da librerie diverse.

### 3.3 Validazione per procedere allo step 2
- **Forward**: almeno un elemento dalla colonna sinistra (una collezione locale **oppure** la checkbox "Includi stili di testo") E almeno una collezione dalla colonna destra.
- **Reverse**: almeno una collezione locale selezionata.

---

## 4. Anteprima (Step 2)

### 4.1 Variabili
- Mostrare una tabella con tutte le variabili delle collezioni selezionate.
- Per ogni variabile: nome, target (nome della variabile di destinazione), stato.
- Stati possibili: **Da rimappare**, **No match**, **Valore diretto**, **Già library/locale**.
- Riga di statistiche in alto con contatori per ogni stato.

### 4.2 Raggruppamento in accordion
- Le righe sono raggruppate per il prefisso prima del primo `/` nel nome della variabile.
- Ogni gruppo ha un'intestazione cliccabile che apre/chiude l'elenco.
- Badge con numero di token e numero rimappabili per gruppo.

### 4.3 Selezione righe
- Ogni riga rimappabile ha una checkbox.
- Checkbox di gruppo con supporto allo stato indeterminate (selezione parziale).
- Checkbox globale "seleziona tutte" nell'header della tabella.
- Il pulsante "⚡ Esegui remapping" è abilitato solo se almeno una riga (variabile o stile) è selezionata.

### 4.4 Ricerca e filtro
- Barra di ricerca testuale con pulsante × per svuotare.
- Filtri rapidi: **Tutte**, **No match**, **Valore diretto**, **Già library**.

### 4.5 Stili di testo
- Se "Includi stili di testo" è attivo, mostrare una sezione separata sotto la tabella variabili con i soli stili che hanno almeno un campo (`fontSize`, `lineHeight`, `letterSpacing`, `paragraphSpacing`, `paragraphIndent`) legato a una variabile rimappabile.
- Stessa struttura accordion+checkbox della tabella variabili.
- La colonna "Campi rimappabili" mostra i nomi dei campi che verranno aggiornati.
- La sezione è nascosta se "Includi stili di testo" non è attivo o se non ci sono stili da mostrare.

---

## 5. Esecuzione (Step 3)

### 5.1 Esecuzione variabili
- Per ogni variabile selezionata, importare la variabile Foundations e impostare `setValueForMode` con `createVariableAlias` per ogni mode della collezione.
- Importare le variabili per chiave (`importVariableByKeyAsync`) con cache per evitare import duplicati.

### 5.2 Esecuzione stili di testo
- Per ogni stile selezionato, chiamare `setBoundVariable(field, importedVar)` per ogni campo rimappabile.
- Forward: import asincrono della variabile Foundations (stessa meccanica delle variabili).
- Reverse: operazione sincrona (la variabile locale esiste già).

### 5.3 Risultato e log
- Mostrare numero di token/stili rimappati, saltati, eventuali errori.
- Log dettagliato con una voce per ogni operazione.
- Le righe di errore (`[ERR*]`) sono evidenziate in **rosso**; tutte le altre sono in grigio neutro.
- Pulsante **Copia** per copiare il log negli appunti.

---

## 6. Navigazione e UX generale

- Plugin a 3 step con barra di avanzamento visiva (Selezione → Anteprima → Risultato).
- Pulsanti "← Indietro" (torna allo step 1 dalla anteprima) e "Chiudi".
- Toggle **Modalità**: Forward / Reverse visibile nell'header, disponibile solo allo step 1.
- Il cambio di modalità resetta le selezioni.

---

## 7. Feature future previste (non ancora implementate)

- **Stili aggiuntivi nella sezione "Stili"**: gestione di grid styles, color styles, effect styles (ombre).
- Eventuale espansione del supporto a librerie esterne per la modalità reverse.
