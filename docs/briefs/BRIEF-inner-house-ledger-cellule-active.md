# The Inner House — Le Ledger : cellule active et marqueur de brouillon
**Correction ciblée. Deux points, rien d'autre.**
Fichiers concernés : `src/app/globals.css` · `src/app/[locale]/(hub)/budget/ledger-client.tsx`

---

## 1. La cellule active est illisible et donne l'impression d'une erreur

### Le constat

```css
.ledger .cell-focus { box-shadow: inset 0 0 0 2px var(--champagne); }
```

C'est **le seul signal** de la cellule active : un liseré champagne de 2 px. Trois défauts qui se cumulent :

- Le champagne est une couleur de **filet**, pas de sélection. À 2 px sur fond crème, le contraste est faible et le rectangle flotte au milieu du tableau **sans lien visible avec sa ligne** — il ressemble à un champ de saisie égaré, pas à une cellule sélectionnée.
- **La ligne n'est pas marquée du tout.** Sur un tableau large, on voit la cellule mais on ne sait plus quelle ligne on édite. C'est le geste le plus fréquent du module et il n'est pas accompagné.
- **Rien ne distingue « sélectionné » de « en train de taper ».** Dans un tableur, cette différence est capitale : elle dit si la prochaine frappe déplace le curseur ou écrase la valeur.

### Le correctif

**Deux états visuellement distincts, et la ligne toujours marquée.**

**A. La ligne active** — un fond très discret sur toute la largeur de la ligne, pour que l'œil suive horizontalement :

```css
.ledger tr.row-active > td { background: oklch(0.7749 0.0521 76.74 / 0.07); }
```

Et le **nom de la ligne** (colonne 2, déjà figée) passe en graisse **500** et en `--hunter` plein sur la ligne active. C'est le repère principal.

**B. La cellule sélectionnée** — navigation aux flèches, pas de saisie en cours :

```css
.ledger td.cell-focus {
  background: var(--parchment);
  box-shadow: inset 0 0 0 1px var(--hunter);
  font-weight: 500;
  color: var(--hunter);
}
```

Le liseré passe de **2 px champagne à 1 px vert chasse** : plus fin, mais nettement plus lisible, et c'est l'encre de la maison plutôt qu'une couleur de filet. Le liseré doit être **exactement à fleur des bords de la cellule**, aligné sur les filets du tableau — c'est ce décalage qui donnait l'impression d'un élément flottant.

**C. La cellule en édition** — une saisie est en cours :

```css
.ledger td.cell-editing {
  background: var(--surface);
  box-shadow: inset 0 0 0 1.5px var(--hunter);
}
```

Fond **blanc franc** : le texte qu'on tape est sur le fond le plus lisible possible, et le passage du parchemin au blanc dit sans ambiguïté qu'on est entré dans la cellule.

**D. Le survol**, plus léger que la sélection, pour ne pas créer de confusion :

```css
.ledger tbody tr:hover > td { background: oklch(0.7749 0.0521 76.74 / 0.04); }
```

### Critères d'acceptation

- En parcourant le tableau aux flèches, **on voit d'un coup d'œil la ligne ET la cellule**, sans les chercher.
- On distingue immédiatement une cellule sélectionnée d'une cellule en édition.
- Aucun rectangle ne paraît flotter : le liseré est à fleur des bords, aligné sur les filets.
- Les lignes de groupe (`.ledger-group`, fond parchemin) ne sont jamais confondues avec une ligne active — vérifier le rendu quand la ligne active est juste sous un en-tête de groupe.
- Le mode dense (`.ledger.dense`) garde le même traitement, sans que les liserés se touchent.
- Contraste vérifié : `/impeccable audit` après la modification.
- Aucun usage de bande alternée : le repérage se fait par la ligne active et le survol, pas par du zébrage.

---

## 2. Le petit carré en début de ligne ressemble à un bug

### Le constat

`ledger-client.tsx`, ligne 502 :

```tsx
{r.draft && <span className="tag int" title={t("status.draft")}>·</span>}
```

Un `.tag` complet — 12 px, capitales, `letter-spacing: 0.16em`, `padding: 4px 10px`, bordure champagne, fond teinté — **pour contenir un seul point médian**.

Résultat : une boîte bordée d'environ 26 px de large avec un point perdu dedans, décalé sur la droite parce que l'interlettrage de 0,16em s'applique aussi à un caractère unique. Visuellement, c'est un élément cassé. Et le sens — « brouillon » — n'existe **que dans un attribut `title`**, donc invisible pour qui ne survole pas, et inaccessible au lecteur d'écran.

### Le correctif

**Sortir le marqueur de la colonne du nom et lui donner sa propre colonne.**

1. **Une colonne d'état étroite** (18–20 px) en première position du tableau, sans en-tête visible (`aria-label` sur le `th`). Elle porte le marqueur de toutes les lignes, alignées verticalement — on repère les brouillons en balayant la colonne, sans que le nom des lignes bouge.

2. **Un point nu, sans boîte** : un disque de 5 px en `--bronze`, centré. Pas de bordure, pas de fond, pas de padding, pas de `letter-spacing`. Une ligne publiée laisse la case vide.

3. **Accessibilité** : `aria-label` explicite sur l'élément (par ex. *« not yet published »*) en plus du `title`, et un texte en `sr-only`. Le sens ne doit jamais reposer sur la seule couleur ni sur le seul survol.

4. **Une légende, une seule fois**, sous la barre d'outils du tableau, dans la voix de la maison — par exemple : *« · not yet published to the couple »*. Elle dispense d'expliquer le point ligne par ligne.

5. **Ne pas remplacer par le mot `DRAFT` dans la colonne du nom** : sur un tableau de trente lignes dont la plupart sont en brouillon, la répétition encombre et écrase le nom des prestataires, qui est l'information utile.

6. **Ne pas utiliser de bande verticale sur le bord de la ligne** : Impeccable l'interdit, et c'est de toute façon confondu avec la ligne active du point 1.

### Critères d'acceptation

- Plus aucune boîte bordée contenant un caractère seul, nulle part dans le Ledger.
- Les marqueurs de brouillon sont **alignés verticalement** et se balayent d'un regard.
- Le nom des lignes commence à la même abscisse, qu'elles soient en brouillon ou publiées.
- Le sens est accessible sans survol et sans dépendre de la couleur.
- La légende apparaît une fois, pas par ligne.

---

## Ordre

Le point 1 d'abord — c'est une modification de CSS et deux classes à poser. Le point 2 ensuite, qui touche la structure du tableau.

Montre-moi une capture du Ledger avec une cellule sélectionnée, une cellule en édition et au moins deux lignes en brouillon, avant et après.
