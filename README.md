# Métré & Devis

Petit outil de devis pour peintre / décorateur : on saisit les métrés pièce par pièce, l'appli calcule les quantités de produits, le prix de vente, la marge, et garde un historique des devis acceptés ou refusés pour savoir jusqu'où on peut négocier.

Fonctionne sur téléphone, tablette et ordinateur, **sans compte, sans serveur et sans connexion** une fois ouverte.

## Ce que fait l'appli

| Onglet | À quoi ça sert |
|---|---|
| **Devis** | Métré par pièce (longueur × largeur × hauteur, compteurs de portes et fenêtres). Surfaces des murs, du plafond, du sol et tour de pièce calculés automatiquement. On touche les travaux à faire (boutons rapides), le prix se calcule. Total HT/TTC, bénéfice, prix mini et remise possible affichés en direct. Remise en un geste (−5 / −10 / −15 %). Devis client en PDF et liste de courses (nombre de pots à acheter). |
| **Produits** | Base de prix des fournitures (peintures, enduits, bâches, scotch…). Modification d'un prix en un geste (l'ancien prix est gardé), hausse ou baisse générale en %, alerte pour les prix non vérifiés depuis 6 mois. Import/export Excel en mode avancé. |
| **Travaux** | Les travaux types : combien de m² à l'heure et quels produits (avec nombre de couches). C'est là qu'on règle sa façon de chiffrer. |
| **Bilan** | En trois phrases : combien de devis signés, le bénéfice moyen, la remise moyenne accordée. Deux conseils maximum. Le détail (prix au m² par travail, temps prévu et réel par chantier) est sur un bouton. |
| **Réglages** | Entreprise (SIRET, assurance décennale…), prix de l'heure, coût de l'heure, TVA, acompte. Réglages avancés (marge sur produits, perte, bénéfice minimum, import Excel) derrière une case à cocher. Sauvegarde par partage (mail, WhatsApp) ou téléchargement. |

Au premier lancement, un écran « 3 étapes » guide le démarrage (entreprise, prix de l'heure, premier devis).

### Comment le prix est calculé

Pour chaque ligne du devis :

- **quantité** = surface de la pièce (ou quantité saisie à la main)
- **heures** = quantité × temps de l'ouvrage
- **fournitures** = quantité × (couches ÷ rendement du produit) × (1 + pertes) × prix d'achat
- **prix de vente** = heures × prix de l'heure + fournitures × (1 + marge sur produits)
- le prix unitaire est arrondi au centime, puis multiplié par la quantité : le devis client tombe juste

Le **bénéfice** (marge nette) compare le prix au coût réel : fournitures achetées en pots entiers + heures × coût réel de l'heure + divers.
Le **prix mini** est le prix qui garde juste le bénéfice minimum : en dessous, on travaille presque sans bénéfice.

Chaque devis garde les prix du jour où il a été fait, donc changer un prix dans la base ne modifie pas les anciens devis. Un bouton propose de mettre à jour les devis en brouillon.

### Le retour d'expérience

1. En haut de chaque devis : **Envoyé**, puis **Signé** ou **Refusé**.
2. S'il est accepté, noter le **prix signé** (après négociation).
3. Quand le chantier est fini, bouton **Chantier terminé ?** : noter les heures passées (et les produits achetés si différent). La liste rappelle les chantiers à compléter.

L'onglet **Bilan** compare ensuite tout ça et indique ce que les clients acceptent.

## Mise en ligne (GitHub Pages, gratuit)

1. Sur GitHub : **Settings → Pages → Source : Deploy from a branch**, choisir la branche et le dossier `/ (root)`.
2. L'appli est alors disponible à l'adresse `https://<compte>.github.io/Test-appli-pour-Etienne-/`.
3. Sur le téléphone, ouvrir cette adresse puis **Ajouter à l'écran d'accueil** : l'appli s'ouvre comme une vraie appli et marche hors connexion.

Pour essayer en local : `python3 -m http.server` dans le dossier, puis ouvrir http://localhost:8000.

## Données et sauvegarde

Les données restent **dans le navigateur de l'appareil** (rien n'est envoyé nulle part). Conséquences :

- les données du téléphone et de l'ordinateur ne sont pas synchronisées ;
- vider les données du navigateur efface tout.

→ Faire régulièrement **Réglages → Sauvegarder maintenant** (sur téléphone : s'envoyer le fichier par mail ou WhatsApp) et garder le fichier (mail, ordinateur, cloud). Le fichier se recharge avec **Récupérer une sauvegarde**, aussi pour passer d'un appareil à l'autre.

## Technique

- `index.html`, `src/app.js`, `src/style.css` : l'appli (JavaScript sans étape de compilation).
- `vendor/htm-preact-3.1.1.umd.js` : [Preact](https://preactjs.com) + [htm](https://github.com/developit/htm) (licence MIT), embarqué pour fonctionner hors ligne.
- `sw.js` + `manifest.webmanifest` : installation sur l'écran d'accueil et fonctionnement hors ligne. Changer `VERSION` dans `sw.js` à chaque nouvelle version.

## Pistes pour la suite

- Synchronisation entre téléphone et ordinateur (avec un petit service comme Supabase ou Firebase).
- Transformation d'un devis accepté en facture.
- Photos du chantier jointes au devis.
- Envoi du devis par e-mail directement depuis l'appli.
