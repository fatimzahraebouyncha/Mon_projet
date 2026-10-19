# Sika — Votre activité, en toute clarté

Sika est un prototype d'**identité financière pour petits commerçants et microentreprises**.
L'idée : transformer les reçus, factures et ventes du quotidien en une comptabilité claire,
un tableau de bord lisible et un **dossier de financement** présentable à une banque ou une
institution de microfinance.

Application web statique (HTML / CSS / JavaScript, sans build ni backend), pensée pour un
usage simple sur téléphone comme sur ordinateur, en français et en FCFA.

---

## Lancer l'application

Aucune installation n'est requise. Deux options :

**Option 1 — serveur local (recommandé)**

```bash
cd mon_projet
python -m http.server 4173
```

puis ouvrir <http://127.0.0.1:4173> dans le navigateur.

**Option 2 — ouverture directe**

Double-cliquer sur `index.html`. L'application fonctionne aussi en `file://`
(la reconnaissance de texte (OCR) et les polices en ligne peuvent alors être limitées,
voir « Limites »).

---

## Ce que fait l'application

| Fonction | Description |
| --- | --- |
| **Vue d'ensemble** | Encaissements, dépenses, bénéfice net, trésorerie estimée, graphique 3/6 mois, activité récente, conseil du jour. |
| **Transactions** | Journal complet : ajout, modification, suppression, recherche, filtres (type, période), pagination. |
| **Scanner un reçu** | Photo/upload d'un reçu ou d'une facture, OCR en ligne si disponible, extraction automatique du montant, de la date, du commerçant et de la catégorie, puis validation en un écran. |
| **Documents** | Tous les justificatifs classés, avec aperçu du reçu, statut de vérification et lien vers l'opération associée. |
| **Rapport** | Synthèse financière par période (mois, 30 jours, trimestre, semestre) : chiffres clés, analyse rédigée, copie du résumé, impression PDF. |
| **Financement** | Score de préparation au crédit (0–100), détail des critères, checklist des pièces, simulateur de prêt (montant, durée, mensualité), aperçu et impression du dossier. |
| **Paramètres** | Profil de l'entreprise, préférences, export JSON/CSV, réinitialisation des données de démonstration. |

### Flux de scan
1. Onglet **Scanner un reçu** → bouton *Choisir une photo* (ou *Prendre une photo*).
2. Sans photo sous la main, trois **exemples** (grossiste, vente, transport) montrent le
   parcours complet avec une extraction pré-remplie.
3. L'écran d'extraction permet de corriger chaque champ avant d'ajouter l'opération à la
   comptabilité. Le document est alors classé automatiquement dans **Documents**.

### Dossier de financement

Le score (0–100) combine cinq critères visibles : historique, régularité des revenus,
rentabilité, documentation et capacité de remboursement. La checklist (identité, Mobile
Money, local, registre…) fait évoluer le score en direct, et le simulateur affiche la
mensualité estimée (taux annuel indicatif de 9 %). L'aperçu du dossier s'imprime en PDF
via l'impression du navigateur.

---

## Mode démonstration

- L'application démarre avec un jeu de démonstration : **Épicerie Chez Awa** (Awa Diallo,
  Abidjan), 6 mois d'opérations et 3 documents scannés liés à des transactions.
- Toutes les données sont **locales** (stockage `localStorage` du navigateur, clé
  `sika.app.v1`). Rien n'est envoyé sur un serveur.
- **Paramètres → Zone de démonstration → Réinitialiser** restaure le jeu de démonstration
  d'origine (avec confirmation).

---

## Déploiement

### GitHub + Streamlit Community Cloud (recommandé)

Le dépôt contient `streamlit_app.py` : un point d'entrée qui sert l'application
statique dans un composant Streamlit (les fichiers HTML/CSS/JS restent la source de
vérité, rien n'est dupliqué).

1. Pousser le dépôt :

   ```bash
   git init
   git add .
   git commit -m "Sika — prototype"
   git branch -M main
   git remote add origin https://github.com/<compte>/Mon_projet.git
   git push -u origin main
   ```

2. Sur <https://share.streamlit.io> : *Create app* → choisir le dépôt `Mon_projet`,
   la branche `main`, puis **Main file path : `streamlit_app.py`** → *Deploy*.
   `requirements.txt` installe Streamlit automatiquement.

3. Tester en local avant de déployer :

   ```bash
   streamlit run streamlit_app.py
   ```

### Hébergement statique (alternative sans Python)

L'application fonctionne telle quelle sur GitHub Pages, Netlify, Vercel, etc.
(GitHub Pages : *Settings → Pages → Deploy from branch → main / root*).

---

## Limites du prototype

- **OCR générique** : la reconnaissance de texte utilise Tesseract.js (chargé depuis un CDN).
  Sans connexion, le scan bascule automatiquement en **saisie manuelle assistée** ; les trois
  exemples restent disponibles et l'extraction des exemples est simulée côté application.
- **Pas de backend** : pas de compte, pas de synchronisation entre appareils, pas de
  sauvegarde cloud. Vider les données du navigateur efface l'historique.
- **Impression PDF** : l'export passe par la boîte d'impression du navigateur
  (« Enregistrer en PDF »).
- **Simulateur indicatif** : mensualités calculées localement, à titre pédagogique.
- L'interface cible un usage mobile en priorité ; le bureau est également pris en charge.

## Pistes de production

1. **OCR fiable** : remplacer Tesseract.js par un service dédié (OCR spécialisé reçus ou
   modèle multimodal) avec validation humaine des champs extraits.
2. **Backend et comptes** : API sécurisée, base de données, authentification par numéro de
   téléphone, chiffrement des justificatifs, sauvegarde automatique.
3. **Paiements et open banking** : rapprochement automatique avec le Mobile Money et les
   relevés bancaires pour enrichir le score.
4. **Dossier de crédit partageable** : export PDF signé, lien sécurisé à durée limitée pour
   l'institution financière.
5. **Conformité** : consentement, journal d'accès, durée de conservation des pièces.

---

## Structure du projet

```
mon_projet/
├── index.html    # structure de l'app, 7 pages, dialogues, sprite d'icônes
├── styles.css    # design system (thème forêt/crème/ambre), sidebar, KPI, graphiques
├── pages.css     # transactions, scanner, documents
├── screens.css   # rapport, financement, paramètres, modales, responsive, impression
├── app.js        # toute la logique : état, données démo, OCR, vues, simulateur
└── README.md
```

Application : **Sika 1.0.0** · données de démonstration relatives à la date du jour.
