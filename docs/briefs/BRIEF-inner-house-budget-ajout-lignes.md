# The Inner House — Budget : ajouter des lignes et des sous-lignes à la main
**Correction de régression. À traiter en priorité.**
Fichiers : `ledger-client.tsx` · `mgmt-client.tsx` · `budget-client.tsx` · `page.tsx` · `src/app/actions/budget.ts`

---

## Le but

**Rien de ce que la lecture automatique ne sait pas faire ne doit devenir impossible à faire à la main.**

Un devis de traiteur mal structuré, un contrat scanné de travers, un poste que l'agent n'a pas su ventiler : ça arrivera, et souvent. Dans ces cas-là, Estelle doit pouvoir ouvrir le budget et ventiler elle-même — ajouter une ligne, ajouter des sous-lignes, comme dans un tableur, en dessous de ce qui existe déjà.

**La saisie manuelle n'est pas un mode dégradé. C'est le mode de référence, que la lecture automatique vient assister.**

---

## 1. Le diagnostic : la fonction n'a pas disparu, elle a été débranchée

Ce n'est pas une fonctionnalité manquante, c'est une régression — et le code le montre clairement.

**Les actions serveur sont toutes là, intactes**, dans `src/app/actions/budget.ts` :

```
addBudgetLine(weddingId, label, budgeted)     ← créer une ligne
saveLineItem({...})                            ← créer / modifier une sous-ligne
deleteBudgetLine(id)
deleteLineItem(id, budgetLineId)
updateBudgetLine({...})
```

**Mais plus aucune interface ne les appelle.** `BudgetViews` (`ledger-client.tsx`) a remplacé les anciens composants, et n'expose ni ajout de ligne ni ajout de sous-ligne.

**Et les anciens composants sont devenus du code mort :** `MasterTable` (dans `mgmt-client.tsx`) et `LinesTable` (dans `budget-client.tsx`) existent toujours, mais `page.tsx` n'importe plus que `PaymentsCalendar` et `RiskBuffer`. Personne ne les appelle plus.

Seul survivant du côté « ajouter » : `MadameBudgetAdd`, la voie par l'agent. **La voie automatique a été conservée, la voie manuelle a été perdue.** C'est exactement l'inverse de ce qu'il fallait garder.

### La règle qui découle de cet incident

**Une fonction ne se remplace pas, elle se transfère.** Avant de substituer un composant à un autre : lister les capacités de l'ancien, les cocher une par une dans le nouveau, et ne supprimer l'ancien qu'après. Cette règle vaut pour toute la suite du chantier, pas seulement ici.

---

## 2. Dans The Ledger — comme un tableur, en place

### L'ajout de ligne

- **Une ligne « + add a line » en permanence, comme dernière ligne de chaque groupe d'enveloppe.** Pas un bouton dans une barre d'outils : à sa place, en bas du groupe, là où un tableur la met.
- Un clic crée la ligne **immédiatement**, en brouillon, et **le curseur atterrit dans la cellule du libellé**, prêt à taper. Pas de modale, pas de formulaire à remplir avant.
- **Une enveloppe vide affiche quand même sa ligne d'ajout.** Aujourd'hui, un groupe sans ligne n'offre aucun point de départ.

### L'ajout de sous-ligne

- Une ligne se déplie sur ses sous-lignes. **En bas de cette liste, une ligne « + add a sub-line »**, selon le même principe.
- Même comportement : création immédiate, curseur dans le libellé.
- **Une ligne sans aucune sous-ligne doit pouvoir en recevoir une** — c'est précisément le cas où la lecture du document a échoué.

### Les gestes clavier qui font la différence

C'est ce qui distingue un tableau d'un tableur :

| Raccourci | Effet |
|---|---|
| `Cmd/Ctrl + Entrée` | Insère une ligne **sous la ligne active**, dans la même enveloppe |
| `Cmd/Ctrl + Maj + Entrée` | Insère une **sous-ligne** sous la ligne active |
| `Cmd/Ctrl + D` | Duplique la ligne active (utile pour un prestataire à plusieurs postes similaires) |
| `Cmd/Ctrl + Z` | Annule, y compris une création et une suppression |

### Modifier et déplacer

- **Supprimer** depuis la ligne, avec annulation. Pas de boîte de confirmation pour une ligne en brouillon — l'annulation suffit et ne casse pas le rythme.
- **Changer d'enveloppe** : la cellule d'enveloppe est un menu déroulant dans la ligne. Déplacer un poste mal classé ne doit pas demander de le supprimer et de le recréer.
- Toute ligne créée à la main est en **brouillon** jusqu'à publication, comme le reste.

### Le total d'une ligne : deux régimes, jamais silencieux

- Une ligne **sans sous-ligne** : son montant se saisit librement.
- Une ligne **avec sous-lignes** : son montant est la **somme des sous-lignes**.
- Le régime en cours doit être **visible** sur la ligne.
- Si un total saisi à la main diverge de la somme de ses sous-lignes, **l'écart s'affiche** en clair — et rien n'est écrasé silencieusement. Estelle tranche.

---

## 3. Dans The House Book — la même puissance, un autre geste

La question posée est la bonne : par quel bout ajouter, et comment les deux vues se nourrissent-elles ?

**La réponse : une seule source de vérité.** Les deux vues écrivent dans les mêmes actions serveur, sur les mêmes tables. Aucune logique métier dupliquée, aucune synchronisation à écrire — il n'y a rien à synchroniser puisqu'il n'y a qu'un jeu de données.

Ce qui change, c'est le geste, parce que la vue n'a pas le même but :

- **The Ledger** est fait pour la saisie en série. On y ajoute vite, au clavier, plusieurs lignes de suite.
- **The House Book** est fait pour la lecture posée. On y ajoute **à l'unité, par prestataire**.

### Concrètement, dans The House Book

- Au bas de la liste des sous-lignes d'un prestataire déplié : **« + add a detail »**, discret, dans la voix de la maison.
- Au bas de chaque carte d'enveloppe : **« + add a line »**.
- L'édition se fait sur place aussi, mais **un champ à la fois**, calmement — pas de navigation au clavier de cellule en cellule. Ce n'est pas le lieu.

### Le critère qui vaut preuve

**Ce qui est créé dans une vue apparaît dans l'autre sans rechargement ni manipulation.** À tester explicitement : créer une sous-ligne dans The Ledger, basculer sur The House Book, elle est là. Et l'inverse.

### Côté client

Aucun contrôle d'ajout, évidemment. The House Book étant la vue par défaut du client, **les affordances d'ajout ne se rendent que si la session est équipe** — et la vérification est côté serveur, pas un `display: none`.

---

## 4. Le lien avec la lecture de documents

C'est le cas d'usage qui a motivé cette correction : l'agent n'a pas su ventiler un devis.

1. **Une lecture qui n'a produit aucune sous-ligne doit le dire.** La ligne affiche explicitement *« no detail read »* — pas un silence, pas un tiret. Et elle propose la saisie manuelle **à cet endroit précis**, sans qu'Estelle ait à chercher ailleurs.
2. **Une lecture partielle le signale aussi** : le nombre de sous-lignes lues, et l'écart entre leur somme et le total du devis.
3. **Chaque sous-ligne porte sa provenance** : `read` (issue d'un document) ou `manual` (saisie par la maison). Visible au survol.
4. **Une relecture du même document n'écrase jamais les sous-lignes manuelles.** Elle les conserve, et le comparatif de validation (§C6 du brief principal) les signale comme telles pour qu'Estelle décide. Le travail fait à la main est du travail : il ne se perd pas parce qu'un agent repasse derrière.

---

## 5. Non-régression — la liste à cocher

Avant de clore, vérifier que **chaque capacité** des anciens composants existe dans les nouveaux :

| Capacité (ancien `MasterTable` / `LinesTable`) | Où elle vit maintenant |
|---|---|
| Ajouter une ligne de budget | ☐ The Ledger + The House Book |
| Ajouter une sous-ligne | ☐ The Ledger + The House Book |
| Modifier libellé, montant, devise, TVA | ☐ |
| Supprimer une ligne | ☐ |
| Supprimer une sous-ligne | ☐ |
| Changer l'enveloppe d'une ligne | ☐ |
| Rattacher une ligne à un prestataire | ☐ |
| Ajouter une échéance à une ligne | ☐ |

**Une fois toutes les cases cochées, supprimer `MasterTable` et `LinesTable`.** Du code mort qui ressemble à du code vivant est un piège pour la prochaine correction.

---

## Critères d'acceptation

- Depuis The Ledger, ajouter une ligne dans une enveloppe **vide** et y saisir un libellé et un montant, **sans quitter le tableau**.
- Depuis The Ledger, ajouter trois sous-lignes de suite sous une ligne existante, au clavier, sans rouvrir de formulaire entre chaque.
- `Cmd/Ctrl + Entrée` insère une ligne sous la ligne active.
- Une ligne créée dans The Ledger apparaît dans The House Book sans rechargement, et réciproquement.
- Une ligne issue d'un document dont la lecture n'a rendu aucune sous-ligne affiche *« no detail read »* et permet la saisie manuelle sur place.
- Une relecture du document ne supprime aucune sous-ligne saisie à la main.
- Toute création est en brouillon et n'apparaît au client qu'après publication.
- En vue client, aucun contrôle d'ajout n'est rendu, et l'appel direct aux actions serveur est refusé.
- `MasterTable` et `LinesTable` ont été supprimés du dépôt.

---

## Ordre

1. **The Ledger** : ajout de ligne et de sous-ligne en place, plus les raccourcis clavier. C'est l'urgence.
2. **The House Book** : les mêmes ajouts, au geste posé.
3. **Les régimes de total** et l'affichage de l'écart.
4. **Le lien avec la lecture** : *« no detail read »*, la provenance, la préservation des saisies manuelles.
5. **La liste de non-régression**, puis suppression du code mort.
