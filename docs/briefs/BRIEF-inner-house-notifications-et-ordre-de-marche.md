# The Inner House — Notifications programmables & ordre de marche
**Dernier brief de la série. Il révise les notifications et donne la marche à suivre pour l'ensemble du chantier.**
**À lire avant de toucher au code.**

---

# PARTIE I — Les notifications de paiement, révisées

Cette partie **remplace** les sections 2 et 3 du brief `BRIEF-inner-house-notifications-et-vitesse.md`. Le reste de ce brief reste valable.

## 1. Des rappels programmables, en nombre libre

Le calendrier fixe à trois moments était trop rigide. **Estelle décide combien de rappels, et quand.**

### Le modèle

Une table `payment_reminders` :

```
payment_id      → l'échéance concernée
offset_days     → décalage par rapport à la date d'échéance (négatif = avant, positif = après)
channel         → email · in_app · both
label           → optionnel, le nom du rappel côté maison
sent_at         → nul jusqu'à l'envoi
```

### Ce qu'elle doit pouvoir faire

- **Ajouter autant de rappels qu'elle veut** sur une échéance : J−60, J−30, J−21, J−14, J−7, J−2, J+1, J+7 — n'importe quelle combinaison, sans limite de nombre.
- **En retirer un** à tout moment, y compris après programmation.
- **Choisir le canal pour chacun** : email seul, application seule, ou les deux. Un rappel à J−60 dans l'application sans email, c'est légitime.
- **Définir un jeu par défaut au niveau du mariage** — appliqué à toute nouvelle échéance — et le **surcharger échéance par échéance**. Un virement vers le Maroc ne se prépare pas comme un prélèvement SEPA : elle doit pouvoir mettre J−45 sur celui-là seulement.
- **Programmer une date fixe** plutôt qu'un décalage, quand c'est plus commode.
- **Déclencher un rappel maintenant**, hors calendrier, en un clic.

### Les règles, qui ne se négocient pas

- **Jamais sur une échéance en brouillon.** Verrou serveur.
- **Jamais deux emails le même jour** au même destinataire : les rappels du jour se **regroupent en un seul message** qui liste les échéances concernées.
- **Arrêt automatique dès que l'échéance est marquée réglée.** Les rappels restants sont annulés, pas envoyés.
- **Chaque envoi est enregistré** : quel rappel, quelle échéance, quelle adresse, quel jour. Le même rappel ne repart jamais deux fois.
- **Aucun rappel si les coordonnées du prestataire ne sont pas `verified`** — et si elles changent, tous les rappels programmés pour ce prestataire sont **suspendus** jusqu'à nouvelle vérification.
- **Prévisualisation obligatoire** avant le premier envoi d'un mariage. Estelle voit exactement ce que le couple recevra.
- **Expédié depuis la boîte d'Estelle ou de Jordane**, jamais d'une adresse technique.

---

## 2. Le contenu de l'email — la décision revient à Estelle

La question posée est légitime, et ma réponse précédente était trop absolue. Voici le raisonnement complet, puis le réglage.

### D'abord, une clarification : le montant, bien sûr

**Le montant, la devise, la date, le prestataire et ce que l'échéance règle figurent dans l'email.** Cela n'a jamais été en question — c'est déjà dans la spécification. Un email qui ne dit pas combien serait absurde.

### Le vrai sujet : l'IBAN dans l'email

**Ce n'est pas une question de confidentialité.** Un IBAN n'est pas un secret : il figure sur chaque facture, et on ne peut pas vider un compte avec un IBAN. Le risque va dans l'autre sens — celui du **couple qui paie le mauvais compte**.

Et le mécanisme de ce risque, c'est **l'habitude**.

Si le couple prend l'habitude de recevoir des coordonnées bancaires par email de la part de Madame Wedding Design, alors le jour où un email très ressemblant arrive avec d'autres coordonnées, **il n'a aucune raison de s'en méfier** : cela correspond au processus normal. La protection n'est pas le secret de l'IBAN, c'est que **le couple n'ait qu'un seul endroit légitime où les coordonnées vivent**. À cette condition, tout email contenant des coordonnées se reconnaît immédiatement comme frauduleux — sans réfléchir, sans expertise.

Deux éléments de contexte qui pèsent : les mariages à sept chiffres et les closings immobiliers sont **des cibles connues et travaillées** de la fraude au virement ; et la boîte email d'un couple est en général **moins protégée** que celle d'une maison qui a réfléchi à la question.

### Ce que je recommande, et qui règle le confort

Un **lien direct vers la page de l'échéance** dans le hub. Un clic depuis l'email, le couple est sur la page, l'IBAN est là avec un bouton de copie. C'est un geste de plus qu'un copier-coller depuis l'email, et cela préserve la règle du lieu unique.

### Mais c'est un arbitrage, pas une loi — donc c'est un réglage

`email_banking_disclosure`, réglable **par mariage**, trois niveaux :

| Niveau | Contenu de l'email | |
|---|---|---|
| **`link`** | Montant, devise, date, prestataire, **lien direct vers l'échéance**. Aucune coordonnée. | **défaut** |
| **`partial`** | Idem, plus **les quatre derniers caractères de l'IBAN**. Le couple vérifie ce qu'il voit dans le hub — un contrôle pour l'œil humain, pas une instruction de paiement. | |
| **`full`** | Idem, plus **les coordonnées complètes** : bénéficiaire légal, IBAN, BIC, banque, référence à porter. | |

**Trois règles qui tiennent aux trois niveaux, sans exception :**

1. **La ligne d'avertissement est présente dans chaque email**, toujours identique, jamais retirée :
   *« The house will never change its payment details by email. If you receive any change, telephone us before you act on it. »*
2. **Un changement de coordonnées ne part jamais par email**, quel que soit le niveau. Une modification se signale dans le hub et s'annonce par téléphone. C'est cette règle-là, plus que toute autre, qui rend une fraude détectable.
3. **Le niveau choisi est enregistré** dans le journal du mariage, avec sa date et qui l'a réglé.

**Et si le niveau `full` est retenu**, ajouter à l'onboarding du couple un mot qui pose la convention une fois pour toutes : les coordonnées arrivent par email **et** dans le hub, elles sont toujours identiques, et **elles ne changent jamais** — un email annonçant un changement est un faux, à signaler par téléphone.

---

## 2 bis. L'envoi : Gmail via `hello@madamewedding.design` — décision d'Estelle

### Pourquoi c'est un bon choix

Le domaine est déjà sur Google Workspace (enregistrements MX vers `aspmx.l.google.com`). Envoyer par l'**API Gmail** signifie donc que **c'est réellement Google qui expédie pour le domaine** : l'alignement SPF et DKIM est natif, sans configuration supplémentaire. C'est meilleur pour la délivrabilité qu'un service tiers qui enverrait « au nom de » `madamewedding.design`.

Pas de sujet de volume : quelques mariages, quelques rappels chacun — on est très loin des plafonds Workspace.

### Ce qu'il faut mettre en place

**a) API Gmail avec OAuth**, pas de mot de passe d'application, pas de SMTP en clair. Un jeton de rafraîchissement stocké **hors du dépôt**, en variable d'environnement.

**b) Gestion de l'échec, obligatoire.** Un jeton OAuth peut être révoqué, une autorisation Google peut expirer. **Un rappel de paiement qui ne part pas et que personne ne remarque est plus grave que pas de rappel du tout.** Donc :
- L'échec d'envoi est enregistré et **remonté à Estelle** dans l'application, pas seulement dans un journal serveur.
- L'échéance reste marquée « rappel non envoyé », visible dans les alertes.
- Une nouvelle tentative automatique, puis abandon avec signalement explicite.

**c) L'identité de l'expéditeur — un arbitrage à trancher.** `hello@` est l'adresse de la maison, pas celle d'une personne. Pour un rappel de paiement adressé à un couple très fortuné, cela peut sonner institutionnel là où l'on voudrait une main.

**Recommandation :** expédier depuis `hello@madamewedding.design`, avec le **nom d'affichage de la personne qui suit le mariage** — *« Estelle Bogaert · Madame Wedding Design »* — et un **`Reply-To` vers sa boîte personnelle**. Le client voit la maison, il répond à quelqu'un.

**d) La réponse doit atterrir chez un humain.** Si un couple répond à un rappel de paiement avec une question, ce message ne doit pas disparaître dans une boîte que personne ne relève. À vérifier avant le premier envoi.

**e) Le fil de discussion.** Les rappels successifs d'une même échéance se **rattachent au même fil** (`References` / `In-Reply-To`). Trois emails séparés sur la même échéance encombrent ; un fil se relit.

**f) Le planificateur.** Les rappels ont besoin d'un déclencheur périodique — fonction planifiée Netlify ou `pg_cron` côté Supabase. **À proposer à Estelle avec ses implications**, et à traiter comme une autorisation de lancement.

### Et un préalable qui compte plus que tout le reste : DMARC

Cloudflare le signale déjà dans les recommandations du domaine : **`madamewedding.design` n'a pas d'enregistrement DMARC.**

Ce n'est pas un détail de configuration. **C'est la protection principale contre le scénario de fraude décrit dans le brief bancaire** — un email d'apparence authentique, semblant venir de la maison, annonçant de nouvelles coordonnées bancaires. Sans DMARC, usurper le domaine est nettement plus facile ; avec un DMARC en `reject`, la messagerie du destinataire rejette les faux.

**À faire avant d'activer les notifications**, dans cet ordre :

1. **Vérifier SPF** — un enregistrement TXT autorisant Google (`v=spf1 include:_spf.google.com ~all`).
2. **Vérifier DKIM** — la signature Workspace activée dans la console d'administration Google, et la clé publiée en DNS.
3. **Poser DMARC** — commencer en `p=none` avec une adresse de rapport pour observer pendant deux à trois semaines, puis passer à `p=quarantine`, puis `p=reject`.

**Ne pas passer directement en `reject` :** si SPF ou DKIM est mal aligné, les emails légitimes de la maison seraient rejetés — y compris la correspondance client. L'observation d'abord.

C'est un travail DNS, pas du code. **Claude Code prépare les valeurs exactes des trois enregistrements et les remet à Estelle ; c'est elle qui les pose dans Cloudflare.** Même discipline que les migrations.

---

# PARTIE II — Ordre de marche pour Claude Code

## 3. Les autorisations à demander DÈS LE LANCEMENT

**Avant d'écrire une ligne de code, poser toutes ces questions en une fois, dans un seul message.** Estelle y répond en un passage. Ne pas les découvrir une par une au fil du chantier.

### Décisions produit

1. **`email_banking_disclosure`** : `link`, `partial` ou `full` par défaut ? (§2)
2. **Jeu de rappels par défaut** : quels décalages, quels canaux ? (§1)
3. **Seuil de vérification téléphonique** des coordonnées : à partir de quel montant cumulé par prestataire ? (section 5 bis du brief bancaire)
4. **Fond parchemin en Team view** : montrer les deux rendus côte à côte et attendre son choix. (§I.5 du brief lisibilité)
5. **Délai de purge** des coordonnées bancaires après la dernière échéance réglée. (§9 du brief bancaire)
6. **`legal_name` des prestataires existants** : les fiches actuelles n'ont pas de nom légal distinct du nom commercial. Faut-il les reprendre à la main, ou les laisser à compléter au fil de l'eau ?

### Accès et secrets

7. **`ANALYSIS_MODEL`** : le modèle le plus capable, à renseigner en variable d'environnement. Confirmer laquelle et où.
8. **Clé de chiffrement** de `vendor_banking` : où elle vit aujourd'hui, et confirmation qu'elle reste hors base.
9. **Envoi d'email** : ~~par quel service~~ — **tranché : API Gmail depuis `hello@madamewedding.design`** (voir §2 bis). Reste à confirmer : le nom d'affichage et le `Reply-To` par mariage, le choix du planificateur, et les identifiants OAuth.
10. **Suppressions de code mort** : `MasterTable` et `LinesTable` — confirmer avant de supprimer.

### Ce qui ne se décide jamais seul

- Toute modification de la **palette**, de la **typographie de marque** ou du **wording de la maison**.
- Toute modification d'une **politique RLS**.
- Toute opération **destructive** sur des données : suppression de colonne, de table, de ligne.
- Tout **nouveau service tiers** ou nouvelle dépendance lourde.

---

## 4. Le protocole de migration — Estelle exécute, jamais Claude Code

**Règle absolue : Claude Code écrit les migrations, il ne les exécute pas.**

1. Toute migration est **additive** : on ajoute des colonnes et des tables, on ne renomme pas, on ne supprime pas. Les colonnes devenues inutiles restent en place jusqu'à une décision explicite.
2. Elle est **numérotée à la suite** dans `supabase/migrations/`, et écrite en un seul fichier par lot cohérent.
3. Elle porte **un en-tête en commentaire** : ce qu'elle fait, pourquoi, et ce qui casse si elle n'est pas jouée.
4. Elle est **idempotente** : `if not exists`, `add column if not exists`. Rejouable sans dommage.
5. Elle est accompagnée d'une **note de retour arrière** — comment revenir en arrière si besoin.
6. **Claude Code annonce chaque migration prête** : *« la migration 0016 est écrite, voici ce qu'elle fait, lancez-la quand vous voulez »* — puis **attend**.
7. **Aucun code qui dépend d'une migration n'est considéré comme terminé avant qu'Estelle ait confirmé l'avoir jouée.** Le code doit se comporter proprement si la migration n'est pas encore passée : pas d'écran blanc, pas d'erreur brute — un message tenu.
8. Les **politiques RLS** de toute nouvelle table sont écrites **dans la même migration** que la table. Une table sans policy est une table ouverte.

---

## 4 bis. Les neuf briefs — inventaire complet

Le chantier tient dans **neuf fichiers**. Si l'un manque, le dire tout de suite et attendre : ne pas reconstituer son contenu par déduction.

| Fichier | Ce qu'il couvre |
|---|---|
| `BRIEF-inner-house-corrections.md` | Le brief principal (buts A→I) + l'annexe d'audit du dépôt |
| `BRIEF-inner-house-lisibilite.md` | Graisse, interlettrage, échelle typographique, plein écran des planches, URL des planches, fatigue |
| `BRIEF-inner-house-ledger-cellule-active.md` | Cellule active du Ledger + badge brouillon |
| `BRIEF-inner-house-budget-ajout-lignes.md` | Régression : ajout manuel de lignes et sous-lignes |
| `BRIEF-inner-house-budget-chiffres-visuels.md` | Les trois grands chiffres, le dépassement, barre principale, répartition par enveloppe |
| `BRIEF-inner-house-budget-application-financiere.md` | Cadrage financier : fondations, trésorerie, devises, TVA, rapprochement, alertes, scénarios, clôture |
| `BRIEF-inner-house-coordonnees-bancaires.md` | Lecture, structure par corridor, contrôles, vérification proportionnée, historique |
| `BRIEF-inner-house-notifications-et-vitesse.md` | Notifications (base) + vitesse du hub |
| `BRIEF-inner-house-notifications-et-ordre-de-marche.md` | **Ce fichier** — rappels programmables, autorisations, migrations, ordre |

---

## 5. L'ordre des chantiers

Les briefs à traiter, dans cet ordre. Un commit et une validation par bloc.

| # | Chantier | Brief |
|---|---|---|
| 1 | **Vitesse** : les huit `revalidatePath("/", "layout")`, puis le `Promise.all` sur toutes les pages | `BRIEF-inner-house-notifications-et-vitesse.md` §7–8 |
| 2 | **Lisibilité** : graisse 300 → 400, interlettrage plafonné à 0,18em | `BRIEF-inner-house-lisibilite.md` §I.1–I.2 |
| 3 | **Ledger** : cellule active, badge brouillon | `BRIEF-inner-house-ledger-cellule-active.md` |
| 4 | **Régression** : ajout de lignes et de sous-lignes à la main | `BRIEF-inner-house-budget-ajout-lignes.md` |
| 5 | **Budget, exactitude** : le pourcentage faux, le libellé du dépassement | `BRIEF-inner-house-budget-chiffres-visuels.md` §1–2 |
| 6 | **Documents** : le téléchargement | `BRIEF-inner-house-corrections.md` §B |
| 7 | **Fondations financières** : devise sur les lignes, taux de change, arrondi | `BRIEF-inner-house-budget-application-financiere.md` §1 |
| 8 | **Analyse de documents** : `ANALYSIS_MODEL`, plafonds, confiance, signalements | `BRIEF-inner-house-corrections.md` §C |
| 9 | **Coordonnées bancaires** : structure, contrôles, vérification, historique | `BRIEF-inner-house-coordonnees-bancaires.md` |
| 10 | **Notifications** : rappels programmables, contenu, verrous | ce brief, Partie I |
| 11 | **Budget, visuels** : barre principale, répartition par enveloppe, trésorerie | `BRIEF-inner-house-budget-chiffres-visuels.md` §3–4 · `BRIEF-inner-house-budget-application-financiere.md` §2.1 |
| 12 | **Scope Budget** : le troisième niveau, le vocabulaire | `BRIEF-inner-house-corrections.md` §D |
| 13 | **Mobile** : marges de sécurité iOS, point de rupture téléphone | `BRIEF-inner-house-lisibilite.md` §I / `BRIEF-inner-house-corrections.md` §I |
| 14 | **Plein écran des planches** | `BRIEF-inner-house-lisibilite.md` §II.1 |
| 15 | **Alertes** et **rapprochement des documents** | `BRIEF-inner-house-budget-application-financiere.md` §5–6 |
| 16 | **Le reste** : scénarios, clôture, indicateurs de la maison | `BRIEF-inner-house-budget-application-financiere.md` §7–9 |

> **Note de portée — The Wedding Days.** La production fait désormais l'objet d'une application distincte, The Production Book (`BRIEF-production-book-application.md`). Dans The Inner House, The Wedding Days se limite à **une page en lecture seule** de ce que la production publie, plus un état vide tenu. **Aucune action d'édition de run sheet côté hub.** Voir la note de portée en tête de `BRIEF-inner-house-wedding-days.md`.

**Après chaque bloc :** `/impeccable audit`, puis une capture avant/après, puis attendre la validation d'Estelle.

---

## 6. Comment travailler

- **Une branche par bloc**, un commit lisible, jamais de travail en cours sur la branche principale.
- **Ne jamais remplacer un composant sans transférer ses capacités** — la règle née de la régression du bloc 4. Lister, cocher, puis supprimer.
- **Poser une question quand un choix engage l'expérience ou l'esthétique.** Trancher seul les détails techniques.
- **Ne rien annoncer comme terminé sans l'avoir vu fonctionner.** Une capture, un test, un chiffre.
- **Signaler ce qui a été trouvé en chemin** et qui n'est pas dans les briefs, sans le corriger de sa propre initiative.

---

## 7. Le juge de paix

Trois questions, avant chaque validation :

1. **Un client Ultra-High-Net-Worth (ultra-haut patrimoine, ~$30M+ net worth) trouverait-il cela digne de la maison ?**
2. **Cela fait-il gagner du temps à Estelle et à Jordane, ou est-ce que cela en coûte ?**
3. **Est-ce qu'on voit que c'est un logiciel ?** Si oui, ce n'est pas fini.
