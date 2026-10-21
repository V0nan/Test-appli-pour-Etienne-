# Métré & Devis

Petit outil de devis pour peintre / décorateur : on saisit les métrés pièce par pièce, l'appli calcule les quantités de produits, le prix de vente, la marge, et garde un historique des devis acceptés ou refusés pour savoir jusqu'où on peut négocier.

Fonctionne sur téléphone, tablette et ordinateur, **sans compte, sans serveur et sans connexion** une fois ouverte.

## Ce que fait l'appli

| Onglet | À quoi ça sert |
|---|---|
| **Devis** | Métré par pièce (longueur × largeur × hauteur, ouvertures à déduire). Surfaces de murs, plafond, sol et périmètre calculées automatiquement. On ajoute les ouvrages, le prix se calcule. Total HT/TTC, marge nette, prix plancher et marge de négociation affichés en direct. Devis client imprimable en PDF et liste de courses (nombre de pots à acheter). |
| **Produits** | Base de prix des fournitures (peintures, enduits, bâches, scotch…). Modification d'un prix en un geste (l'ancien prix est gardé dans l'historique), hausse générale en % par fournisseur ou catégorie, export/import Excel (CSV), alerte pour les prix non vérifiés depuis 6 mois. |
| **Ouvrages** | Les travaux types : temps par m² (ou ml, ou unité) et produits consommés (avec nombre de couches). C'est là qu'on règle sa façon de chiffrer. |
| **Bilan** | Taux de signature, chiffre signé, marge moyenne des devis signés et refusés, remise moyenne accordée, prix au m² pratiqués par ouvrage, écart entre heures prévues et heures réelles, conseils de négociation. |
| **Réglages** | En-tête de l'entreprise (SIRET, assurance décennale…), taux horaire, coût réel de l'heure, coefficient sur fournitures, pertes, TVA, marge minimum. Sauvegarde et restauration. |

### Comment le prix est calculé

Pour chaque ligne du devis :

- **quantité** = surface de la pièce (ou quantité saisie à la main)
- **heures** = quantité × temps de l'ouvrage
- **fournitures** = quantité × (couches ÷ rendement du produit) × (1 + pertes) × prix d'achat
- **prix de vente** = heures × taux horaire facturé + fournitures × coefficient

La **marge nette** compare le prix au coût réel : fournitures achetées en pots entiers + heures × coût réel de l'heure + divers.
Le **prix plancher** est le prix qui garde juste la marge minimum : en dessous, on travaille presque sans bénéfice.

Chaque devis garde les prix du jour où il a été fait, donc changer un prix dans la base ne modifie pas les anciens devis. Un bouton propose de mettre à jour les devis en brouillon.

### Le retour d'expérience

1. Passer le devis en **Envoyé**, puis **Accepté** ou **Refusé**.
2. S'il est accepté, noter le **prix signé** (après négociation).
3. Quand le chantier est fini, noter les **heures réelles** et les **fournitures réellement achetées**.

L'onglet **Bilan** compare ensuite tout ça et indique la zone de marge que les clients acceptent.

## Mise en ligne (GitHub Pages, gratuit)

1. Sur GitHub : **Settings → Pages → Source : Deploy from a branch**, choisir la branche et le dossier `/ (root)`.
2. L'appli est alors disponible à l'adresse `https://<compte>.github.io/Test-appli-pour-Etienne-/`.
3. Sur le téléphone, ouvrir cette adresse puis **Ajouter à l'écran d'accueil** : l'appli s'ouvre comme une vraie appli et marche hors connexion.

Pour essayer en local : `python3 -m http.server` dans le dossier, puis ouvrir http://localhost:8000.

## Données et sauvegarde

Les données restent **dans le navigateur de l'appareil** (rien n'est envoyé nulle part). Conséquences :

- les données du téléphone et de l'ordinateur ne sont pas synchronisées ;
- vider les données du navigateur efface tout.

→ Faire régulièrement **Réglages → Télécharger une sauvegarde** et garder le fichier (mail, ordinateur, cloud). Le fichier se recharge avec **Restaurer une sauvegarde**, aussi pour passer d'un appareil à l'autre.

## Technique

- `index.html`, `src/app.js`, `src/style.css` : l'appli (JavaScript sans étape de compilation).
- `vendor/htm-preact-3.1.1.umd.js` : [Preact](https://preactjs.com) + [htm](https://github.com/developit/htm) (licence MIT), embarqué pour fonctionner hors ligne.
- `sw.js` + `manifest.webmanifest` : installation sur l'écran d'accueil et fonctionnement hors ligne. Changer `VERSION` dans `sw.js` à chaque nouvelle version.

## Pistes pour la suite

- Synchronisation entre téléphone et ordinateur (avec un petit service comme Supabase ou Firebase).
- Transformation d'un devis accepté en facture.
- Photos du chantier jointes au devis.
- Envoi du devis par e-mail directement depuis l'appli.
