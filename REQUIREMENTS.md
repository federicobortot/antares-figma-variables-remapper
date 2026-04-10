# Token Remapper → Foundations — Requisiti utente

## 1. Obiettivo generale

Il plugin consente di rimappare le variabili delle collezioni locali di un file Figma verso le variabili della libreria Foundations condivisa (e viceversa), oltre a rimappare le variabili associate alle proprietà degli stili di testo locali.

---

## 2. Modalità operative

### 2.1 Forward (locale → Foundations)
- Le variabili di componenti locali che attualmente puntano a variabili **primitive locali** devono essere ridirezionate verso le variabili equivalenti nella libreria Foundations.
- La corrispondenza tra variabile locale e variabile Foundations avviene per **nome esatto**.
- Ogni variabile può avere più mode: se anche un solo mode è rimappabile, la variabile appare come rimappabile.
- Una variabile che già punta a una variabile library viene segnalata come "Già library" e non viene toccata.
- Una variabile con valore diretto (non alias), incluso il valore numerico `0`, viene segnalata come "Valore diretto" e non viene toccata.

### 2.2 Reverse (Foundations → locale)
- Le variabili di componenti locali che attualmente puntano a variabili della libreria esterna (Foundations) devono essere ridirezionate verso le variabili locali equivalenti.
- La corrispondenza avviene per **nome esatto**.
- Se la variabile referenziata è una library variable non prontamente accessibile, il plugin tenta comunque di risolverla tramite l'ID.
- Se non è possibile risolvere la variabile referenziata in nessun modo, viene segnalata come "Irrisolvibile".
- Una variabile che punta già a una variabile locale viene segnalata come "Già locale" e non viene toccata.
- Se due variabili locali hanno lo stesso nome, ha la precedenza la variabile **non remote** (cioè definita nel file corrente, non importata).

---

## 3. Selezione delle sorgenti (Step 1)

### 3.1 Layout per modalità
- **Forward**: due colonne — a sinistra le sorgenti locali da rimappare, a destra le librerie Foundations di destinazione.
- **Reverse**: una sola colonna con le collezioni locali da rimappare (nessuna libreria di destinazione necessaria).
- Il toggle Forward/Reverse è accessibile solo allo step 1. Cambiare modalità resetta tutte le selezioni.

### 3.2 Colonna sinistra — sorgenti locali
- Elenco di tutte le **collezioni di variabili locali** con il numero di variabili per collezione.
- Le collezioni sono mostrate **tutte in sequenza**, senza altezza massima né scroll interno al contenitore.
- Selezione multipla: si possono selezionare più collezioni insieme.
- La selezione è **condivisa** tra forward e reverse: selezionare una collezione in una modalità la mantiene selezionata anche quando si passa all'altra.
- Sezione **"Stili"** (nome generico, progettato per espandersi in futuro con grid, colori, ombre):
  - Checkbox **"Includi stili di testo"** con conteggio degli stili locali presenti nel file.
  - Il conteggio viene caricato automaticamente all'apertura del plugin.
  - Attivare o disattivare questa checkbox abilita/disabilita immediatamente il pulsante "Avanti".

### 3.3 Colonna destra — librerie Foundations (solo forward)
- Elenco delle collezioni disponibili nelle librerie di team, raggruppate per nome di libreria.
- Le librerie vengono **caricate automaticamente** all'apertura del plugin, senza richiedere azioni all'utente.
- Durante il caricamento viene mostrato un indicatore visivo (loader).
- Pulsante **↺ Ricarica** per ricaricare manualmente le librerie (utile se una libreria viene abilitata dopo l'apertura).
- In caso di errore di caricamento, viene mostrato un messaggio esplicativo e il pulsante Ricarica rimane disponibile.
- Le collezioni selezionate appaiono come **pillole rimovibili** riepilogative sopra la lista.
- Pulsante **"Seleziona tutte"** visibile solo quando le librerie sono caricate.

### 3.4 Condizioni per procedere allo step 2
- **Forward**: almeno un elemento della colonna sinistra (una collezione locale **oppure** la spunta "Includi stili di testo") **e** almeno una collezione dalla colonna destra.
- **Reverse**: almeno una collezione locale selezionata.

---

## 4. Anteprima (Step 2)

### 4.1 Statistiche
- Riga di contatori in cima: **Da rimappare**, **No match**, **Valore diretto**, **Già library** (in forward) / **Già locale** (in reverse).

### 4.2 Classificazione delle variabili

| Stato mostrato | Significato | Checkbox presente |
|---|---|---|
| ✓ Rimappa | La variabile può essere rimappata | Sì |
| No match | Nessuna corrispondente trovata nella destinazione | No |
| Valore diretto | La variabile ha un valore diretto, non è un alias | No |
| Già library | (forward) Punta già a una variabile library | No |
| Già locale | (reverse) Punta già a una variabile locale | No |
| Irrisolvibile | (reverse) Il riferimento non è risolvibile | No |

- Le variabili non rimappabili appaiono nella tabella ma **senza checkbox** e non possono essere selezionate.
- Lo stato mostrato riflette il primo mode della variabile; se i mode sono discordanti, il badge indica lo stato predominante.

### 4.3 Raggruppamento in accordion
- Le variabili sono raggruppate per il prefisso prima del primo `/` nel nome (es. `color/primary` → gruppo `color`).
- Variabili senza `/` nel nome finiscono nel gruppo `(altro)`.
- Ogni gruppo mostra quante variabili contiene e quante sono rimappabili.
- I gruppi si aprono e chiudono con un click. Tutti i gruppi partono aperti; la ricerca li riapre tutti.
- La checkbox di gruppo seleziona/deseleziona tutte le righe rimappabili del gruppo e supporta lo stato indeterminate (selezione parziale).

### 4.4 Selezione righe
- All'apertura dell'anteprima tutte le righe rimappabili sono **pre-selezionate**.
- Checkbox globale nell'header con stato indeterminate quando la selezione è parziale.
- Il pulsante "⚡ Esegui remapping" è abilitato solo se almeno una riga (variabile o stile) è selezionata.

### 4.5 Ricerca e filtro
- Barra di ricerca testuale: filtra per nome della variabile o per nome del target.
- Pulsante × per svuotare la ricerca.
- Filtri rapidi: **Tutte**, **No match**, **Valore diretto**, **Già library/locale**.
- Ricerca e filtro si combinano tra loro.
- La sezione stili non è soggetta a ricerca o filtro.

### 4.6 Stili di testo
- Se "Includi stili di testo" è attivo, viene mostrata una sezione separata sotto la tabella delle variabili.
- La sezione mostra solo gli stili che hanno almeno un campo tra `fontSize`, `lineHeight`, `letterSpacing`, `paragraphSpacing`, `paragraphIndent` associato a una variabile rimappabile.
- Gli stili senza binding variabile su nessuno di questi campi non compaiono.
- Stessa struttura accordion + checkbox della tabella variabili.
- La colonna centrale indica i nomi dei campi che verranno aggiornati.
- All'apertura dell'anteprima tutti gli stili rimappabili sono **pre-selezionati**.

### 4.7 Avvisi
- Se ci sono variabili "No match", viene mostrato un avviso che suggerisce di verificare i nomi o abilitare altre collezioni.

---

## 5. Esecuzione (Step 3)

### 5.1 Cosa viene modificato
- Per ogni variabile selezionata, tutti i mode vengono aggiornati con il nuovo riferimento.
- Per ogni stile di testo selezionato, tutti i campi rimappabili vengono aggiornati con il nuovo binding.
- Variabili e stili vengono elaborati nello stesso passaggio: il risultato finale è cumulativo.

### 5.2 Risultato
- Titolo di esito: **"Remapping completato!"** (verde) o **"Completato con avvisi"** (giallo) se ci sono errori parziali.
- Contatori: quante variabili/stili sono stati rimappati, quanti saltati.
- Testo contestuale: *"ora puntano alle Foundations"* (forward) / *"ora puntano alle token locali"* (reverse).

### 5.3 Log dettagliato
- Ogni operazione genera una riga nel log: token nome, campo (per gli stili), valore precedente → valore nuovo.
- Le righe di **errore** sono evidenziate in rosso; tutte le altre in grigio neutro.
- Pulsante **Copia** per copiare l'intero log negli appunti.

---

## 6. Navigazione e UX generale

- Plugin a **3 step** con barra di avanzamento visiva: Selezione → Anteprima → Risultato.
- Allo step 1 il pulsante principale si chiama **"Anteprima →"**.
- Allo step 2 il pulsante principale si chiama **"⚡ Esegui remapping"** e ha aspetto "pericoloso" (rosso) per segnalare che l'operazione modifica il file.
- Allo step 3 non ci sono pulsanti Avanti/Indietro; il pulsante Chiudi cambia aspetto per indicare il completamento.
- Il pulsante **"← Indietro"** dallo step 2 torna allo step 1 mantenendo le selezioni già fatte.

---

## 7. Feature future previste (non ancora implementate)

- **Sezione "Stili" espansa**: oltre agli stili di testo, gestire anche grid styles, color styles, effect styles. Il nome "Stili" (anziché "Stili di testo") è stato scelto esplicitamente per questa espansione futura.
- Eventuale supporto a librerie esterne anche in modalità reverse.
- **Ridimensionamento della finestra del plugin**: l'utente dovrebbe poter trascinare un bordo o un angolo per ridimensionare la finestra del plugin. Tentativi di implementazione falliti a causa dei limiti di Figma (gli eventi mouse non attraversano il confine iframe → nessuna possibilità di intercettare il drag con puro JavaScript lato UI). Richiede una soluzione alternativa (es. preset di dimensioni, handle che invia coordinate tramite postMessage al backend, oppure un supporto nativo di Figma in futuro).

