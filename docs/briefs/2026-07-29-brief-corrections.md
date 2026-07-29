# The Inner House — Brief de correction
### Madame Wedding Design · maison parisienne de wedding planning et de production
**Destinataire : Claude Code · Ce document remplace toute interprétation antérieure sur les points qu'il traite.**

---

## 0. Comment lire ce document

Ce brief n'est **pas une liste de tâches**. Il est écrit en **buts**.

Pour chaque section tu trouveras :
- **LE BUT** — l'état final recherché, en une phrase. C'est le juge de paix.
- **CE QUI DOIT ÊTRE VRAI** — les critères d'acceptation vérifiables.
- **CE QUE TU DOIS CORRIGER** — les écarts constatés dans le repo actuel.

**Règle d'arbitrage :** quand une décision technique se présente, tranche seul en te demandant *« est-ce que ce choix rapproche ou éloigne du BUT ? »*. Quand un choix engage l'expérience client ou l'esthétique, tu poses la question — tu ne devines pas.

**Avant de commencer :**
1. `git checkout -b corrections/experience` — tout ce brief se fait sur une branche dédiée, un commit par section.
2. Relis `PROMPT-inner-house-claude-code.md` et la maquette `wedding-hub-mwd.html` — ils restent la référence de fond. Ce brief corrige et précise ; il ne réécrit pas l'architecture.
3. Vérifie qu'Impeccable est bien installé et lance `/impeccable audit` sur l'état actuel. Tu me remontes la liste des violations avant de toucher au code.

---

## 0 bis. Les invariants — jamais négociables

Quoi que tu fasses dans ce brief, ces règles tiennent :

- **The Inner House est un template multi-clients.** Rien de ce que tu codes ne doit être spécifique à un couple. Tout passe par les données du client courant.
- **Cloisonnement serveur.** Les cinq niveaux d'accès (client · coordinatrices · équipe · Teamwork · The Vault) sont appliqués **côté serveur**, jamais par masquage CSS ou conditionnel React. Un client ne doit **jamais** pouvoir atteindre un brouillon ou une donnée interne, même en appelant l'API directement.
- **Brouillon → publication.** Rien n'apparaît au client avant le go explicite d'Estelle. Chaque objet publiable porte un état (`draft` / `published`) et une date de publication.
- **Le travail de la maison est invisible.** L'analyse, la méthode, les marges de manœuvre, les notes internes : le client ne les voit pas et ne peut pas les deviner.
- **Palette et voix.** Crème et vert chasse `#22382B`, filets champagne. Wording maison : *attentions*, *Awaiting your word*, *At your leisure*, *Attended to*. Jamais « to do », jamais « task », jamais « pending ».
- **Interface en anglais**, i18n prête (FR, 中文, 日本語), traductions rédigées par toi.
- **Impeccable fait foi** sur le design : contraste ≥ 4.5:1, couleurs en OKLCH, pas de texte en dégradé, pas de glassmorphism, pas de grilles de cartes identiques, pas de bordure-liseré latérale, motion en ease-out expo sans rebond, `prefers-reduced-motion` obligatoire.

---

## 1. BUT — Une expérience client exceptionnelle

> **LE BUT :** qu'un client Ultra-High-Net-Worth (ultra-haut patrimoine, ~$30M+ net worth) ouvre The Inner House et ait le sentiment d'entrer dans une maison qui s'occupe de tout — jamais dans un logiciel. Qu'il comprenne où il en est en dix secondes, qu'il ne cherche jamais un bouton, et qu'il n'ait jamais à demander « et ça, où ça en est ? ».

### Ce qui doit être vrai

1. **Aucun état vide moche.** Chaque module a un état vide rédigé dans la voix de la maison, jamais « No data ». Exemple pour Documents : *« Nothing has been placed here yet. The house will let you know.”*
2. **Aucun chargement brutal.** Skeletons aux bonnes dimensions, jamais de spinner plein écran, jamais de saut de mise en page (CLS ≈ 0).
3. **Aucune erreur technique visible.** Pas de code d'erreur, pas de stack. Un message tenu + une porte de sortie (« Write to the house »).
4. **Chaque page répond à une question du client**, affichée haut de page en une ligne :
   - Home → *Where do we stand today.*
   - Timeline → *What the house is working on this month.*
   - Budget → *What we have committed, and what remains.*
   - Documents → *Everything the house has placed in your hands.*
5. **Le mobile est de première classe.** Le client lira 70 % du temps sur téléphone, souvent en déplacement. Cibles tactiles ≥ 44px, aucune table à scroll horizontal cassé, PWA installable, tout ce qui est cliquable sur desktop est atteignable au pouce.
6. **Les attentions sont évidentes.** Ce qu'on attend de lui apparaît sur Home avec un compteur discret, et nulle part ailleurs en doublon.
7. **Une seule action primaire par écran.** Pas deux boutons pleins côte à côte.
8. **Notifications** : email depuis la boîte d'Estelle ou de Jordane + rappel dans l'application. Jamais de notification sur un brouillon.

### Ce que tu dois corriger

- Passe **chaque page cliente** et supprime tout vocabulaire d'application : *dashboard, submit, item, entry, upload, admin, status*. Réécris dans la voix de la maison.
- Vérifie que l'expérience d'entrée (les deux portes vert chasse → *« The house is expecting you. »* → *« The Inner House of [Couple] »* → **Enter**) fonctionne **au premier chargement, sur mobile, et sans flash de contenu non stylé**. C'est la première impression de la maison — elle doit être parfaite.
- Ajoute un fil conducteur : depuis n'importe quelle page, le client doit pouvoir revenir à Home en un geste, et savoir où il est.
- Lance `/impeccable audit` puis `/impeccable polish` sur l'intégralité des vues clientes, et corrige toutes les violations avant de me montrer quoi que ce soit.

---

## 2. BUT — Une expérience Team view exceptionnelle

> **LE BUT :** qu'Estelle et Jordane pilotent un mariage entier depuis The Inner House sans jamais rouvrir un tableur, un dossier Drive ou un fil d'emails. Que la maison travaille **plus vite et plus détendue** qu'avant le hub — c'est le seul critère de réussite.

### Ce qui doit être vrai

1. **Vue client / vue équipe se basculent en un clic**, sur la même page, sans rechargement. En vue équipe, tout ce qui est brouillon est visuellement marqué (filet champagne + mention *Draft until your word*).
2. **Rien ne se saisit deux fois.** Une donnée entrée dans The Desk se propage partout. Si tu détectes une double saisie dans le repo, tu la supprimes et tu me le signales.
3. **Publier est un geste unique et sûr.** Un bouton *Publish to the couple* par objet, plus une **publication groupée** avec un récapitulatif explicite de ce qui va devenir visible (« 4 budget lines, 1 monthly note, 2 documents »). Confirmation obligatoire. Annulation possible (dépublier).
4. **Madame est atteignable partout en vue équipe** — pas seulement sur une page dédiée. Raccourci clavier, panneau latéral, contexte de la page courante injecté automatiquement dans sa conversation.
5. **Madame agit, elle ne discute pas.** Quand Estelle écrit « ajoute un artificier pour la reception et explique-le comme un final au-dessus des jardins », l'agent crée la ligne, l'affecte à son enveloppe, rédige la note dans la voix de la maison, et laisse le tout **en brouillon**. Il ne rend jamais du texte à recopier.
6. **Tout est éditable à la main.** Chaque chose que Madame peut faire, Estelle doit pouvoir la faire elle-même, sans passer par l'agent. La timeline en particulier : éditer, déplacer, supprimer, ajouter, marquer fait.
7. **Journal d'activité interne** : qui a publié quoi, quand. Utile le jour où quelque chose part trop tôt.
8. **Vitesse de saisie.** En vue équipe, tout formulaire se remplit au clavier : `Tab` circule dans l'ordre logique, `Entrée` valide, `Échap` annule. Autosave avec indicateur discret — jamais de perte de saisie.

### Ce que tu dois corriger

- Audite le repo et liste toutes les actions équipe qui demandent **plus de trois clics**. Ramène-les à un ou deux.
- Vérifie qu'aucune action équipe ne provoque de rechargement de page complet.
- Ajoute les raccourcis clavier et documente-les dans un `?` discret.

---

## 3. BUT — Une analyse de documents exceptionnelle

> **LE BUT :** qu'Estelle dépose un devis, un contrat ou un budget prestataire dans The Inner House, et que la maison en ressorte **avec ses données déjà en place** — lignes, montants, TVA, devise, échéancier, conditions — sans qu'elle ait à ressaisir un seul chiffre. C'est le gain de temps le plus important de tout le projet.

### Affecte ton agent le plus performant

**Consigne explicite : l'analyse documentaire ne doit jamais tourner sur un modèle rapide ou économique.**

- Crée un **sous-agent dédié** dans `.claude/agents/document-analyst.md`, configuré sur le **modèle le plus capable disponible dans le projet** (tier Opus). C'est lui, et lui seul, qui lit les documents financiers.
- Côté application, l'appel à l'API Anthropic pour l'analyse de documents utilise **le modèle le plus capable disponible**, pas le modèle par défaut. Isole ce choix dans une constante unique (`ANALYSIS_MODEL`) pour qu'il soit modifiable en un endroit.
- Les documents PDF sont envoyés **nativement** (bloc `document`, base64) — pas d'OCR maison, pas d'extraction de texte préalable qui détruirait la mise en page des tableaux.
- Les documents images (scans, photos de devis) passent en bloc `image`, même modèle.
- Un document long est traité **en entier**, jamais tronqué. Si le contexte ne suffit pas, tu découpes par page en conservant l'en-tête et tu recomposes.

### Ce que l'agent doit extraire d'un document budgétaire

Sortie en **JSON strict**, schéma versionné, avec un **indice de confiance par champ** :

- Prestataire, catégorie, pays, coordonnées
- Devise · montant HT · taux(s) de TVA · montant TTC · service charge
- Lignes de détail (libellé, quantité, prix unitaire, total) — la granularité du document, pas un total agrégé
- Échéancier : montants, dates, pourcentages (30/40/30 et variantes)
- Acompte : remboursable ou non, date limite
- Minimum spend (à porter en ligne de crédit négatif), buyout, crédits divers
- Conditions d'annulation, date de validité de l'offre
- Coordonnées bancaires si présentes → **stockées chiffrées, jamais affichées automatiquement**
- Tout montant ambigu ou illisible → champ `flagged` avec la citation exacte du document

### Ce qui doit être vrai

1. **Rien ne s'écrit automatiquement dans le budget publié.** L'extraction arrive dans un état `proposed`, présenté en vue équipe sous forme de **comparatif côte à côte** : ce que le document dit / ce qui est actuellement dans le hub. Estelle accepte ligne par ligne ou en bloc.
2. **Chaque montant est traçable.** Un clic sur une ligne de budget montre le document source et la page d'où le chiffre vient.
3. **Multi-devises réel.** Taux de change stocké avec sa date, jamais recalculé rétroactivement sur un montant déjà engagé.
4. **Aucune hallucination tolérée.** Si l'agent n'est pas sûr, il ne remplit pas : il signale. Un champ vide signalé vaut infiniment mieux qu'un chiffre inventé — le prompt système doit le dire explicitement.
5. **L'analyse alimente aussi le Scope Budget et l'échéancier de paiement**, pas seulement le Budget Management.
6. **Le flux Vendors → Budget fonctionne** : passage d'un prestataire en *Booked* → sa ligne apparaît dans le Budget en *awaiting quote* → dépôt du devis → analyse → sous-lignes et échéancier proposés.

### Ce que tu dois corriger

- Écris le system prompt de l'agent d'analyse comme celui d'un **directeur financier d'hôtellerie et d'événementiel** : il connaît les minimum spends, les service charges, les buyouts, les taux de TVA européens et leurs différences par poste, les usages de facturation des châteaux et traiteurs de luxe.
- Ajoute un jeu de tests avec de vrais formats de devis (traiteur, château, fleuriste, rental) et vérifie l'extraction avant de me présenter le module.

---

## 4. BUT — Le Scope Budget, limpide pour le client

> **LE BUT :** que le client ouvre le Scope Budget et comprenne en une lecture **trois choses distinctes** : ce que la maison lui recommande d'allouer, ce qui était prévu, et ce qui est aujourd'hui réellement engagé. Sans jargon, sans avoir à demander.

### Les trois niveaux — à distinguer visuellement, toujours

Pour chaque enveloppe (Venues & accommodation, Catering & wines, Floral & rental, Wedding communication, Production, Entertainment, Photography & film, Beauty, Transport, Contingency…) :

| Colonne | Ce que c'est | Voix |
|---|---|---|
| **Recommended by the house** | L'enveloppe conseillée par Madame Wedding Design, en % du budget global et en montant. C'est l'expertise de la maison. | Autorité — c'est le conseil. |
| **Forecast** | Le prévisionnel retenu avec le couple, après arbitrages. Peut différer du conseil. | Neutre — c'est la décision commune. |
| **Committed** | Ce qui est réellement engagé : devis signés, contrats, acomptes versés. Ne bouge que sur pièce. | Factuel — c'est le réel. |

- Un **écart visible** entre *Forecast* et *Committed*, exprimé en montant **et** en langage clair (*« €18,000 still to place »*, jamais « variance »).
- Un **écart visible** entre *Recommended* et *Forecast*, avec une note de la maison qui l'explique quand il est significatif — c'est là que la valeur d'Estelle se voit.
- **Une note de la maison par enveloppe**, en serif italique, signée « — Estelle », rédigée ou éditée par elle (ou composée par Madame sur ses indications). Brouillon jusqu'à publication.
- **Le moteur d'allocation reste tel que validé** : un budget global saisi pilote les enveloppes en pourcentage, enveloppes librement ajoutables et supprimables, plafond dur à 100 % qui bloque la publication avec message d'erreur, bouton *rebalance proportionally*, ligne *Unallocated* visible en dessous de 100 %.

### Ce qui doit être vrai

1. Le client ne voit **jamais** les trois colonnes comme un tableau comptable froid. Elles se lisent comme une page de maison : l'enveloppe, sa note, ses trois chiffres alignés proprement.
2. Sur mobile, les trois valeurs restent lisibles **sans scroll horizontal** — empilées, pas rognées.
3. Un **total en tête de page** : budget global · engagé · reste à placer. Trois chiffres, rien d'autre.
4. Le côté éducationnel est préservé : chaque enveloppe explique **ce qu'elle recouvre réellement** (le client UHNW ne sait pas ce qu'un poste « production » contient).
5. La ligne *Contingency / Risk buffer* est présentée comme une marque de sérieux, pas comme un coussin caché.

### Ce que tu dois corriger

- Le vocabulaire actuel doit être repris : *estimated / actual / variance* → *Recommended by the house / Forecast / Committed / still to place*.
- Vérifie qu'une enveloppe sans engagement encore ne s'affiche pas comme « 0 » sec — elle affiche *Not yet placed*.

---

## 5. BUT — Le Budget Management : la rigueur d'un tableur, la tenue d'une maison

> **LE BUT :** qu'Estelle travaille dans le Budget Management **aussi vite que dans Google Sheets**, et que le client, lui, ouvre le même budget et le trouve **beau, calme et parfaitement compréhensible**. Deux besoins opposés — donc **deux vues**, sur les mêmes données.

### 5.1 — Deux styles de vue, à présenter tous les deux

Un sélecteur discret en haut du module, mémorisé par utilisateur.

**VUE A — « The Ledger »** *(défaut en vue équipe)*
La rigueur d'un tableur, sans en avoir l'air.
- Tableau dense, une ligne par poste, colonnes : poste · prestataire · devise · HT · TVA · TTC · payé · reste · prochaine échéance · statut.
- **Édition en ligne** : clic sur une cellule, saisie, `Entrée`. Aucune modale.
- **Navigation clavier complète** : flèches entre cellules, `Tab`, `Entrée`, `Échap`, `Cmd/Ctrl+Z` (annuler / rétablir).
- **Copier-coller multi-cellules depuis Excel et Google Sheets** — c'est un vrai besoin, pas un confort.
- En-tête et première colonne **figées**. Tri et filtre par colonne. Sous-totaux par enveloppe, repliables.
- Autosave optimiste, indicateur discret, aucune perte de saisie.
- **Export XLSX et CSV** fidèles, avec les formules de totaux.

**VUE B — « The House Book »** *(défaut en vue client)*
La lecture d'un client, pas d'un comptable.
- Une **carte par enveloppe** : le nom, la note de la maison, un chiffre principal, une jauge fine payé / reste (jamais une barre de progression criarde), et les lignes en dessous, respirées.
- Typographie éditoriale : serif pour les titres et les notes, chiffres tabulaires alignés pour les montants.
- Chaque ligne se déplie sur le détail : sous-lignes, échéancier, document source.
- Beaucoup de blanc. Aucun quadrillage lourd. Filets champagne uniquement.
- Lecture parfaite au téléphone, en une colonne.

**Les deux vues lisent exactement les mêmes données.** Une modification en Vue A est visible en Vue B instantanément. Aucune duplication de logique métier.

### 5.2 — Contrôles communs aux deux vues

- **Bascule de devise** (devise du prestataire ↔ devise de référence du couple), avec le taux et sa date affichés discrètement.
- **Bascule HT / TTC**, mémorisée.
- **Filtre par statut** : engagé · en attente de devis · payé · à venir.
- **Densité** : confortable / compacte (vue équipe uniquement).

### Ce qui doit être vrai

1. Le client comprend **ce qu'il paie**, dans le détail : payé, reste à payer, par rapport à son budget. C'est le cœur du module.
2. **Les IBAN ne sont visibles que sur décision explicite d'Estelle, échéance par échéance.** Jamais de publication globale.
3. Les **notifications de paiement à venir** partent dans l'application et par email depuis la boîte d'Estelle ou de Jordane.
4. Toute la mécanique validée est conservée : crédits de buyout, minimum spends en lignes de crédit négatives, échéanciers 30/40/30, acomptes remboursables ou non, Risk Buffer par exposition × probabilité.
5. Le budget se travaille en ligne mais n'est **publié au client qu'après validation d'Estelle**, avec notification envoyée à ce moment-là.

### Ce que tu dois corriger

- Si le module actuel n'a qu'une seule vue, construis la seconde **avant** de peaufiner la première.
- Vérifie qu'aucun calcul de total n'est fait côté client uniquement — les totaux font autorité côté serveur.

---

## 6. BUT — Les documents, stockés et téléchargeables. Sans exception.

> **LE BUT :** que le client aille sur la page Documents, voie tout ce que la maison a mis entre ses mains, clique — **et que le fichier se télécharge**. Immédiatement. Sur ordinateur, sur iPhone, sur iPad. C'est le point le plus important de ce brief : un document qui ne se télécharge pas, c'est un appel téléphonique et une maison qui perd sa crédibilité.

### Ce qui doit être vrai

1. **Tous les documents publiés au client sont physiquement présents sur la page Documents.** Pas de document accessible uniquement depuis un autre module. Un document attaché ailleurs (Vendors, Budget) apparaît **aussi** dans Documents s'il est publié.
2. **Un clic = un téléchargement.** Pas d'ouverture d'un nouvel onglet blanc, pas de visionneuse qui bloque, pas de clic droit nécessaire.
3. **URL signées à durée limitée** générées côté serveur, avec `Content-Disposition: attachment` et le **nom de fichier propre et lisible** (`Château de X — Proposal — May 2027.pdf`, jamais un UUID).
4. **Vérification d'accès à chaque téléchargement**, côté serveur. Une URL de document ne doit jamais être devinable, et un document en brouillon doit renvoyer 404 pour un client — pas 403, qui révèle son existence.
5. **iOS et PWA testés explicitement.** C'est là que les téléchargements cassent le plus souvent. Si le téléchargement direct est impossible sur une plateforme, tu proposes un aperçu avec bouton *Save to Files* — mais tu me le signales.
6. **Aperçu avant téléchargement** pour les PDF et images : vignette + visionneuse légère, avec le bouton de téléchargement toujours visible.
7. **Organisation** : regroupement par catégorie (Contracts · Proposals · Invoices · Design · Practical), tri par date, recherche par nom. Chaque document affiche son type, sa taille, sa date de dépôt.
8. **Téléchargement groupé** d'une catégorie en `.zip`.
9. **Google Drive comme source** : la connexion Drive reste le stockage, mais le client **ne voit jamais Drive** et n'a jamais besoin d'un compte Google. Le hub sert le fichier lui-même.
10. **Rien ne casse si un fichier est déplacé côté Drive.** Un document introuvable affiche un message tenu et alerte l'équipe — jamais une erreur brute au client.

### Ce que tu dois corriger

- Écris un **test de bout en bout par type de fichier** (PDF, JPG, PNG, XLSX, DOCX) et par rôle, et montre-moi le résultat. Je veux voir la preuve que ça marche avant de valider ce module.

---

## 7. BUT — Que tout soit fluide

> **LE BUT :** qu'aucune attente, aucun à-coup, aucun rechargement ne vienne rappeler au client ou à l'équipe qu'ils sont dans un logiciel.

### Ce qui doit être vrai

- Navigation entre modules **sans rechargement de page**, transitions courtes (150–250 ms), ease-out expo, sans rebond.
- **Aucun saut de mise en page** au chargement (CLS ≈ 0). Skeletons aux dimensions exactes.
- Toute action affiche son résultat **immédiatement** (optimistic UI) et se réconcilie en arrière-plan. En cas d'échec, retour en arrière visible et message clair.
- Images servies en formats modernes, dimensionnées, `lazy` hors du premier écran. Les planches de design ne doivent pas ramer.
- Fonctionnement acceptable en **connexion faible** — le client sera en voyage.
- `prefers-reduced-motion` respecté partout.
- **Objectif mesurable :** Lighthouse ≥ 90 en performance et accessibilité sur les vues clientes, sur mobile. Tu me montres le rapport.

---

## 8. Ordre d'exécution

Tu procèdes dans cet ordre, un commit et une validation par étape. Tu me montres le résultat et tu attends mon go avant de passer à la suivante.

1. **Audit** — `/impeccable audit` sur l'existant + liste des écarts par rapport à ce brief. Tu ne codes rien avant de m'avoir montré cette liste.
2. **Documents** (§6) — c'est le plus critique et le plus vite constatable. Preuve par les tests.
3. **Analyse de documents** (§3) — sous-agent, modèle le plus capable, schéma d'extraction, comparatif de validation.
4. **Scope Budget** (§4) — les trois niveaux, les notes d'enveloppe, le vocabulaire.
5. **Budget Management** (§5) — les deux vues, l'édition type tableur, les contrôles communs.
6. **Team view** (§2) — raccourcis, publication groupée, Madame contextuelle, suppression des doubles saisies.
7. **Expérience client** (§1) — passage complet du wording, états vides, états d'erreur, mobile.
8. **Fluidité** (§7) — performance, transitions, Lighthouse.
9. **Durcissement** — `/impeccable harden`, tests des barrières d'accès pour les cinq rôles (vérifie qu'un client ne peut **jamais** atteindre un brouillon ou une donnée interne via l'API), déploiement Netlify.

---

## 9. Comment je juge ton travail

Trois questions, à te poser avant chaque validation :

1. **Est-ce qu'un client Ultra-High-Net-Worth (ultra-haut patrimoine, ~$30M+ net worth) trouverait ça digne de la maison ?**
2. **Est-ce que ça fait gagner du temps à Estelle et Jordane, ou est-ce que ça en coûte ?**
3. **Est-ce que ça se voit que c'est un logiciel ?** Si oui, ce n'est pas fini.

Pose tes questions quand un choix engage l'expérience. Tranche seul les détails techniques.

---

# ANNEXE — Écarts constatés dans le dépôt

*Audit du dépôt `MWDSTUDIO/mwdhubtemplate`. Ces constats remplacent l'étape 1 « Audit » de la section 8 : tu peux attaquer directement les corrections. Tu vérifies chaque point avant de le corriger — le dépôt a pu bouger depuis.*

## A. Ce qui est juste et ne doit pas être touché

- **Aucun `.env` versionné** — seul `.env.example` est suivi. Ne change rien à ce `.gitignore`.
- **Les barrières d'accès sont réelles et côté serveur.** `0002_rls.sql` active RLS sur l'ensemble des tables ; `documents` porte `couple read shared … using (app.couple_of(wedding_id) and not internal)` ; `access_codes` n'a aucune policy, donc refuse tout ; les quatre buckets (`shared`, `internal`, `vault`, `entrance`) sont privés avec des policies par rôle ; `supabase/tests/access_barriers.sql` existe. **Ne remplace jamais cette mécanique par un filtrage d'affichage.** Toute nouvelle route que tu ajoutes doit s'y conformer.
- Les PDF sont déjà envoyés **nativement** à l'API (`type: "document"`, base64) dans `src/lib/agents/run.ts`. C'est correct — conserve.
- L'i18n est câblée jusqu'au routage (`/fr` redirige vers `/login?next=/fr`), cinq fichiers dans `messages/`.

## B. §6 Documents — corrections

Fichier : `src/app/[locale]/(hub)/documents/page.tsx`

| # | Constat | Correctif attendu |
|---|---|---|
| B1 | `<a href={href} target="_blank">` — ouvre un onglet, ne télécharge pas | Route proxy `GET /api/documents/[id]/download` : contrôle d'accès serveur, puis `Content-Disposition: attachment` avec nom propre (`filename*=UTF-8''…`). Le lien de la liste pointe dessus. |
| B2 | `createSignedUrl(path, 3600)` sans option `download` → Supabase sert `inline` | À défaut de la route proxy : `createSignedUrl(path, 3600, { download: "Label propre.pdf" })`. La route proxy reste préférable (elle contrôle l'accès à chaque appel). |
| B3 | Nom de fichier en base : `${Date.now()}-${file.name}` | Clé de stockage assainie (ASCII, sans espace) **et** libellé d'affichage conservé séparément pour le nom de téléchargement. |
| B4 | Bouton *Open in Google Drive* et lead *« Connected to your dedicated Google Drive folder »* visibles **par le client** | Réserver Drive à `session.isTeam`. Réécrire le lead dans la voix de la maison, sans mention de Drive. |
| B5 | Aucun état vide | *« Nothing has been placed here yet. The house will let you know. »* |
| B6 | Ni catégorie, ni date, ni taille, ni recherche, ni aperçu, ni zip | Catégories (Contracts · Proposals · Invoices · Design · Practical), date de dépôt, taille, recherche par nom, aperçu PDF/image, téléchargement groupé `.zip` par catégorie. |
| B7 | Les documents lus par Madame vont tous en bucket `internal` + `internal: true` — ils n'atteignent jamais la page Documents du client | Chemin de publication explicite : depuis Vendors ou depuis Madame, *Publish to the couple* → copie/déplacement en bucket `shared`, `internal: false`, apparition dans Documents. Faire remonter `vendor_documents.client_visible`, aujourd'hui sans effet. |
| B8 | Un document en brouillon doit renvoyer **404**, pas 403 | À implémenter dans la route de téléchargement. |
| B9 | iOS / PWA non testés | Test explicite, et repli *Save to Files* si le téléchargement direct est impossible. Me le signaler. |

## C. §3 Analyse de documents — corrections

Fichiers : `src/lib/agents/run.ts` · `src/app/api/agents/document/route.ts`

| # | Constat | Correctif attendu |
|---|---|---|
| C1 | `run.ts:143` — `process.env.ANTHROPIC_MODEL \|\| "claude-sonnet-4-5"` pour **les quatorze agents**, analyse comprise | Deux constantes distinctes : `HOUSE_MODEL` (agents de rédaction) et **`ANALYSIS_MODEL`** (lecture de documents), cette dernière sur le **modèle le plus capable disponible** (tier Opus). `runAgentFull` accepte un modèle par appel. |
| C2 | `max_tokens: 4000` sur la passe complète, et consigne *« past 40 lines, fold the smallest into grouped lines »* | **Supprimer le plafond de 40 lignes.** Un devis se lit en entier. Élargir `max_tokens` largement, et si un document résiste, découper **par page** en conservant l'en-tête puis recomposer — jamais abandonner les lignes. |
| C3 | Le repli `slimPrompt` renvoie `"items": []` — les lignes de détail sont perdues sans que personne ne le sache | Le repli doit **signaler explicitement** la perte à Estelle, pas la taire. |
| C4 | Ni indice de confiance, ni champ de signalement dans le schéma ; le prompt ne dit nulle part de ne pas remplir en cas de doute | Ajouter `confidence` par champ et un tableau `flagged: [{field, reason, quote}]`. Ajouter au system prompt, en toutes lettres : *un champ vide signalé vaut infiniment mieux qu'un chiffre inventé.* |
| C5 | Schéma incomplet : pas de TVA globale, service charge, minimum spend, buyout, conditions d'annulation, date de validité, coordonnées bancaires | Compléter selon §3 du brief. Minimum spend en ligne de crédit négative. Coordonnées bancaires chiffrées, jamais affichées automatiquement. |
| C6 | L'extraction **écrit directement en base** : `delete` des `budget_line_items` puis réinsertion, écrasement de `committed` | État `proposed` intermédiaire + **comparatif côte à côte** en Team view (ce que le document dit / ce qui est dans le hub), acceptation ligne par ligne ou en bloc. Le `status: "draft"` protège le client, pas la saisie d'Estelle. |
| C7 | Aucune traçabilité montant → source | Chaque ligne issue d'une lecture garde l'identifiant du document et la page. Un clic ouvre le document à l'endroit du chiffre. |
| C8 | Sous-agent Claude Code absent | Créer `.claude/agents/document-analyst.md`, modèle le plus capable, system prompt de directeur financier hôtellerie & événementiel. |
| C9 | Aucun jeu de tests d'extraction | Jeu de devis réels (traiteur, château, fleuriste, rental) + résultats montrés avant validation du module. |

## D. §4 Scope Budget — corrections

Fichier : `src/app/[locale]/(hub)/budget/scope-client.tsx`

| # | Constat | Correctif attendu |
|---|---|---|
| D1 | **Deux niveaux seulement** : `allocated` (% du budget global) et `committed`. Le conseil de la maison n'existe pas. | Ajouter le troisième niveau **`recommended`** — l'enveloppe conseillée par MWD, en % et en montant, stockée en base, éditable en Team view. C'est la colonne qui porte la valeur de la maison : elle ne peut pas manquer. |
| D2 | `allocated` sert à la fois de conseil et de prévisionnel | Les séparer nettement : `recommended` (le conseil) ≠ `forecast` (l'arbitrage retenu avec le couple). Migration à écrire. |
| D3 | Vocabulaire `variance` / `colVariance` / `varianceOver` jusque dans `messages/*.json` | *Recommended by the house · Forecast · Committed · still to place*. Réécrire les cinq fichiers de langue. |
| D4 | Un écart Recommended ↔ Forecast n'est pas commenté | Note de la maison déclenchée quand l'écart est significatif — c'est là que l'expertise se voit. |
| D5 | Une enveloppe sans engagement affiche `0` | *Not yet placed*. |

## E. §5 Budget Management — corrections

Fichier : `src/app/[locale]/(hub)/budget/mgmt-client.tsx` (794 lignes) · `page.tsx`

| # | Constat | Correctif attendu |
|---|---|---|
| E1 | `BudgetTabs` gère deux **onglets** (Scope / Management), pas deux **styles de vue** | Construire le sélecteur de vue **The Ledger** / **The House Book** selon §5.1, mémorisé par utilisateur, sur les mêmes données. |
| E2 | `MasterTable` n'a que des `<input onChange>` : aucun `onKeyDown`, aucun `onPaste`, aucune annulation, aucun en-tête figé, aucun tri ni filtre, aucun export | Implémenter toute la mécanique tableur de §5.1 — navigation aux flèches, `Tab`/`Entrée`/`Échap`, `Cmd/Ctrl+Z`, collage multi-cellules depuis Excel et Sheets, en-tête et première colonne figées, tri, filtre, sous-totaux repliables, export XLSX et CSV. |
| E3 | Pas de bascule devise ni HT/TTC exposée | Contrôles communs de §5.2. |
| E4 | Totaux calculés côté client | Les totaux qui font autorité se calculent côté serveur. |

## F. Ordre révisé

L'étape 1 (audit) est faite. Tu enchaînes : **B → C → D → E**, puis §2 Team view, §1 expérience client, §7 fluidité, et le durcissement. Un commit et une validation par bloc de lettres.

## G. Échéancier de paiement — plusieurs échéances, lues et saisies

> **LE BUT :** qu'un devis portant trois échéances produise **trois échéances** dans le hub, pas un montant global ; et qu'Estelle puisse en ajouter, en corriger ou en supprimer à la main, à tout moment, sans passer par l'agent.

Fichiers : `src/app/[locale]/(hub)/budget/mgmt-client.tsx` (`PaymentsCalendar`, `AddPaymentRow`) · `src/app/actions/budget.ts` · `src/app/api/agents/document/route.ts`

**Ce qui existe déjà et fonctionne** — l'agent extrait bien un tableau `schedule` complet et insère **toutes** les échéances dans `payments` ; `addPayment`, `markPaid`, `updatePaymentFlags` et `deletePayment` existent ; le regroupement par mois et la conversion en euros sont en place. Ne casse pas cette base.

| # | Constat | Correctif attendu |
|---|---|---|
| G1 | **Aucune action de modification** : on peut ajouter, marquer payé, changer les drapeaux, supprimer — mais pas corriger un montant, une date ou un libellé. Il faut supprimer et refaire. | Ajouter `updatePayment(paymentId, { label, amount, currency, amountEur, dueDate, method, payer })`, avec les mêmes contrôles d'accès que les actions voisines. |
| G2 | `AddPaymentRow` se ferme après chaque ajout (`onDone()`) : saisir un 30/40/30 impose trois passages complets dans une ligne de huit champs | Le formulaire **reste ouvert** après un ajout, champs vidés, focus au premier champ. On enchaîne les échéances. |
| G3 | Aucune saisie d'un échéancier complet en une fois | **Éditeur d'échéancier par ligne de budget** : ajouter *n* échéances d'un coup, chacune avec son libellé, son montant, sa date. Des gabarits (30/40/30 · 50/50) existent en simple raccourci, **jamais en modèle imposé** — voir G9. |
| G4 | Rien ne vérifie que la somme des échéances correspond au montant engagé de la ligne | Contrôle permanent : somme des échéances vs `committed`. L'écart s'affiche en clair (*« €4,200 not yet scheduled »*), sans bloquer — Estelle décide. |
| G5 | Une échéance ne peut s'attacher qu'à une ligne parente (`lines.filter(l => !l.parent_line_id)`) | Autoriser l'attachement à une sous-ligne quand le devis paie un poste précis. |
| G6 | Pas d'édition en ligne dans le tableau des échéances | En vue **The Ledger** (§5.1), chaque échéance s'édite dans la cellule, au clavier, comme le reste. |
| G7 | Après lecture d'un devis, les échéances arrivent en base sans passage de revue | Elles arrivent en `proposed` (voir C6) : Estelle voit ce que le document propose, accepte, corrige les dates, en ajoute. **L'agent propose l'échéancier, il ne le décrète pas.** |
| G8 | Le prompt d'extraction ne demande ni le pourcentage ni la condition de déclenchement | Ajouter au schéma : `percentage`, et `trigger` (à la signature, à J-90, à la livraison…) — beaucoup de devis datent leurs échéances par événement, pas par date fixe. |

### G9 — Le principe qui commande toute la section

**L'échéancier n'appartient pas à la maison : il appartient au prestataire.** Chaque château, chaque traiteur, chaque fleuriste fixe son calendrier comme il l'entend — deux échéances ou six, des dates fermes ou des conditions, des pourcentages ronds ou non. Estelle ne le décide pas et ne peut pas le normaliser.

Il en découle trois règles absolues pour l'agent de lecture :

1. **Reprendre les dates telles qu'elles figurent au document.** Aucune normalisation, aucun arrondi, aucun gabarit appliqué par-dessus. Si le devis porte cinq échéances irrégulières, il en ressort cinq échéances irrégulières.
2. **Ne jamais calculer une date qui n'est pas écrite.** Quand l'échéance est exprimée par une condition (*à la signature*, *60 jours avant l'événement*, *au solde du minimum spend*), l'agent conserve la condition **mot pour mot** dans `trigger` et **laisse `due_date` vide**. Une date inventée est pire qu'une date absente : elle déclenchera une notification de paiement fausse au client.
3. **Ne jamais compléter un échéancier partiel.** Si le document ne dit rien du solde, l'agent s'arrête et le signale — il ne déduit pas la dernière échéance par soustraction.

Et la contrepartie, côté Estelle : **contrôle manuel total, à tout moment.** Ajouter une échéance, en retirer une, corriger un montant, poser ou effacer une date, réordonner — sans passer par l'agent, sans relire le document, sans supprimer et recréer. Les gabarits de G3 ne sont qu'un raccourci de saisie pour les cas simples ; ils ne s'appliquent jamais automatiquement à une lecture de document.

## H. Calendrier de disponibilités — le client propose, rien de plus

> **LE BUT :** que le client propose des créneaux, et **uniquement cela**. Il n'a aucun accès au calendrier d'Estelle, aucun compte Google, aucune connexion à Google Meet. Le croisement avec l'agenda de la maison se fait **de son côté à elle**, au moment où elle examine la proposition.

Fichiers : `src/app/api/schedule/busy/route.ts` · `src/components/ProposeMoment.tsx` · `src/app/actions/schedule.ts`

| # | Constat | Correctif attendu |
|---|---|---|
| H1 | **`/api/schedule/busy` est ouverte à toute session** (`gate(false)`) : un client connecté peut interroger l'agenda Google d'Estelle jour après jour et reconstituer ses disponibilités. C'est une fuite de son emploi du temps personnel. | Passer la route en **`gate(true)`** — équipe uniquement. |
| H2 | `ProposeMoment.tsx` appelle cette route à chaque date choisie et grise les créneaux occupés d'Estelle. Le commentaire du fichier l'assume : *« crossed with Estelle's Google Calendar: only her open slots remain selectable »* | **Retirer entièrement cet appel du composant client.** Le client voit un calendrier net : il choisit ses jours, ses créneaux de 30 minutes, sa durée, et envoie. Aucune information sur l'agenda de la maison. |
| H3 | Le croisement disparaît alors du produit | Le déplacer **en Team view** : quand Estelle ouvre la proposition, ses créneaux occupés sont croisés à ce moment-là et elle voit immédiatement lesquels des créneaux proposés sont libres. C'est là que l'information est utile — et elle reste chez elle. |
| H4 | Wording | Côté client, rien ne doit évoquer une disponibilité de la maison. *« Propose a few moments — the house will confirm one. »* |
| H5 | `confirmMoment` — correct : réservé à l'équipe, crée le Meet, invite le couple et `HOUSE_INBOX`, jamais une boîte personnelle | **Ne rien changer à la mécanique.** À confirmer avec Estelle : le couple reçoit aujourd'hui l'invitation calendrier automatiquement après confirmation. Si elle préfère l'envoyer elle-même, le rendre optionnel. |
| H6 | Aucun compte Google requis côté client — à préserver | Le lien Meet arrive par l'invitation et par la notification du hub. Le client n'a jamais à se connecter à quoi que ce soit de Google pour être reçu. |

*Les blocs G et H s'exécutent avec E (Budget Management) pour G, et avant §1 (expérience client) pour H — H1 est un correctif de confidentialité, à traiter tôt.*

## I. Mobile — les bords sont cassés sur iPhone

> **LE BUT :** que The Inner House sur un iPhone récent ne donne jamais l'impression d'un site rogné. Le client lira l'essentiel sur son téléphone : c'est là que la maison se juge, pas sur un écran 27 pouces.

Fichiers : `src/app/[locale]/layout.tsx` · `src/app/globals.css`

### Le diagnostic

Trois causes, qui se cumulent exactement sur un iPhone 16 Pro Max :

**I1 — Aucune marge de sécurité iOS, nulle part.** La recherche de `env(safe-area-inset-*)` dans tout le dépôt ne renvoie **rien**. Le contenu vient donc buter contre les bords physiques de l'écran, passe sous l'îlot dynamique en haut et sous la barre d'accueil en bas.

**I2 — Et le manifeste demande précisément à passer sous la barre d'état.** L'application déclare `apple-mobile-web-app-capable: yes` avec `apple-mobile-web-app-status-bar-style: black-translucent`. En mode installé, le contenu s'étend **volontairement** derrière la barre d'état — ce qui est le bon choix esthétique, mais qui exige un rembourrage `env(safe-area-inset-top)` que personne n'a écrit. D'où le haut de page mangé.

**I3 — `viewportFit: "cover"` est absent** de l'export `viewport` dans `layout.tsx`, qui ne porte que `themeColor`, `width` et `initialScale`. Sans lui, les variables `env()` ne sont même pas alimentées par iOS : le correctif I1 ne pourrait pas fonctionner tant que celui-ci n'est pas posé.

**I4 — Un seul point de rupture, à 900px.** Un iPhone 16 Pro Max fait 430px de large en CSS. La même mise en page sert donc de 430px à 900px : `section.sheet` passe de `52px 48px` à `36px 22px`, et c'est tout. La barre de navigation devient un `flex-wrap` d'onglets empilés, la frise garde ses `min-width: 132px` en défilement horizontal, et les tableaux (`table.sheet-table` dans des conteneurs `overflow-x: auto`) obligent à pousser le budget latéralement au doigt.

### Les correctifs

1. **Ajouter `viewportFit: "cover"`** à l'export `viewport`. C'est le préalable à tout le reste.
2. **Poser les marges de sécurité sur la coque**, pas sur chaque composant :
   `padding-left: max(22px, env(safe-area-inset-left))` et son symétrique à droite ; `env(safe-area-inset-top)` sur la barre supérieure ; `env(safe-area-inset-bottom)` ajouté au `padding-bottom: 90px` de `main.hub`. Tout élément en `position: fixed` (barre de navigation, panneau de Madame, portes d'entrée) doit les respecter aussi.
3. **Ajouter un vrai point de rupture téléphone à 480px**, distinct du 900px tablette. À cette largeur : navigation repensée (barre basse ou tiroir, pas un empilement d'onglets), titres redimensionnés, frise en défilement assumé avec indicateur.
4. **Supprimer le défilement horizontal sur les tableaux en dessous de 480px.** Le budget et l'échéancier passent en **cartes empilées** : un poste par carte, les montants alignés, le détail dépliable. Un client ne pousse pas un tableau du doigt pour lire ce qu'il paie.
5. **Vérifier l'entrée aux portes en mode installé** — c'est l'écran le plus exposé au problème, et le premier que le client voit.

### Le test à faire, et à me montrer

Safari **et** application installée, portrait **et** paysage, sur trois gabarits : **430 × 932** (iPhone 16 Pro Max), **393 × 852** (iPhone 16), **375 × 667** (petit écran, cas limite). Sur chaque page cliente. Capture à l'appui.
