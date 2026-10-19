# Sika — Votre activité, en toute clarté

Sika est un prototype d'**identité financière pour petits commerçants et microentreprises**.
L'idée : transformer les reçus, factures et ventes du quotidien en une comptabilité claire,
un tableau de bord lisible et un **dossier de financement** présentable à une banque ou une
institution de microfinance.

Application web statique (HTML / CSS / JavaScript, sans build ni backend), pensée pour un
usage simple sur téléphone comme sur ordinateur, en français et en FCFA.

Un **assistant financier intégré** complète le tableau de bord : suivi des dettes et
créances, détection d'anomalies, prévision de trésorerie, recommandations et rapport
actualisé — d'abord avec un moteur local hors ligne, puis avec Claude (IA) quand une clé
API est connectée.

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
| **Assistant IA** | Copilote financier : dettes & créances avec échéances, détection d'anomalies, prévision de trésorerie à 45 jours, recommandations concrètes, rapport financier actualisé, analyse et questions libres avec Claude (option). |
| **Transactions** | Journal complet : ajout, modification, suppression, recherche, filtres (type, période), pagination. |
| **Scanner un reçu** | Photo/upload d'un reçu ou d'une facture, extraction automatique (IA Claude ou OCR Tesseract.js en secours), puis validation en un écran. |
| **Documents** | Tous les justificatifs classés, avec aperçu du reçu, statut de vérification et lien vers l'opération associée. |
| **Rapport** | Synthèse financière par période (mois, 30 jours, trimestre, semestre) : chiffres clés, analyse rédigée, copie du résumé, impression PDF. |
| **Financement** | Score de préparation au crédit (0–100), détail des critères, checklist des pièces, simulateur de prêt (montant, durée, mensualité), aperçu et impression du dossier. |
| **Paramètres** | Profil de l'entreprise, préférences, connexion de l'assistant IA, export JSON/CSV, réinitialisation des données de démonstration. |

### Assistant IA

L'assistant fonctionne en **deux niveaux** :

1. **Moteur local (par défaut, sans clé, 100 % hors ligne)** — il suit les dettes et
   créances avec leurs échéances (ajout, modification, règlement en un clic),
   détecte les anomalies (doublons possibles, montants inhabituels, justificatifs
   manquants, échéances en retard), projette la trésorerie à 45 jours à partir du
   rythme récent et des échéances, produit des recommandations chiffrées et rédige
   un rapport financier complet (situation, évolution, vigilances, échéances,
   recommandations, informations manquantes pour le dossier). Le rapport se copie
   et s'imprime en PDF.

2. **IA Claude (optionnel)** — dans **Paramètres → Assistant IA**, collez une clé API
   Anthropic (`sk-ant-…`, créée sur <https://console.anthropic.com>). La clé est
   stockée **uniquement dans le navigateur** (clé de stockage `sika.ai.v1`, jamais
   incluse dans les exports). Une fois connecté :
   - **Analyser avec l'IA** : Claude lit le résumé de vos chiffres et identifie les
     risques et priorités.
   - **Rédiger avec l'IA** : un rapport financier prêt à présenter à une banque.
   - **Poser une question** : dialogue en français (« Vais-je pouvoir payer le loyer
     cette semaine ? »), l'assistant répond avec vos données réelles.
   - **Lecture des reçus par l'IA** : quand l'IA est activée, une photo de reçu est
     analysée par Claude (modèle multimodal) pour une extraction plus fiable que
     l'OCR classique ; en cas d'échec, la lecture locale reprend automatiquement.

> **Confidentialité** : sans IA, rien ne quitte l'appareil. Avec l'IA, seul un résumé
> chiffré de votre activité (ou la photo du reçu au moment du scan) est envoyé à
> Anthropic — jamais vos autres documents. Une clé committée dans le code serait
> publique : ne l'écrivez jamais dans un fichier du dépôt, collez-la dans l'application.

### Flux de scan
1. Onglet **Scanner un reçu** → bouton *Choisir une photo* (ou *Prendre une photo*).
   Avec l'IA activée, la photo passe par Claude ; sinon, OCR local Tesseract.js.
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
  Abidjan), 6 mois d'opérations, 3 documents scannés liés à des transactions, 3 dettes et
  3 créances (dont une en retard) pour illustrer l'assistant.
- Toutes les données sont **locales** (stockage `localStorage` du navigateur, clé
  `sika.app.v1`). Rien n'est envoyé sur un serveur, sauf si vous activez l'IA.
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

- **Extraction des reçus** : avec l'IA activée, la photo passe par Claude (excellent taux de
  lecture) ; sans clé, l'application utilise Tesseract.js (chargé depuis un CDN) et bascule
  en **saisie manuelle assistée** hors ligne. Les trois exemples restent disponibles et leur
  extraction est simulée côté application.
- **Clé API côté navigateur** : c'est un choix de prototype assumé (aucun backend). La clé
  reste sur l'appareil et la conversation part directement vers Anthropic, mais pour une
  vraie mise en production il faudrait un petit serveur qui garde la clé côté serveur.
- **Pas de backend** : pas de compte, pas de synchronisation entre appareils, pas de
  sauvegarde cloud. Vider les données du navigateur efface l'historique et la clé IA.
- **Impression PDF** : l'export passe par la boîte d'impression du navigateur
  (« Enregistrer en PDF »).
- **Simulateur indicatif** : mensualités calculées localement, à titre pédagogique.
- L'interface cible un usage mobile en priorité ; le bureau est également pris en charge.

## Pistes de production

1. **Clé API côté serveur** : un petit proxy (Streamlit, FastAPI…) garde la clé Anthropic
   hors du navigateur et journalise les appels — prérequis pour un usage public.
2. **OCR fiable** : généraliser la lecture multimodale des reçus avec validation humaine
   des champs extraits (déjà en place côté écran de vérification).
3. **Backend et comptes** : API sécurisée, base de données, authentification par numéro de
   téléphone, chiffrement des justificatifs, sauvegarde automatique.
4. **Paiements et open banking** : rapprochement automatique avec le Mobile Money et les
   relevés bancaires pour enrichir le score.
5. **Dossier de crédit partageable** : export PDF signé, lien sécurisé à durée limitée pour
   l'institution financière.
6. **Conformité** : consentement, journal d'accès, durée de conservation des pièces.

---

## Structure du projet

```
mon_projet/
├── index.html      # structure de l'app, 8 pages, dialogues, sprite d'icônes
├── styles.css      # design system (thème forêt/crème/ambre), sidebar, KPI, graphiques
├── pages.css       # transactions, scanner, documents
├── screens.css     # rapport, financement, assistant IA, paramètres, responsive, impression
├── app.js          # toute la logique : état, démo, IA (analyses, Claude), vues, OCR
├── streamlit_app.py# point d'entrée Streamlit (inline l'app statique)
├── requirements.txt
└── README.md
```

Application : **Sika 1.1.0** · données de démonstration relatives à la date du jour.
