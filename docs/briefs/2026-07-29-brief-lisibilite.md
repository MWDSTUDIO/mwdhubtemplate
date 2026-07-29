# The Inner House — Lisibilité, confort de lecture et fatigue
**Brief autonome pour Claude Code.** Il remplace la note courte précédente et se traite avant la section §1 (expérience client) du brief principal.

---

## Le but

Deux personnes très différentes vivent dans The Inner House.

**La maison y passe ses journées.** Estelle et Jordane travaillent huit, dix heures devant cet écran — budgets, planches, échéanciers, correspondance. Sur cette durée, un défaut minuscule de lisibilité ne coûte pas une gêne : il coûte des maux de tête, une attention qui s'effrite en fin d'après-midi, et des erreurs de saisie sur des chiffres qui engagent des centaines de milliers d'euros.

**Le client, lui, y vient par moments** — et ce qu'il vient y chercher est de la sérénité. Une planche de design, un budget, une timeline. Il ne doit jamais plisser les yeux, jamais avoir l'impression de déchiffrer.

Le but de ce brief est donc double, et il ne se réduit pas à « grossir les polices » : **rendre The Inner House lisible d'un coup d'œil, et supportable sur la durée.**

Quatre fatigues à combattre, dans cet ordre d'importance.

---

# I. La fatigue oculaire

## I.1 — La graisse : le défaut le plus coûteux, et le moins visible

```css
body { font-family: var(--font-ui); font-weight: 300; }
```

**Tout le hub est en graisse 300.** Jost en Light, à 15 px et moins, en vert sur crème.

C'est un choix juste sur les grands corps : le 88 px du compteur, le 40 px des titres, les chiffres en serif. En Light, ces tailles-là respirent et donnent exactement la retenue que la maison recherche.

Mais **en dessous de 16 px, une graisse 300 fait payer chaque ligne.** Les traits deviennent si fins que l'œil doit reconstituer les formes au lieu de les reconnaître. Sur dix minutes, c'est imperceptible. Sur une journée, c'est la première cause de fatigue de cette interface — avant la taille, avant le contraste.

**Le correctif :**

| Contexte | Graisse cible |
|---|---|
| Corps de texte, tableaux, formulaires, libellés | **400** |
| Petites capitales espacées (eyebrows, tags) | **400**, jamais 300 |
| Titres à partir de 24 px | 300 conservé |
| Chiffres d'affichage (compteurs, grands montants) | 300 conservé |

Le caractère de la maison est intact : la retenue vient des grands corps en Light, du serif, du blanc et des filets champagne — pas de la finesse d'un texte de 13 px que personne n'arrive à lire.

## I.2 — L'interlettrage sur les petits textes

La feuille de style monte jusqu'à `letter-spacing: 0.34em`, avec plusieurs occurrences à 0,26 / 0,28 / 0,30 / 0,32em — **appliquées à des textes de 9 et 10 px**.

Le mécanisme en jeu : on ne lit pas lettre à lettre, on reconnaît la **forme globale du mot**. Au-delà d'environ 0,20em, cette forme se désagrège et l'œil bascule en déchiffrage caractère par caractère. C'est lent, et c'est fatigant.

**Le correctif :** plafonner à **0,18em** partout, et réserver les valeurs supérieures à un usage : une eyebrow isolée de deux ou trois mots, jamais une ligne de contenu, jamais un libellé de tableau, jamais une navigation.

C'est un ajustement de quelques centièmes qui ne se verra pas — et qui se sentira.

## I.3 — L'échelle typographique

La base est à 15 px, mais l'interface descend à 9, 10 et 11 px un peu partout, et jusqu'à **8,5 px** sur la signature de planche.

| Élément | Aujourd'hui | Cible |
|---|---|---|
| Corps de texte | 15 px | **16 px** |
| Tableaux (`.sheet-table`) | 13,5 px | **15 px** |
| Notes, légendes, blocs mensuels | 12,5 px | **14 px** |
| Messages du chat (`.bub`) | 13,5 px | **15 px** |
| Eyebrows / petites capitales | 9–10 px | **12 px** |
| Boutons `.btn.sm` | 10 px | **12 px** |
| Signature de planche (`.hd .sig`) | 8,5 px | **11 px** |

**Règle : rien en dessous de 12 px nulle part, rien en dessous de 13 px dans une vue cliente.**

Le raffinement des petites capitales est le bon geste — c'est la signature typographique de la maison et on la garde. C'est le corps qu'on remonte, pas l'esprit.

## I.4 — L'interligne et la longueur de ligne

**Interligne.** La base est à 1,6, ce qui est juste. Mais `.mo p` est à 1,45 et `.bub` à 1,5 — trop serré pour du petit texte. **Plancher à 1,55 sur tout texte courant**, 1,65 sur les paragraphes de planche et les notes de la maison, qui se lisent posément.

**Longueur de ligne.** `max-width: 72ch` n'est posé que sur `.lead` et `.title`. Ailleurs, dans `section.sheet` qui monte à 1520 px, un paragraphe peut s'étirer sur toute la largeur d'un écran de 27 pouces. Au-delà de 75 caractères, l'œil se perd en revenant à la ligne suivante.

**Correctif : plafonner tout texte courant à 68–72 caractères**, partout, y compris dans les cartes et les notes d'enveloppe. Les tableaux et les grilles ne sont pas concernés.

## I.5 — La luminance sur les longues sessions

Le crème `#fbf8f3` est à une luminance de 0,98 — c'est un blanc, ou presque. En plein écran, huit heures par jour, c'est une surface lumineuse continue dans le champ visuel. C'est la charge la plus lourde après la graisse.

**Impossible d'y toucher côté client** : c'est la maison, c'est sa lumière, et le client la voit par sessions courtes. On n'y touche pas.

**Mais côté équipe, la solution est déjà dans vos jetons.** `--parchment` (`#f2efe4`, luminance 0,95) est un crème très légèrement rabattu, parfaitement de la maison.

**Proposition : un fond `--parchment` pour les surfaces de travail en Team view** — The Desk, le budget en vue Ledger, Teamwork. Le crème reste le fond de toute vue cliente et de toute planche. Aucune nouvelle couleur, aucune trahison de la charte : simplement un demi-ton de moins là où on passe la journée.

À proposer en réglage, pas à imposer : un discret bascule dans les préférences d'équipe, mémorisé.

## I.6 — Le contraste, à revérifier après coup

L'en-tête de la feuille de style annonce un rapport corps sur crème ≥ 5:1, et le `--bronze` a déjà été assombri pour tenir le 4,5:1. Le travail a été fait sérieusement.

**Mais il a été fait aux anciennes tailles.** Un gris `--ink2` qui passe sur un corps de 16 px en graisse 400 ne passe pas nécessairement sur une capitale fine de 12 px espacée à 0,18em. Après les corrections I.1 à I.3, **repasser `/impeccable audit` sur l'ensemble** et corriger là où c'est limite — en fonçant le gris, jamais en agrandissant encore.

---

# II. La fatigue de navigation

## II.1 — Le plein écran ne remplit pas l'écran

```css
.bsheet { width: 1220px; max-width: 100%; }
.bsheet-stage:fullscreen { justify-content: center; padding: 40px; overflow: auto; }
```

La planche a une **largeur de dessin fixe de 1220 px**, et le plein écran se contente de la **centrer** sans jamais la redimensionner. Sur un écran de 2560 px, elle occupe moins de la moitié de la largeur. **Plus l'écran est grand, plus la planche paraît petite** — l'inverse exact de ce qu'on attend.

**Le correctif :** garder 1220 px comme largeur de dessin (toutes les proportions internes en dépendent, ne pas y toucher) et mettre la planche à l'échelle de la fenêtre.

```
facteur = min(
  (largeurFenêtre - marge) / 1220,
  (hauteurFenêtre - marge) / hauteurRéelleDeLaPlanche
)
```

En `transform: scale(facteur)`, `transform-origin: top center`, sur un conteneur dont les dimensions réservées tiennent compte du facteur. Recalculé au redimensionnement, à l'entrée et à la sortie du plein écran, et quand le contenu change de hauteur.

**Critères d'acceptation :**
- La planche occupe **au moins 92 %** de la dimension la plus contraignante, testé à 1440, 1728, 2560 et 3440 px de large.
- **Aucune barre de défilement en plein écran** — la planche tient d'un seul tenant.
- Rien de rogné, rien qui dépasse. Les textes grossissent avec la planche : c'est voulu.
- Respiration **égale tout autour**, jamais un bandeau crème d'un seul côté.
- Sortie du plein écran : retour exact à l'état et à la position de défilement précédents.

## II.2 — Ne jamais perdre le fil dans un tableau

Le budget et l'échéancier sont les écrans les plus longs de l'application. Aujourd'hui, en défilant, on perd l'en-tête et on ne sait plus quelle colonne on lit — il faut remonter, redescendre, recommencer. C'est un des gestes les plus coûteux de la journée.

- **En-tête de tableau figé** au défilement, et **première colonne figée** en vue Ledger.
- **Sous-totaux d'enveloppe visibles en permanence**, pas seulement en pied de tableau.
- **Hauteur de ligne d'au moins 44 px** — un tableau trop compact fait sauter des lignes à l'œil.
- **Chiffres en fonte tabulaire** (`font-variant-numeric: tabular-nums`), alignés à droite. Des chiffres qui ne s'alignent pas verticalement obligent à relire chaque montant.
- Repérage des lignes par **filet fin très clair** (`--line-soft`), jamais par bandes alternées.

## II.3 — La position des choses ne change jamais

Sur une journée, ce qui fatigue le plus n'est pas de cliquer : c'est de **chercher où cliquer**.

- L'action principale d'une page est **toujours au même endroit**, sur toutes les pages.
- La navigation ne se réorganise jamais selon le contenu.
- Un module ouvert, quitté, puis rouvert **retrouve son onglet et sa position de défilement**.
- Les raccourcis clavier de la Team view sont **les mêmes partout**, et découvrables par un `?`.

## II.4 — Le mouvement, ajusté

`section.sheet` porte une animation d'apparition de 0,4 s à chaque changement de page. Sur une journée à plusieurs centaines de navigations, c'est du temps d'attente cumulé et une sollicitation visuelle répétée.

- **Ramener à 0,2 s** les transitions de page. Garder l'`ease-out` sans rebond.
- `prefers-reduced-motion` est déjà respecté, y compris sur le `scroll-behavior: smooth` — **ne rien casser de cet acquis.**
- Aucun élément qui bouge, clignote ou pulse en continu dans le champ de vision. Les indicateurs d'activité sont discrets et s'arrêtent.

---

# III. La fatigue cognitive

## III.1 — Montrer moins à la fois

Un écran qui affiche tout ce qu'il sait oblige à trier soi-même. C'est la fatigue la plus sournoise parce qu'elle ne se voit pas.

- **Un écran, une question.** Ce que la page répond est écrit en une ligne en haut (voir §1 du brief principal).
- **Dévoilement progressif** : le détail d'une ligne de budget, les sous-lignes, l'échéancier se déplient à la demande. Rien n'est déplié par défaut.
- **Densité réglable en Team view** (confortable / compacte) — Estelle en saisie et Estelle en relecture n'ont pas le même besoin.
- Trois niveaux de titre au maximum sur une page.

## III.2 — Un mot, une chose

Le même objet porte le même nom partout, dans les cinq langues. Un « paiement » ne devient jamais une « échéance » deux écrans plus loin. Le glossaire de la maison (*attentions*, *Awaiting your word*, *At your leisure*, *Attended to*) fait autorité et **rien ne s'y ajoute sans décision.**

C'est une règle d'écriture, pas de code — mais c'est elle qui décide si l'application se comprend sans effort ou s'il faut réapprendre à chaque page.

## III.3 — Les chiffres se lisent, pas se calculent

- Les montants portent leur devise, sans ambiguïté.
- Aucun écart n'est laissé à la soustraction mentale : si l'information utile est « il reste 4 200 € à placer », **c'est cette phrase qui s'affiche**, pas deux nombres à soustraire.
- Les pourcentages sont accompagnés de leur montant, toujours.

---

# IV. La fatigue nerveuse

Celle qu'on oublie, et qui use le plus : la crainte de perdre son travail ou de faire une bêtise.

- **Autosave partout**, avec un indicateur discret et honnête. Jamais de saisie perdue à cause d'un onglet fermé.
- **Annulation (`Cmd/Ctrl+Z`) sur toute saisie**, et une action de reprise sur les suppressions.
- **Rien d'irréversible sans confirmation nommée** — la confirmation dit *ce qui* va devenir visible du client, pas « Êtes-vous sûr ? ».
- **Réponse immédiate à chaque action** (affichage optimiste), réconciliation en arrière-plan, retour en arrière visible et message clair en cas d'échec. L'attente devant un écran figé est un coût d'attention réel.
- **Notifications sobres** : rien qui interrompt une saisie en cours.

---

# V. Au passage — l'URL des planches

```
/design/33333333-0000-0000-0000-000000000001
```

C'est l'identifiant **UUID de la planche en base** (`boards.id`, généré par `gen_random_uuid()`). Celui-ci vient des **données de démonstration** de `supabase/seed.sql` — d'où sa forme régulière en 3333. Il est illisible, impossible à dicter, et il signale au regard averti qu'il s'agit d'une donnée de démo.

**Tout ce qu'il faut existe déjà en base :** la table `boards` porte une colonne `kind` (`global`, `floral`, `tablescape`, `welcome`, `cocktail`…) et `weddings` a déjà un `slug` unique. La route devient :

```
/design/floral
/design/tablescape
```

résolue dans le mariage de la session. Pour les planches personnalisées (migration `0006_custom_boards`), un slug dérivé du titre, unique par mariage, suffixé en cas de doublon.

**Réserve :** l'UUID a une vertu — il n'est pas devinable. Ici l'accès est protégé par la session et par RLS, donc le slug ne crée aucune faille dans le hub. **Mais** si un lien de planche est un jour partagé à un prestataire sans authentification, ce partage passera par un **jeton dédié, aléatoire et révocable** — jamais par le slug.

---

# Ordre d'exécution

1. **I.1 (graisse) et I.2 (interlettrage)** — deux passes courtes sur `globals.css`, l'effet est immédiat et c'est le plus rentable de tout le brief.
2. **I.3 et I.4** (échelle, interligne, longueur de ligne).
3. **I.6** — `/impeccable audit` complet, correction des contrastes aux nouvelles tailles.
4. **II.1** — le plein écran des planches.
5. **II.2** — les tableaux du budget.
6. **I.5** — proposer le fond parchemin en Team view, avec le réglage. Me montrer les deux avant de trancher.
7. **II.3, II.4, III, IV** — au fil des modules concernés.
8. **V** — l'URL, indépendant, quand ça arrange.

Après les étapes 1 et 2, **montre-moi une capture de la même page avant / après**, à taille réelle. C'est le seul moyen de juger.
Après l'étape 4, **des captures à 1440, 2560 et 3440 px de large.**
