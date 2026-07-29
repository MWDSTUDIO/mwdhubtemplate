# The Inner House — Budget : les grands chiffres et leur lecture visuelle
**Correction d'exactitude + ajout de représentation. À traiter avec le module budget.**
Fichiers : `src/app/[locale]/(hub)/budget/page.tsx` · `ledger-client.tsx` · `messages/*.json` · `globals.css`

---

## Le but

Qu'un client ouvre son budget et comprenne **où il en est en trois secondes, sans faire une division.**

Aujourd'hui il y a trois grands chiffres, et il faut les mettre en rapport soi-même pour savoir ce qu'ils veulent dire. Or c'est exactement le travail que la maison doit faire à sa place.

Et surtout : **l'un des trois est mal libellé.** C'est ce que l'œil a senti avant de pouvoir le nommer.

---

## 1. Le chiffre qui ne correspond pas

### Le constat

`page.tsx`, ligne 186 :

```tsx
{t("mgmt.ofBudget", { pct: Math.round((paid / committed) * 100) })}
```

La clé de traduction dit **« of budget »**, le calcul dit **`paid / committed`**. Le libellé et le calcul ne parlent pas de la même chose.

Vérification sur Camille & Alexander :

| | |
|---|---|
| Budget total | €720,000 |
| Engagé | €221,427 |
| Payé | €156,100 |
| Affiché sous « PAID TO DATE » | **70 % of budget** |

Or `156,100 / 720,000 = 21,7 %`. Le 70 % affiché, c'est `156,100 / 221,427` — **70 % de l'engagé, pas du budget.**

Même défaut sur Sophie & Gordon : 71 % affiché, alors que la part du budget est de 75 %.

**Pourquoi c'est trompeur et pas seulement inexact.** Cette mention est posée sous « PAID TO DATE », juste à côté d'une carte « TOTAL BUDGET ». Le client lit donc : *« j'ai payé 70 % de mon budget »* — alors qu'il en a payé 22 %. C'est un écart de perception considérable sur un mariage à sept chiffres, et il joue dans le mauvais sens : il inquiète.

Et par-dessus, la mention **fait doublon** : la troisième carte affiche déjà *« of €221,427 committed »*.

### Le correctif

- La deuxième carte affiche la part **du budget total** : `paid / total`, avec le libellé « of budget ». Les deux concordent.
- La part de l'engagé reste sur la troisième carte, où elle est à sa place.
- **Un contrôle systématique dans le code : tout pourcentage affiché doit avoir son dénominateur nommé dans le libellé.** Un pourcentage sans dénommé explicite est un bug, même s'il est juste.

---

## 2. Il manque un chiffre, et c'est le pivot

Trois cartes, mais **cinq grandeurs** comptent réellement :

| Grandeur | Aujourd'hui |
|---|---|
| **Budget total alloué** — ce que le couple a décidé de consacrer | Carte 1 |
| **Engagé** — contrats et devis validés : ce que le mariage coûte réellement à ce jour | Nulle part en propre, seulement en sous-ligne de la carte 3 |
| **Payé** | Carte 2 |
| **Reste à payer** (engagé − payé) | Carte 3 |
| **Reste à engager** (budget − engagé) | Petite ligne sous la carte 1 |

**L'engagé est le pivot de toute la lecture** : c'est lui qui transforme une intention en engagement, et c'est lui qui dit si le mariage tient dans son budget. Il mérite d'être lisible, pas relégué.

### Le cas du dépassement, à traiter sérieusement

Sur Sophie & Gordon, la ligne sous la carte 1 affiche **« −€94,573 still to allot »**. Autrement dit : **le mariage dépasse son budget de 94 573 €.**

Cette information est aujourd'hui écrite dans le plus petit corps de la page, dans le même gris que tout le reste, avec un signe moins comme seul signal.

C'est peut-être l'information la plus importante du module. **Un dépassement doit être impossible à manquer** — un libellé qui le nomme (*« €94,573 beyond the allotted budget »*, pas « −€94,573 still to allot », qui est un contresens), un traitement visuel distinct, et une note de la maison qui l'explique. Un dépassement se dit, il ne se laisse pas deviner à un signe moins.

---

## 3. La barre qui répond à « où en sommes-nous ? »

Une seule barre, sous les trois cartes, en pleine largeur. C'est la réponse visuelle demandée.

### Construction

**Échelle** = `max(budget total, engagé)`. Ce choix permet de traiter les deux cas — sous-engagé et dépassement — avec la même barre.

**Un repère vertical** marque la position du **budget total** sur la barre. C'est la ligne à ne pas franchir, et elle est toujours visible.

**Segments, de gauche à droite :**

| Segment | Rendu |
|---|---|
| **Payé** | Vert chasse plein |
| **Reste à payer** (engagé non encore payé) | Vert chasse à 35 % d'opacité |
| **Reste à engager** (si engagé < budget) | Parchemin, vide |
| **Dépassement** (si engagé > budget) | Bronze, **au-delà du repère du budget** |

**Légende sous la barre** : chaque segment nommé, avec son montant **et** son pourcentage. Jamais un pourcentage seul, jamais une couleur seule.

### Sur Camille & Alexander, cela donne

Payé 22 % · reste à payer 9 % · reste à engager 69 %. Le client voit immédiatement que l'essentiel de son budget n'est pas encore engagé — ce qui est l'information utile à quatorze mois du mariage, et que les trois chiffres actuels ne disent pas.

### Où la placer

**Au-dessus du sélecteur The Ledger / The House Book**, avec les trois cartes : elle résume le budget entier, pas une vue. Elle s'affiche donc dans les deux, et en vue client.

---

## 4. La répartition par enveloppe — les « parts »

C'est le second visuel demandé, et il répond à une autre question : **où va l'argent ?**

**Des barres horizontales, une par enveloppe, triées par montant décroissant.** Pas un camembert : on compare mal des angles, et un camembert ne sait pas montrer le payé à l'intérieur de chaque part.

Chaque barre porte :
- le nom de l'enveloppe ;
- son montant engagé ;
- **sa part du budget total**, en pourcentage ;
- à l'intérieur de la barre, la distinction payé / reste à payer, comme dans la barre principale.

Les enveloppes encore sans engagement figurent **en bas de liste**, dans un état discret — *« not yet placed »* — sans être escamotées : le client doit voir ce qui reste à venir.

**Où la placer :** dans **The House Book** uniquement. C'est la vue de lecture, et cette répartition est un objet de compréhension, pas de saisie. The Ledger garde ses sous-totaux d'enveloppe, qui suffisent au travail.

---

## 5. Les règles de rendu

- **Filets, pas jauges.** Hauteur de 6 à 8 px, angles nets, aucune barre de progression criarde, aucun dégradé, aucun brillant.
- **Palette existante uniquement** : `--hunter`, `--hunter` en opacité réduite, `--parchment`, `--bronze` pour le seul dépassement. Aucune nouvelle couleur.
- **Jamais la couleur seule.** Chaque segment est nommé en texte dans la légende. Un lecteur d'écran doit obtenir les mêmes informations qu'un œil.
- **Chiffres tabulaires**, alignés, et **tout pourcentage accompagné de son montant**.
- **Mobile** : les barres s'empilent et restent lisibles à 430 px, sans défilement horizontal. Les légendes passent sous la barre plutôt que de se comprimer.
- **`prefers-reduced-motion`** : pas de remplissage animé.
- Si le budget est exporté en PDF, les barres suivent — c'est ce qui rend l'export compréhensible.

---

## 6. La cohérence, vérifiée en continu

Trois égalités doivent tenir en permanence :

```
payé + reste à payer            = engagé
engagé + reste à engager        = budget total
somme des enveloppes engagées   = engagé
```

Si l'une casse, c'est une anomalie de données, pas un arrondi. **Elle s'affiche comme telle en Team view** — une mention explicite pour Estelle — et **jamais au client**, qui ne doit pas assister au débogage de son propre budget.

À écrire en tests, pas seulement en contrôle d'affichage.

---

## Critères d'acceptation

- Sur Camille & Alexander, la carte « PAID TO DATE » affiche **22 % of budget**, pas 70 %.
- Aucun pourcentage n'est affiché dans le module sans que son dénominateur soit nommé dans le libellé.
- L'engagé est lisible comme grandeur propre, pas seulement en sous-ligne.
- La barre principale se lit d'un regard, avec sa légende chiffrée, et le repère du budget est visible.
- Sur Sophie & Gordon, le **dépassement de €94,573 est immédiatement visible** et correctement libellé — plus de « −€94,573 still to allot ».
- La répartition par enveloppe est triée, chiffrée, et montre le payé à l'intérieur de chaque part.
- Les trois égalités de cohérence sont couvertes par des tests.
- Tout est lisible à 430 px de large.
- `/impeccable audit` passe sur les nouveaux éléments.

---

## Ordre

1. **Le correctif du pourcentage** (§1) — c'est une ligne, et c'est le plus urgent : un chiffre faux affiché à un client est le pire des défauts.
2. **Le libellé du dépassement** (§2) — une ligne aussi, et un vrai risque.
3. **La barre principale** (§3).
4. **La répartition par enveloppe** (§4).
5. **Les tests de cohérence** (§6).
