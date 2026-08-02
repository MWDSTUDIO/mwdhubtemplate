# The Inner House — Wedding Communication
**Brief de refonte. Une seule page qui réunit la communication générale et la guest communication — avec la main d'Estelle partout.**
Fichiers : `communication/page.tsx` · `guests/page.tsx` · `actions/guests.ts` · `actions/communication.ts`

---

## Le but

**La clientèle de la maison est majoritairement américaine et très fortunée.** Le standard visé est celui d'un wedding producer de haut vol — le niveau Marcy Blum : une maison qui tient la liste d'invités **mieux que le couple lui-même**, au cordeau des conventions de papeterie américaines, et qui transmet à chaque prestataire le fichier exact dont il a besoin, sans qu'on le lui demande.

Et un principe qui gouverne toute la page, parce que c'est la compétence de la maison :

> **Tout ce que la page contient doit pouvoir être corrigé à la main par Estelle, à tout moment, y compris au dernier moment.** Le couple saisit, l'import déverse, l'agent vérifie — mais la dernière main est toujours celle de la maison. Aucun champ verrouillé, aucun automatisme qui écrase une correction humaine.

**Une seule page : `Wedding Communication`** (route `/communication` conservée ; `/guests` redirige en 301 ; une seule entrée dans le rail). Deux territoires dessous : la communication générale, et la guest communication.

---

## 1. Volet — General communication

La communication du mariage vue d'en haut, **légère** : ni guide, ni calendrier détaillé (la Timeline fait ce travail), ni fabrication (le papetier est un prestataire, son épreuve se suit dans Vendors).

Ce qui reste, et rien de plus :

- **La correspondance envoyée aux invités** — save the date, invitation suite, mot pratique — en **lignes d'état simples** : quoi · quand · parti ou à venir.
- **Une note de la maison** libre, optionnelle, en brouillon jusqu'à publication.

**La règle qui rend ce volet viable : il se tient tout seul, ou il ment.** Un registre tenu à la main finit périmé, et une information périmée dans un hub de luxe est pire qu'une absence. Donc :

- Chaque ligne de correspondance peut être **liée à un jalon de la Timeline** ; marquer le jalon fait marque la ligne partie. **Une information, un endroit, zéro double saisie.**
- Une ligne non liée reste éditable à la main — mais si sa date est passée sans état, elle s'affiche **à Estelle seule** comme *« à confirmer »*, jamais au couple comme une fausse certitude.
- **Le volet ne se rend au client que s'il a du contenu.** Vide, il n'existe pas — pas de coquille.

Ce qui disparaît de l'ancienne page : le suivi *In proof / Approved* (→ Vendors), le tableau *Hospitality & guest logistics* (vide), l'encart *The Desk* (doublon). `hospitality_items` n'est plus lue ; suppression sur décision d'Estelle seulement.

---

## 2. Volet — Guest communication : la liste

### 2.1 Trois chemins d'entrée, un même résultat

**a) Le couple saisit** — le formulaire existant, remonté au standard américain (§2.3).

**b) Le couple donne un fichier, la maison l'importe.** C'est le cas réel le plus fréquent : un Excel tenu par la mariée ou sa mère, colonnes dans le désordre, civilités approximatives, doublons. **L'import est un citoyen de première classe, pas un utilitaire caché :**

- Formats acceptés : **XLSX, CSV, Google Sheets exporté** — et un collage direct depuis le presse-papiers.
- **Écran de correspondance des colonnes** : l'application propose le mappage (Nom → name, Email → …), Estelle corrige d'un menu. Les colonnes inconnues sont conservées en notes, jamais jetées.
- **L'agent normalise en proposant, jamais en décidant** : il déduit les civilités probables, sépare prénoms/nom/suffixe, repère les doublons et les foyers à fusionner — et présente tout en **revue avant intégration**, ligne par ligne ou en bloc, exactement comme le comparatif de lecture des devis. Rien n'entre dans la liste sans passage sous les yeux d'Estelle.
- Un import **n'écrase jamais** une ligne existante corrigée à la main : en cas de collision, les deux versions s'affichent et Estelle tranche.

**c) La maison saisit ou corrige directement.** Voir 2.2 — c'est le cœur de la demande.

### 2.2 La correction manuelle — la compétence de la maison, outillée

En Team view, la liste se travaille **comme le Ledger** :

- **Édition en place** : clic sur une cellule, correction, `Entrée`. Pas de modale pour changer une civilité ou corriger une orthographe.
- **Navigation clavier** : flèches, `Tab`, `Échap`, `Cmd/Ctrl+Z` — y compris sur les créations et suppressions.
- **Ajout rapide** : une ligne « + add a household » en bas de liste, création immédiate, curseur dans le premier champ.
- **Corrections en série** : sélection multiple → changer l'événement convié, le statut, l'hôtel, en un geste. À trois jours du mariage, on corrige vingt lignes, pas une.
- **Provenance visible au survol** : saisie par le couple · importée · corrigée par la maison. La version de la maison **prime toujours** — l'œil du papetier signale mais ne re-modifie jamais une ligne marquée corrigée à la main.
- Tout reste en **brouillon → publication** comme le reste du hub pour ce que le couple voit ; les corrections internes (orthographe, civilité) s'appliquent sans cérémonie.

### 2.3 La saisie au standard américain

**L'anglais américain est le régime par défaut** (le français reste par foyer). Menu de civilités : **Ms. en premier** (le défaut absolu en cas de doute), Mr., Mrs., Miss, Mx., Mr. and Mrs., Dr., The Doctors, The Honorable, The Reverend · Rabbi · Cantor, grades militaires en toutes lettres.

Règles **exécutées par le formulaire**, pas documentées :

- **Suffixe en champ à part** (Jr. · Sr. · II · III · IV), correctement placé : *Mr. William Fitzgerald, Jr.*
- **Le titre le plus élevé en premier** : *Dr. Sarah Mitchell and Mr. James Mitchell*.
- **Couple non marié** : deux noms complets, deux lignes, ordre alphabétique.
- **Couple de même sexe** : alphabétique ou préférence du couple — champ toujours éditable.
- **« and Guest »** : indicateur sur le foyer ; quand le nom arrive, il remplace « and Guest » partout, exports compris.
- **Les enfants ne figurent pas sur la ligne d'enveloppe** ; le foyer porte leurs prénoms et leur nombre.
- **« Mademoiselle » n'existe pas** dans le menu français ; *Maître* y figure.
- **La ligne d'invitation se pré-remplit** à la saisie selon ces règles, et reste entièrement éditable.
- **L'œil du papetier conservé** : relecture de chaque ligne comme un papetier de Madison Avenue, signalements — jamais de correction automatique.

### 2.4 Le foyer

Civilité · prénoms, nom, suffixe · ligne d'invitation · adresse postale · langue · événements conviés · adultes et enfants (prénoms) · voyage et séjour · notes alimentaires · statut de réponse · « and Guest » · provenance. Chaque champ existe parce qu'un export en a besoin.

---

## 3. Volet — Accommodation & Travel

- **Accommodation** : blocs négociés (les invités réservent avec un code) et rooming list (la maison attribue), verrou existant conservé — ouverture sur le mot d'Estelle. **La rooming list s'édite en place**, comme la liste.
- **Travel** : interne, arrivées/départs consolidés, alimente l'export hébergement. Jamais rendu en vue client — vérification serveur.

---

## 4. Les exports

Team view uniquement. **XLSX et CSV.** Chaque destinataire ne reçoit que ce dont il a besoin.

| Export | Colonnes | Une ligne par |
|---|---|---|
| **Papetier** | Ligne d'invitation exacte · adresse · langue | Foyer |
| **Traiteur** | Événement · adultes · enfants · notes alimentaires | Événement, puis foyer |
| **Lieu** | Événement · confirmés · en attente · enfants | Événement |
| **Hébergement** | Nom · hôtel · arrivée · départ · nuits · effectif | Foyer hébergé |
| **Liste brute** | Tout | Foyer |

Règles : nom de fichier explicite (`Paula & Aaron — Caterer — 2 August 2026.xlsx`) · en-têtes lisibles · un onglet par événement · filtres (événement, statut, hébergé) · **compte de lignes avant téléchargement** · **journalisation de chaque export** · aucun export en vue client, y compris par appel direct.

**L'export reflète l'état corrigé à l'instant du clic** — c'est ce qui rend les corrections de dernière minute utiles : Estelle corrige à 18h, exporte à 18h02, le traiteur reçoit la version juste.

---

## 5. Les exigences du dix sur dix

Cinq mécanismes qui font passer la page d'un bon outil à l'instrument d'une grande maison. Tous découlent du même fait : **une liste d'invités bouge jusqu'au dernier jour, et tout le monde en aval dépend de sa version.**

### 5.1 — Le delta d'export : « ce qui a changé depuis votre dernière liste »

Chaque export est déjà journalisé. En tirer la conséquence : au prochain export vers le même destinataire, l'application propose **la liste complète OU le delta** — *« 3 foyers modifiés, 1 ajouté depuis la liste du 12 juillet »* — avec les changements surlignés dans le fichier.

C'est exactement ce qu'un traiteur attend d'une grande maison : pas une quatrième liste complète à re-comparer lui-même, mais *ce qui a bougé*. Personne ne le fait ; c'est un marqueur de niveau.

### 5.2 — Le compte arrêté (final count)

Le geste le plus engageant du métier : le chiffre donné au traiteur et au lieu, souvent contractuel.

- Un bouton **« Record the count given »** par événement et par destinataire : le chiffre, la date, à qui. Enregistré, affiché sur la page.
- **Si la liste bouge après un compte arrêté** — une confirmation tardive, une annulation — **alerte à Estelle** : *« The dinner count given to Atelier R. on July 12 was 142 ; the list now says 145. »* C'est l'écart qui coûte de l'argent ou une table manquante, et personne ne le surveille jamais.

### 5.3 — Les contrôles de complétude avant export

L'œil du papetier étendu à l'hygiène des données. Avant chaque export, un contrôle du **nécessaire pour ce destinataire** :

- Papetier → foyers **sans adresse postale** signalés (on ne poste pas sans adresse).
- Traiteur → événements avec des foyers confirmés **sans effectif adulte/enfant** renseigné.
- Hébergement → foyers « accommodation wished » **sans hôtel attribué**.

Le contrôle **signale et laisse passer** — Estelle décide. Mais elle ne découvre plus un trou dans le fichier après l'avoir envoyé.

### 5.4 — La prise de plume : à T−30, la maison tient la liste

Jusqu'à une date choisie par Estelle (défaut : J−30), le couple modifie librement sa liste. **Après cette date, la plume passe à la maison** : les modifications du couple deviennent des **propositions** — visibles dans les attentions d'Estelle, appliquées d'un clic — au lieu d'écritures directes.

Pourquoi : après le compte arrêté, une modification silencieuse du couple casse les chiffres donnés aux prestataires sans que personne ne le voie. La prise de plume ne retire rien au couple — sa demande est traitée en heures — mais **plus rien ne bouge sans passer sous les yeux de la maison**. C'est précisément ce qu'un couple UHNW paie : à l'approche du jour, la maison tient tout.

Réglable par mariage ; Estelle peut ne jamais l'activer.

### 5.5 — Les retardataires et le mouvement récent

Deux filtres d'un clic, parce que ce sont les deux questions réelles des dernières semaines :

- **« No reply yet »** — les foyers sans réponse à l'approche de la date limite, **exportables** en une liste que le couple utilise pour relancer (c'est lui qui relance, pas la maison).
- **« Changed lately »** — tout ce qui a bougé dans les dernières 48 heures / 7 jours. C'est le filtre qu'Estelle ouvre chaque matin de la dernière semaine.

Et pour le traiteur, en tête de son export : **le rollup des régimes** — *vegetarian 12 · shellfish-free 3 · nut allergy 2* — agrégé par événement, avant le détail par foyer. C'est la première chose qu'une brigade regarde.

---

## Critères d'acceptation

- Une seule entrée `Wedding Communication` ; `/guests` redirige ; la page est **plus légère qu'aujourd'hui**.
- Importer un XLSX désordonné de 120 foyers : mappage proposé, normalisation en revue, doublons signalés, rien d'intégré sans validation — et aucune ligne corrigée à la main écrasée.
- Corriger une civilité en place au clavier, sans modale ; corriger vingt statuts en une sélection multiple.
- *Dr. Sarah Mitchell and Mr. James Mitchell* sort dans le bon ordre sans intervention ; `Jr.` correctement placé.
- « and Guest » se met à jour partout quand le nom arrive.
- *Mademoiselle* introuvable ; *Ms.* en premier.
- Un export lancé juste après une correction manuelle contient la correction.
- Les cinq exports : nommés, filtrés, journalisés, inaccessibles en vue client.
- Lisible à 430 px sans défilement horizontal.
- Un second export vers le même destinataire propose le delta, avec les changements surlignés.
- Un compte arrêté enregistré, puis une confirmation tardive → l'alerte d'écart apparaît chez Estelle.
- Un export papetier avec deux foyers sans adresse → les deux foyers sont signalés avant téléchargement.
- La prise de plume activée à J−30 : une modification du couple arrive en proposition, pas en écriture directe.
- Les filtres « no reply yet » et « changed lately » fonctionnent, et le premier s'exporte.
- L'export traiteur commence par le rollup des régimes par événement.
- Une ligne de correspondance liée à un jalon se marque partie quand le jalon est fait ; le volet général vide n'est pas rendu au client.
- Aucune donnée perdue ; migration éventuelle : écrite, annoncée, **non exécutée**.

---

## Ordre — en trois lots, avec validation entre chaque

**La page reste unique** : la fusion *supprime* plus de code qu'elle n'en ajoute (une entrée de rail en moins, quatre blocs morts retirés), ce n'est pas elle qui charge. Ce qui charge, ce sont les mécanismes du dix sur dix — donc ils arrivent en dernier, par lots, et **chaque lot se livre, se montre et se valide avant d'ouvrir le suivant**. Si Estelle veut s'arrêter après le lot A ou B, la page est complète et cohérente à ce stade.

**Lot A — la page juste** (l'essentiel) : étapes 1 à 4.
**Lot B — la page qui transmet** : étape 5.
**Lot C — la page d'une grande maison** : étapes 6 à 9.

1. Fusion, suppressions, redirection.
2. Édition en place + corrections en série (2.2) — **c'est la priorité d'Estelle**.
3. Civilités américaines, suffixe, pré-remplissage (2.3).
4. L'import avec mappage et revue (2.1.b).
5. Les cinq exports + contrôles de complétude (5.3) + rollup régimes (5.5).
6. Le delta d'export (5.1) et le compte arrêté (5.2).
7. Les filtres retardataires / mouvement récent (5.5).
8. La prise de plume (5.4).
9. General communication (volet 1), lié à la Timeline, en dernier.
