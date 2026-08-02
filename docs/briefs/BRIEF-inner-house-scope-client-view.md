# The Inner House — Scope Budget : la Client view
**Brief générique, valable pour le template entier — aucun mariage en particulier.**
Fichiers : `src/app/[locale]/(hub)/budget/scope-client.tsx` · `page.tsx` · `messages/*.json`

---

## Le constat

En Client view, le Scope Budget ne rend **que le bandeau d'introduction** (*« Understanding your budget »*). Aucune enveloppe, aucun chiffre, aucune note. Un Scope invisible du client n'a aucune raison d'être : c'est précisément la page qui doit rendre l'expertise de la maison visible.

**Première tâche : dire pourquoi.** Avant de coder, répondre en une phrase : est-ce un état brouillon non publié qui se comporte comme prévu, ou la vue client de ce module n'a-t-elle jamais été construite ? La réponse conditionne la taille du chantier.

---

## LE BUT

> Qu'un couple — n'importe lequel — ouvre le Scope Budget et comprenne **en une lecture** trois choses distinctes : ce que la maison lui recommande d'allouer, ce qui a été décidé ensemble, et ce qui est réellement engagé à ce jour. Sans jargon, sans avoir à demander.

C'est la page où la valeur d'Estelle se voit. Si elle est vide ou confuse, le module entier perd sa raison d'être.

---

## Ce qui doit être vrai — pour tout mariage

### 1. Les trois niveaux, toujours distingués

Pour chaque enveloppe :

| Niveau | Ce que c'est | Voix |
|---|---|---|
| **Recommended by the house** | L'enveloppe conseillée par la maison, en % et en montant | Autorité — c'est le conseil |
| **Forecast** | Le prévisionnel arbitré avec le couple | Neutre — c'est la décision commune |
| **Committed** | Ce qui est réellement engagé | Factuel — c'est le réel |

- **Jamais un tableau comptable froid** : l'enveloppe se lit comme une page de maison — le nom, la note, les trois chiffres alignés proprement.
- **Committed est calculé, jamais saisi** — dérivé des lignes du Budget Management rattachées à l'enveloppe, provenance *« booked by the couple »* comprise. C'est ce qui garantit que l'analyse reste vraie même quand le couple réserve des prestataires seul. House % et Forecast restent des saisies de la maison.

### 2. Le total en tête

Budget global · engagé · reste à placer. **Trois chiffres, rien d'autre.**

### 3. Les écarts en langage clair

- *« €18,000 still to place »* — jamais « variance », jamais un signe moins à interpréter.
- Un écart significatif entre *Recommended* et *Forecast* s'accompagne d'une **note de la maison** qui l'explique — c'est là que l'expertise se montre.
- Un dépassement se **dit** (*« €X beyond the allotted budget »*), traitement visuel distinct, note de la maison.

### 4. La note d'enveloppe

Serif italique, signée « — Estelle », rédigée ou éditée par elle (ou composée par Madame sur ses indications). **Brouillon jusqu'à publication.** Le côté éducationnel est conservé : chaque enveloppe explique ce qu'elle recouvre — un couple ne sait pas ce qu'un poste « production » contient.

### 5. Les états, sans exception

- Enveloppe sans engagement → ***Not yet placed***, jamais un zéro sec.
- **Rien n'apparaît au couple avant publication.** Brouillon → publication, comme tout le hub.
- Tant que rien n'est publié, la Client view affiche un **état vide tenu** : *« The house is composing your budget scope. »* — jamais une page blanche, jamais le seul bandeau d'introduction. La différence entre une page blanche et cette phrase est la différence entre un module cassé et une maison au travail.

### 6. « Beyond the envelopes » n'existe pas côté client

C'est un bac de tri **Team view uniquement** (état transitoire : toute ligne engagée doit finir dans une enveloppe ; le bac alerte l'équipe). Côté client : **les totaux incluent toujours tout** — rien ne disparaît des chiffres — mais le détail par enveloppe ne montre que ce qui est placé.

### 7. Template, pas mariage

Rien de spécifique à un couple en dur. Enveloppes, notes, seuils : tout vient des données du mariage courant.

### 8. Mobile

Les trois niveaux lisibles à **430 px, empilés, sans défilement horizontal**.

---

## LE STOP

En dehors de cette Client view et des points budget déjà validés : **aucune refonte, aucun retrait, aucune réorganisation, aucune initiative sur le Scope Budget.** La forme finale du module (le garder, le réduire à une analyse texte, autre chose) est une décision d'Estelle — elle la prendra devant la vue fonctionnelle, publiée, sur un mariage réel.

---

## Livraison

Deux captures avant validation, sur la démo :

1. **Avant publication** — l'état vide tenu.
2. **Après publication** d'un scope complet avec notes d'enveloppe — desktop **et** 430 px.

Puis `/impeccable audit` sur la vue.
