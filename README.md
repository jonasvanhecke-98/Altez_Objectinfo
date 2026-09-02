# Altez Objectinfo

Trimble Connect 3D Viewer-extensie voor labels per uniek Tekla-merk.

## Standaardpreset
- **Merk** -> `Tekla Assembly` / `Cast Unit Mark`
- De preset is ingebouwd en kan niet worden aangepast of verwijderd.

## Werking
1. Selecteer Tekla-objecten in de 3D Viewer.
2. De extensie leest `Cast Unit Mark` en dedupliceert de selectie naar unieke merken.
3. Kies een preset.
4. Klik **Merklabels plaatsen**.
5. Eigen presets kunnen worden gemaakt vanuit de parameters die in de huidige selectie aanwezig zijn en worden lokaal in de browser opgeslagen.

## GitHub Pages
Plaats de bestanden in de root van repository `Altez_Objectinfo` en activeer GitHub Pages op de `main` branch/root.

Manifest URL:
`https://jonasvanhecke-98.github.io/Altez_Objectinfo/manifest.json`


## v4
Selectie-uitlezing gebruikt nu altijd `viewer.getSelection()` + `viewer.getObjectProperties()` zodat de volledige properties van geselecteerde elementen worden opgehaald.
