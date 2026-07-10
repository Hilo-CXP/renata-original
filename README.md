# Renata Batista — Psicologia & Arteterapia

Site institucional da psicóloga e arteterapeuta Renata Batista. Landing page responsiva com seções de apresentação, serviços, contato e formulário.

## Estrutura

```
renata-batista-site/
├── index.html          # Página principal
├── css/
│   └── styles.css      # Estilos
├── js/
│   └── main.js         # Interatividade (menu, scroll, formulário)
└── README.md
```

## Como visualizar

Abra o arquivo `index.html` diretamente no navegador, ou use uma extensão Live Server no VS Code.

### Com Live Server (VS Code)

1. Instale a extensão **Live Server**
2. Clique com botão direito em `index.html`
3. Selecione **Open with Live Server**

### Com Python (servidor local)

```bash
python -m http.server 8080
```

Acesse: http://localhost:8080

## Personalização

Antes de publicar, atualize:

- **WhatsApp:** links `wa.me/5500000000000` no HTML
- **E-mail, Instagram e telefone** na seção de contato e footer
- **Fotos:** substitua as URLs do Unsplash por imagens reais em uma pasta `assets/images/`
- **CRP e textos** conforme informações oficiais

## Publicar no GitHub

```bash
git init
git add .
git commit -m "Initial commit: landing page Renata Batista"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/renata-batista-site.git
git push -u origin main
```

Para hospedar gratuitamente, use [GitHub Pages](https://pages.github.com/): Settings → Pages → Source: branch `main`.

## Tecnologias

- HTML5 semântico
- CSS3 (Grid, Flexbox, custom properties)
- JavaScript vanilla
- Google Fonts (Cormorant Garamond + Inter)

## Licença

Projeto privado — Renata Batista © 2026
