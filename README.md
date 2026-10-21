# Métré & Devis

Petit outil de devis pour peintre / décorateur : on saisit les métrés pièce par pièce, l'appli calcule les quantités de produits, le prix de vente, la marge, et garde un historique des devis acceptés ou refusés pour savoir jusqu'où on peut négocier.

Fonctionne sur téléphone, tablette et ordinateur, **sans compte, sans serveur et sans connexion** une fois ouverte.

## Contexte du projet

**Pour qui.** un peintre et décorateur, à son compte, à l'île Maurice. Il n'utilise pas beaucoup d'outils numériques. Aujourd'hui, il fait ses métrés sur chantier et calcule ses devis à la main dans un cahier, à partir de sa propre base de prix (peintures, sous-couches, enduits, bâches, scotch…).

**Ce qu'on cherche.**
1. **Gagner du temps** sur les métrés et le chiffrage.
2. **Tirer les leçons des devis passés** : quelle marge sur les devis signés et refusés, combien de remise accordée, temps prévu et temps réel. Le but est de savoir **jusqu'où il peut négocier**.
3. **Mettre à jour facilement** sa base de produits et leurs prix.
4. Le tout **très simple à utiliser**, surtout sur téléphone et sur chantier. C'est la condition pour qu'il l'adopte.

**Choix faits, et pourquoi.**
- **Appli web installable, sans compte ni serveur.** Rien à payer, rien à administrer, et l'appli marche sans réseau sur chantier. Les données restent sur son téléphone, d'où la sauvegarde mensuelle (voir plus bas).
- **Chaque devis garde les prix du jour où il a été fait.** Changer un prix dans la base ne fausse pas le bilan des anciens devis.
- **Le coût des produits compte les pots entiers achetés**, le prix de vente seulement ce qui est utilisé. La marge est donc prudente. Le détail du prix affiche la part de produit qui restera en stock.
- **Vocabulaire du métier plutôt que de la gestion** : « Travaux » plutôt qu'« ouvrages », « bénéfice » plutôt que « marge nette », « prix mini » plutôt que « prix plancher », « m² faits en 1 heure » plutôt que « heures par m² ». Les réglages techniques sont masqués par défaut.
- **Adapté à l'île Maurice** : roupies (Rs), TVA 15 % (ou sans TVA), BRN sur le devis. Pas de mentions propres à la France (TVA 10 %, assurance décennale).

**Historique.**
1. Première version : devis, produits, travaux, bilan et réglages.
2. **Relecture indépendante du code** par un second agent, puis corrections : centimes du devis client, import Excel (produits de même nom, prix vides, accents des fichiers Windows), protection contre la perte de données, numéros de devis en double.
3. **Audit d'ergonomie** pour un utilisateur peu à l'aise avec ces outils, puis simplification : écran de premiers pas, boutons rapides, compteurs portes et fenêtres, remise en un geste, bilan en 3 phrases, grandes zones tactiles.
4. Passage aux roupies et aux règles mauriciennes.

## Où en est le projet

- [x] Appli fonctionnelle, testée dans un navigateur (téléphone et ordinateur, mode clair et sombre).
- [ ] **Mise en ligne** : le dépôt est privé. Le passer en public, puis activer GitHub Pages (voir « Mise en ligne »).
- [ ] **Test par utilisateur ** sur son téléphone, sans aide, en notant où il bloque.
- [ ] **Saisir ses vrais chiffres** : prix des produits, vitesse de travail en m² à l'heure, prix et coût de l'heure. Les valeurs actuelles sont des **exemples inventés**.
- [ ] **Questions ouvertes** :
  - écrit-il « 3,500 » (habitude mauricienne) ou « 3 500 » pour trois mille cinq cents ? L'appli suit aujourd'hui l'usage français, où la virgule sert aux décimales ;
  - est-il enregistré à la TVA ? Si non, mettre la TVA à 0 ;
  - que contient son devis papier actuel qui manquerait ici ?

## Ce que fait l'appli

| Onglet | À quoi ça sert |
|---|---|
| **Devis** | Métré par pièce (longueur × largeur × hauteur, compteurs de portes et fenêtres). Surfaces des murs, du plafond, du sol et tour de pièce calculés automatiquement. On touche les travaux à faire (boutons rapides), le prix se calcule. Total HT/TTC, bénéfice, prix mini et remise possible affichés en direct. Remise en un geste (−5 / −10 / −15 %). Devis client en PDF et liste de courses (nombre de pots à acheter). |
| **Produits** | Base de prix des fournitures (peintures, enduits, bâches, scotch…). Modification d'un prix en un geste (l'ancien prix est gardé), hausse ou baisse générale en %, alerte pour les prix non vérifiés depuis 6 mois. Import/export Excel en mode avancé. |
| **Travaux** | Les travaux types : combien de m² à l'heure et quels produits (avec nombre de couches). C'est là qu'on règle sa façon de chiffrer. |
| **Bilan** | En trois phrases : combien de devis signés, le bénéfice moyen, la remise moyenne accordée. Deux conseils maximum. Le détail (prix au m² par travail, temps prévu et réel par chantier) est sur un bouton. |
| **Réglages** | Entreprise (BRN, n° de TVA, téléphone…), prix de l'heure, coût de l'heure, TVA, acompte. Réglages avancés (marge sur produits, perte, bénéfice minimum, import Excel) derrière une case à cocher. Sauvegarde par partage (mail, WhatsApp) ou téléchargement. |

L'appli est réglée pour **l'île Maurice** : montants en roupies (Rs), TVA à 15 % (à mettre à 0 si l'entreprise n'est pas enregistrée à la TVA auprès de la MRA ; le devis affiche alors un total sans TVA), BRN sur le devis. Le symbole de la monnaie se change dans les réglages avancés. Les nombres se tapent à la française : virgule pour les décimales (2,5 m), espace ou rien pour les milliers (3 500 ou 3500).

Au premier lancement, un écran « 3 étapes » guide le démarrage (entreprise, prix de l'heure, premier devis).

### Comment le prix est calculé

Pour chaque ligne du devis :

- **quantité** = surface de la pièce (ou quantité saisie à la main)
- **heures** = quantité ÷ m² faits en 1 heure (réglé dans « Travaux »)
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

GitHub Pages n'est gratuit que pour un dépôt **public**. Passer le dépôt en public ne montre que le code : les données des utilisateurs restent sur leur téléphone et ne sont jamais sur GitHub. Si le code doit rester privé, deux solutions : Netlify Drop (gratuit, en glissant le dossier sur app.netlify.com/drop) ou GitHub Pro (payant).

1. **Settings → General → Danger Zone → Change visibility → Public.**
2. **Settings → Pages → Source : Deploy from a branch**, branche `claude/outil-devis-peintre`, dossier `/ (root)`, puis **Save**.
3. Au bout d'1 à 2 minutes, l'appli est disponible à l'adresse `https://v0nan.github.io/Test-appli-pour-Etienne-/`.
4. Sur le téléphone, ouvrir cette adresse puis **Ajouter à l'écran d'accueil** :
   - iPhone : Safari → Partager → « Sur l'écran d'accueil » ;
   - Android : Chrome → ⋮ → « Installer l'appli ».

   Sur iPhone, c'est indispensable : sinon Safari peut effacer les données d'un site qu'on n'a pas ouvert depuis quelques jours.

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
