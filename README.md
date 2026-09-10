# FonHincas App

Página web (hosteada en GitHub Pages) que muestra la app desarrollada en Google Apps Script, con Google Sheets como base de datos.

## Estructura
- `index.html` — página web pública (GitHub Pages).
- `Código.js`, `appsscript.json`, `.clasp.json` — proyecto de Google Apps Script vinculado al Google Sheet, gestionado localmente con [clasp](https://github.com/google/clasp).

## Apps Script
Para subir cambios del script:
```bash
clasp push
```
Para desplegar como Web App:
```bash
clasp deploy
```
