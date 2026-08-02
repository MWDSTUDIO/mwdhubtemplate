# The Inner House — Audit Phase 0 du module financier

**Réponse au Master Product & Engineering Brief, §40. Aucune modification effectuée — audit seul.**
Établi le 2 août 2026, sur l'arbre de travail courant. Chaque affirmation porte sa référence `fichier:ligne`.

---

## 1. L'architecture financière actuelle, exacte

Une seule URL, `/budget`, porte tout le domaine. `src/app/[locale]/(hub)/budget/page.tsx` (427 lignes, composant serveur) monte `<BudgetTabs>` à deux onglets — **Scope** et **Budget management** — dont les deux panneaux sont rendus simultanément et basculés en `display:none` (`budget-client.tsx:20-37`) : tout le module se monte au premier rendu.

**Panneau Scope** : carte d'intro · `ScopeStudio` (`scope-client.tsx:24`) · `ScopeAnalysisDrop` (équipe) · `MadameBudgetAdd` (équipe).

**Panneau Management**, onze sections empilées : `PublishBar` · `ReadingsDesk` · 3 cartes KPI · barre de progression + alertes · `BudgetViews` (2ᵉ étage d'onglets : **Ledger** / **House Book**, `ledger-client.tsx:136-153`, persisté en localStorage) · `PaymentsCalendar` · `RemindersDesk` · bloc Analyse (AnalysisDesk + aperçu client + BudgetAsk) · `BudgetDocDrop` · `RiskBuffer` · `InternalNotes`.

**Poids** : ~6 400 lignes de TSX derrière une URL — `ledger-client.tsx` **1 735**, `vendor-client.tsx` 1 120, `scope-client.tsx` 715, `mgmt-client.tsx` 657, `reminders-client.tsx` 588, `budget-client.tsx` 484, `readings-client.tsx` 341. Actions : `actions/budget.ts` 921 lignes (26 actions exportées), `budget-scope.ts` 234 (8 actions), `publish-desk.ts` 316, `readings.ts`, `banking.ts`, `reminders.ts`.

**Moteur de calcul** : `src/lib/budget-math.ts` (148 lignes, isomorphe) — `barModel`, `pctOfBudget`, `coherence`, `envelopeCommitted`. Les totaux de tête sont calculés **côté serveur** (`page.tsx:114-152` : engagé/payé en euros tracés via `lineEurValues`/`sumMoney`, répartition par enveloppe, prochaine échéance par ligne). Mais une seconde famille de totaux vit **uniquement dans le navigateur** (§8).

**Les quatre métiers du brief, aujourd'hui** : *Decide* = ScopeStudio (3 niveaux Recommended/Forecast/Committed, 0014) — sans scénarios. *Control* = le Ledger + fiches vendeurs + paiements + rappels (0018) + bancaire vérifié (0016). *Explain* = le House Book (`ledger-client.tsx:1279`) + notes publiables + analyse sous le mot d'Estelle (0022). *Assist* = les routes `api/agents/*` + `runAgent()` — lecture de documents, compositions, rappels. Le **Financial Control Centre** n'existe pas ; ses fragments sont dispersés (alertes d'anomalie `page.tsx:302-316`, désk de publication, readings desk).

---

## 2. Le flux d'ingestion documentaire, exact

Quatre routes acceptent un fichier (`multipart/form-data`), toutes synchrones, aucune ne déclare `maxDuration` :

| Route | Stockage | Modèle | maxTokens | Persistance |
|---|---|---|---|---|
| `api/agents/document` (`route.ts:44-279`) | bucket `internal` (`:65-68`) | passe 1 : `ANALYSIS_MODEL` 8000 ; passe 2 de repli : `HOUSE_MODEL` 2500 **items abandonnés** (`:116,147-152`) | 8000/2500 | `vendors` upsert, `vendor_documents.extraction`, `document_readings.payload` (`:193-248`) |
| `api/agents/banking` (`:65-148`) | bucket `vault` via client admin (`:84-88`) | `ANALYSIS_MODEL` + filet déterministe `banking-checks.ts` (`:119-138`) | 4000 | `document_readings` `proposed` |
| `api/agents/proposal-read` | **rien** | `HOUSE_MODEL` | 1200 | **rien** — état React seulement |
| `api/agents/scope-analysis` | **rien** | `HOUSE_MODEL` | 2500 | seulement les notes internes (`:74-77`) ; l'analyse est perdue au refresh (`scope-client.tsx:602-611`) |

Mécanique commune : `Buffer.from(await file.arrayBuffer())` → base64 du **fichier entier** dans **un seul bloc document** d'une seule requête (`run.ts:136-154`). `runAgent()` (`src/lib/agents/run.ts`) assemble le contexte RLS par 9 requêtes parallèles et le sérialise **sans aucune borne** dans le system prompt de chaque appel (`:59-111`) ; **aucun prompt caching** (`cache_control` absent). Parsing `JSON.parse` strict, non gardé sur `proposal-read:52` et `scope-analysis:65` (→ 500 sec).

**Revue humaine** : `readings-client.tsx` (341 l.) — cases à cocher par item/échéance/total/crédit/bancaire, **aucune édition par champ** (une valeur fausse ne peut qu'être acceptée ou rejetée en bloc), confidence à 4 valeurs affichée seulement < 0.7, `page` affichée sur les items mais **pas** sur les échéances, **aucun lien vers le PDF source**. `acceptReading` (`readings.ts:42-299`) pose tout en `draft`, préserve le travail manuel (`source_document_id is not null`, `:159-167`). Contraste : la revue **bancaire** (`vendor-client.tsx:359-480`) est au niveau cible — par champ, confidence %, page, rejets déterministes désactivés.

---

## 3. La raison exacte de l'échec des longs PDFs

Dix causes cumulatives, toutes vérifiées :

1. **Fichier entier, une passe, en mémoire** — pas de découpage par pages, pas de limite de taille sur ces routes (le seul `MAX_BYTES` du dépôt est sur la route couple `documents/transmit:7`).
2. **Plafond de sortie atteint avant la fin du document** : `maxTokens: 8000` face à un prompt qui exige « EVERY priced line… never truncate » (`document/route.ts:107-108`). `stopReason === "max_tokens"` → `throw "truncated"` (`:139`) → **passe maigre qui rend zéro ligne** (`items: []`, `:116`), signalée `items_lost` — une « réussite » sans lignes.
3. **Mur des fonctions Netlify synchrones** : `netlify.toml` ne configure ni timeout ni background functions ; aucun fichier `*-background.mjs` ; aucune route document ne déclare `maxDuration` (seul `api/reminders/tick/route.ts:7` en a un). Deux appels Opus séquentiels + 9 requêtes de contexte + upload ≈ dépassent le plafond ~26 s → 502 nu.
4. **SDK sans timeout ni retries configurés** (`new Anthropic({apiKey})`, `run.ts:124`) ; seul le repli 404/403 est attrapé (`:170-176`) — 429/500/overloaded s'échappent.
5. **Parsing JSON strict** d'une longue réponse (`:140`) : la moindre prose → repli maigre.
6. **Aucune persistance intermédiaire** : entre l'upload et le parse réussi, rien n'est écrit ; une fonction tuée au milieu ne laisse que l'objet dans le bucket — pas de table de jobs, pas de file (`grep queue|job|pg_cron` : zéro).
7. **Aucun retry, aucune reprise par page** — la « récupération » documentée est littéralement *« drop the document once more »* (`:260-261`), sur le même chemin qui vient d'échouer.
8. **Aucun hash de fichier, aucune déduplication** : clé de stockage `${Date.now()}-${file.name}` (`:65`) — chaque re-dépôt refait et refacture tout ; le remplacement se fait par delete-by-label **généré par le modèle** (`:212-217`) — un doublon s'empile si le label change.
9. **Le contexte non borné aggrave tout** : chaque passe ré-envoie l'intégralité du mariage (lignes, vendeurs, jalons, brief) dans le system prompt, sans cache.
10. **Le client abandonne en silence** : tous les appels sont des `fetch` nus avec un `catch` générique (`budget-client.tsx:253-260`, `vendor-client.tsx:998-1004`…) — un 502 devient « failed », indistinguable d'un document illisible.

**Conclusion** : l'échec des PDFs ≥ 25 pages n'est pas un défaut de modèle mais un défaut d'architecture — passage unique + plafond de sortie + mur synchrone + absence totale d'état persistant/reprenable. C'est exactement ce que les Stages 1-6 du brief (§11-12) corrigent.

---

## 4. Le modèle de données actuel

**Tables existantes** (migrations 0001→0025) : `budget_envelopes` (+priority/locked 0011, +recommended_pct 0014) · `envelope_notes` (draft/publish) · `budget_lines` (+parent_line_id/line_kind 0011, +currency/committed_eur/fx_rate_id 0017) · `budget_line_items` (HT/TVA/TTC 0011, +source_document_id/source_page 0013, +currency 0017 **jamais lue**, +envelope_id 0020) · `payments` (+currency/amount_eur/method/payer/refundable/reveal_banking/notified_at 0011, +fx_rate_id 0017 **jamais écrit**) · `fx_rates` 0017 · `payment_reminders`/`reminder_sends` 0018 · `vendor_banking`(+historique+trigger 0016) · `budget_risks` 0011 · `document_readings` 0013 · `vendor_documents.extraction` jsonb 0001 · `contracts_vault` avec **`instalments jsonb`** — un second échéancier non typé, sans FK vers `payments` (`0001:394-402`) · `activity_log` 0015 · `internal_budget_notes`.

**Contre le modèle cible du brief (§5.3)** — ce qui MANQUE : `BudgetScenario` (zéro occurrence) · `VendorProposal/ProposalVersion` (seulement `vendor_documents.type` + label libre) · `Contract` comme entité (fichier + jsonb seulement) · `Commitment` comme ligne d'écriture (scalaires sur `budget_lines`) · `Invoice`/`InvoiceLine` · `Installment` distinct du règlement (une même ligne `payments` porte `due_date` **et** `paid_at`) · `PaymentAllocation` (un paiement ↔ une seule ligne, `0001:224`) · `CreditNote` (approché par `line_kind='credit'` négatif) · `Refund` (un booléen `refundable`, jamais un événement) · `SecurityDeposit` · `TaxLine` (3 scalaires par item, un seul taux) · `Approval` · `PublicationVersion` · `AuditEvent` typé (voir §5) · `DocumentPage`.

**Défauts de calcul relevés (faits, pas d'opinion)** :
- « Payé » a **trois chemins incohérents** : rollup depuis les paiements réglés seulement dans `markPaymentPaid` (`budget.ts:784-796` — jamais sur add/update/deletePayment : supprimer un paiement réglé ne retouche pas `budget_lines.paid`) ; saisie à la main qui l'écrase (`budget.ts:205`, éditable au Ledger) ; total de tête sommé depuis la **colonne** de ligne, jamais depuis la table `payments` (`page.tsx:119`).
- **Aucune validation HT×(1+TVA)=TTC** nulle part (grep exhaustif) ; la dérivation ne joue que si TTC absent (`budget.ts:574-577`) ; partout le repli `total_ttc ?? total_ht` fait silencieusement disparaître la taxe.
- Arrondi : la règle maison (`money.ts:1-20`) est contournée dans `saveLineItem` (`budget.ts:572,576`), le rollup de `markPaymentPaid` (`:791` — un paiement étranger sans `amount_eur` compte **0**), `acceptReading` (euros entiers, `readings.ts:132,200`), et `payments.amount` n'est jamais arrondi à l'écriture.
- `splitBudgetLine` : le résidu `max(0, committed - part)` **perd de l'argent en silence** quand `part > committed` (`budget.ts:440`).
- `rollupLine` n'écrit que si la somme > 0 (`:538`) — supprimer tous les items ne remet jamais `committed` à zéro.

**Tests** : 42 verts, mais uniquement sur les libs pures (`money`, `budget-math`, `banking-checks`, `reminders-logic`). **Aucun test** sur les actions serveur, la RLS, le trigger bancaire, l'algorithme de redistribution du scope, ou le moindre total client.

---

## 5. Le modèle de publication actuel

**Deux chemins indépendants, aux sémantiques différentes** :
- **La balayeuse** (`publish-desk.ts`, touche `p`) : collecte les ids **avant** publication (`:131-190`) → RPC `publish_budget` + `publish_timeline` → journal `publish_sweep` avec les ids → une notification → recomposition de l'analyse en **draft**. Réversible : `unpublishSweep(logId)` (`:269-316`) rend exactement ces ids au brouillon, une seule fois (`reverted_at`), depuis les 12 dernières entrées du journal.
- **Le bouton simple** `publishBudget` (`budget.ts:60-110`) : même RPC, journal **sans ids** → **irréversible**, et l'UI `PublishBar` (`budget-client.tsx:175-192`) publie **sans confirmation, sans récapitulatif, sans diff**.

**Le RPC** (`0004_functions.sql:36-50`) est un tout-ou-rien par mariage : tous les brouillons de lignes + notes passent `published` ; `grant execute to authenticated` (inerte pour un couple grâce à la RLS, mais plus large que l'intention). **Pas de publication par ligne.**

**Ce qui n'existe pas** (exigences §9.3 du brief) : versionnage des publications (aucune table de snapshot budget), **diff avant publication** (la balayeuse ne montre que des comptes), aperçu « ce que le couple lira », publication programmée, restauration d'une publication antérieure. Le seul historique existant : `vendor_banking_history` et `guest_export_snapshots` (module invités).

**Retour au brouillon à la moindre retouche** : correct et systématique (`updateBudgetLine:207`, `addBudgetLine:331`, `splitBudgetLine:423,441`, `rollupLine:541`, `acceptReading:121,134,200`) — deux exceptions assumées (`setLineVendor:344-346`) ou muettes (`deleteLineItem` via le no-op de rollup).

**Trois fuites précises trouvées** :
1. `publishScopeAnalysis` (`budget-scope.ts:225-234`) écrit `budget_analysis` **sans poser `budget_analysis_status`** — sur un mariage au défaut 0022 `'published'`, le texte part chez le couple en contournant le verrou de brouillon (bouton `scope-client.tsx:682-695`).
2. `publishBudget` et `publishSweep` portent un commentaire de repli pré-0022 **jamais implémenté** — `catch` vide (`budget.ts:99-101`, `publish-desk.ts:255-257`) : sur base non migrée, l'analyse recomposée serait jetée en silence.
3. `budget_line_items` : lecture couple **sans condition de statut** (`0011:35-37`) — les sous-lignes d'une ligne *draft* sont lisibles au niveau base (aujourd'hui masquées seulement parce que la ligne parente est invisible ; toute surface future qui interroge les items directement fuirait).

**La Client view (bascule)** est purement présentationnelle (`Topbar.tsx:150-168` + `globals.css:330-335`) — l'intention est documentée, la vraie séparation étant RLS + branches serveur (`page.tsx` : 20+ points de garde `session.isTeam`). **Écart de fidélité** : au Ledger, les lignes draft et leur point de brouillon restent visibles en Client view (`ledger-client.tsx:874-880` sans `.team-only`), et la vue par défaut équipe est le Ledger que le couple ne voit jamais — seul le bloc analyse a un double rendu fidèle.

---

## 6. Le modèle de permissions actuel

**Rôles effectifs** : `client` / `coordinator` / `team` (enum `0001:11`) + deux booléens `is_principal` (Estelle), `is_teamwork` (Estelle+Jordane), significatifs seulement quand role=team (`session.ts:55,72-74`) + la relation par mariage `couple|coordinator` (`0001:78`). Soit **5 personas** — pas de Owner/Lead Planner/Finance Manager/lecture seule ; pas de table de capacités ; **tout membre d'équipe a le pouvoir d'écriture complet sur le budget de tous les mariages** (policies `app.is_team()`, `0002:215-234`). `is_principal`/`is_teamwork` ne gardent **rien** dans l'aire financière (uniquement liens de nav + `/vault`, `/teamwork`).

**Garde-fous** : RLS solide et hiérarchisée (helpers `0002:12-53`, anti-escalade `protect_profile_flags` `0002:118`), `teamSession()` copié-collé dans 5 fichiers d'actions (`budget.ts:13-17` etc.), `gate(true)` sur 17 routes API. `requireHouseSession()` **ne vérifie aucun rôle** (`session.ts:80-84`).

**Trous précis** :
- `app.coordinator_of()` n'apparaît dans **aucune** policy budget : un coordinateur qui navigue vers `/budget` obtient une page vide, pas un refus.
- `updatePaymentFlags` — dont le **dévoilement d'IBAN au couple** — n'est **pas journalisé** (`budget.ts:801-815`), contrairement à tous les autres gestes bancaires.
- `api/pdf/vendor/[id]` est `gate(false)` et déchiffre le bancaire via client admin **sans le contrôle `status==='verified'`** que la page applique (`route.ts:54-58` vs `vendor/page.tsx:94`). Protégé aujourd'hui par accident (RLS payments vide pour un couple), pas par conception.
- Les boutons d'export CSV/XLSX du Ledger sont rendus **pour tous** (`ledger-client.tsx:1093-1094`) — un couple peut télécharger ses lignes publiées : fuite de discipline (non journalisé, non gaté) plus que de données.
- `payments` : aucune policy couple — le couple ne voit **aucune** échéance (le brief §9.1 veut des « approved upcoming payment requests » : impossible aujourd'hui au niveau base).

**Bancaire (0016)** : le point fort — trigger `guard_banking_reveal` en base (`0016:61-88`), historique, fingerprint, purge planifiée, chiffrement AES-GCM, revue par champ. À préserver tel quel.

---

## 7. Contrôles non fonctionnels ou incomplets

Bonne nouvelle mesurée : **zéro TODO/FIXME, zéro handler vide, zéro bouton factice** dans l'aire budget ; tous les `disabled` sont des gardes d'état légitimes. Les manques sont des **absences**, pas des simulacres :

- **Undo** : réel et soigné mais **uniquement dans la grille du Ledger** (`ledger-client.tsx:37,89-91,645-746` + `restoreBudgetLine`/`deleteBudgetLineWithUndo`) ; rien au scope (supprimer une enveloppe et sauver est définitif), rien sur `deletePayment` (**ni confirm ni undo**, `mgmt-client.tsx:177-187`), ni `deleteRisk`, ni publication simple. Piles en refs — perdues au refresh.
- **Archive** : zéro occurrence dans l'aire budget. Lignes/enveloppes/paiements/vendeurs ne connaissent qu'exister ou disparaître ; `deleteBudgetLine`/`deletePayment` sont des hard deletes — contraire au §23 du brief pour tout ce qui est approuvé.
- **Reverse** : n'existe pas — aucun mécanisme d'écriture d'extourne.
- **Duplicate** : lignes seulement (⌘D). **Merge** : nulle part (l'inverse de `splitBudgetLine` n'existe pas). **Scénarios** : zéro. **Réordonner les enveloppes** : impossible (le tri = position du tableau, `budget-scope.ts:47`).
- **Sélection multiple / actions en série** : aucune dans le Ledger (tout est geste par geste) ; pas de recherche texte (seul filtre : statut).
- **Colonne `budgeted`** : la donnée existe, l'UI du Ledger ne l'affiche ni l'édite (en-têtes `ledger-client.tsx:1106-1114`) ; qty/prix unitaire éditables seulement sur la fiche vendeur.
- **Readings desk** : pas d'édition par champ, pas de « relire ces pages », pas d'ouverture du PDF source (§2).
- `redistribute` du scope est mort tant que `budget_total` n'est pas posé au Desk (`scope-client.tsx:421`) — sans explication à l'écran.

---

## 8. Complexité dupliquée ou inutile

1. **Totaux à double vérité** : le serveur compte en euros tracés (`page.tsx:118` via `committedEur`), le Ledger client passe `converted:true` et `Number(l.committed)` sans regarder la devise (`ledger-client.tsx:1314-1315`) — **une ligne GBP donne deux chiffres différents** à un écran d'écart. Idem sous-totaux de groupe (`:1120-1123`) vs `envelopeCommitted`.
2. **Formule HT/TTC implémentée deux fois** (`budget.ts:572-577` serveur, `vendor-client.tsx:863-866` client).
3. **Deux magasins d'extraction** : `vendor_documents.extraction` (écrit, **jamais relu** par `src/`) et `document_readings.payload` (le vrai chemin). Le premier est du poids mort.
4. **Deux échéanciers** : `payments` et `contracts_vault.instalments` jsonb, sans lien ni réconciliation.
5. **Deux chemins de publication** aux garanties inégales (§5) ; **trois écritures de l'analyse** (`saveBudgetAnalysis` gardée, `publishBudget`/`publishSweep` recomposition, `publishScopeAnalysis` fuyante).
6. **`teamSession()` copié dans 5 fichiers** ; `gate()` dans `_shared` des agents réutilisé par des routes non-agents.
7. **Colonnes mortes** : `budget_line_items.currency` (0017, ni lue ni écrite), `payments.fx_rate_id` (jamais écrit), `payments.reminder_sent_at` (remplacé par 0018, jamais lu par le moteur).
8. **Export du Ledger côté navigateur** alors que `api/exports` (invités) possède déjà toute la discipline serveur — gate, snapshot, delta, journal, nom de fichier composé — non réutilisée.
9. **Le contexte agent ré-envoyé intégralement à chaque appel** sans prompt caching : coût et latence dupliqués à chaque lecture.
10. `activity_log.actor` est un **nom d'affichage**, pas un id de profil ; la policy `team full` permet à l'équipe de **modifier/supprimer son propre journal** (`0015:24-27`) — un journal d'audit inscriptible n'en est pas un.

---

## 9. Composants à préserver (le brief §2.1 l'exige, l'audit le confirme)

- **`src/lib/budget-math.ts` + `src/lib/money.ts`** — corrects, testés (21 tests), une seule vérité de répartition : en faire le noyau du futur moteur, pas le remplacer.
- **Le House Book** (`ledger-client.tsx:1279+`) — éditorial, catégorie par catégorie, sélecteurs de catégorie partout, « → counts in » : signature du produit.
- **Le Scope à trois niveaux** (0014 : Recommended/Forecast/Committed) + verrou/priorité + notes par enveloppe raffinées par Madame.
- **La chaîne bancaire 0016 entière** : trigger en base, fingerprint, pending, historique, vérification hors bande, purge, revue par champ (`vendor-client.tsx:359-480`) — c'est le gabarit de la future revue documentaire.
- **La discipline draft→publish à la retouche** (`status:'draft'` systématique) et **la balayeuse réversible** (`publish_sweep` + ids + `unpublishSweep`) — l'embryon exact de `PublicationVersion`.
- **Le moteur de rappels 0018** (verrous, ledger d'envois idempotent, groupage) et ses 8 tests.
- **L'undo du Ledger** (edit/create/delete, ⌘Z/⌘⇧Z) — à généraliser, pas à réécrire.
- **`acceptReading` qui préserve le travail manuel** (`source_document_id is not null`) — le germe de « human corrections persist ».
- **La machinerie d'export invités** (`api/exports/route.ts` : gate, snapshot, delta, journal) — à généraliser au financier.
- **L'identité éditoriale** : palette OKLCH, Cormorant/Jost, la voix de la maison, `HouseProse`.

## 10. Composants à refactoriser

- **`ledger-client.tsx` (1 735 l.)** — à découper : grille, House Book, SplitPanel, FxHolder, HouseBookAdd en fichiers propres ; extraire les composants réutilisables du §34 du brief (DataTable, BulkActionBar, MoneyDisplay…).
- **`actions/budget.ts` (921 l.)** — à scinder par domaine (lignes/items, paiements, fx, analyse) avec `teamSession()` mutualisé dans `src/lib/session.ts`.
- **Tous les totaux client du §8** — à remplacer par les valeurs serveur passées en props (règle §33 : « do not calculate critical totals only in the browser »).
- **Le pipeline documentaire entier** (§2-3) — re-architecture par étapes persistantes ; les routes actuelles deviennent la façade.
- **`publishBudget`/`PublishBar`** — à aligner sur la balayeuse (ids + réversible + récap) puis à fusionner.
- **`page.tsx` budget** — la page doit devenir vue d'ensemble + exceptions + actions primaires (§27) ; documents et rapports partent en espaces dédiés.
- **`activity_log`** — insert-only (retirer update/delete de la policy), `actor_id`, before/after, entité+id typés.

---

## 11. Migrations requises (écrites par moi, exécutées par Estelle — additives, idempotentes)

Dans l'ordre de dépendance, regroupées par phase du brief :

1. **0026 — Journal d'audit durci** : `activity_log` + `actor_id uuid`, `entity`, `entity_id`, `before jsonb`, `after jsonb`, `origin check(human|ai)` ; policy insert-only pour l'équipe (select conservé) ; vue de compatibilité.
2. **0027 — Fondation transactionnelle** : `commitments` (ligne d'engagement versionnée : draft/approved/amended/superseded/reversed, FK contrat/document), `invoices` + `invoice_lines` (avec `tax_lines jsonb` typé multi-taux), séparation `installments` (échéancier) / `payments` (règlements) — `payments` actuel devient les échéances, un `payment_settlements` porte les règlements avec statuts §7.2 (Draft→Confirmed→Reversed…), `payment_allocations` (n-n vers invoices/lines, montant alloué). Reprise : chaque `payments.paid_at` existant engendre son settlement Confirmed ; rien n'est perdu.
3. **0028 — Approbations & publications versionnées** : `approvals` (objet, approbateur, décision, horodatage), `publication_versions` (snapshot jsonb des valeurs publiées par mariage + diff), rattachement de `publish_sweep` existant.
4. **0029 — Scénarios de scope** : `budget_scenarios` (nom, statut draft/published/archived, jsonb des enveloppes) + `budget_envelopes.archived`, `sort` éditable, min/max recommandés (`recommended_min_pct`/`recommended_max_pct` — le brief §4.3 demande une fourchette, 0014 n'a qu'un point).
5. **0030 — Document intelligence** : `document_files` (hash sha-256, taille, pages, langue, couverture texte natif, statut), `document_pages` (n°, texte, statut, hash), `document_extractions` (champ, valeur, page source, extrait, confidence, statut approved/rejected/corrected, correction, versions modèle/prompt), table de jobs à étapes reprenables.
6. **0031 — Archivage & extourne** : `archived_at` sur `budget_lines`/`payments`/`budget_envelopes`/`vendors` ; interdiction de hard delete des objets approuvés (trigger) ; type d'écriture d'extourne.
7. **Correctifs immédiats sans nouvelle table** (Phase 1) : policy couple sur `payments` (échéances publiées seulement), condition de statut sur la lecture couple de `budget_line_items`, journalisation de `updatePaymentFlags`, contrôle `verified` dans `api/pdf/vendor`, `publishScopeAnalysis` aligné sur le verrou 0022.

## 12. Plan d'implémentation sûr (phases du brief §38, mappées sur ce code)

- **Phase 1 — Fondation** : 0026+0027 ; `src/lib/finance/` (moteur de calcul serveur unique : engagé/facturé/payé/restants §5.4, validations §6, réconciliation) ; mutualiser `teamSession` ; corriger les 5 correctifs ci-dessus + les défauts d'arrondi (§4) ; tests sur chaque calcul et sur la RLS. *Rien ne change à l'écran.*
- **Phase 2 — Ledger** : brancher le Ledger sur les nouvelles entités (commitments/invoices/installments/settlements/allocations) ; découpage de `ledger-client.tsx` ; sélection multiple + BulkActionBar ; archive/restore/reverse ; colonne budgeted ; totaux serveur partout.
- **Phase 3 — Document Intelligence** : 0030 ; pipeline par étapes persistantes (intake→pages→mapping→extraction ciblée→réconciliation) en background function Netlify + reprise ; espace de revue à deux panneaux (page source à gauche, champs à droite — sur le modèle de la revue bancaire) ; hash/dédup/Resume-or-Reanalyse.
- **Phase 4 — Scope** : 0029 ; fourchettes MWD, scénarios nommés + comparaison + publication d'un seul ; terminologie §4.4 ; réordonner/archiver/fusionner les enveloppes.
- **Phase 5 — Publication & House Book** : 0028 ; un seul chemin de publication avec **diff avant envoi**, aperçu couple, versions restaurables ; « A Note from Madame Wedding Design » comme seule voix automatique-jamais ; policy payments couple pour les échéances à venir approuvées.
- **Phase 6 — Agents spécialisés** : Reader/Reconciler/Auditor/Forecast/Note/Payment-coordinator sur `runAgent` borné (contexte plafonné + prompt caching) ; niveaux de permission §14 (le niveau « jamais » est déjà largement respecté : l'IA ne confirme ni ne publie rien aujourd'hui — à verrouiller par code, pas par convention).
- **Phase 7 — Import/Export/Rapports** : généraliser `api/exports` au financier (registres, échéancier, fiscalité, delta, journal) ; PDF budget interne + client via `@react-pdf/renderer` existant ; centre d'import réutilisant l'assistant invités.
- **Phase 8 — QA finale** : matrice d'actions §16 complétée, audit de complétude §36, accessibilité, performance, scénario d'intégration §35 de bout en bout.

Chaque phase : une livraison, migrations annoncées et exécutées par Estelle, tests verts avant la suivante, captures — la règle de la maison inchangée.

---

*Fin de l'audit. Aucun fichier de l'application n'a été modifié.*
