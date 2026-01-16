## Suivi Travaux 63B — site (statique)

### Lancer en local

Depuis le dossier du projet:

```bash
cd "/Users/dfilabs/Kevin Travaux 63B/travaux_site"
python3 -m http.server 8000
```

Puis ouvrir: `http://localhost:8000`

### Commentaires artisan

- Les statuts + commentaires sont sauvegardés automatiquement (localStorage).
- Pour partager:
  - **Exporter commentaires** (fichier JSON) puis l’artisan l’importe, ou
  - **Générer lien à partager** (URL contenant les commentaires dans le hash).

### Hébergement gratuit (URL publique)

Je peux préparer un déploiement Netlify/Vercel/GitHub Pages, mais pour obtenir une **URL publique** il faut un compte sur l’hébergeur (ou un token).

