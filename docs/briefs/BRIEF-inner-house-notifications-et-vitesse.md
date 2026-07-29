# The Inner House — Notifications de paiement & vitesse du hub
**Deux sujets distincts, réunis parce qu'ils touchent tous deux au sentiment que le hub « répond ».**

---

# PARTIE I — Les notifications de paiement

## Le but

Que le couple sache **avant** qu'une échéance tombe, sans qu'Estelle ait à y penser ni à écrire un email. Et que la maison garde la trace de ce qui a été envoyé, à qui, quand.

## 1. Ce qui existe déjà

- `payments` porte `due_date`, `paid_at`, `reveal_banking`.
- `composePaymentNotice(weddingId, paymentId)` et `sendPaymentNotice(...)` existent dans `actions/budget.ts`.
- `actions/banking.ts` existe désormais — le chantier des coordonnées a commencé.
- `vendor_banking` chiffré, révélation par échéance.

La mécanique est amorcée. Ce qui manque, c'est le **déclenchement automatique**, le **contenu**, et les **règles de sécurité**.

## 2. Le déclenchement

Trois moments, et pas un de plus :

| Quand | Objet |
|---|---|
| **J−21** | *An instalment is coming.* Le couple a le temps d'organiser un virement international. |
| **J−5** | Rappel, uniquement si l'échéance n'est pas marquée réglée. |
| **J+3** | Rappel discret, uniquement si toujours non réglée — et **une notification interne à Estelle**, parce qu'un retard se traite par téléphone, pas par email. |

- **Jamais de notification sur une échéance en brouillon.** Le verrou est serveur.
- **Jamais deux notifications le même jour**, même si deux échéances tombent : un seul email qui les regroupe.
- Chaque envoi est enregistré : quelle échéance, quel jour, à quelle adresse. **On ne renvoie jamais deux fois la même.**
- Un délai de 21 jours par défaut, **modifiable par échéance** : un virement vers le Maroc ne se prépare pas comme un prélèvement SEPA.

## 3. Le contenu — et la règle qui le gouverne

> **Aucune coordonnée bancaire ne figure jamais dans un email. Jamais.**

C'est non négociable, et ce n'est pas de la prudence excessive : **l'email est le vecteur de la fraude au virement.** Un email qui contient un IBAN est un email qu'on peut intercepter, imiter, renvoyer modifié. Le couple qui a l'habitude de recevoir ses coordonnées par email est exactement le couple qui paiera un faux.

L'email dit donc :
- l'échéance, son montant, sa devise, sa date ;
- le prestataire et ce qu'elle règle ;
- **une invitation à se connecter à The Inner House** pour consulter les coordonnées — jamais les coordonnées elles-mêmes ;
- une ligne de la maison, à chaque envoi : *« The house will never send you bank details by email. If you receive any, telephone us before you act on them. »*

**Expédié depuis la boîte d'Estelle ou de Jordane**, jamais depuis une adresse technique. Signé de la main qui suit le mariage.

Le texte est **composé par Madame et validé par Estelle** avant le premier envoi d'un mariage, puis réutilisé. Ce n'est pas une notification système, c'est un mot de la maison.

## 4. Le lien avec les coordonnées bancaires

- **Une échéance dont les coordonnées ne sont pas `verified` ne déclenche aucune notification.** Verrou serveur. Prévenir le client de payer alors que le compte n'a pas été vérifié de vive voix, c'est le contraire de ce qu'il faut faire.
- La notification et la révélation de l'IBAN sont **deux gestes distincts** : Estelle peut prévenir sans révéler, et révéler sans prévenir.
- Si les coordonnées d'un prestataire changent, **toute notification programmée pour lui est suspendue** jusqu'à nouvelle vérification.

## 5. Dans l'application

- Une mention dans les *attentions* du client sur Home, avec le compteur.
- Jamais en doublon : si c'est dans les attentions, ce n'est pas répété sur trois autres pages.
- Une échéance réglée disparaît des attentions **sans notification de disparition**.

---

# PARTIE II — La vitesse du hub

## Le but

Que rien ne rappelle jamais qu'il y a un serveur au bout du fil. Une action, un résultat. Sur une journée de travail, la latence cumulée est le premier facteur d'agacement — avant le design, avant les fonctions manquantes.

## 6. « Les pings » — ce qu'ils peuvent et ne peuvent pas faire

Un battement régulier entre le navigateur et le serveur est **utile pour deux choses précises** :

1. **Garder la session vivante.** Un jeton qui expire au milieu d'une saisie provoque un aller-retour d'authentification — l'attente la plus frustrante de toutes, parce qu'elle arrive au pire moment. Un rafraîchissement anticipé, avant expiration, la supprime. C'est le seul usage vraiment indispensable.
2. **Savoir que les données ont bougé.** Quand Estelle et Jordane travaillent en même temps, un battement léger permet de signaler *« cette page a changé »* plutôt que de laisser deux versions divergentes.

**Mais il faut être clair : un battement ne rend pas la navigation plus rapide.** Il ne précharge rien, il n'accélère aucune requête. Et mal réglé, il coûte : batterie sur téléphone, requêtes inutiles, quota.

**Les règles :** intervalle long (30 à 60 secondes, pas 5) ; **suspendu quand l'onglet est en arrière-plan** ; suspendu hors ligne, reprise à la reconnexion ; une seule requête, minuscule, sans charge utile.

Les vrais leviers de vitesse sont ailleurs, et le principal est un vrai défaut.

## 7. Le défaut principal : le cache est détruit à chaque écriture

Dans `src/app/actions/`, on compte **huit occurrences** de :

```ts
revalidatePath("/", "layout");
```

Cette instruction invalide **le cache de l'application entière**. Chaque modification de timeline, chaque publication, efface le rendu mis en cache de **toutes** les pages — Budget, Documents, Guests, Design Studio comprises.

Conséquence directe : après chaque petite édition, la navigation suivante, quelle qu'elle soit, doit tout recalculer depuis la base. **C'est très exactement la sensation de lenteur qui s'installe au fil d'une session de travail** — plus on travaille, plus l'application semble ralentir, alors qu'elle refait simplement tout, tout le temps.

**Correctif :** invalider **la route concernée, et elle seule**.

```ts
revalidatePath("/timeline");   // et non "/" en layout
```

Le mode `"layout"` sur la racine ne se justifie que pour un changement qui affecte réellement toutes les pages — un changement de mariage courant, une bascule de langue. Pas pour l'ajout d'un jalon.

**C'est la correction la plus rentable de tout ce document.**

## 8. Ce qui est déjà bien fait

À conserver, et à généraliser aux autres pages :

- **`budget/page.tsx` regroupe ses requêtes en `Promise.all`.** Une page qui enchaîne dix `await` séquentiels attend dix fois ; celle-ci attend une fois. Vérifier que **toutes** les pages du hub font de même — c'est souvent le plus gros gain de latence dans une application de ce type.

## 9. Les autres leviers, par ordre de rendement

1. **Précharger la route suivante.** Au survol d'un lien de navigation, le rendu de la page cible est demandé en avance. Le clic devient instantané. Coût de mise en œuvre : faible.
2. **Affichage optimiste partout.** Une modification s'affiche immédiatement et se réconcilie en arrière-plan. Déjà présent par endroits — à généraliser à toute écriture, avec retour en arrière visible en cas d'échec.
3. **Ne pas envoyer au navigateur ce qu'il n'affiche pas.** Vérifier ce que les composants clients reçoivent en propriétés : un mariage entier sérialisé pour afficher trois chiffres coûte à chaque chargement.
4. **Virtualiser les tableaux longs.** `.ledger-wrap` a un `max-height: 70vh` mais rend **toutes** les lignes. À trente lignes c'est indolore ; à deux cents, le tableau devient poussif au défilement et à la frappe. À traiter quand un mariage réel dépassera la centaine de lignes — pas avant, mais en le sachant.
5. **Une seule requête par page, pas une par composant.** Les données descendent depuis la page, elles ne se re-demandent pas à chaque niveau.
6. **Images dimensionnées et en formats modernes**, chargement différé hors du premier écran. Les planches de design ne doivent pas ramer.

## 10. Les objectifs mesurables

- **Navigation entre deux pages : moins de 300 ms** de ressenti, préchargement compris.
- **Toute écriture affiche son résultat en moins de 100 ms** (affichage optimiste).
- **Aucune session ne rencontre d'aller-retour d'authentification** pendant une saisie.
- **Lighthouse ≥ 90** en performance sur les vues clientes, en mobile.
- **Aucun saut de mise en page** au chargement.
- **Le battement est invisible** : pas d'indicateur d'activité qui clignote toutes les trente secondes.

---

## Ordre

1. **§7 — Corriger les huit `revalidatePath("/", "layout")`.** C'est une heure de travail et le gain le plus net.
2. **§8 — Vérifier le `Promise.all` sur toutes les pages**, pas seulement le budget.
3. **§6 — Le battement**, réglé selon ses trois règles, avec le rafraîchissement anticipé de session comme objectif premier.
4. **§9.1 et 9.2** — préchargement et affichage optimiste généralisé.
5. **Partie I** — les notifications, avec leur verrou sur `verified` et l'interdiction absolue de l'IBAN par email.
6. **§9.3 à 9.6** — les optimisations de charge.
7. **§10** — mesurer, et me montrer les chiffres.
