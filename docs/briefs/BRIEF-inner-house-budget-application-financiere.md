# The Inner House — Le Budget comme petite application financière
**Brief de cadrage. À lire avant les briefs de correction du budget — il donne le niveau d'exigence auquel ils répondent.**

---

## Le but, et le critère de réussite

Le module Budget ne doit pas être un beau tableau. Ce doit être **une petite application financière**, avec l'intelligence que cela suppose.

Le critère est double, et il faut les deux :

> **Un directeur financier de groupe hôtelier doit pouvoir ouvrir ce module et le reconnaître comme un outil de gestion.**
> **Et le couple doit pouvoir l'ouvrir et le trouver limpide.**

Sur les mêmes données. C'est exactement ce que font les deux vues, The Ledger et The House Book — mais elles ne suffiront pas si le moteur en dessous n'a pas la rigueur d'un outil financier.

**La différence entre un tableau et une application financière tient en trois mots : le temps, la traçabilité, l'alerte.** Un tableau montre l'état à l'instant présent. Une application financière sait d'où vient chaque chiffre, où va l'argent dans les mois qui viennent, et vous prévient avant que ce soit un problème.

---

## 0. Ce qui est déjà juste — à ne pas casser

Le socle est meilleur qu'on pourrait le croire, et ces choix doivent survivre à tout ce qui suit :

- **Les montants sont en `numeric`**, pas en `float` ni en `real`. C'est le choix correct : arithmétique exacte, pas d'erreur d'arrondi binaire. **Ne jamais convertir un montant en type flottant, sous aucun prétexte.**
- **`budget_risks`** avec `exposure` × `probability` — le Risk Buffer existe et il est bien pensé.
- **`activity_log`** (migration 0015) — il y a un journal.
- **`vendor_banking`** chiffré, équipe seule.
- **`payments`** porte déjà `method`, `payer`, `refundable`, `reveal_banking`.
- **Les barrières RLS** sur les cinq rôles.

---

## 1. Les fondations financières — à corriger avant tout le reste

### 1.1 La devise appartient à l'engagement, pas seulement au paiement

`budget_lines` n'a **aucune colonne `currency`**. Seule `payments` en a une. Un engagement de £120,000 auprès d'un prestataire britannique est donc stocké comme `committed = 120000` sans devise — et la devise n'existe qu'au niveau des échéances individuelles.

C'est une faille structurelle : l'engagement **est** libellé dans une devise, c'est sa nature. Le jour où deux lignes de devises différentes s'additionnent, le total est faux sans que rien ne le signale.

**Correctif :** `currency` sur `budget_lines` et sur `budget_line_items`, non nulle, avec la devise du prestataire par défaut. Aucune addition de montants de devises différentes sans passer par une conversion tracée.

### 1.2 Un taux de change ne s'improvise pas

`payments.amount_eur` porte le commentaire *« equivalent, kept by Madame »*. Autrement dit : un agent renseigne une contre-valeur en euros **sans qu'aucun taux, aucune date, aucune source ne soit enregistrée**.

Dans une application financière, c'est disqualifiant : une conversion dont on ne peut pas retrouver le taux n'est pas auditable, et deux personnes qui regardent le même chiffre à deux mois d'écart ne comprennent pas le même montant.

**Correctif :** une table `fx_rates` — paire, taux, date, source. Chaque conversion référence une ligne de cette table. **Un montant déjà converti et réglé ne se recalcule jamais rétroactivement.**

### 1.3 L'écart de change réalisé doit exister

Quand une échéance est réglée à un taux différent de celui de l'engagement, la différence est un **écart de change réalisé**. Elle doit apparaître comme telle — une ligne, pas un arrondi qui disparaît. Sur un mariage avec 300 000 € d'engagements en devises, l'écart cumulé se compte en milliers.

### 1.4 L'arrondi se décide, il ne se subit pas

`numeric` est déclaré sans échelle. La règle doit être écrite une fois et appliquée partout :

- **Deux décimales** pour tout montant monétaire.
- **Arrondi au plus proche, à l'écart de zéro** à la demi-unité.
- L'arrondi s'applique **à l'affichage et au stockage d'un total calculé**, jamais entre deux étapes de calcul.
- **Ne jamais additionner des valeurs déjà arrondies** pour produire un total : sommer les valeurs exactes, arrondir le résultat.

### 1.5 Les totaux font autorité côté serveur

Aucun total affiché ne provient d'une somme calculée dans le navigateur. Le serveur calcule, le client affiche. C'est la règle de tout outil qui manipule de l'argent.

---

## 2. Le temps — ce qui manque le plus

C'est ici que l'écart entre un tableau et une application financière est le plus visible.

### 2.1 La courbe de trésorerie

**Mois par mois : ce qui sort du compte.** Pour un couple qui engage sept chiffres, **le calendrier compte autant que le montant**. Savoir qu'il reste 527 000 € à payer n'est pas la même information que savoir que 310 000 € partent en mars.

- Barres mensuelles des sorties prévues, du mois courant jusqu'au mariage, et au-delà s'il reste des soldes.
- **Courbe cumulée** superposée, ramenée au budget total.
- Distinction visuelle entre **payé**, **engagé daté**, et **engagé non daté** (les échéances conditionnelles — voir G9 du brief sur les échéanciers).
- Les mois lourds se voient immédiatement. C'est l'information que le client attend et qu'aucun outil de wedding planning ne donne.

C'est, à mon sens, la fonction la plus « application financière » qui manque aujourd'hui.

### 2.2 Un prévisionnel figé, sinon pas d'analyse d'écart

À chaque publication, enregistrer un **instantané** du budget. Sans ligne de base, la notion d'écart n'existe pas — on ne peut comparer qu'à hier.

Cela permet la lecture qui compte vraiment : **le budget à la signature, le budget aujourd'hui, le budget final.** Et de dire au client *pourquoi* ça a bougé.

### 2.3 L'historique de chaque ligne

`activity_log` existe : il faut s'assurer que **toute modification budgétaire y écrit** — quoi, de quelle valeur à quelle valeur, par qui, quand. Un budget sans historique n'est pas auditable, et le jour où un client demande « pourquoi ce poste est passé de 41 000 à 47 000 ? », il faut pouvoir répondre en dix secondes.

---

## 3. L'exposition en devises

Une agrégation, par devise, des **engagements non encore payés**.

> *£120,000 et $80,000 restent à régler.*
> *Une variation de 5 % représente environ 9 400 €.*

Ce n'est pas un conseil de couverture — la maison ne fait pas de gestion de change. C'est une **information d'exposition**, celle qu'un client qui manie ces montants s'attend à trouver, et que ses prestataires internationaux rendent nécessaire.

À afficher côté client de façon sobre et factuelle ; côté équipe avec la sensibilité chiffrée.

---

## 4. La TVA, prise au sérieux

- **Le taux appartient à la ligne**, pas au budget. Un traiteur, une location de château, une prestation artistique et un transport ne portent pas le même taux, et pas dans tous les pays.
- **HT, TVA et TTC toujours cohérents** — et calculés, jamais saisis trois fois.
- **Un prestataire étranger qui facture sans TVA** (autoliquidation) doit être **signalé comme tel**, pas enregistré comme un taux à 0 %. Ce n'est pas la même chose et la confusion se paie.
- **Le service charge est distinct de la TVA.** Un hôtel qui ajoute 15 % de service puis la TVA par-dessus produit un total que personne ne retrouve à la main.
- **La récupérabilité** : un mariage privé ne récupère rien, mais un événement porté par une société change tout. Le champ doit exister, même s'il reste à « non » dans la quasi-totalité des cas.

---

## 5. Le rapprochement — l'intelligence la plus utile de tout le module

Un prestataire produit jusqu'à quatre documents : **proposition → contrat → facture → justificatif de paiement**. Une application financière les **rapproche**.

C'est ici que Madame gagne réellement sa place — non pas en rédigeant de la prose, mais en attrapant ce qu'un humain manque à vingt-trois heures :

> *Le contrat dit €195,000. La facture dit €197,400. Écart de €2,400 — service charge non inclus au contrat ?*

À signaler systématiquement :

- Un **écart entre contrat et facture**, avec une hypothèse nommée quand elle est plausible.
- Un montant **engagé sans contrat au dossier**.
- Un paiement **marqué réglé sans justificatif attaché**.
- Une **somme d'échéances différente du total du contrat**.
- Un **acompte réglé deux fois** — la détection de doublon sur montant, prestataire et fenêtre de dates.

Chaque signalement dit ce qu'il a comparé et où regarder. Aucun ne se résout tout seul.

---

## 6. Les alertes — c'est cela, « l'intelligence nécessaire »

**Un tableau montre. Une application financière prévient.**

| Alerte | Déclencheur | Pourquoi elle compte |
|---|---|---|
| Échéance à J-14 non réglée | date + statut | La base. |
| **Fenêtre d'annulation d'un acompte non remboursable** | date limite − X jours | **La plus précieuse du lot.** Passé cette date, l'argent est perdu quoi qu'il arrive. Personne n'y pense à temps. |
| Devis dont la validité est dépassée | date de validité | Le prestataire peut réviser son prix. |
| Enveloppe qui va dépasser son allocation | engagé + en cours > allocation | Avant, pas après. |
| Somme des échéances ≠ engagé | contrôle permanent | Un solde oublié. |
| Engagé sans contrat au dossier | rapprochement | Exposition juridique. |
| Coordonnées bancaires modifiées | empreinte | Signal de fraude n° 1. |
| Exposition devise qui bouge de plus de X % | taux vs taux d'engagement | Anticipation. |
| Dépassement du budget global | engagé > budget | Doit être impossible à manquer. |

**Les règles des alertes :**

- Une alerte **dit ce qu'il faut faire**, pas seulement ce qui va mal.
- Elle se **classe sans bruit**, avec un motif enregistré — et l'historique garde qu'elle a été vue.
- Elle **groupe** : un panneau consulté, jamais un flux qui déroule.
- Elle **n'apparaît jamais au client.** Le couple voit la sérénité ; la maison voit la mécanique.

---

## 7. Les scénarios — décider avant d'engager

> *« Et si on ajoute un artificier à 18 000 € ? »*

Un mode simulation qui montre l'impact — sur l'enveloppe, sur le total, sur le reste à engager, sur la courbe de trésorerie — **sans rien écrire** tant que ce n'est pas validé. Deux scénarios comparables côte à côte.

C'est la conversation qu'Estelle a réellement avec ses clients. Aujourd'hui elle la tient de tête ou dans un tableur à côté. Elle doit pouvoir la tenir dans le hub, et la montrer.

---

## 8. La clôture — et ce qu'elle rapporte à la maison

À la fin du mariage, un **état final** : par enveloppe, prévu / engagé / payé / écart, avec les écarts expliqués.

Deux usages, et le second est le plus précieux :

1. **Le document de clôture du client** — la dernière page de la relation, et une pièce dont on se souvient.
2. **L'apprentissage de la maison.** Les pourcentages réels par enveloppe, mariage après mariage, alimentent la colonne **« Recommended by the house »** du Scope Budget. C'est ainsi que le conseil d'Estelle cesse d'être une intuition pour devenir une donnée — sept ans de mariages qui parlent.

---

## 9. Les indicateurs de la maison — équipe seule

- Les honoraires MWD en part du budget total, par mariage et en moyenne.
- La distribution moyenne des enveloppes sur l'ensemble des mariages.
- **La justesse du prévisionnel** : budget initial contre budget final. C'est l'indicateur qui mesure la compétence de la maison.
- La ponctualité de règlement, par client et par prestataire.

**Aucun de ces indicateurs n'est visible d'un client, jamais, sous aucune vue.**

---

## 10. Les règles d'intégrité — non négociables

- **Rien n'est écrasé silencieusement.** Toute valeur remplacée laisse sa trace.
- **Chaque chiffre est traçable** jusqu'à son document source et sa page.
- **Le journal est immuable** : on y ajoute, on n'y modifie pas.
- **Les totaux se calculent côté serveur.**
- **Les écritures sont idempotentes** : un double-clic ne crée jamais deux échéances.
- **La règle d'arrondi est écrite** et testée.
- **Les montants restent en `numeric`.** Jamais de flottant.
- **Chaque règle ci-dessus est couverte par un test**, pas seulement par une intention.

---

## Ce que le client ne voit jamais

Les alertes, les indicateurs de la maison, les signalements de rapprochement, les scénarios non retenus, la sensibilité au change, les écarts de change réalisés, le journal.

Il voit trois grands chiffres justes, une barre qui dit où il en est, une répartition claire, une courbe de trésorerie qui lui dit quand payer, et des notes de la maison qui expliquent. **La rigueur se sent dans le calme du résultat, elle ne s'expose pas.**

---

## Ordre d'exécution

1. **§1 — Les fondations** : devise sur les lignes, table des taux, règle d'arrondi, totaux côté serveur. Rien de solide ne se construit avant.
2. **Les correctifs déjà documentés** : les trois grands chiffres, l'ajout de lignes, la cellule active, les échéanciers.
3. **§2.1 — La courbe de trésorerie.** Le plus grand gain de perception pour le client, et le plus visible.
4. **§6 — Les alertes**, en commençant par la fenêtre d'annulation des acomptes non remboursables.
5. **§5 — Le rapprochement des documents.**
6. **§2.2 et 2.3 — Les instantanés et l'historique.**
7. **§3 et §4 — Exposition devises et TVA.**
8. **§7 — Les scénarios.**
9. **§8 et §9 — La clôture et les indicateurs de la maison.**
10. **§10 — Les tests d'intégrité**, en accompagnement de chaque étape et non à la fin.
