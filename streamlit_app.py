"""Sika — point d'entrée Streamlit.

Ce fichier sert le prototype statique (index.html + CSS + JS) dans un composant
Streamlit, afin de pouvoir le déployer sur Streamlit Community Cloud.

  Lancer en local :   streamlit run streamlit_app.py
  Version statique :   python -m http.server 4173   (ouvrir index.html)

Les fichiers de l'application restent la source de vérité : ce module se contente
de lire index.html, styles.css, pages.css, screens.css et app.js, puis d'« inliner »
les ressources pour les injecter dans l'iframe du composant.
"""

from __future__ import annotations

import pathlib
import re

import streamlit as st
import streamlit.components.v1 as components

BASE_DIR = pathlib.Path(__file__).resolve().parent

APP_TITLE = "Sika — Votre activité, en toute clarté"
APP_ICON = "🧾"
CSS_FILES = ("styles.css", "pages.css", "screens.css")
COMPONENT_HEIGHT = 940


def read_text(name: str) -> str:
    """Lit un fichier du projet en UTF-8."""
    return (BASE_DIR / name).read_text(encoding="utf-8")


def build_app_html() -> str:
    """Retourne l'application complète avec CSS et JS intégrés."""
    html = read_text("index.html")

    for css_name in CSS_FILES:
        html, count = re.subn(
            rf'<link[^>]*href="{re.escape(css_name)}"[^>]*>',
            lambda _match, name=css_name: f"<style>\n{read_text(name)}\n</style>",
            html,
        )
        if count != 1:
            raise RuntimeError(f"Feuille de style introuvable dans index.html : {css_name}")

    html, count = re.subn(
        r'<script[^>]*src="app\.js[^"]*"[^>]*></script>',
        lambda _match: f"<script>\n{read_text('app.js')}\n</script>",
        html,
    )
    if count != 1:
        raise RuntimeError("Script app.js introuvable dans index.html")

    return html


def main() -> None:
    st.set_page_config(page_title=APP_TITLE, page_icon=APP_ICON, layout="wide")

    # L'application gère elle-même sa mise en page : on réduit l'interface Streamlit.
    st.markdown(
        """
        <style>
          [data-testid="stHeader"] { display: none; }
          .block-container { padding: 0 !important; max-width: 100% !important; }
          iframe[title="streamlit_components.v1.html"] { display: block; }
        </style>
        """,
        unsafe_allow_html=True,
    )

    components.html(build_app_html(), height=COMPONENT_HEIGHT, scrolling=True)


main()
