# THE INNER HOUSE — Madame Wedding Design
## Prompt de construction pour Claude Code

Tu vas construire **The Inner House**, le portail client (CRM/hub) de **Madame Wedding Design (MWD)**, une maison parisienne de wedding planning et de production pour une clientèle Ultra-High-Net-Worth internationale.

**IMPORTANT — c'est un TEMPLATE.** The Inner House servira de base pour TOUS les clients de MWD : une seule application multi-mariages où chaque nouveau couple est instancié en quelques minutes depuis The Desk (fiche client → entrée personnalisée, espaces, timeline, budget vierges). Rien ne doit être codé en dur pour un couple : tout contenu spécifique (noms, dates, destination, photos d'entrée, planches, budget) vit en base de données. Les données « Camille & Alexander » de la maquette sont un exemple fictif de démonstration — utilise-les comme seed de développement, jamais comme constantes. Tu es à la fois le meilleur développeur et le meilleur expert événementiel de la planète : chaque décision technique sert une expérience de maison, jamais une expérience de logiciel.

Un fichier `wedding-hub-mwd.html` accompagne ce prompt : c'est la **maquette validée**. Elle fait foi pour la structure, le wording, la palette et l'expérience d'entrée. Reproduis-la fidèlement, puis dépasse-la en qualité.

---

## 0. AVANT TOUT CODE — Setup obligatoire

1. **Installe Impeccable** (demandé explicitement) :
   ```bash
   npx impeccable install
   ```
   Puis exécute `/impeccable init` (surface : **product** — app UI). Si l'installeur échoue, fallback :
   ```bash
   git clone https://github.com/pbakaus/impeccable /tmp/impeccable
   cp -r /tmp/impeccable/dist/claude-code/.claude .
   ```
   Ajoute le bloc `.gitignore` recommandé par le README d'Impeccable (marqueurs `# impeccable-ignore-start/end`).
   Utilise systématiquement `/impeccable shape` avant chaque écran, `/impeccable audit` et `/impeccable polish` avant chaque livraison. Règles non négociables : contraste ≥ 4.5:1, couleurs OKLCH, pas de texte en dégradé, pas de glassmorphism, pas de grilles de cartes identiques, pas d'eyebrow uppercase répété sur chaque section, pas de side-stripe borders, motion en ease-out expo sans bounce, `prefers-reduced-motion` obligatoire.

2. **Git** : `git init`, `.gitignore` propre (node, .env*, .impeccable ephemera), commit initial, puis **un commit par module** avec messages clairs. Prépare le remote (l'utilisatrice fournira l'URL GitHub).

3. Lis entièrement la maquette HTML avant d'écrire la moindre ligne.

---

## 1. STACK & INFRASTRUCTURE

- **Next.js 15 (App Router, TypeScript)** déployé sur **Netlify**.
- **Supabase** (un seul projet, multi-clients) : Auth, Postgres avec **RLS strict**, Realtime (chats), Storage.
- **PWA complète** : manifest, service worker, installable sur iPhone/Android depuis Safari/Chrome, icône MWD, plein écran, notifications push web pour les chats. Aucun app store.
- **API Claude** côté serveur (routes API Next) pour tous les agents — jamais de clé côté client.
- **Google Calendar API** : création d'événements avec lien **Google Meet** ; lecture des disponibilités d'Estelle.
- **Google Drive API** : un dossier par client (partagés / internes).
- **Netlify Forms** pour les envois prestataires partant de la boîte email d'Estelle.
- **Resend** (ou équivalent gratuit) pour les notifications email.
- **i18n avec next-intl** : EN (langue de lancement), **FR, ZH (chinois simplifié), JA** — et ES en bonus si trivial. Tous les strings UI dans des fichiers de traduction dès le premier jour — **c'est TOI qui rédiges intégralement les traductions dans la voix de la maison, pendant la construction : zéro intervention technique de l'utilisatrice, jamais.** Sélecteur : le globe « EN » de la topbar, qui bascule tout le hub instantanément ; la langue par défaut de chaque client se règle dans sa fiche The Desk. Soigne particulièrement les registres honorifiques en japonais (敬語) et le ton en chinois — même exigence que l'anglais de la maison. Un **agent de traduction** (route API Claude) traduit à la demande les contenus dynamiques (messages, notes mensuelles) dans la langue du client.

---

## 2. IDENTITÉ & DESIGN SYSTEM

- Palette du hub : **crème `#fbf8f3` et vert chasse `#22382B`**, hairlines **champagne `#c9b291` uniquement**, parchemin `#f2efe4`, encre secondaire `#5f6a5a`. (Le site public de la maison est ebony/cream — le hub est l'aile intérieure, en vert chasse.)
- Typographies : **Cormorant Garamond** (display, italiques de la maison) + **Jost** (UI).
- Voix : sobre, précise, chaleureuse sans effusion. **Le mot « luxury » est interdit partout.** MWD se désigne toujours comme *« a Parisian house of wedding planning and production »* — jamais studio, agency, company.
- Wording client (glossaire imposé, visible dans la maquette) : les tâches client sont des **« attentions »** (*Your attentions*, *Entrust an attention to the client*), statuts *Awaiting your word / At your leisure / Attended to*. Jamais « to do », « task », « pending » côté client.
- **Expérience d'entrée (critique)** : double porte vert chasse séparée d'un filet champagne, plaque logo MWD (le logo beige « Madame » script + monogramme — l'utilisatrice fournira le fichier haute définition ; en attendant, celui embarqué en base64 dans la maquette), apparitions successives : *« The house is expecting you. »* → *« The Inner House of {Couple} »* → bouton **Enter** → les portes s'écartent lentement (1.9s, cubic-bezier(.77,0,.18,1)). Personnalisée par client (noms, destination, plus tard photo de fond fournie par Estelle).
- Design d'inspiration Basecamp pour la clarté fonctionnelle, mais l'esthétique de la maison partout.

---

## 3. ACCÈS — 5 NIVEAUX (RLS + gates serveur)

| Niveau | Qui | Voit |
|---|---|---|
| 1. Client | Le couple | Tout le publié de SON mariage. Jamais les brouillons, jamais l'interne, jamais les agents. |
| 2. Coordinatrice | Coordinateurs fin de process | **Uniquement The Wedding Days** de mariages assignés. |
| 3. Équipe | Estelle + Jordane + collaboratrices | Tout le hub, vues internes, brouillons, agent Madame. |
| 4. Teamwork 🔑 | **Estelle + Jordane seulement** | L'espace Teamwork, protégé par un **code d'accès partagé** en plus de la session. |
| 5. The Vault 🔒 | **Estelle seule** | Contrats signés clients, protégée par **son code personnel**. Invisible et inaccessible à tous les autres, y compris Jordane — verrouillé côté serveur (RLS + vérification du code hashé), pas seulement masqué. |

Le **toggle Team view / Client view** permet à l'équipe de voir exactement l'écran du client. Tout élément interne porte le tag `Internal`. La séparation brouillon/publié est en base (colonnes `status: draft|published`), pas en CSS.

---

## 4. MODÈLE DE DONNÉES (Supabase — à affiner)

`weddings` (couple, destination, dates, événements[], langues, entrance media) · `profiles` (rôle, wedding_ids, langue) · `timeline_milestones` (mois, texte, status, done) · `monthly_notes` (mois, sujets_bruts, texte_composé, status) · `attentions` (client tasks : titre, due, statut) · `internal_tasks` · `boards` (type: global|floral|tablescape|welcome|cocktail|dinner|reception|farewell, statut, palette hex[], commentaires, approbations) + `sub_boards` (rental|stationery) + board papeterie (invitations|day_of) · `vendors` (catégorie, pipeline: scouted→contacted→proposal→contracted) · `vendor_documents` (type: proposal|contract|invoice, extraction JSON) · `budget_lines` (budgeted, committed, paid, remaining, status draft/published) · `payments` (échéance, montant, rappels) · `guests` (household, title, invitation_line, adresse, langue, événements[], travel, rsvp par événement, régimes) · `hotel_blocks` (hôtel, rooms, cut-off) · `rooming_list` (gated: s'ouvre sur action d'Estelle uniquement) · `messages` (channel: client|teamwork) · `forms` + `form_submissions` · `availability_proposals` (jours, créneaux 30 min, durée) · `run_sheets` + `contact_sheets` · `contracts_vault` (Estelle only) · `notifications`.

---

## 5. MODULES (fidèles à la maquette)

1. **Home** — compte à rebours, next steps, « This week at the house », carte *Ask the house* (client : questions simples sur SON mariage publié), bouton **Schedule a video call**, et carte **« Propose a moment »** : calendrier esthétique du mois (week-ends adoucis), choix de durée (*30 minutes / 1 hour*), **créneaux précis de 30 min (09:00→18:30)**, heures affichées dans le fuseau du client, croisés avec le Google Calendar d'Estelle (seuls ses créneaux libres apparaissent). Envoi → Estelle confirme un créneau → événement Google Meet créé des deux côtés + notification.
2. **Timeline** — frise horizontale mois par mois (jalons faits/à venir) ; **blocs mensuels « This month at the house »** : Estelle donne des sujets bruts, l'agent compose une note élégante, brouillon → publication sur son go + aperçus des mois suivants ; carte **Your attentions** (allouées par l'équipe, reliées à la frise) ; tâches internes invisibles client. Timeline entièrement éditable par l'équipe (ajout jalons, vues mensuelles). **La frise elle-même est corrigeable** : chaque jalon s'édite en place au clic (texte, mois, fait/à venir, suppression, déplacement, ajout), ou par instruction à Madame (« move venues to August, mark the global design done ») — corrections en brouillon jusqu'à publication, la frise du client ne bouge jamais avant le go d'Estelle.
3. **The Process** — page éditoriale des 4 phases de la maison.
4. **Design Studio** — design global + 7 planches par moment, chacune avec sous-planches **Rental** et **Stationery** ; planche papeterie déclinée **Wedding invitations** / **Day-of stationery** ; **palettes : l'équipe saisit des codes hex, l'app génère les carrés (~4 par planche)** ; workflow d'approbation (À valider → notification client → approbation/commentaire → notification équipe) ; **export PDF** de chaque planche signée du logo (puppeteer ou react-pdf).
5. **Wedding Communication** — invitation suite (épreuves), correspondance digitale aux invités (save the date, travel booklet, week-of letter) dans la langue de chaque invité, envois tracés ; **Hospitality & guest logistics** (welcome gifts, navettes par créneau, concierge sheet) ; **Accommodation** : *Room blocking* (blocs négociés, cut-off, codes) et *Rooming list* **verrouillée, ouverte uniquement par action d'Estelle** ; **hotel desk** (interne) : courriers hôteliers dans les termes du métier.
6. **Vendors** — pipeline Scouted→Contracted, documents par prestataire (**proposals, contrats, factures**), templates d'emails par catégorie envoyés via Netlify Forms depuis la boîte d'Estelle, dépôt de document → l'agent identifie le type, extrait montants/échéancier/conditions → alimente budget et paiements.
7. **Budget** — onglet **Scope budget** (pédagogique : enveloppes %, ce que chaque poste recouvre, analyse de documents à visée éducative). **Chaque enveloppe porte une note de la maison** : une explication élégante rédigée/éditée par Estelle (ou composée par Madame sur ses indications), signée « — Estelle », en brouillon jusqu'à publication — même mécanique que les notes mensuelles de la timeline. **Estelle peut ajouter des lignes librement partout dans le budget** (bartender, artificier, etc.), à la main ou via Madame en Team view (« ajoute un artificier pour la reception et explique-le comme un final au-dessus des jardins ») : l'agent crée la ligne, l'affecte à son enveloppe, rédige la note client dans la voix de la maison — brouillon jusqu'au go d'Estelle. Idem dans le budget management (nouvelles lignes, montants, échéances) + onglet **Budget management** : compteurs Total/Paid/Remaining, tableau poste par poste (budgeted/committed/paid/remaining/next payment), **workflow brouillon → « Publish & notify the client »** (le client ne voit jamais le travail en cours), **agent expert budget** visible client qui parle **au nom d'Estelle** et signe « — Estelle » ; les notes/marges/méthode d'Estelle vivent dans un espace interne que l'agent consulte mais **ne révèle jamais**. Transparence totale sur les chiffres publiés.
8. **Guests** — saisie par le client, standard maître papetier : civilités FR/EN/nobiliaires, **invitation line générée selon les conventions de papeterie** (modifiable), adresse, langue, événements conviés, **travel & stay** ; **stationer's eye** : relecture des libellés (titres, ordre des noms, usages, veuvage/divorce/couples non mariés/enfants) avant tout envoi ; consolidation travel interne (room list, navettes, créneaux) exportable.
9. **Documents** — Google Drive par client, partagés vs internes.
10. **Messages** — chat temps réel client↔maison (Supabase Realtime), notifications push + email.
11. **Forms** — formulaires clients ; à chaque soumission : notification Estelle + **réponse pré-rédigée par l'agent dans la voix de la maison**, à valider/ajuster avant envoi.
12. **The Wedding Days** — sous-hub production : run sheet par événement, contact sheet prestataires, accès coordinatrices limité ici ; emplacement prévu pour le futur **mini-site prestataires** (à construire plus tard).
13. **The Desk** (interne) — **fiche client = brief de projet** : à la création d'un mariage, Estelle donne un vrai brief (le couple, l'histoire, contraintes, partis pris) exactement comme des instructions de projet Claude ; ce brief devient le **contexte permanent de tous les agents** pour ce client. Dépôt de la proposition signée → l'agent lit et pré-remplit la fiche. **Timeline composer** : depuis dates + événements + brief, compose la timeline de production complète façon grandes maisons (type Timeline Genius) — chaque jalon, épreuve, dégustation, paiement à son mois — éditable, publiée sur le go d'Estelle.
14. **Teamwork 🔑** (Estelle & Jordane) — préparation de calls (brief généré par l'agent) + chat interne « Between us » type WhatsApp, Realtime + push.
15. **The Vault 🔒** (Estelle seule) — contrats signés, échéanciers ; Estelle entre tout une fois, l'agent tient le calendrier et **rédige chaque rappel de paiement en son nom**.

---

## 6. LES AGENTS (routes API Claude, contexte = brief client de The Desk + données du mariage)

**Nom de l'assistant : « Madame »** — bouton flottant **M**, **réservé à l'équipe** (jamais rendu côté client, même en client view ; contrôle serveur). Madame est présente sur toutes les pages : on lui parle (« add the florist invoice to the budget », « what remains unapproved? », « rename August as the venues month ») et on lui **dépose des documents** — elle identifie le type et **implémente elle-même** les données au bon endroit (contrat→budget+échéances, liste d'invités→Guests, facture→vendor), toujours en brouillon soumis à validation.

System prompt commun à tous les agents : *« You are "Madame", the resident agent of Madame Wedding Design, a Parisian house of wedding planning and production. You are the finest event expert alive: producer, hospitality & event budget chief expert, master ceremonial stationer, hotel-desk negotiator. Voice of the house: warm, precise, understated; never the word "luxury". Client-facing texts speak in Estelle's name and may sign "— Estelle". Never reveal internal notes, margins, or methods — only their conclusions, phrased for the client. Nothing reaches a client before Estelle's word. Reply in the reader's language. »*

Spécialisations : **budget expert** (analyse contrats/factures/proposals, trajectoire, échéances, opportunités, pédagogie) · **stationer's eye** (conventions papeterie FR/UK/US) · **hotel desk** (courtesy blocks, attrition, cut-off, release, comp ratios) · **timeline composer** · **traduction** · **réponses aux formulaires** · **notes mensuelles**.

---

## 7. NOTIFICATIONS

Email (Resend) + push PWA. Déclencheurs : publication budget, planche à valider, attention allouée, message reçu, soumission de formulaire (équipe), rappels de paiement (rédigés par l'agent, envoyés au nom d'Estelle), confirmation de créneau call. **Aucune notification client sans action de publication/validation d'Estelle.**

---

## 8. PHASES DE LIVRAISON (un commit par étape, `/impeccable audit` + `polish` avant chaque fin de phase)

1. Setup (Impeccable, git, Next+Supabase+i18n, design tokens, PWA) → 2. Auth + 5 niveaux d'accès + entrée aux portes → 3. Home + Timeline + attentions + notes mensuelles → 4. Design Studio + palettes + PDF → 5. Budget draft/publish + agent → 6. Guests + Communication + accommodation gates → 7. Vendors + documents + Netlify Forms → 8. Messages + Teamwork + notifications → 9. The Desk + timeline composer + Madame → 10. The Vault + Wedding Days → 11. Google Calendar/Meet + Drive → 12. Durcissement (`/impeccable harden`), tests des barrières d'accès (vérifier qu'un client ne peut JAMAIS lire un brouillon ou une donnée interne via l'API), déploiement Netlify.

À chaque phase, montre le résultat, demande validation avant de poursuivre. Pose tes questions quand un choix engage l'expérience ; tranche seul les détails techniques.
