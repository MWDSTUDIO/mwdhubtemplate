# The Inner House — Coordonnées bancaires : lecture, structure, vérification
**Brief autonome pour Claude Code.** Complète la section C (analyse de documents) du brief principal. À traiter après C, avant toute mise en production du module de paiement.

---

## Le but

Ne plus jamais retaper un IBAN à la main. Estelle dépose le contrat, le devis ou la photo du RIB, et la maison en ressort avec les coordonnées bancaires du prestataire déjà en place, structurées et contrôlées.

**Et un second but, qui commande tout le premier : ne jamais confondre « lu » et « vérifié ».**

---

## 0. L'avertissement qui gouverne ce document

Ce module est le plus sensible de toute l'application. Une ligne de budget fausse se corrige. Un virement de 298 000 € parti sur le mauvais compte ne revient pas.

Il faut distinguer deux risques de nature opposée :

**Le risque de transcription.** Un IBAN de 27 caractères recopié à la main, un `0` lu `O`, un `5` lu `S`. La lecture automatique **réduit fortement** ce risque, et c'est la raison légitime de construire ce module.

**Le risque de substitution.** C'est la fraude au faux fournisseur : un document qui a l'air authentique, portant des coordonnées qui ne sont pas celles du prestataire. C'est le mode opératoire le plus courant et le plus rentable contre les maisons qui manient de gros montants — et un mariage à sept chiffres est une cible de premier choix. Sur ce risque, **la lecture automatique n'aide pas : elle accélère.** Un agent qui lit vite et bien un faux document produit une fausse donnée, proprement formatée, avec un bel indice de confiance.

**Conséquence de conception, non négociable : l'agent lit, un humain vérifie hors bande, le système garde la trace de qui a vérifié et comment.** Tout ce qui suit découle de cette phrase.

---

## 1. Ce qui existe déjà, et qui est bon

`supabase/migrations/0011_budget_v2.sql` :

```sql
create table vendor_banking (
  vendor_id uuid primary key references vendors on delete cascade,
  wedding_id uuid not null references weddings on delete cascade,
  enc text not null,                   -- AES-256-GCM, clé côté serveur
  updated_at timestamptz not null default now()
);
create policy "team full" on vendor_banking
  for all using (app.is_team()) with check (app.is_team());
-- aucune policy client : le couple ne voit un IBAN que via une page
-- rendue par le serveur quand un paiement porte reveal_banking.
```

C'est une bonne base et il ne faut pas la casser : chiffrement au repos, RLS équipe uniquement, aucune policy cliente, révélation au cas par cas via `payments.reveal_banking`. `pgcrypto` est déjà activé.

**Trois manques :**

1. **Le blob `enc` est opaque.** Aucune structure, donc aucune validation par champ, aucune détection de changement, aucune empreinte.
2. **Aucune trace de vérification.** Rien ne distingue une coordonnée lue d'une coordonnée confirmée par téléphone.
3. **L'agent n'extrait rien de bancaire aujourd'hui.** Le schéma d'extraction de `src/app/api/agents/document/route.ts` ne contient aucun champ bancaire.

---

## 2. Le modèle de données — pourquoi quatre champs ne suffisent pas

La réponse courte à la question posée : **non, `titulaire + IBAN + BIC` ne suffit pas.** Pas parce que c'est faux, mais parce que ce jeu de champs ne couvre qu'un seul corridor de paiement — le SEPA. Dès qu'on sort de la zone euro, les champs changent de nature, et pas seulement de nombre.

Le modèle correct n'est donc **pas une liste fixe de colonnes**, mais un discriminant de corridor plus un jeu de champs propre à ce corridor.

### Bloc A — Le bénéficiaire (toujours requis)

| Champ | Pourquoi |
|---|---|
| `legal_name` | Le nom **exact tel qu'il est enregistré à la banque**. Pas le nom commercial. Voir §7 : depuis octobre 2025 c'est ce nom qui est confronté à l'IBAN à chaque virement en euros. |
| `trading_name` | Le nom sous lequel le prestataire se présente, s'il diffère. |
| `entity_type` | Société · auto-entrepreneur · particulier. Détermine la nature des données personnelles (voir §9). |
| `beneficiary_address` | Rue, code postal, ville, pays. **Exigée par la plupart des formulaires de virement hors SEPA** et par les règles de traçabilité des transferts. C'est la première cause de virement international bloqué. |
| `tax_id` | SIRET, TVA intracommunautaire, VAT number, EIN. Souvent imprimé dans le même bloc. |

### Bloc B — Le compte, selon le corridor

C'est ici que le jeu de champs varie. À stocker en `jsonb` validé selon `corridor`, jamais en colonnes fixes.

| Corridor | Champs requis |
|---|---|
| **SEPA** (zone euro + EEE) | `iban` seul suffit. Le BIC est facultatif depuis 2016 — le stocker s'il est fourni, ne jamais le réclamer. |
| **Royaume-Uni, en GBP** | `sort_code` (6 chiffres) + `account_number` (8 chiffres). **Pas d'IBAN.** |
| **Royaume-Uni, en EUR** | `iban` + `bic` |
| **Suisse** | `iban` + `bic` |
| **États-Unis** | `aba_routing` (9 chiffres) + `account_number` + `account_type` (checking / savings) + `swift` pour l'international |
| **Canada** | `institution_number` (3) + `transit_number` (5) + `account_number` |
| **Australie** | `bsb` (6) + `account_number` |
| **Inde** | `ifsc` + `account_number` |
| **Mexique** | `clabe` (18 chiffres) |
| **Japon** | `bank_code` (4) + `branch_code` (3) + `account_number` + nom du bénéficiaire en katakana |
| **Maroc, Tunisie, Moyen-Orient** | `rib` ou `iban` + `swift` + nom **et adresse** de la banque, systématiquement |
| **Reste du monde** | `account_number` + `swift` + nom et adresse complète de la banque |

Chaque corridor porte sa propre liste de champs obligatoires. Une fiche incomplète pour son corridor est **incomplète**, pas « à peu près bonne ».

### Bloc C — La banque (obligatoire hors SEPA)

`bank_name` · `branch_name` · `bank_address` (complète) · `bank_country`

En SEPA, l'IBAN suffit et ces champs sont décoratifs. **Hors SEPA, ils sont exigés par le formulaire de virement**, et c'est exactement le manque relevé dans la question : le nom de la banque et son adresse sont souvent indispensables.

### Bloc D — La banque intermédiaire (parfois, et c'est le piège)

`intermediary_bank_name` · `intermediary_swift` · `intermediary_account`

Sur certains corridors — Afrique, Moyen-Orient, Asie du Sud-Est, petites banques régionales — le virement doit transiter par une banque correspondante. Le prestataire l'indique sur son contrat, souvent en petits caractères sous le bloc principal.

**Omettre ce champ ne produit pas une erreur immédiate.** Le virement part, semble accepté, puis revient cinq à dix jours plus tard, frais déduits, à quinze jours d'un mariage. C'est le genre d'incident qu'on ne veut vivre qu'une fois.

### Bloc E — Les conditions de règlement

Elles figurent presque toujours dans le même bloc du contrat, et se perdent presque toujours.

| Champ | Pourquoi c'est important |
|---|---|
| `account_currency` | Un IBAN peut être rattaché à un compte multi-devises. Payer en euros sur un compte tenu en dollars déclenche une conversion au taux de la banque du prestataire — qui recevra moins que facturé et le dira. |
| `fee_arrangement` | **OUR** (l'émetteur paie tous les frais) · **SHA** (partagés) · **BEN** (le bénéficiaire paie tout). C'est le champ que personne ne note et la première cause de litige « vous m'avez sous-payé ». Sur un virement international, l'écart va de 15 à 60 €, davantage avec un intermédiaire. Si le contrat dit OUR, il faut le savoir avant d'émettre. |
| `payment_reference` | La référence à porter en libellé : numéro de facture, référence de contrat, nom du mariage. Sans elle, le prestataire ne rapproche pas et relance. |
| `notes` | Toute condition en clair : « virement uniquement », « pas de chèque », « acompte non remboursable après le 1er mars ». |

---

## 3. Ce que l'agent doit faire — et ce qu'il ne doit jamais faire

### Le sous-agent

Un sous-agent dédié, **distinct** de celui qui lit les budgets, sur le **modèle le plus capable disponible** (`ANALYSIS_MODEL`, voir C1 du brief principal). Il ne fait que ça.

**Entrées acceptées :** PDF en bloc `document` natif · photo ou scan en bloc `image` · capture d'écran. Une photo de RIB prise au téléphone est un cas d'usage principal, pas une tolérance.

**Sortie :** JSON strict portant, pour chaque champ, la valeur normalisée, **la lecture brute telle qu'elle apparaît**, un indice de confiance, et la localisation dans le document (page, zone).

### Les interdictions, à écrire en toutes lettres dans le system prompt

1. **Ne jamais deviner un caractère.** Les confusions à signaler systématiquement : `0`/`O`, `1`/`l`/`I`, `5`/`S`, `8`/`B`, `2`/`Z`, `6`/`G`. Un caractère douteux est signalé **avec sa position exacte**, jamais tranché.
2. **Ne jamais compléter un IBAN partiel.** Ni par calcul, ni par déduction du format national.
3. **Ne jamais déduire le BIC de l'IBAN.** C'est techniquement possible et pratiquement faux : une banque a plusieurs BIC, et les tables de correspondance sont périmées.
4. **Ne jamais inventer l'adresse d'une banque** à partir de son nom.
5. **Ne jamais déduire le corridor.** Il se lit dans le document ou dans les deux premières lettres de l'IBAN. Sinon, il est signalé comme inconnu.
6. **Ne jamais fusionner deux blocs bancaires.** Un contrat peut en porter plusieurs — le prestataire et son sous-traitant, ou un compte en euros et un compte en livres. Chaque bloc est extrait séparément, avec ce qui l'identifie.
7. **En cas de doute, ne pas remplir.** Un champ vide signalé vaut infiniment mieux qu'un chiffre plausible.

### Le stockage du document source

Un contrat portant des coordonnées bancaires va dans le bucket **`vault`**, pas `internal`. C'est le niveau Estelle seule. Il n'apparaît jamais dans la page Documents du client, quelle que soit la manipulation.

---

## 4. Les contrôles déterministes — gratuits, et systématiques

Avant tout affichage, avant toute écriture. Ce sont des calculs, pas des jugements : ils ne se trompent pas.

| Contrôle | Ce qu'il attrape |
|---|---|
| **Somme de contrôle IBAN, mod-97** (ISO 13616) | La quasi-totalité des erreurs de transcription et de lecture optique. **Bloquant.** |
| **Longueur IBAN par pays** | FR 27 · DE 22 · GB 22 · IT 27 · ES 24 · CH 21 · PT 25 · NL 18 · MC 27 · BE 16. Une longueur fausse = lecture incomplète. |
| **Format BIC** (ISO 9362) | 8 ou 11 caractères ; les positions 5 et 6 portent le code pays et doivent correspondre au pays de l'IBAN — sauf banque intermédiaire, où la divergence est normale. |
| **Clé du RIB français, mod-97** | Cohérence code banque / code guichet / numéro de compte. |
| **Somme de contrôle ABA** (mod 10 pondéré 3-7-1) | Routing américain. |
| **Chiffre de contrôle CLABE** | Mexique. |

**Un contrôle qui échoue rejette le champ.** Il ne l'affiche pas assorti d'un avertissement : l'expérience montre qu'un avertissement se clique. Le champ retourne en lecture à confirmer, avec la zone du document affichée à côté.

**Affichage pour relecture humaine :** l'IBAN se présente **en groupes de quatre caractères**, comme sur le RIB, avec le document source côte à côte. C'est ce format qui permet à l'œil de comparer sans se perdre.

---

## 5. La vérification hors bande — le point non négociable

Trois états, et un seul chemin entre eux :

```
read  →  verified  →  releasable
```

**`read`** — l'agent a lu, les contrôles déterministes passent. Ne permet aucun paiement.

**`verified`** — un humain de la maison a confirmé les coordonnées **de vive voix**, sur un numéro obtenu **indépendamment du document** : l'en-tête du contrat papier, le site du prestataire, un numéro déjà connu de la maison. **Jamais** le numéro figurant dans le document qui porte les coordonnées. **Jamais** une signature d'email. **Jamais** un rappel à un numéro qu'on vient de recevoir.

À enregistrer : `verified_by`, `verified_at`, `verification_method` (appel · en personne), `verification_contact` (le numéro appelé et le nom de l'interlocuteur).

**`releasable`** — un paiement ne peut pas être marqué prêt à émettre si les coordonnées du prestataire ne sont pas `verified`. C'est un verrou serveur, pas un rappel dans l'interface.

---

## 5 bis. Qui vérifie quoi — la règle de proportionnalité

**Point capital, à ne pas confondre :** la vérification de vive voix se fait **auprès du PRESTATAIRE**, jamais auprès du client. Estelle n'appelle pas un couple américain : elle appelle le château, le traiteur, le photographe — ceux dont elle va payer le compte. Une fois par prestataire, pas par échéance.

**Et côté client, le hub est entièrement automatique** : le couple se connecte, l'échéance est là, l'IBAN est là. Plus aucune saisie, plus aucun email à écrire. C'est plus automatisé qu'avant, pas moins.

### Le moteur de règles

Toutes les coordonnées ne portent pas le même risque. La vérification téléphonique n'est donc **pas systématique** : elle se déclenche sur des critères, calculés par le système.

| Situation | Vérification exigée |
|---|---|
| Nouveau prestataire · **SEPA en euros** · coordonnées issues d'un contrat reçu par un canal connu · montant sous le seuil | **Aucun appel.** Le contrôle mod-97 valide la forme, le nom légal est enregistré, et la vérification du bénéficiaire de la banque d'Estelle fait le contrôle nom/IBAN au moment du premier virement (voir §7). Statut : `verified by document` |
| Nouveau prestataire · **hors SEPA ou hors euro** (États-Unis, Royaume-Uni en livres, Suisse, Maroc, reste du monde) | **Appel obligatoire.** Aucun filet automatique n'existe sur ces corridors. |
| **Tout changement de coordonnées** sur un prestataire existant | **Appel obligatoire, sans exception.** C'est le scénario de fraude n° 1. Aucune règle ne le contourne. |
| Montant cumulé du prestataire **au-dessus du seuil** (à fixer par Estelle, par exemple 50 000 €) | **Appel obligatoire.** |
| Coordonnées reçues **par email** plutôt que dans un contrat signé | **Appel obligatoire.** |
| Honoraires MWD (compte de la maison) | Aucune vérification — c'est son propre compte. |

**En pratique, sur un mariage :** deux à quatre appels, à des prestataires, une fois chacun. Pas un appel par échéance, et aucun appel à un client.

### Ce qui compte comme « hors bande »

Le principe n'est pas « un appel téléphonique » : c'est **un canal qui n'a pas été fourni par le document lui-même**. Comptent donc :

- un appel sur un numéro pris sur l'en-tête du contrat papier, le site du prestataire, ou déjà connu de la maison avant l'arrivée du document ;
- une visioconférence déjà programmée avec ce prestataire ;
- une rencontre en personne — un repérage, une dégustation ;
- un message vocal sur un numéro que la maison avait **avant** de recevoir le document.

Ne comptent pas : le numéro figurant dans le document qui porte les coordonnées, une signature d'email, un rappel à un numéro qui vient d'appeler.

### Ce que le système fait tout seul

Pour ne laisser à Estelle que le geste irréductible :

- **Il calcule si l'appel est requis** et l'affiche sur la fiche : *« verification required — non-SEPA corridor »* ou *« no call required — SEPA, within threshold »*.
- **Il prépare l'appel** : le numéro à composer, pris hors du document et signalé comme tel, le nom légal à faire confirmer, les quatre derniers caractères de l'IBAN à faire relire — jamais l'IBAN entier à dicter.
- **Il enregistre la vérification en deux clics** : qui, quand, quel numéro, quel interlocuteur.
- **Il n'oublie pas** : une fiche en attente de vérification apparaît dans les alertes tant qu'elle bloque une échéance à venir, avec le délai restant.


---

## 6. La détection de changement — le signal de fraude numéro un

À la première lecture vérifiée, calculer une **empreinte** (hash) des champs de compte et la stocker.

Toute lecture ultérieure pour le même prestataire compare son empreinte à l'empreinte vérifiée.

**Si elle diffère :**

- **Alerte forte et immédiate** à Estelle, dans l'application et par email. Pas une notification discrète.
- Le statut retombe à `read`. **Les anciennes coordonnées ne sont pas écrasées** : elles restent en place, et la nouvelle lecture attend en parallèle.
- Une nouvelle vérification hors bande complète est exigée, avec sa propre trace.
- Table `vendor_banking_history` : toutes les versions, qui a vérifié, quand, et l'empreinte.

**Aucune mise à jour silencieuse de coordonnées bancaires, jamais, dans aucun cas.**

C'est précisément ce scénario que la fraude exploite : un prestataire déjà connu, déjà payé une fois, dont « les coordonnées ont changé ». Un changement d'IBAN sur un prestataire existant est une alerte par défaut, pas une mise à jour.

---

## 7. Verification of Payee — ce qui a changé depuis le 9 octobre 2025

Depuis cette date, les établissements de paiement de la zone euro doivent offrir gratuitement un service de vérification du bénéficiaire : avant d'autoriser un virement SEPA, le nom du bénéficiaire est confronté à l'IBAN, et le résultat revient sous forme de feu — correspondance exacte, correspondance approchante, absence de correspondance.

**Deux conséquences directes sur ce modèle de données.**

**Le nom légal exact devient un champ critique.** Enregistrer « Blu Notte » quand le compte est tenu par « Blu Notte Eventi S.r.l. » produira une correspondance approchante — donc un avertissement — à chaque virement. C'est pour cela que `legal_name` et `trading_name` sont deux champs distincts, et que c'est le nom légal qui part au virement.

**Et un point d'attention qui compte davantage :** cette vérification ne couvre que les virements SEPA en euros. Les paiements en livres, en dollars, en francs suisses — c'est-à-dire précisément les prestataires internationaux — n'en bénéficient pas. **Ce sont eux qui exigent la vérification hors bande la plus stricte**, puisqu'aucun filet automatique ne les protège. Le champ `corridor` doit donc piloter le niveau d'exigence : hors SEPA euro, la vérification téléphonique n'est pas recommandée, elle est obligatoire.

Enfin, si un avertissement est passé outre et que le virement part malgré tout, la responsabilité se déplace vers celui qui a autorisé. Raison de plus pour que le nom stocké soit le bon.

---

## 8. Ce que le client voit

- **Jamais automatiquement.** Le mécanisme existant — `payments.reveal_banking`, décidé échéance par échéance — est le bon. Ne pas le changer.
- **Ajouter un verrou :** une échéance ne peut pas être révélée si les coordonnées ne sont pas `verified`.
- **Présentation client :** l'IBAN en groupes de quatre, un bouton de copie, la référence à porter en libellé, le nom légal exact du bénéficiaire.
- **Une ligne dans la voix de la maison**, sous le bloc, à chaque révélation : *« The house will never send you new bank details by email. If you receive any, telephone us before you act on them. »* Cette phrase protège le couple mieux que n'importe quel dispositif technique — c'est lui qui émet le virement.

---

## 9. Conservation et données personnelles

- Les coordonnées d'un auto-entrepreneur ou d'un artisan individuel sont des **données personnelles**. Le traitement doit être minimisé et limité dans le temps.
- Chiffrement au repos : déjà en place, à conserver. **La clé vit hors de la base de données.**
- **Journal d'accès** : chaque consultation en clair est tracée — qui, quand, quel prestataire. Sans exception, y compris pour Estelle.
- **Purge** : suppression automatique un délai défini après le règlement de la dernière échéance du mariage. Une coordonnée bancaire conservée sans raison est un risque sans contrepartie.
- **Jamais en clair** dans un journal applicatif, dans un message d'erreur, dans une notification, ni dans un prompt envoyé à un modèle pour une autre tâche que la lecture initiale.

---

## 10. Ordre d'exécution

1. **Schéma** : structurer `vendor_banking` (corridor + `jsonb` validé + statut + trace de vérification), créer `vendor_banking_history`. Migration additive, sans perte.
2. **Contrôles déterministes** (§4) avec leurs tests unitaires. À faire avant l'agent : c'est le filet.
3. **Sous-agent de lecture** (§3) et son schéma de sortie.
4. **Écran de validation** : document source à gauche, champs extraits à droite, IBAN en groupes de quatre, acceptation champ par champ.
5. **Vérification hors bande** (§5) et le verrou serveur sur l'émission.
6. **Détection de changement** (§6) — à ne pas remettre à plus tard, c'est la protection la plus utile du lot.
7. **Révélation client** (§8) et le verrou sur `verified`.
8. **Journal d'accès et purge** (§9).

## Critères d'acceptation

- Une photo de RIB français prise au téléphone produit un IBAN qui passe le mod-97, ou un signalement — jamais un IBAN faux.
- Un contrat américain produit routing + account + type, et **n'invente pas d'IBAN**.
- Un contrat britannique en livres produit sort code + account number, et **ne réclame pas d'IBAN**.
- Un contrat marocain produit banque, agence et adresse complète, et signale l'absence de banque intermédiaire si le document n'en mentionne pas.
- Un IBAN dont un caractère est illisible sur la photo est **signalé avec sa position**, jamais complété.
- Un second contrat du même prestataire portant un IBAN différent déclenche une alerte forte et **n'écrase rien**.
- Aucune échéance ne peut être marquée prête à émettre, ni révélée au client, si le statut n'est pas `verified`.
- Aucune coordonnée n'apparaît en clair dans un journal.
